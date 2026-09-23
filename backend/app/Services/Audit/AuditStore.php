<?php

namespace App\Services\Audit;

use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * Where the audit trail lives. Every audit write and read in the application
 * goes through this — call sites use the App\Support\Audit facade — so the
 * trail can move without touching them.
 *
 *   DatabaseAuditStore — audit_logs in this database (AUDIT_DRIVER=database,
 *                        the default: hosted environments and tests).
 *   ServiceAuditStore  — service-audit, the isolated microservice
 *                        (AUDIT_DRIVER=service: the local compose stack).
 *
 * Bound in AppServiceProvider from config('audit.driver').
 */
interface AuditStore
{
    /**
     * Records one event. $entry uses the audit_logs column names: user_id,
     * action, module, target_type, description, ip_address.
     *
     * $eventId identifies the event itself. A store that de-duplicates
     * (isRemote()) stores a repeat of the same id once; the database store
     * ignores it.
     */
    public function record(array $entry, ?string $eventId = null): void;

    /**
     * The newest events, in the AuditLogResource shape the frontend reads:
     * id, timestamp, performedBy, role, action, targetType, details.
     *
     * @return array<int, array<string, mixed>>
     */
    public function recent(int $limit): array;

    /** One account's own events, same shape as recent(). */
    public function forUser(User $user, int $limit): array;

    /**
     * @param  array<int, int>  $userIds
     * @return array<int, Carbon> user id => latest LOGIN (absent: never)
     */
    public function lastLogins(array $userIds): array;

    /** True when the trail is held by service-audit rather than this database. */
    public function isRemote(): bool;
}
