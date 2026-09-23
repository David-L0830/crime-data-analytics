<?php

namespace App\Services\Audit;

use App\Jobs\ShipAuditEvent;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * The audit trail in service-audit, the isolated microservice.
 *
 * WRITES are queued: record() builds the event and dispatches ShipAuditEvent,
 * which delivers it over signed HTTP with retries. Dispatch waits for the
 * surrounding database transaction to COMMIT (DB::afterCommit), so an action
 * that rolls back is never audited as though it happened — the same outcome a
 * rolled-back audit_logs row gave.
 *
 * READS go straight to the service (signed), and are reshaped into the exact
 * AuditLogResource format, so the frontend cannot tell which store answered.
 */
class ServiceAuditStore implements AuditStore
{
    public function __construct(private AuditServiceClient $client) {}

    public function record(array $entry, ?string $eventId = null): void
    {
        // service-audit has no users table, so who acted is captured now, as
        // they were at the moment of acting.
        $actor = isset($entry['user_id']) ? User::find($entry['user_id']) : null;

        $event = [
            'event_id' => $eventId ?? (string) Str::uuid(),
            'occurred_at' => now()->format('Y-m-d\TH:i:s.uP'),
            'source' => 'app-core',
            'actor_user_id' => $actor?->id,
            'actor_name' => $actor?->name,
            'actor_role' => $actor?->role,
            'action' => (string) $entry['action'],
            'module' => $entry['module'] ?? null,
            'target_type' => $entry['target_type'] ?? null,
            'description' => $entry['description'] ?? null,
            'ip_address' => $entry['ip_address'] ?? null,
        ];

        DB::afterCommit(function () use ($event) {
            try {
                Bus::dispatch(new ShipAuditEvent($event));
            } catch (\Throwable $e) {
                // The queue itself is unreachable. The action has already
                // committed, so failing the request now would only hide that
                // it happened; instead the whole event is written to the log,
                // from where it can be replayed.
                Log::critical('Audit event could not be queued for service-audit.', [
                    'event' => $event,
                    'exception' => $e::class,
                ]);
            }
        });
    }

    public function recent(int $limit): array
    {
        return array_map(fn (array $row) => $this->shape($row), $this->client->events($limit));
    }

    public function forUser(User $user, int $limit): array
    {
        return array_map(fn (array $row) => $this->shape($row), $this->client->events($limit, $user->id));
    }

    public function lastLogins(array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        $result = [];
        foreach ($this->client->lastLogins($userIds) as $userId => $at) {
            // In the app timezone, as the audit_logs timestamps are rendered.
            $result[(int) $userId] = Carbon::parse($at)->setTimezone(config('app.timezone'));
        }

        return $result;
    }

    public function isRemote(): bool
    {
        return true;
    }

    /** service-audit's row -> the AuditLogResource shape. */
    private function shape(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'timestamp' => isset($row['occurred_at'])
                ? Carbon::parse($row['occurred_at'])->setTimezone(config('app.timezone'))->toIso8601String()
                : null,
            'performedBy' => $row['actor_name'] ?? 'System',
            'role' => $row['actor_role'] ?? 'system',
            'action' => $row['action'],
            'targetType' => $row['target_type'] ?? null,
            'details' => $row['description'] ?? null,
        ];
    }
}
