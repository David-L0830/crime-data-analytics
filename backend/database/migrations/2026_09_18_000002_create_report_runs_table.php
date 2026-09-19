<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Report execution history.
 *
 * Reporting in CDARS is the output stage of a PROCESS — Crime Data Collection
 * -> Validation -> Analytics -> Reporting — not a module unrelated to the
 * ones that feed it: a report is generated from inside the module that owns
 * the data (Crime Data Collection, Crime Mapping, Statistical Analysis, Trend
 * and Pattern Detection, the Crime Reporting Dashboard) and handed straight to
 * the person who asked for it, OR generated and e-mailed automatically by a
 * schedule (see ReportSchedule / ScheduledReportDispatcher / the Reports page
 * at /reports). This table is the record that the process ran. THIS TABLE
 * ITSELF has no page of its own and nothing in the interface lists it — that
 * is a statement about report_runs, not about Reporting as a whole, which the
 * Reports page remains a real, supported part of.
 *
 * WHAT IT DELIBERATELY DOES NOT STORE: the report itself. No file, no rows, no
 * personal detail, and no recipient — there is no recipient, because reports
 * are downloaded rather than delivered. A row says which report ran, over what
 * scope, how many rows it covered, who ran it and when. That is the same rule
 * report_email_logs was written under, minus everything that existed only to
 * describe an e-mail.
 *
 * WHY row_count AND filters_summary LIVE HERE AND NOT IN audit_logs:
 * AuditLogController::reportExported() keeps its audit row deliberately
 * minimal, because audit_logs is itself exportable and a row count plus a
 * filter list would put the shape of the exported data into a file somebody can
 * download. This table has no export and no UI, which is exactly what makes it
 * the right home for that detail.
 *
 * ORIGIN: how the run was asked for.
 *   manual            - a person exported from a module. Every row written from
 *                       today onwards.
 *   external_request  - a future authenticated system-to-system report request
 *                       (Security Alert System, Campaign Planning). NOT
 *                       IMPLEMENTED; the value exists so the column does not
 *                       have to change when it is.
 *   scheduled_legacy  - a historical run of the scheduled/e-mailed report
 *                       feature, preserved by the backfill below. NOTHING
 *                       WRITES THIS VALUE ANY MORE, because that feature logs
 *                       to report_email_logs, not to this table — it is NOT
 *                       retired, and remains a live, supported part of CDARS
 *                       (see ScheduledReportDispatcher and the Reports page).
 *
 * LEGACY DATA. report_email_logs holds the only record of reports this system
 * had already produced before this table existed, and those runs really
 * happened. They are copied here so report_runs' history is complete from the
 * start, even though the live scheduled/e-mailed feature keeps logging its own
 * runs to report_email_logs going forward rather than to this table. The copy
 * takes only the fields that describe the REPORT: recipients, status, error and
 * report_schedule_id are e-mail and scheduling concerns and are deliberately
 * left behind. Nothing in report_email_logs or report_schedules is read
 * destructively, updated or deleted — both tables are left exactly as they
 * are, and a later, separately approved checkpoint decides their fate.
 *
 * down() drops ONLY report_runs, so rolling this back cannot touch the legacy
 * tables it copied from.
 */
return new class extends Migration
{
    /**
     * report_email_logs.trigger -> report_runs.origin.
     */
    private const ORIGIN_BY_TRIGGER = [
        'manual' => 'manual',
        'scheduled' => 'scheduled_legacy',
    ];

    public function up(): void
    {
        Schema::create('report_runs', function (Blueprint $table) {
            $table->id();

            // Which report ran. Same vocabulary as
            // AuditLogController::REPORTS, which is the server-side whitelist
            // the export endpoint validates against.
            $table->string('report_key', 40);

            // A human-readable name for the report. Carries a retired
            // schedule's name for a backfilled row; null for an ordinary
            // export, whose report_key already names it.
            $table->string('report_label', 150)->nullable();

            // The reporting period the run covered, when the caller stated one.
            // Null means the export was not bounded by a date range.
            $table->date('period_from')->nullable();
            $table->date('period_to')->nullable();

            // One line describing the scope — text ABOUT the data, never the
            // data. Same treatment as ReportGenerator::describeScope().
            $table->string('filters_summary', 500)->nullable();

            $table->unsignedInteger('row_count')->nullable();

            // Who ran it. Null for a backfilled row whose user is gone, and
            // null for a future external_request, which has no human actor.
            $table->foreignId('generated_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('origin', 30);

            $table->timestamp('generated_at');
            $table->timestamps();

            $table->index(['report_key', 'generated_at']);
            $table->index('origin');
        });

        $this->backfillFromLegacyEmailLogs();

        $this->enableRowLevelSecurity();
    }

    public function down(): void
    {
        // ONLY this table. report_email_logs and report_schedules are not
        // this migration's to remove, and a rollback must not take the
        // history it copied from with it.
        Schema::dropIfExists('report_runs');
    }

    /**
     * Copy each historical run into report_runs, reading report_email_logs
     * without modifying it.
     *
     * Chunked and written through the query builder rather than as one
     * INSERT ... SELECT, so the same code runs on PostgreSQL (production and
     * staging) and on the in-memory SQLite the test suite uses.
     */
    private function backfillFromLegacyEmailLogs(): void
    {
        if (! Schema::hasTable('report_email_logs')) {
            return;
        }

        $now = now();

        DB::table('report_email_logs')->orderBy('id')->chunk(200, function ($logs) use ($now) {
            $rows = [];

            foreach ($logs as $log) {
                $rows[] = [
                    'report_key' => $log->report_key,
                    'report_label' => $log->schedule_name,
                    // The old rows carry no explicit period: the schedule held
                    // a rolling window (last_30_days and friends) rather than
                    // two dates. filters_summary already states the window in
                    // words, so nothing is invented here.
                    'period_from' => null,
                    'period_to' => null,
                    'filters_summary' => $log->filters_summary,
                    'row_count' => $log->row_count,
                    'generated_by' => $log->triggered_by,
                    'origin' => self::ORIGIN_BY_TRIGGER[$log->trigger] ?? 'scheduled_legacy',
                    'generated_at' => $log->generated_at,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            if ($rows !== []) {
                DB::table('report_runs')->insert($rows);
            }
        });
    }

    /**
     * Same posture as every other table in this database: the table lands in
     * `public`, where Supabase exposes it through PostgREST with default
     * grants to `anon` and `authenticated`, and the publishable key ships in
     * the frontend bundle. Deny-all with no policies; this application reaches
     * its data as the table owner, which is exempt. Guarded by driver because
     * the statement is PostgreSQL-only and the tests run on SQLite.
     */
    private function enableRowLevelSecurity(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE public."report_runs" ENABLE ROW LEVEL SECURITY');
    }
};
