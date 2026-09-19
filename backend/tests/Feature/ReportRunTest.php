<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\ReportRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Report execution history (report_runs).
 *
 * Reporting is the output stage of a PROCESS inside CDARS — Crime Data
 * Collection -> Validation -> Analytics -> Reporting — not a module unrelated
 * to the ones that feed it. THIS TABLE has no page and no listing endpoint of
 * its own, so everything asserted here is about what the backend records when
 * a person exports from a module they can already reach; that is a statement
 * about report_runs, not about Reporting as a whole, which the Reports page
 * (/reports) remains a real, supported part of.
 *
 * The scheduled/e-mailed report feature is NOT touched by this checkpoint and
 * is not retired. Its tables still exist, still hold their rows, and
 * ScheduledReportTest still covers it as a live feature; the assertions below
 * prove the backfill reads that history without disturbing it.
 */
class ReportRunTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = 'migrations/2026_09_18_000002_create_report_runs_table.php';

    private function actingRole(string $role): User
    {
        $user = User::factory()->create(['role' => $role]);
        $this->actingAsSupabase($user);

        return $user;
    }

    /**
     * One legacy delivery-log row, written the way the scheduled/e-mailed
     * report feature writes them today. Inserted through the query builder
     * rather than the ReportEmailLog model, so this test exercises the
     * backfill's own read of the table's columns instead of depending on that
     * model's current shape.
     */
    private function legacyLog(array $overrides = []): int
    {
        return DB::table('report_email_logs')->insertGetId(array_merge([
            'report_schedule_id' => null,
            'schedule_name' => 'Monthly Summary Reports',
            'report_key' => 'incidents',
            'recipients' => json_encode(['punong.barangay@example.test']),
            'status' => 'sent',
            'trigger' => 'manual',
            'row_count' => 42,
            'filters_summary' => 'Period: 2026-08-01 to 2026-08-31 · Crime Type: All',
            'error' => null,
            'triggered_by' => null,
            'generated_at' => '2026-08-31 06:00:00',
            'created_at' => '2026-08-31 06:00:00',
            'updated_at' => '2026-08-31 06:00:00',
        ], $overrides));
    }

    /**
     * Re-runs the migration over whatever legacy rows the test has just
     * created. RefreshDatabase has already run it against an empty database,
     * so the table is dropped first; that is the only way to exercise the
     * backfill itself.
     */
    private function rerunMigration(): object
    {
        $migration = require database_path(self::MIGRATION);
        Schema::drop('report_runs');
        $migration->up();

        return $migration;
    }

    // ---------------------------------------------------------------
    // 1. The table
    // ---------------------------------------------------------------

    public function test_the_report_runs_table_exists_with_the_expected_columns(): void
    {
        $this->assertTrue(Schema::hasTable('report_runs'));

        $this->assertTrue(Schema::hasColumns('report_runs', [
            'id', 'report_key', 'report_label', 'period_from', 'period_to',
            'filters_summary', 'row_count', 'generated_by', 'origin',
            'generated_at', 'created_at', 'updated_at',
        ]));
    }

    public function test_the_table_carries_no_email_or_scheduling_columns(): void
    {
        foreach (['recipients', 'status', 'error', 'report_schedule_id', 'frequency', 'is_active'] as $column) {
            $this->assertFalse(
                Schema::hasColumn('report_runs', $column),
                "report_runs must not carry the e-mail/scheduling column [{$column}]."
            );
        }
    }

    // ---------------------------------------------------------------
    // 2. Legacy backfill
    // ---------------------------------------------------------------

    public function test_legacy_email_logs_are_backfilled_into_report_runs(): void
    {
        $user = User::factory()->create();
        $this->legacyLog(['triggered_by' => $user->id]);

        $this->rerunMigration();

        $this->assertSame(1, ReportRun::count());
        $run = ReportRun::first();

        $this->assertSame('incidents', $run->report_key);
        $this->assertSame('Monthly Summary Reports', $run->report_label);
        $this->assertSame('Period: 2026-08-01 to 2026-08-31 · Crime Type: All', $run->filters_summary);
        $this->assertSame(42, $run->row_count);
        $this->assertSame($user->id, $run->generated_by);
        $this->assertSame(ReportRun::ORIGIN_MANUAL, $run->origin);
        $this->assertSame('2026-08-31 06:00:00', $run->generated_at->format('Y-m-d H:i:s'));
        // The old rows held a rolling window, not two dates. Nothing is invented.
        $this->assertNull($run->period_from);
        $this->assertNull($run->period_to);
    }

    public function test_a_legacy_scheduled_run_is_preserved_as_scheduled_legacy(): void
    {
        $this->legacyLog(['trigger' => 'scheduled', 'schedule_name' => 'Weekly Crime Summary']);

        $this->rerunMigration();

        $this->assertSame(ReportRun::ORIGIN_SCHEDULED_LEGACY, ReportRun::first()->origin);
    }

    public function test_the_backfill_copies_no_recipient_status_or_error(): void
    {
        $this->legacyLog([
            'trigger' => 'scheduled',
            'status' => 'failed',
            'error' => 'Connection could not be established with host smtp.example.test',
            'recipients' => json_encode(['someone@example.test']),
        ]);

        $this->rerunMigration();

        $row = (array) DB::table('report_runs')->first();
        $serialised = json_encode($row);

        $this->assertStringNotContainsString('someone@example.test', $serialised);
        $this->assertStringNotContainsString('smtp.example.test', $serialised);
        $this->assertArrayNotHasKey('recipients', $row);
        $this->assertArrayNotHasKey('status', $row);
        $this->assertArrayNotHasKey('error', $row);
        $this->assertArrayNotHasKey('report_schedule_id', $row);
    }

    public function test_every_legacy_row_is_carried_over(): void
    {
        $this->legacyLog(['trigger' => 'manual']);
        $this->legacyLog(['trigger' => 'scheduled']);
        $this->legacyLog(['trigger' => 'scheduled', 'status' => 'failed', 'error' => 'boom']);

        $this->rerunMigration();

        $this->assertSame(3, ReportRun::count());
        $this->assertSame(1, ReportRun::where('origin', ReportRun::ORIGIN_MANUAL)->count());
        $this->assertSame(2, ReportRun::where('origin', ReportRun::ORIGIN_SCHEDULED_LEGACY)->count());
    }

    // ---------------------------------------------------------------
    // 3. The legacy tables are left alone
    // ---------------------------------------------------------------

    public function test_the_backfill_leaves_the_legacy_tables_untouched(): void
    {
        $scheduleId = DB::table('report_schedules')->insertGetId([
            'name' => 'Monthly Summary Reports',
            'report_key' => 'incidents',
            'period' => 'last_30_days',
            'filters' => json_encode([]),
            'recipients' => json_encode(['punong.barangay@example.test']),
            'frequency' => 'monthly',
            'hour' => 6,
            'day_of_month' => 1,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $logId = $this->legacyLog();

        $scheduleBefore = (array) DB::table('report_schedules')->find($scheduleId);
        $logBefore = (array) DB::table('report_email_logs')->find($logId);

        $this->rerunMigration();

        $this->assertSame($scheduleBefore, (array) DB::table('report_schedules')->find($scheduleId));
        $this->assertSame($logBefore, (array) DB::table('report_email_logs')->find($logId));
        $this->assertSame(1, DB::table('report_schedules')->count());
        $this->assertSame(1, DB::table('report_email_logs')->count());
    }

    public function test_down_drops_only_report_runs(): void
    {
        $this->legacyLog();

        $migration = $this->rerunMigration();
        $this->assertTrue(Schema::hasTable('report_runs'));

        $migration->down();

        $this->assertFalse(Schema::hasTable('report_runs'));
        $this->assertTrue(Schema::hasTable('report_email_logs'));
        $this->assertTrue(Schema::hasTable('report_schedules'));
        $this->assertSame(1, DB::table('report_email_logs')->count());
    }

    // ---------------------------------------------------------------
    // 4. A manual export records a run
    // ---------------------------------------------------------------

    public function test_an_export_records_a_report_run_and_the_audit_row(): void
    {
        $admin = $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/report-export-audit', ['report' => 'dashboard'])->assertOk();

        $this->assertSame(1, ReportRun::count());
        $run = ReportRun::first();
        $this->assertSame('dashboard', $run->report_key);
        $this->assertSame('Crime Reporting Dashboard', $run->report_label);
        $this->assertSame($admin->id, $run->generated_by);
        $this->assertSame(ReportRun::ORIGIN_MANUAL, $run->origin);
        $this->assertNotNull($run->generated_at);

        // The existing audit behaviour is unchanged.
        $this->assertSame(1, AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    public function test_scope_metadata_is_recorded_when_supplied(): void
    {
        $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/report-export-audit', [
            'report' => 'analytics',
            'rowCount' => 137,
            'periodFrom' => '2026-08-01',
            'periodTo' => '2026-08-31',
            'filtersSummary' => 'Crime Type: Theft · Sitio: Sitio 4',
        ])->assertOk();

        $run = ReportRun::first();
        $this->assertSame(137, $run->row_count);
        $this->assertSame('2026-08-01', $run->period_from->format('Y-m-d'));
        $this->assertSame('2026-08-31', $run->period_to->format('Y-m-d'));
        $this->assertSame('Crime Type: Theft · Sitio: Sitio 4', $run->filters_summary);
    }

    public function test_a_caller_that_sends_no_metadata_still_records_a_run(): void
    {
        // Every existing call site sends `report` alone. That must keep
        // working, and must still produce history.
        $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/report-export-audit', ['report' => 'incidents'])->assertOk();

        $run = ReportRun::first();
        $this->assertNull($run->row_count);
        $this->assertNull($run->period_from);
        $this->assertNull($run->period_to);
        $this->assertNull($run->filters_summary);
        $this->assertSame(ReportRun::ORIGIN_MANUAL, $run->origin);
    }

    public function test_the_validator_and_encoder_also_record_their_own_runs(): void
    {
        // D-R3 / D-R7: the BADAC Validator exports from the modules it can
        // already reach. D-R4: the Encoder's existing export surface is
        // unchanged — this endpoint has never been role-restricted.
        $validator = $this->actingRole(User::ROLE_BADAC_VALIDATOR);
        $this->postJson('/api/report-export-audit', ['report' => 'analytics'])->assertOk();

        $encoder = $this->actingRole(User::ROLE_ENCODER);
        $this->postJson('/api/report-export-audit', ['report' => 'incidents'])->assertOk();

        $this->assertSame($validator->id, ReportRun::where('report_key', 'analytics')->first()->generated_by);
        $this->assertSame($encoder->id, ReportRun::where('report_key', 'incidents')->first()->generated_by);
    }

    // ---------------------------------------------------------------
    // 4b. Crime Mapping (R2b)
    // ---------------------------------------------------------------

    public function test_the_crime_mapping_export_is_recordable(): void
    {
        // Crime Mapping was the last tabular module with no export at all, so
        // its key did not exist and a mapping export would have been rejected
        // by the whitelist with nothing written.
        $admin = $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/report-export-audit', [
            'report' => 'mapping',
            'rowCount' => 42,
            'periodFrom' => '2026-08-01',
            'periodTo' => '2026-08-31',
            'filtersSummary' => 'From: 2026-08-01 · To: 2026-08-31 · Crime Type: Theft · Sitio: All · Status: All',
        ])->assertOk();

        $run = ReportRun::where('report_key', 'mapping')->sole();

        $this->assertSame('Crime Mapping and Visualization', $run->report_label);
        $this->assertSame(42, $run->row_count);
        $this->assertSame('2026-08-01', $run->period_from->format('Y-m-d'));
        $this->assertSame('2026-08-31', $run->period_to->format('Y-m-d'));
        $this->assertStringContainsString('Crime Type: Theft', $run->filters_summary);

        // The two facts the checkpoint asks for explicitly.
        $this->assertSame(ReportRun::ORIGIN_MANUAL, $run->origin);
        $this->assertSame($admin->id, $run->generated_by);

        // And the audit event is still written beside it, as it is for every
        // other export surface.
        $this->assertSame(
            1,
            AuditLog::where('action', 'REPORT_EXPORTED')
                ->where('description', 'Exported the Crime Mapping and Visualization report')
                ->count(),
        );
    }

    public function test_the_mapping_run_stores_no_personal_detail(): void
    {
        // The mapping export projects the PII-free /incidents/map payload, and
        // the run record carries only the scope of that export. Asserted on
        // the stored row itself: whatever a caller sends, what lands in
        // report_runs is a key, a label, a period, a filter line and a count —
        // there is no column here that could hold a person.
        $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/report-export-audit', [
            'report' => 'mapping',
            'rowCount' => 3,
            'filtersSummary' => 'Sitio: Sitio 1',
        ])->assertOk();

        $row = (array) DB::table('report_runs')->sole();

        $this->assertSame([
            'id',
            'report_key',
            'report_label',
            'period_from',
            'period_to',
            'filters_summary',
            'row_count',
            'generated_by',
            'origin',
            'generated_at',
            'created_at',
            'updated_at',
        ], array_keys($row));

        foreach (['victim', 'suspect', 'complainant', 'contact', 'address', 'latitude', 'longitude'] as $forbidden) {
            $this->assertStringNotContainsStringIgnoringCase(
                $forbidden,
                json_encode($row),
            );
        }
    }

    // ---------------------------------------------------------------
    // 5. Existing endpoint behaviour is unchanged
    // ---------------------------------------------------------------

    public function test_an_unauthenticated_request_records_nothing(): void
    {
        $this->postJson('/api/report-export-audit', ['report' => 'dashboard'])
            ->assertUnauthorized();

        $this->assertSame(0, ReportRun::count());
        $this->assertSame(0, AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    public function test_an_unknown_report_key_is_rejected_and_records_nothing(): void
    {
        $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/report-export-audit', ['report' => 'everything'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('report');

        $this->assertSame(0, ReportRun::count());
        $this->assertSame(0, AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    public function test_invalid_metadata_is_rejected_and_records_nothing(): void
    {
        $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/report-export-audit', [
            'report' => 'dashboard',
            'rowCount' => -1,
            'periodFrom' => '31-08-2026',
            'filtersSummary' => str_repeat('x', 501),
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['rowCount', 'periodFrom', 'filtersSummary']);

        $this->assertSame(0, ReportRun::count());
        $this->assertSame(0, AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    public function test_recording_a_run_sends_no_mail(): void
    {
        // Reporting no longer delivers anything. This checkpoint must not
        // introduce a send, and the export path never had one.
        Mail::fake();

        $this->actingRole(User::ROLE_BADAC_ADMIN);
        $this->postJson('/api/report-export-audit', ['report' => 'dashboard'])->assertOk();

        Mail::assertNothingSent();
        Mail::assertNothingQueued();
    }
}
