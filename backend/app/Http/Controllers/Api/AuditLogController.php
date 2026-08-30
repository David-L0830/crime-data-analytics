<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

class AuditLogController extends Controller
{
    // GET /api/audit-logs
    //
    // Admin-only. Access is enforced at the route level, not here:
    // routes/api.php gates this route with `role:badac_admin` (EnsureRole
    // middleware), so any other role hitting this endpoint directly gets a
    // 403 before this method ever runs — RBAC here is real backend
    // enforcement, not frontend-only filtering.
    //
    // BADAC (badac_readonly) access to this route was removed — it
    // previously mirrored badac_admin's full view (see the git history on
    // this file and BadacReadonlyTest::test_badac_readonly_cannot_view_audit_logs,
    // which used to assert the opposite). See ROLES.badac_readonly in
    // src/utils/constants.js for the matching frontend change.
    public function index()
    {
        $logs = AuditLog::with('user')->orderByDesc('created_at')->limit(200)->get();

        return AuditLogResource::collection($logs);
    }

    /**
     * The reports that can be exported, and the name each is recorded under.
     *
     * One entry per exportWorkbook() call site in the frontend. The caller
     * sends a key rather than a description because the value lands in the
     * audit trail: a free-text field here would let any authenticated client
     * write arbitrary text into the record of who did what.
     */
    private const REPORTS = [
        'dashboard' => 'Crime Reporting Dashboard',
        'analytics' => 'Statistical Analysis',
        'incidents' => 'Crime Data Collection',
        'audit-logs' => 'Audit Logs',
        'criminal-records' => 'Criminal Records',
        'criminal-profile' => 'Criminal Profile',
        'victim-records' => 'Victim Records',
        'victim-profile' => 'Victim Profile',
        'incident-record' => 'Incident Record',
    ];

    // POST /api/report-export-audit
    //
    // Records that a report was exported. Mirrors
    // UserController::passwordResetAudit(): an audit-only endpoint for an
    // action that happens somewhere else, called only after that action has
    // actually succeeded — here, after exportWorkbook() has returned true,
    // meaning the workbook was built and handed to the browser.
    //
    // Why this exists: the Audit Logs filter has always offered
    // REPORT_EXPORTED, but nothing ever wrote one. The only rows carrying it
    // came from AuditLogSeeder's fabricated demo data, so filtering by it
    // matched seeded rows and nothing else, while every real export left no
    // trace. 'reports' / 'report' are the module and target_type that seeded
    // row already used, and 'report' is already offered as a target-type
    // filter, so this writes into the vocabulary the UI expects rather than
    // inventing one.
    //
    // NOT admin-only, deliberately. All three roles export something they are
    // entitled to see — Encoder from Crime Data Collection, BADAC read-only
    // from Records and the analytics pages — so gating this to administrators
    // would simply lose those events. Reading the trail stays admin-only: the
    // GET route above keeps its role:badac_admin middleware.
    //
    // No REPORT_GENERATED counterpart is written. Printing goes through
    // window.print(), which signals neither success nor cancellation, so a
    // print audit could only ever claim a report that may not have been
    // produced.
    public function reportExported(Request $request)
    {
        $data = $request->validate([
            'report' => ['required', 'string', Rule::in(array_keys(self::REPORTS))],
        ]);

        try {
            AuditLog::create([
                'user_id' => $request->user()?->id,
                'action' => 'REPORT_EXPORTED',
                'module' => 'reports',
                'target_type' => 'report',
                // Deliberately minimal: which report, and nothing about what it
                // contained. Row counts and filter values would put the shape of
                // the exported data into a log that is itself exportable.
                'description' => 'Exported the '.self::REPORTS[$data['report']].' report',
                'ip_address' => $request->ip(),
            ]);
        } catch (\Throwable $e) {
            // Logged with context the way announceNewIncident() does, rather
            // than surfacing as an unhandled stack trace.
            //
            // Still answered as a failure, NOT as a success. This endpoint's
            // only job is to write the row, so replying "recorded" when nothing
            // was recorded would be the exact false claim this change exists to
            // remove. The caller is what protects the user: logExport()
            // swallows this, so a download that already succeeded is never
            // presented as failed.
            Log::warning('Report export could not be recorded in the audit trail', [
                'report' => $data['report'],
                'user_id' => $request->user()?->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Report export could not be recorded.'], 500);
        }

        return response()->json(['message' => 'Report export recorded.']);
    }
}
