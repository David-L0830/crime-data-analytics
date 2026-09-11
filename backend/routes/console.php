<?php

use Illuminate\Support\Facades\Schedule;

// Automated report generation (Reporting System checklist, "Scheduled
// Reports"). One entry, running hourly, serves every schedule an
// administrator creates: the command asks each active schedule whether its
// slot has arrived rather than each schedule owning a cron expression, so
// nothing here changes when schedules are added, edited or removed.
//
// withoutOverlapping() because a run sends real e-mail. If one invocation is
// still working when the next hour arrives — a slow SMTP host, a large report
// — the second must not start and send the same schedule again. The schedule's
// own last_run_at check is the second line of defence behind this one.
//
// runInBackground() is deliberately NOT used: these runs are short, and
// keeping them in the foreground means the process exit code reflects whether
// the send succeeded, which is what a cron runner reports on.
//
// THIS LINE ALONE SENDS NOTHING. Laravel's scheduler needs a process to invoke
// it every minute (`php artisan schedule:run`), and the API container does not
// run one — it serves HTTP. See the deployment note in README/docs: on Render
// this requires a separate Cron Job service running `php artisan
// schedule:run`, or an equivalent external scheduler. Until that exists,
// schedules are created and stored correctly and are run on demand from
// Settings > Scheduled Reports ("Run now"), which uses the identical code
// path.
Schedule::command('reports:send-scheduled')
    ->hourly()
    ->withoutOverlapping();
