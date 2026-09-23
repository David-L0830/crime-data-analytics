<?php

namespace App\Services\Audit;

use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * The audit trail in this application's own audit_logs table — exactly the
 * behaviour the application had before service-audit existed. Writes join any
 * surrounding database transaction, as they always did.
 */
class DatabaseAuditStore implements AuditStore
{
    public function record(array $entry, ?string $eventId = null): void
    {
        AuditLog::create($entry);
    }

    public function recent(int $limit): array
    {
        return $this->shape(AuditLog::with('user')->orderByDesc('created_at')->limit($limit)->get());
    }

    public function forUser(User $user, int $limit): array
    {
        return $this->shape($user->auditLogs()->with('user')->orderByDesc('created_at')->limit($limit)->get());
    }

    public function lastLogins(array $userIds): array
    {
        return AuditLog::query()
            ->whereIn('user_id', $userIds)
            ->where('action', 'LOGIN')
            ->groupBy('user_id')
            ->selectRaw('user_id, MAX(created_at) AS last_login')
            ->pluck('last_login', 'user_id')
            ->map(fn ($at) => Carbon::parse($at))
            ->all();
    }

    public function isRemote(): bool
    {
        return false;
    }

    private function shape($logs): array
    {
        return AuditLogResource::collection($logs)->resolve(request());
    }
}
