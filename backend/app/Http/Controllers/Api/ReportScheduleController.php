<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ReportEmailLog;
use App\Models\ReportSchedule;
use App\Services\ReportGenerator;
use App\Services\ScheduledReportDispatcher;
use App\Support\Audit;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The Reports module: automated report schedules and their delivery log.
 *
 * WHO MAY DO WHAT (enforced by `role:` middleware in routes/api.php)
 *
 *   BADAC Administrator  everything: create, edit, pause/resume, archive,
 *                        restore, Run Now, and the full delivery detail
 *   BADAC Read-Only      the two GET endpoints only (index, logs)
 *   Encoder              nothing — 403 on every report endpoint
 *
 * A schedule is a standing instruction to send crime records to an e-mail
 * address, repeatedly, without anyone present, so every write stays
 * administrative. Read-Only may SEE schedules and their delivery status.
 *
 * RECIPIENT PRIVACY. Recipient addresses — and the raw mail-server error text,
 * which routinely quotes the rejected address — are returned to an
 * administrator only. Everyone else receives a recipient COUNT and the bare
 * delivery status. This is decided here, on the server, per request: the
 * addresses are never sent to a non-administrator's browser at all, so they
 * cannot be recovered from the network response, frontend state or the DOM.
 * Fields are withheld outright rather than pattern-redacted, because no
 * pattern can guarantee an address does not survive.
 *
 * NO PERMANENT DELETE. A schedule is archived (SoftDeletes on `archived_at`,
 * see ReportSchedule) and can be restored; the row and its delivery history
 * are never removed.
 *
 * Nothing here is public, and no route returns report CONTENT. The only way
 * report data leaves through this controller is as an attachment on a message
 * addressed to a recipient an administrator configured.
 */
class ReportScheduleController extends Controller
{
    // GET /api/report-schedules            active (non-archived) schedules
    // GET /api/report-schedules?archived=1 archived schedules
    //
    // Administrator and Read-Only. The response is shaped for the caller: see
    // present().
    public function index(Request $request)
    {
        $query = $request->boolean('archived')
            ? ReportSchedule::onlyTrashed()
            : ReportSchedule::query();

        $full = $this->mayViewRecipients($request);

        return $query->with(['creator', 'latestEmailLog'])
            ->orderBy('name')
            ->get()
            ->map(fn (ReportSchedule $s) => $this->present($s, $full));
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
        return response()->json($this->present($schedule->fresh(), true), 201);
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

        return response()->json($this->present($reportSchedule->fresh(), true));
    }

    /**
     * PUT /api/report-schedules/{reportSchedule}/archive
     *
     * Replaces the former permanent DELETE. Non-destructive: SoftDeletes sets
     * `archived_at` and nothing else, so the row, its configuration, its
     * `is_active` (pause) state and every delivery-log link are kept. From this
     * moment the schedule is excluded from the hourly command, the dispatcher,
     * editing and Run Now until it is restored. An already-archived schedule
     * is not found by the binding, so archiving twice is a 404.
     */
    public function archive(Request $request, ReportSchedule $reportSchedule)
    {
        $reportSchedule->delete();

        $this->audit($request, 'ARCHIVE', sprintf('Archived the scheduled report "%s"', $reportSchedule->name));

        return response()->json($this->present($this->freshIncludingArchived($reportSchedule), true));
    }

    /**
     * PUT /api/report-schedules/{reportSchedule}/restore
     *
     * The route is registered withTrashed() so an archived schedule can be
     * bound. Clears `archived_at` only: `is_active` is not read or written, so
     * a schedule archived while paused comes back paused, and one archived
     * while active becomes eligible for scheduling again.
     */
    public function restore(Request $request, ReportSchedule $reportSchedule)
    {
        if (! $reportSchedule->trashed()) {
            return response()->json(['message' => 'This report schedule is not archived.'], 422);
        }

        $reportSchedule->restore();

        $this->audit($request, 'RESTORE', sprintf('Restored the scheduled report "%s"', $reportSchedule->name));

        return response()->json($this->present($reportSchedule->fresh(), true));
    }

    /**
     * POST /api/report-schedules/{reportSchedule}/run
     *
     * Runs the schedule immediately, through the identical code path the
     * scheduler uses — same generator, same message, same log row, with only
     * `trigger` distinguishing the two. A "Run now" that took a shortcut would
     * demonstrate something other than the automation it is supposed to prove.
     *
     * An archived schedule is never bound here (SoftDeletes scope), so it
     * answers 404 and nothing is sent; it has to be restored first. A PAUSED
     * schedule is refused by the dispatcher (ScheduledReportDispatcher::
     * runOnce returns null): 422, nothing sent, nothing logged or audited.
     */
    public function run(Request $request, ReportSchedule $reportSchedule, ScheduledReportDispatcher $dispatcher)
    {
        $log = $dispatcher->runOnce(
            $reportSchedule,
            ReportEmailLog::TRIGGER_MANUAL,
            $request->user()?->id,
        );

        if ($log === null) {
            return response()->json([
                'message' => 'This report schedule is paused. Resume it before running it.',
            ], 422);
        }

        $this->audit($request, 'EXPORT', sprintf(
            'Ran the scheduled report "%s" manually (%s)',
            $reportSchedule->name,
            $log->status,
        ));

        // 200 either way: the request was handled correctly even when the send
        // failed. The outcome is in the body, and in the log row it points at.
        return response()->json([
            'log' => $this->presentLog($log, true),
            'schedule' => $this->present($reportSchedule->fresh(), true),
        ]);
    }

