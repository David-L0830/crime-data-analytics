<?php

namespace App\Services;

use App\Mail\ScheduledReportMail;
use App\Models\ReportEmailLog;
use App\Models\ReportSchedule;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Runs a report schedule: generate, send, record.
 *
 * A service rather than logic inside the Artisan command, because there are
 * two callers and they must behave identically. The scheduler calls
 * dispatchDue() once an hour; an administrator's "Run now" button calls
 * runOnce() through the API. If the manual path were a separate
 * implementation, the button would be demonstrating something other than what
 * the automation actually does, which would make it worthless as evidence
 * that automation works.
 */
class ScheduledReportDispatcher
{
    public function __construct(private ReportGenerator $generator) {}

    /**
     * Run every schedule due at `$now`.
     *
     * @return array<int, ReportEmailLog>
     */
    public function dispatchDue(Carbon $now): array
    {
        $logs = [];

        foreach (ReportSchedule::where('is_active', true)->get() as $schedule) {
            if (! $schedule->isDue($now)) {
                continue;
            }

            $log = $this->runOnce($schedule, ReportEmailLog::TRIGGER_SCHEDULED, null, $now);

            if ($log !== null) {
                $logs[] = $log;
            }
        }

        return $logs;
    }

    /**
     * Generate and send one schedule, and record what happened either way.
     *
     * NEVER THROWS. A failed run has to leave a log row — the failed run is
     * the one an administrator most needs to find — and when the hourly
     * command is processing several schedules, one unreachable SMTP host must
     * not stop the rest from being sent. The exception is recorded on the row
     * and written to the application log; the caller reads the returned row's
     * status rather than catching.
     *
     * `last_run_at` is stamped on failure as well as on success, and that is
     * deliberate: without it a schedule whose mail server is down would be
     * retried on every tick of the hourly command and fill the log with
     * hundreds of identical failures in a single afternoon. One attempt per
     * slot, logged, is the diagnosable behaviour.
     *
     * REFUSES A PAUSED OR ARCHIVED SCHEDULE, and returns null for it: no
     * report is generated, no mail is sent, no log row is written and
     * `last_run_at` is not stamped. This is the one guard for every send path
     * — the hourly command, `reports:send-scheduled --schedule=ID` with or
     * without --force, and Run Now — so none of them can disagree about it.
     * The rule itself is ReportSchedule::isSendable().
     *
     * The schedule is RE-READ first rather than trusted as passed in, so a
     * copy loaded before somebody paused or archived it cannot send. The
     * normal query scope already excludes an archived row, so it re-reads as
     * null.
     */
    public function runOnce(
        ReportSchedule $schedule,
        string $trigger = ReportEmailLog::TRIGGER_MANUAL,
        ?int $triggeredBy = null,
        ?Carbon $now = null,
    ): ?ReportEmailLog {
        $current = ReportSchedule::query()->find($schedule->getKey());

        if ($current === null || ! $current->isSendable()) {
            return null;
        }

        $schedule = $current;
        $now ??= Carbon::now();
        [$from, $to] = $schedule->resolvePeriod($now);

        $base = [
            'report_schedule_id' => $schedule->id,
            'schedule_name' => $schedule->name,
            'report_key' => $schedule->report_key,
            'recipients' => $schedule->recipients,
            'trigger' => $trigger,
            'triggered_by' => $triggeredBy,
            'generated_at' => $now,
        ];

        try {
            $report = $this->generator->generate(
                $schedule->report_key,
                $schedule->filters ?? [],
                $from,
                $to,
            );

            Mail::to($schedule->recipients)->send(new ScheduledReportMail(
                scheduleName: $schedule->name,
                reportLabel: $report['label'],
                scopeSummary: $report['summary'],
                rowCount: $report['rowCount'],
                generatedAt: $now->format('d M Y, g:i A'),
                attachmentName: $report['filename'],
                attachmentContents: $report['contents'],
            ));

            $schedule->forceFill(['last_run_at' => $now])->save();

            return ReportEmailLog::create($base + [
                'status' => ReportEmailLog::STATUS_SENT,
                'row_count' => $report['rowCount'],
                'filters_summary' => $report['summary'],
            ]);
        } catch (Throwable $e) {
            // The message only. No stack trace on the row: a trace carries
            // file paths and framework internals, and this table is read
            // through the API by an administrator, not by a developer with a
            // debugger. The full trace goes to the application log.
            Log::error('Scheduled report failed', [
                'schedule_id' => $schedule->id,
                'report_key' => $schedule->report_key,
                'exception' => $e,
            ]);

            $schedule->forceFill(['last_run_at' => $now])->save();

            return ReportEmailLog::create($base + [
                'status' => ReportEmailLog::STATUS_FAILED,
                'error' => mb_substr($e->getMessage(), 0, ReportEmailLog::ERROR_MAX),
            ]);
        }
    }
}
