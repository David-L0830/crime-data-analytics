<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

// Laravel's scheduler. In the local Docker Compose stack the `scheduler`
// service runs `php artisan schedule:work`, which evaluates this file every
// minute. No hosted environment runs a scheduler.
//
// SCHEDULED REPORT E-MAILS ARE DISABLED, DELIBERATELY. This file used to
// register `reports:send-scheduled` hourly. It was removed, not merely left
// unrun, so that adding a scheduler process can never start e-mailing reports
// again. The command itself still exists for manual use; do not re-register it
// here.

// Failed NOTIFICATION jobs are kept for one day, long enough to diagnose a
// mail outage, then removed. Their payloads are encrypted (see
// App\Jobs\SendEmailMfaCode), but an undeliverable, long-expired sign-in code
// has no reason to be kept at all.
//
// Only the `notifications` queue. `queue:prune-failed` would also delete
// failed audit deliveries (ShipAuditEvent on the `audit` queue) — audit events
// that have not reached service-audit yet and must be retried, never discarded.
Schedule::call(function () {
    DB::table('failed_jobs')
        ->where('queue', 'notifications')
        ->where('failed_at', '<', now()->subDay())
        ->delete();
})->name('prune-failed-notification-jobs')->daily();
