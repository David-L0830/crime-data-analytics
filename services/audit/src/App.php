<?php

declare(strict_types=1);

namespace AuditService;

use Throwable;

/**
 * The whole HTTP interface, as a pure function of the request, so the test
 * suite can drive it without a web server.
 *
 *   GET  /health                        unsigned; liveness + database reachability
 *   POST /v1/events                     append one event (idempotent on event_id)
 *   GET  /v1/events?limit=&actor_user_id=
 *                                       newest first; limit 1..500 (default 200)
 *   GET  /v1/last-logins?user_ids=1,2   latest LOGIN per user
 *
 * Every /v1 request must carry a valid signature (see Signature). There is no
 * route that updates or deletes, by design.
 */
final class App
{
    private const MAX_LIMIT = 500;

    private const DEFAULT_LIMIT = 200;

    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    public function __construct(
        private EventStore $store,
        private string $secret,
    ) {}

    /**
     * @param  array<string, string>  $headers  lower-cased names
     * @return array{0: int, 1: array<string, mixed>}
     */
    public function handle(string $method, string $requestUri, array $headers, string $body, int $now): array
    {
        $method = strtoupper($method);
        $path = parse_url($requestUri, PHP_URL_PATH) ?: '/';
        parse_str((string) parse_url($requestUri, PHP_URL_QUERY), $query);

        try {
            if ($method === 'GET' && $path === '/health') {
                $this->store->ping();

                return [200, ['status' => 'ok']];
            }

            if (! str_starts_with($path, '/v1/')) {
                return [404, ['message' => 'Not found.']];
            }

            if (! Signature::verify(
                $this->secret,
                $headers['x-audit-timestamp'] ?? null,
                $headers['x-audit-signature'] ?? null,
                $method,
                $requestUri,
                $body,
                $now,
            )) {
                return [401, ['message' => 'Invalid or missing request signature.']];
            }

            return match (true) {
                $method === 'POST' && $path === '/v1/events' => $this->append($body, $now),
                $method === 'GET' && $path === '/v1/events' => $this->recent($query),
                $method === 'GET' && $path === '/v1/last-logins' => $this->lastLogins($query),
                in_array($path, ['/v1/events', '/v1/last-logins'], true) => [405, ['message' => 'Method not allowed. The audit trail is append-only.']],
                default => [404, ['message' => 'Not found.']],
            };
        } catch (Throwable $e) {
            // Nothing from the exception reaches the caller: a database error
            // can name hosts, roles and SQL.
            error_log('service-audit: '.get_class($e).': '.$e->getMessage());

            return [500, ['message' => 'The audit service could not complete the request.']];
        }
    }

    private function append(string $body, int $now): array
    {
        $input = json_decode($body, true);

        if (! is_array($input)) {
            return [422, ['message' => 'The body must be a JSON object.']];
        }

        $errors = [];
        $event = [
            'event_id' => $this->requiredMatch($input, 'event_id', self::UUID, $errors),
            'occurred_at' => $this->occurredAt($input, $now, $errors),
            'source' => $this->optionalString($input, 'source', 64, $errors) ?? 'app-core',
            'actor_user_id' => $this->optionalInt($input, 'actor_user_id', $errors),
            'actor_name' => $this->optionalString($input, 'actor_name', 190, $errors),
            'actor_role' => $this->optionalString($input, 'actor_role', 64, $errors),
            'action' => $this->requiredString($input, 'action', 64, $errors),
            'module' => $this->optionalString($input, 'module', 64, $errors),
            'target_type' => $this->optionalString($input, 'target_type', 64, $errors),
            'description' => $this->optionalString($input, 'description', 2000, $errors),
            'ip_address' => $this->optionalString($input, 'ip_address', 45, $errors),
        ];

        if ($errors !== []) {
            return [422, ['message' => 'The event is invalid.', 'errors' => $errors]];
        }

        $created = $this->store->append($event);

        // 200 for a duplicate rather than an error: a retry of an event that
        // already arrived has succeeded, and the sender must stop retrying.
        return $created
            ? [201, ['status' => 'created', 'event_id' => $event['event_id']]]
            : [200, ['status' => 'duplicate', 'event_id' => $event['event_id']]];
    }

    private function recent(array $query): array
    {
        $limit = isset($query['limit']) && ctype_digit((string) $query['limit'])
            ? max(1, min(self::MAX_LIMIT, (int) $query['limit']))
            : self::DEFAULT_LIMIT;

        $actor = null;
        if (isset($query['actor_user_id'])) {
            if (! ctype_digit((string) $query['actor_user_id'])) {
                return [422, ['message' => 'actor_user_id must be a positive integer.']];
            }
            $actor = (int) $query['actor_user_id'];
        }

        return [200, ['data' => $this->store->recent($limit, $actor)]];
    }

    private function lastLogins(array $query): array
    {
        $ids = array_values(array_filter(
            explode(',', (string) ($query['user_ids'] ?? '')),
            fn (string $id) => ctype_digit($id),
        ));

        return [200, ['data' => (object) $this->store->lastLogins(array_map('intval', array_slice($ids, 0, 1000)))]];
    }

    // --- validation helpers -------------------------------------------------

    private function requiredString(array $input, string $key, int $max, array &$errors): ?string
    {
        $value = $input[$key] ?? null;
        if (! is_string($value) || trim($value) === '' || mb_strlen($value) > $max) {
            $errors[$key] = "Required, at most {$max} characters.";

            return null;
        }

        return $value;
    }

    private function optionalString(array $input, string $key, int $max, array &$errors): ?string
    {
        $value = $input[$key] ?? null;
        if ($value === null) {
            return null;
        }
        if (! is_string($value) || mb_strlen($value) > $max) {
            $errors[$key] = "Must be text of at most {$max} characters.";

            return null;
        }

        return $value;
    }

    private function optionalInt(array $input, string $key, array &$errors): ?int
    {
        $value = $input[$key] ?? null;
        if ($value === null) {
            return null;
        }
        if (! is_int($value) || $value < 1) {
            $errors[$key] = 'Must be a positive integer.';

            return null;
        }

        return $value;
    }

    private function requiredMatch(array $input, string $key, string $pattern, array &$errors): ?string
    {
        $value = $input[$key] ?? null;
        if (! is_string($value) || ! preg_match($pattern, $value)) {
            $errors[$key] = 'Required, in the expected format.';

            return null;
        }

        return strtolower($value);
    }

    private function occurredAt(array $input, int $now, array &$errors): ?string
    {
        $value = $input['occurred_at'] ?? null;

        try {
            $at = is_string($value) ? new \DateTimeImmutable($value) : null;
        } catch (\Exception) {
            $at = null;
        }

        // An event from the future is a clock or forgery problem; a small
        // allowance absorbs ordinary skew between containers.
        if ($at === null || $at->getTimestamp() > $now + Signature::MAX_SKEW_SECONDS) {
            $errors['occurred_at'] = 'Required, an ISO-8601 time not in the future.';

            return null;
        }

        return $at->format('Y-m-d\TH:i:s.uP');
    }
}
