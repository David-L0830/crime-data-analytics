<?php

declare(strict_types=1);

namespace AuditService;

/**
 * What App needs from storage. PdoEventStore is the real one; the test suite
 * substitutes an in-memory one for the HTTP-level tests.
 */
interface EventStore
{
    /** Stores a validated event. True if stored, false if its event_id already existed. */
    public function append(array $event): bool;

    /** Newest first, optionally one actor's events only. */
    public function recent(int $limit, ?int $actorUserId): array;

    /** @param array<int, int> $userIds  @return array<string, string> user id => latest LOGIN time */
    public function lastLogins(array $userIds): array;

    public function ping(): void;
}
