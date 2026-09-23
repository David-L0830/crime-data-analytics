<?php

namespace App\Jobs;

use App\Services\Audit\AuditServiceClient;
use DateTimeInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Throwable;

// Delivers one audit event to service-audit (ServiceAuditStore queues it).
//
// QUEUED, so an audited action never waits on, or fails because of, the audit
// service. RETRIED for up to a day with growing backoff, so a service outage
// delays the trail rather than losing it; a job that exhausts that window
// stays in failed_jobs, from where `php artisan queue:retry` re-sends it (the
// daily pruning in routes/console.php deliberately leaves audit jobs alone).
// IDEMPOTENT, because every event carries its own event_id and service-audit
// ignores one it already holds — so a retry after a lost response cannot
// write the same event twice.
//
// ENCRYPTED (ShouldBeEncrypted): the payload names people, actions and IP
// addresses, and it sits in Redis and possibly failed_jobs.
class ShipAuditEvent implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /** @var array<int, int> seconds; the last value repeats */
    public array $backoff = [10, 30, 60, 300];

    public function __construct(public array $event)
    {
        $this->onQueue((string) config('audit.service.queue', 'audit'));
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addDay();
    }

    public function handle(AuditServiceClient $client): void
    {
        $client->append($this->event);
    }

    public function failed(?Throwable $e): void
    {
        // Identifiers only; the description and IP stay out of the log.
        Log::error('Audit event could not be delivered to service-audit; it remains in failed_jobs.', [
            'event_id' => $this->event['event_id'] ?? null,
            'action' => $this->event['action'] ?? null,
            'exception' => $e ? $e::class : null,
        ]);
    }
}
