<?php

namespace App\Console\Commands;

use App\Models\ReportEmailLog;
use App\Models\ReportSchedule;
use App\Services\ScheduledReportDispatcher;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Sends the report schedules that are due.
 *
 * Registered in routes/console.php to run hourly. It is the hour that is
 * scheduled, not each report: the command asks every active schedule whether
 * its slot has arrived (ReportSchedule::isDue()), so one cron entry serves any
 * number of schedules and a schedule created a minute ago is picked up on the
 * next tick without a restart.
 *
 * Safe to run by hand, which is how the feature is demonstrated without
 * waiting for a real schedule to come round:
 *
 *   php artisan reports:send-scheduled              # send whatever is due now
 *   php artisan reports:send-scheduled --schedule=3 # that one, if it is due
 *   php artisan reports:send-scheduled --schedule=3 --force
 *
 * --force skips only the due check. It does not skip the log, the recipient
 * list or anything else, so a forced run produces exactly the message and
 * exactly the report_email_logs row a scheduled run would.
 */
class SendScheduledReports extends Command
{
    protected $signature = 'reports:send-scheduled
                            {--schedule= : Run only the schedule with this id}
                            {--force : Run even if the schedule is not due now}';

    protected $description = 'Generate and email the report schedules that are due';

    public function handle(ScheduledReportDispatcher $dispatcher): int
    {
        $now = Carbon::now();

        $schedules = $this->option('schedule') !== null
            ? ReportSchedule::where('id', $this->option('schedule'))->get()
            : ReportSchedule::where('is_active', true)->get();

        if ($schedules->isEmpty()) {
            $this->info('No report schedules to run.');

            return self::SUCCESS;
        }

        $sent = 0;
        $failed = 0;
        $skipped = 0;

        foreach ($schedules as $schedule) {
            if (! $this->option('force') && ! $schedule->isDue($now)) {
                $skipped++;

                continue;
            }

            $log = $dispatcher->runOnce(
                $schedule,
                ReportEmailLog::TRIGGER_SCHEDULED,
                null,
                $now,
            );

            if ($log->status === ReportEmailLog::STATUS_SENT) {
                $sent++;
                $this->info(sprintf(
                    'Sent "%s" (%d records) to %d recipient(s).',
                    $schedule->name,
                    $log->row_count ?? 0,
                    count($schedule->recipients ?? []),
                ));
            } else {
                $failed++;
                $this->error(sprintf('Failed "%s": %s', $schedule->name, $log->error));
            }
        }

        $this->line(sprintf('Done. sent=%d failed=%d not-due=%d', $sent, $failed, $skipped));

        // A failed send is reported through the exit code as well as the log,
        // so a cron runner (Render Cron Job, systemd timer, CI) marks the run
        // as failed instead of reporting success while nothing arrived.
        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
