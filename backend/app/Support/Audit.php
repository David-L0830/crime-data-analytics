<?php

namespace App\Support;

use App\Services\Audit\AuditStore;
use Illuminate\Support\Facades\Facade;

/**
 * Audit::record([...]) — the single way the application writes to the audit
 * trail, wherever that trail lives (see App\Services\Audit\AuditStore).
 *
 * @method static void record(array $entry, ?string $eventId = null)
 * @method static array recent(int $limit)
 * @method static array forUser(\App\Models\User $user, int $limit)
 * @method static array lastLogins(array $userIds)
 * @method static bool isRemote()
 */
class Audit extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return AuditStore::class;
    }
}
