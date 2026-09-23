<?php

declare(strict_types=1);

namespace AuditService;

use PDO;

/**
 * audit_events in audit-db, reached as audit_writer (INSERT + SELECT only).
 *
 * There is deliberately no update or delete method, and the database would
 * refuse one anyway (see database/01-schema.sql).
 */
final class PdoEventStore implements EventStore
{
    // Every column a reader receives. ip_address is stored but never returned:
    // the core app's Audit Logs view has never shown it, and a read API should
    // not widen what is exposed.
    private const READ_COLUMNS = 'id, event_id, occurred_at, actor_user_id, actor_name, actor_role,
        action, module, target_type, description';

    public function __construct(private PDO $pdo)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    }

    public function append(array $event): bool
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO audit_events
                (event_id, occurred_at, source, actor_user_id, actor_name, actor_role,
                 action, module, target_type, description, ip_address)
             VALUES
                (:event_id, :occurred_at, :source, :actor_user_id, :actor_name, :actor_role,
                 :action, :module, :target_type, :description, :ip_address)
             ON CONFLICT (event_id) DO NOTHING'
        );

        $statement->execute([
            'event_id' => $event['event_id'],
            'occurred_at' => $event['occurred_at'],
            'source' => $event['source'],
            'actor_user_id' => $event['actor_user_id'],
            'actor_name' => $event['actor_name'],
            'actor_role' => $event['actor_role'],
            'action' => $event['action'],
            'module' => $event['module'],
            'target_type' => $event['target_type'],
            'description' => $event['description'],
            'ip_address' => $event['ip_address'],
        ]);

        return $statement->rowCount() === 1;
    }

    public function recent(int $limit, ?int $actorUserId): array
    {
        $sql = 'SELECT '.self::READ_COLUMNS.' FROM audit_events';
        $params = [];

        if ($actorUserId !== null) {
            $sql .= ' WHERE actor_user_id = :actor';
            $params['actor'] = $actorUserId;
        }

        $sql .= ' ORDER BY occurred_at DESC, id DESC LIMIT '.$limit;

        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return array_map(fn (array $row) => [
            'id' => (int) $row['id'],
            'event_id' => $row['event_id'],
            'occurred_at' => (new \DateTimeImmutable($row['occurred_at']))->format(\DateTimeInterface::ATOM),
            'actor_user_id' => $row['actor_user_id'] === null ? null : (int) $row['actor_user_id'],
            'actor_name' => $row['actor_name'],
            'actor_role' => $row['actor_role'],
            'action' => $row['action'],
            'module' => $row['module'],
            'target_type' => $row['target_type'],
            'description' => $row['description'],
        ], $statement->fetchAll());
    }

    public function lastLogins(array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($userIds), '?'));
        $statement = $this->pdo->prepare(
            "SELECT actor_user_id, MAX(occurred_at) AS last_login
               FROM audit_events
              WHERE action = 'LOGIN' AND actor_user_id IN ($placeholders)
           GROUP BY actor_user_id"
        );
        $statement->execute(array_values($userIds));

        $result = [];
        foreach ($statement->fetchAll() as $row) {
            $result[(string) $row['actor_user_id']] =
                (new \DateTimeImmutable($row['last_login']))->format(\DateTimeInterface::ATOM);
        }

        return $result;
    }

    public function ping(): void
    {
        $this->pdo->query('SELECT 1');
    }
}
