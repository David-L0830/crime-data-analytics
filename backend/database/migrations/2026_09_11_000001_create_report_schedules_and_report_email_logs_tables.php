<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Automated report generation (Reporting System checklist, "Scheduled
 * Reports" and its "Email Logs" evidence).
 *
 * Two tables, and they are deliberately separate:
 *
 *   report_schedules   - the CONFIGURATION an administrator creates: which
 *                        report, over what period, filtered how, to whom, how
 *                        often. Mutable; an administrator edits and deletes
 *                        these.
 *   report_email_logs  - the RECORD of what actually happened on each run.
 *                        Append-only in practice, and it must survive the
 *                        deletion of the schedule that produced it, which is
 *                        why the foreign key is nullOnDelete and why the
 *                        schedule's name and report key are copied onto every
 *                        row rather than read back through the relation. A
 *                        log that disappears when someone tidies up a
 *                        schedule is not evidence of anything.
 *
 * WHAT THE LOG DELIBERATELY DOES NOT STORE: any report content. The row
 * records that a report of N rows was generated from a named schedule, which
 * addresses it went to, when, and whether it succeeded — never the incident
 * records themselves. The attachment exists only in the message that was
 * sent. This is the same reasoning that keeps `description` in audit_logs a
 * server-built sentence rather than client-supplied text: a log that
 * accumulates copies of the data it describes becomes a second, unguarded
 * store of that data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_schedules', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);

            // Which report to produce. Validated against
            // ReportGenerator::REPORTS at the controller and again in the
            // generator, so an unknown key cannot reach a run.
            $table->string('report_key', 40);

            // Rolling window relative to the moment the report runs — NOT a
            // fixed date range. A schedule pinned to two literal dates would
            // email an identical file every week forever, which is the
            // failure mode that makes most "scheduled report" features
            // useless. See ReportSchedule::PERIODS.
            $table->string('period', 20)->default('last_30_days');

            // The remaining, non-date filters (crime type, category, sitio,
            // status) as an object. Absent keys mean "no filtering on that
            // field", matching how the React FilterBar already treats an
            // empty control.
            $table->json('filters')->nullable();

            // Recipient addresses. Validated as e-mail addresses on the way
            // in; no address is ever taken from the report data itself.
            $table->json('recipients');

            $table->string('frequency', 20)->default('weekly');

            // Local hour of day (0-23) the run is due. The command runs
            // hourly and sends the schedules whose hour has arrived, so the
            // scheduler needs no per-schedule cron entry.
            $table->unsignedTinyInteger('hour')->default(6);

            // 0 (Sunday) - 6, weekly schedules only.
            $table->unsignedTinyInteger('day_of_week')->nullable();

            // 1 - 28, monthly schedules only. Capped at 28 rather than 31 so
            // a monthly schedule cannot silently skip February.
            $table->unsignedTinyInteger('day_of_month')->nullable();

            $table->boolean('is_active')->default(true);

            // Guards against a double send when the hourly command overlaps
            // or is retried; see ReportSchedule::isDue().
            $table->timestamp('last_run_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['is_active', 'frequency']);
        });

        Schema::create('report_email_logs', function (Blueprint $table) {
            $table->id();

            $table->foreignId('report_schedule_id')->nullable()
                ->constrained('report_schedules')->nullOnDelete();

            // Denormalised on purpose — see the note at the top of this file.
            $table->string('schedule_name', 150);
            $table->string('report_key', 40);

            $table->json('recipients');

            // 'sent' | 'failed'. Both are written: a failed run that leaves no
            // trace is exactly the run an administrator needs to find.
            $table->string('status', 20);

            // 'scheduled' | 'manual' — a run triggered by an administrator
            // from the UI must be distinguishable from one the scheduler
            // fired, or the log cannot be used to show that automation works.
            $table->string('trigger', 20)->default('scheduled');

            $table->unsignedInteger('row_count')->nullable();

            // A human-readable restatement of the filters and period the run
            // used, so the log row explains its own row_count. Text, not the
            // data.
            $table->string('filters_summary', 500)->nullable();

            // Exception message on a failed run. Truncated by the writer.
            $table->text('error')->nullable();

            $table->foreignId('triggered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('generated_at');
            $table->timestamps();

            $table->index(['report_key', 'status']);
            $table->index('generated_at');
        });

        $this->enableRowLevelSecurity();
    }

    public function down(): void
    {
        Schema::dropIfExists('report_email_logs');
        Schema::dropIfExists('report_schedules');
    }

    /**
     * Both new tables land in `public`, where Supabase exposes every table
     * through PostgREST and the default grants give `anon` and
     * `authenticated` full access. The publishable key that unlocks those
     * roles ships inside the frontend bundle by design, so a table left
     * without RLS here would let anyone loading the deployed site read the
     * recipient addresses of every scheduled report and insert schedules of
     * their own.
     *
     * Deny-all with no policies, matching the posture
     * 2026_08_29_000001_enable_row_level_security_on_unprotected_tables.php
     * established for every other table: this application reaches its data
     * only through the Laravel API, which connects as the table owner and is
     * exempt from RLS. Guarded by driver because the statement is
     * PostgreSQL-only and the test suite runs on in-memory SQLite.
     */
    private function enableRowLevelSecurity(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        foreach (['report_schedules', 'report_email_logs'] as $table) {
            DB::statement("ALTER TABLE public.\"{$table}\" ENABLE ROW LEVEL SECURITY");
        }
    }
};
