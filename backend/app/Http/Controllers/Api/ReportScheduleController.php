<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ReportEmailLog;
use App\Models\ReportSchedule;
use App\Services\ReportGenerator;
use App\Services\ScheduledReportDispatcher;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Administration of automated reports (Reporting System checklist, "Scheduled
 * Reports" / "Email Logs").
 *
 * EVERY route on this controller is registered behind
 * `auth:supabase`, `supabase.mfa` and `role:badac_admin` in routes/api.php.
 * That is not incidental. A schedule is a standing instruction to send crime
 * records to an e-mail address, repeatedly, without anyone present — it is a
 * stronger capability than the one-off export an Encoder or a read-only BADAC
 * account performs from a screen they can already see, because the recipient
 * need not be a user of this system at all. Creating one is therefore an
 * administrative act, and the read side is administrative too: the email log
 * lists recipient addresses and is exactly as sensitive as the audit trail,
 * which is already administrator-only.
 *
 * Nothing here is public, and no route returns report CONTENT. The only way
 * report data leaves through this controller is as an attachment on a message
 * addressed to a recipient an administrator configured.
 */
class ReportScheduleController extends Controller
{
    // GET /api/report-schedules
    public function index()
    {
        return ReportSchedule::with('creator')
            ->orderBy('name')
            ->get()
            ->map(fn (ReportSchedule $s) => $this->present($s));
    }

    // POST /api/report-schedules
    public function store(Request $request)
    {
        $data = $this->validated($request);

        $schedule = ReportSchedule::create($data + [
            'created_by' => $request->user()?->id,
        ]);

        $this->audit($request, 'CREATE', sprintf(
            'Created the scheduled report "%s" (%s, %s)',
            $schedule->name,
            ReportGenerator::REPORTS[$schedule->report_key],
            $schedule->frequency,
        ));

        // fresh(), so the response carries the columns the DATABASE filled in
        // rather than only the ones the request supplied. `is_active` has a
        // default of true and is omitted by every normal create, so presenting
        // the unrefreshed model answered "is this schedule active?" with null —
        // which a client reading it as a boolean would take for "no".
        return response()->json($this->present($schedule->fresh()), 201);
    }

    // PUT /api/report-schedules/{reportSchedule}
    public function update(Request $request, ReportSchedule $reportSchedule)
    {
        $data = $this->validated($request, $reportSchedule);

        $reportSchedule->update($data);

        $this->audit($request, 'UPDATE', sprintf(
            'Updated the scheduled report "%s"',
            $reportSchedule->name,
        ));

        return response()->json($this->present($reportSchedule->fresh()));
    }

    // DELETE /api/report-schedules/{reportSchedule}
    public function destroy(Request $request, ReportSchedule $reportSchedule)
    {
        $name = $reportSchedule->name;
        $reportSchedule->delete();

        // The email log rows survive: report_schedule_id is nullOnDelete and
        // each row carries its own copy of the schedule's name. Deleting a
        // schedule stops future sends; it does not erase the record of the
        // sends that already happened.
        $this->audit($request, 'DELETE', sprintf('Deleted the scheduled report "%s"', $name));

        return response()->json(['deleted' => true]);
    }

    /**
     * POST /api/report-schedules/{reportSchedule}/run
     *
     * Runs the schedule immediately, through the identical code path the
     * scheduler uses — same generator, same message, same log row, with only
     * `trigger` distinguishing the two. A "Run now" that took a shortcut would
     * demonstrate something other than the automation it is supposed to prove.
     */
    public function run(Request $request, ReportSchedule $reportSchedule, ScheduledReportDispatcher $dispatcher)
    {
        $log = $dispatcher->runOnce(
            $reportSchedule,
            ReportEmailLog::TRIGGER_MANUAL,
            $request->user()?->id,
        );

        $this->audit($request, 'EXPORT', sprintf(
            'Ran the scheduled report "%s" manually (%s)',
            $reportSchedule->name,
            $log->status,
        ));

        // 200 either way: the request was handled correctly even when the send
        // failed. The outcome is in the body, and in the log row it points at.
        return response()->json([
            'log' => $this->presentLog($log),
            'schedule' => $this->present($reportSchedule->fresh()),
        ]);
    }

    /**
     * GET /api/report-email-logs
     *
     * The "Email Logs" evidence. Capped because this table grows on every run
     * and an administrator is reading the recent history, not auditing all of
     * it; the cap is explicit here rather than left to the client so a large
     * table cannot turn one request into a full-table read.
     */
    public function logs()
    {
        return ReportEmailLog::with('triggeredBy')
            ->orderByDesc('generated_at')
            ->limit(200)
            ->get()
            ->map(fn (ReportEmailLog $l) => $this->presentLog($l));
    }

    /**
     * Shared validation for store() and update().
     *
     * `report_key` is validated against ReportGenerator::REPORTS rather than
     * accepted as a string, so a schedule cannot be created for a report that
     * does not exist and then fail silently at 6am. Recipients are validated
     * as e-mail addresses one by one: this list is the only thing that decides
     * where crime records are sent.
     */
    private function validated(Request $request, ?ReportSchedule $existing = null): array
    {
        $sometimes = $existing !== null ? ['sometimes'] : [];

        $data = $request->validate([
            'name' => [...$sometimes, 'required', 'string', 'max:150'],
            'report_key' => [...$sometimes, 'required', Rule::in(array_keys(ReportGenerator::REPORTS))],
            'period' => [...$sometimes, 'required', Rule::in(ReportSchedule::PERIODS)],
            'frequency' => [...$sometimes, 'required', Rule::in(ReportSchedule::FREQUENCIES)],
            'hour' => [...$sometimes, 'required', 'integer', 'min:0', 'max:23'],
            'day_of_week' => ['nullable', 'integer', 'min:0', 'max:6'],
            // 28 rather than 31, so a monthly schedule cannot land on a date
            // that does not exist in February and silently never run.
            'day_of_month' => ['nullable', 'integer', 'min:1', 'max:28'],
            'recipients' => [...$sometimes, 'required', 'array', 'min:1', 'max:20'],
            'recipients.*' => ['required', 'email:rfc', 'max:255'],
            'is_active' => ['sometimes', 'boolean'],
            'filters' => ['sometimes', 'nullable', 'array'],
            // An explicit whitelist, not a free-form object: `filters` is
            // written into a WHERE clause, and only these four fields are ever
            // filtered on. A key that is not listed here cannot reach the
            // query.
            'filters.crimeType' => ['sometimes', 'nullable', 'string', 'max:100'],
            'filters.category' => ['sometimes', 'nullable', 'string', 'max:100'],
            'filters.sitio' => ['sometimes', 'nullable', 'string', 'max:100'],
            'filters.status' => ['sometimes', 'nullable', 'string', 'max:50'],
        ]);

        // Strip any key the whitelist above did not name. validate() returns
        // only validated keys, but `filters` is an array rule, so this
        // re-projects its contents explicitly rather than trusting the shape.
        if (array_key_exists('filters', $data)) {
            $filters = $data['filters'] ?? [];
            $data['filters'] = array_filter([
                'crimeType' => $filters['crimeType'] ?? null,
                'category' => $filters['category'] ?? null,
                'sitio' => $filters['sitio'] ?? null,
                'status' => $filters['status'] ?? null,
            ], fn ($v) => $v !== null && $v !== '');
        }

        return $data;
    }

    private function present(ReportSchedule $s): array
    {
        return [
            'id' => (string) $s->id,
            'name' => $s->name,
            'reportKey' => $s->report_key,
            'reportLabel' => ReportGenerator::REPORTS[$s->report_key] ?? $s->report_key,
            'period' => $s->period,
            'filters' => (object) ($s->filters ?? []),
            'recipients' => $s->recipients ?? [],
            'frequency' => $s->frequency,
            'hour' => $s->hour,
            'dayOfWeek' => $s->day_of_week,
            'dayOfMonth' => $s->day_of_month,
            'isActive' => $s->is_active,
            'lastRunAt' => $s->last_run_at?->toIso8601String(),
            'createdBy' => $s->creator?->name,
        ];
    }

    private function presentLog(ReportEmailLog $l): array
    {
        return [
            'id' => (string) $l->id,
            'scheduleId' => $l->report_schedule_id === null ? null : (string) $l->report_schedule_id,
            'scheduleName' => $l->schedule_name,
            'reportKey' => $l->report_key,
            'reportLabel' => ReportGenerator::REPORTS[$l->report_key] ?? $l->report_key,
            'recipients' => $l->recipients ?? [],
            'status' => $l->status,
            'trigger' => $l->trigger,
            'rowCount' => $l->row_count,
            'scope' => $l->filters_summary,
            'error' => $l->error,
            'triggeredBy' => $l->triggeredBy?->name,
            'generatedAt' => $l->generated_at?->toIso8601String(),
        ];
    }

    /**
     * Managing an automated report is an administrative action on the system's
     * own configuration, so it belongs in the same trail as a settings change
     * or a role change. The description is built here from validated values —
     * never from raw request text — for the same reason
     * AuditLogController::reportExported() builds its own.
     */
    private function audit(Request $request, string $action, string $description): void
    {
        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => $action,
            'module' => 'reports',
            'target_type' => 'report_schedule',
            'description' => $description,
            'ip_address' => $request->ip(),
        ]);
    }
}