    /**
     * GET /api/report-email-logs
     *
     * The "Email Logs" evidence. Capped because this table grows on every run
     * and an administrator is reading the recent history, not auditing all of
     * it; the cap is explicit here rather than left to the client so a large
     * table cannot turn one request into a full-table read.
     *
     * Administrator and Read-Only; shaped for the caller like index(). Rows of
     * archived schedules are included — the history is kept on purpose.
     */
    public function logs(Request $request)
    {
        $full = $this->mayViewRecipients($request);

        return ReportEmailLog::with('triggeredBy')
            ->orderByDesc('generated_at')
            ->limit(200)
            ->get()
            ->map(fn (ReportEmailLog $l) => $this->presentLog($l, $full));
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

    /**
     * Recipient addresses and raw delivery errors are administrator-only.
     * Positive check: only the Administrator role qualifies, so a role added
     * later is withheld the addresses by default.
     */
    private function mayViewRecipients(Request $request): bool
    {
        return (bool) $request->user()?->isAdmin();
    }

    /**
     * @param  bool  $full  true only for an administrator (see
     *                      mayViewRecipients). When false, `recipients` and
     *                      `lastRunError` are OMITTED — not emptied, not
     *                      redacted — and only the count and bare status remain.
     */
    private function present(ReportSchedule $s, bool $full): array
    {
        $recipients = $s->recipients ?? [];

        $data = [
            'id' => (string) $s->id,
            'name' => $s->name,
            'reportKey' => $s->report_key,
            'reportLabel' => ReportGenerator::REPORTS[$s->report_key] ?? $s->report_key,
            'period' => $s->period,
            'filters' => (object) ($s->filters ?? []),
            'recipientCount' => count($recipients),
            'frequency' => $s->frequency,
            'hour' => $s->hour,
            'dayOfWeek' => $s->day_of_week,
            'dayOfMonth' => $s->day_of_month,
            'isActive' => $s->is_active,
            'isArchived' => $s->trashed(),
            'archivedAt' => $s->archived_at?->toIso8601String(),
            'lastRunAt' => $s->last_run_at?->toIso8601String(),
            // Additive, read-only presentation fields. nextRunAt is computed
            // with the scheduler's own isDue() rule (see
            // ReportSchedule::nextRunAt) and is null for an archived schedule,
            // which the scheduler never selects; the last result comes from
            // the email log, never from a separate status column.
            'nextRunAt' => $s->trashed() ? null : $s->nextRunAt(now())?->toIso8601String(),
            'lastRunStatus' => $s->latestEmailLog?->status,
            'createdBy' => $s->creator?->name,
        ];

        if ($full) {
            $data['recipients'] = $recipients;
            $data['lastRunError'] = $s->latestEmailLog?->error;
        }

        return $data;
    }

    /** @param  bool  $full  see present() */
    private function presentLog(ReportEmailLog $l, bool $full): array
    {
        $recipients = $l->recipients ?? [];

        $data = [
            'id' => (string) $l->id,
            'scheduleId' => $l->report_schedule_id === null ? null : (string) $l->report_schedule_id,
            'scheduleName' => $l->schedule_name,
            'reportKey' => $l->report_key,
            'reportLabel' => ReportGenerator::REPORTS[$l->report_key] ?? $l->report_key,
            'recipientCount' => count($recipients),
            'status' => $l->status,
            'trigger' => $l->trigger,
            'rowCount' => $l->row_count,
            'scope' => $l->filters_summary,
            'triggeredBy' => $l->triggeredBy?->name,
            'generatedAt' => $l->generated_at?->toIso8601String(),
        ];

        if ($full) {
            $data['recipients'] = $recipients;
            $data['error'] = $l->error;
        }

        return $data;
    }

    private function freshIncludingArchived(ReportSchedule $s): ReportSchedule
    {
        return ReportSchedule::withTrashed()->with(['creator', 'latestEmailLog'])->findOrFail($s->getKey());
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
        Audit::record([
            'user_id' => $request->user()?->id,
            'action' => $action,
            'module' => 'reports',
            'target_type' => 'report_schedule',
            'description' => $description,
            'ip_address' => $request->ip(),
        ]);
    }
}
