<?php

namespace Tests\Feature;

use App\Mail\ScheduledReportMail;
use App\Models\AuditLog;
use App\Models\Incident;
use App\Models\ReportEmailLog;
use App\Models\ReportSchedule;
use App\Models\User;
use App\Services\ReportGenerator;
use App\Services\ScheduledReportDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Automated report generation, end to end (Reporting System checklist,
 * "Scheduled Reports" and its "Email Logs" evidence).
 *
 * The feature is worth nothing unless four things hold, and each has its own
 * group of tests below:
 *
 *   - Only an administrator can create, edit, archive, restore or run a
 *     schedule. A schedule sends crime records to an address on a timer, with
 *     nobody present; that is a stronger capability than the on-demand export
 *     every role already has. BADAC Read-Only may READ schedules and the
 *     delivery log, but never receives recipient addresses or raw errors.
 *     Encoder has no access at all.
 *   - A schedule runs when it is due, and NOT twice in the same slot.
 *   - Every run leaves a log row, whether it succeeded or failed. The failed
 *     run is the one an administrator needs to find.
 *   - No report content leaks into the message body or into the log.
 */
class ScheduledReportTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Weekly Crime Summary',
            'report_key' => 'incidents',
            'period' => 'last_7_days',
            'frequency' => 'weekly',
            'hour' => 6,
            'day_of_week' => 1,
            'recipients' => ['punong.barangay@example.test'],
            'filters' => ['sitio' => 'Sitio 1'],
        ], $overrides);
    }

    private function schedule(array $overrides = []): ReportSchedule
    {
        return ReportSchedule::create(array_merge([
            'name' => 'Weekly Crime Summary',
            'report_key' => 'incidents',
            'period' => 'last_30_days',
            'frequency' => 'weekly',
            'hour' => 6,
            'day_of_week' => 1,
            'recipients' => ['punong.barangay@example.test'],
            'filters' => [],
            'is_active' => true,
        ], $overrides));
    }

    // ---------------------------------------------------------------
    // Authorisation
    // ---------------------------------------------------------------

    public function test_an_unauthenticated_request_is_rejected(): void
    {
        $this->getJson('/api/report-schedules')->assertUnauthorized();
        $this->postJson('/api/report-schedules', $this->payload())->assertUnauthorized();
        $this->getJson('/api/report-email-logs')->assertUnauthorized();
    }

    public function test_an_encoder_is_refused_on_every_report_endpoint(): void
    {
        Mail::fake();
        $active = $this->schedule();
        $archived = $this->schedule(['name' => 'Archived One']);
        $archived->delete();

        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->getJson('/api/report-schedules')->assertForbidden();
        $this->getJson('/api/report-schedules?archived=1')->assertForbidden();
        $this->getJson('/api/report-email-logs')->assertForbidden();
        $this->postJson('/api/report-schedules', $this->payload())->assertForbidden();
        $this->putJson("/api/report-schedules/{$active->id}", ['name' => 'X'])->assertForbidden();
        $this->putJson("/api/report-schedules/{$active->id}", ['is_active' => false])->assertForbidden();
        $this->putJson("/api/report-schedules/{$active->id}/archive")->assertForbidden();
        $this->putJson("/api/report-schedules/{$archived->id}/restore")->assertForbidden();
        $this->postJson("/api/report-schedules/{$active->id}/run")->assertForbidden();

        Mail::assertNothingSent();
        $this->assertSame(1, ReportSchedule::count());
        $this->assertTrue($archived->fresh()->trashed());
        $this->assertSame('Weekly Crime Summary', $active->fresh()->name);
    }

    public function test_a_badac_validator_account_can_read_but_never_manage_schedules(): void
    {
        // This account may SEE the schedules and whether they were delivered,
        // and still may not stand up, change or fire an automation that mails
        // records out. Viewing is not the same permission as sending.
        Mail::fake();
        $active = $this->schedule();
        $archived = $this->schedule(['name' => 'Archived One']);
        $archived->delete();

        $viewer = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        $this->actingAsSupabase($viewer);

        $this->getJson('/api/report-schedules')->assertOk()->assertJsonCount(1);
        $this->getJson('/api/report-schedules?archived=1')->assertOk()->assertJsonCount(1);
        $this->getJson('/api/report-email-logs')->assertOk();

        $this->postJson('/api/report-schedules', $this->payload())->assertForbidden();
        $this->putJson("/api/report-schedules/{$active->id}", ['name' => 'X'])->assertForbidden();
        // Pause and resume are the same update endpoint.
        $this->putJson("/api/report-schedules/{$active->id}", ['is_active' => false])->assertForbidden();
        $this->putJson("/api/report-schedules/{$active->id}/archive")->assertForbidden();
        $this->putJson("/api/report-schedules/{$archived->id}/restore")->assertForbidden();
        $this->postJson("/api/report-schedules/{$active->id}/run")->assertForbidden();

        Mail::assertNothingSent();
        $this->assertSame(0, ReportEmailLog::count());
        $fresh = $active->fresh();
        $this->assertSame('Weekly Crime Summary', $fresh->name);
        $this->assertTrue($fresh->is_active);
        $this->assertFalse($fresh->trashed());
        $this->assertTrue($archived->fresh()->trashed());
        $this->assertDatabaseMissing('audit_logs', ['module' => 'reports']);
    }

    public function test_there_is_no_permanent_delete_endpoint(): void
    {
        $this->admin();
        $schedule = $this->schedule();

        $this->deleteJson("/api/report-schedules/{$schedule->id}")->assertStatus(405);

        $this->assertDatabaseHas('report_schedules', ['id' => $schedule->id, 'archived_at' => null]);
        $deleteRoutes = collect(Route::getRoutes())
            ->filter(fn ($route) => str_contains($route->uri(), 'report-schedules')
                && in_array('DELETE', $route->methods(), true));
        $this->assertCount(0, $deleteRoutes);
    }

    public function test_an_encoder_cannot_run_an_existing_schedule(): void
    {
        $schedule = $this->schedule();

        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        Mail::fake();
        $this->postJson("/api/report-schedules/{$schedule->id}/run")->assertForbidden();
        Mail::assertNothingSent();
    }

    // ---------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------

    public function test_an_administrator_can_create_a_schedule(): void
    {
        $admin = $this->admin();

        $this->postJson('/api/report-schedules', $this->payload())
            ->assertCreated()
            ->assertJsonPath('name', 'Weekly Crime Summary')
            ->assertJsonPath('reportLabel', 'Crime Data Collection')
            ->assertJsonPath('isActive', true);

        $this->assertDatabaseHas('report_schedules', [
            'name' => 'Weekly Crime Summary',
            'report_key' => 'incidents',
            'created_by' => $admin->id,
        ]);
    }

    public function test_creating_a_schedule_is_recorded_in_the_audit_trail(): void
    {
        $this->admin();

        $this->postJson('/api/report-schedules', $this->payload())->assertCreated();

        $log = AuditLog::where('module', 'reports')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertSame('CREATE', $log->action);
        $this->assertStringContainsString('Weekly Crime Summary', $log->description);
    }

    public function test_it_rejects_an_unknown_report_key(): void
    {
        $this->admin();

        $this->postJson('/api/report-schedules', $this->payload(['report_key' => 'everything']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('report_key');
    }

    public function test_it_rejects_a_recipient_that_is_not_an_email_address(): void
    {
        // This list is the only thing deciding where crime records are sent.
        $this->admin();

        $this->postJson('/api/report-schedules', $this->payload(['recipients' => ['not-an-address']]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('recipients.0');

        $this->postJson('/api/report-schedules', $this->payload(['recipients' => []]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('recipients');
    }

    public function test_it_rejects_a_monthly_day_that_does_not_exist_in_every_month(): void
    {
        // A schedule on the 31st would never run in February, and would look
        // like a broken feature rather than an impossible configuration.
        $this->admin();

        $this->postJson('/api/report-schedules', $this->payload([
            'frequency' => 'monthly',
            'day_of_month' => 31,
        ]))->assertStatus(422)->assertJsonValidationErrors('day_of_month');
    }

    public function test_it_stores_only_the_whitelisted_filter_keys(): void
    {
        $this->admin();

        $this->postJson('/api/report-schedules', $this->payload([
            'filters' => [
                'sitio' => 'Sitio 1',
                // Not a filter this report offers. It must not be carried into
                // the stored configuration, where it would later be handed to
                // a query builder.
                'reported_by' => '1',
            ],
        ]))->assertCreated();

        $stored = ReportSchedule::first();
        $this->assertSame(['sitio' => 'Sitio 1'], $stored->filters);
    }

    public function test_an_administrator_can_update_and_pause_a_schedule(): void
    {
        $this->admin();
        $schedule = $this->schedule();

        $this->putJson("/api/report-schedules/{$schedule->id}", ['name' => 'Renamed', 'is_active' => false])
            ->assertOk()
            ->assertJsonPath('name', 'Renamed')
            ->assertJsonPath('isActive', false);
    }

    // ---------------------------------------------------------------
    // Archive / restore (replaces permanent delete)
    // ---------------------------------------------------------------

    public function test_an_administrator_can_archive_a_schedule_without_deleting_it(): void
    {
        Mail::fake();
        $this->admin();
        $schedule = $this->schedule();

        app(ScheduledReportDispatcher::class)->runOnce($schedule);
        $this->assertSame(1, ReportEmailLog::count());

        $this->putJson("/api/report-schedules/{$schedule->id}/archive")
            ->assertOk()
            ->assertJsonPath('isArchived', true)
            ->assertJsonPath('nextRunAt', null);

        // The row is still there, archived, with its configuration intact.
        $stored = ReportSchedule::withTrashed()->find($schedule->id);
        $this->assertNotNull($stored);
        $this->assertNotNull($stored->archived_at);
        $this->assertSame('Weekly Crime Summary', $stored->name);
        $this->assertSame(['punong.barangay@example.test'], $stored->recipients);
        $this->assertDatabaseHas('report_schedules', ['id' => $schedule->id]);

        // Delivery history is kept AND still linked to the schedule.
        $log = ReportEmailLog::first();
        $this->assertSame($schedule->id, $log->report_schedule_id);
        $this->assertSame('Weekly Crime Summary', $log->schedule_name);

        $audit = AuditLog::where('module', 'reports')->where('action', 'ARCHIVE')->first();
        $this->assertNotNull($audit);
        $this->assertStringContainsString('Weekly Crime Summary', $audit->description);
    }

    public function test_an_archived_schedule_moves_from_the_active_list_to_the_archived_list(): void
    {
        $this->admin();
        $schedule = $this->schedule();
        $this->schedule(['name' => 'Still Active']);

        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertOk();

        $this->getJson('/api/report-schedules')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.name', 'Still Active')
            ->assertJsonPath('0.isArchived', false);

        $this->getJson('/api/report-schedules?archived=1')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.name', 'Weekly Crime Summary')
            ->assertJsonPath('0.isArchived', true);
    }

    public function test_an_administrator_can_restore_an_archived_schedule(): void
    {
        Mail::fake();
        $this->admin();
        $schedule = $this->schedule();
        app(ScheduledReportDispatcher::class)->runOnce($schedule);

        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertOk();
        $this->putJson("/api/report-schedules/{$schedule->id}/restore")
            ->assertOk()
            ->assertJsonPath('isArchived', false)
            ->assertJsonPath('archivedAt', null);

        $this->assertNull($schedule->fresh()->archived_at);
        $this->getJson('/api/report-schedules')->assertJsonCount(1);
        $this->getJson('/api/report-schedules?archived=1')->assertJsonCount(0);
        $this->assertSame($schedule->id, ReportEmailLog::first()->report_schedule_id);
        $this->assertNotNull(AuditLog::where('module', 'reports')->where('action', 'RESTORE')->first());
    }

    public function test_archive_and_restore_preserve_an_active_schedules_state(): void
    {
        $this->admin();
        $schedule = $this->schedule(['is_active' => true]);

        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertOk();
        $this->assertTrue(ReportSchedule::withTrashed()->find($schedule->id)->is_active);

        $this->putJson("/api/report-schedules/{$schedule->id}/restore")
            ->assertOk()
            ->assertJsonPath('isActive', true);
        $this->assertTrue($schedule->fresh()->is_active);
    }

    public function test_archive_and_restore_preserve_a_paused_schedules_state(): void
    {
        $this->admin();
        $schedule = $this->schedule(['is_active' => false]);

        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertOk();
        $this->assertFalse(ReportSchedule::withTrashed()->find($schedule->id)->is_active);

        $this->putJson("/api/report-schedules/{$schedule->id}/restore")
            ->assertOk()
            ->assertJsonPath('isActive', false);
        $this->assertFalse($schedule->fresh()->is_active);
    }

    public function test_an_archived_schedule_cannot_be_edited_until_restored(): void
    {
        $this->admin();
        $schedule = $this->schedule();
        $schedule->delete();

        $this->putJson("/api/report-schedules/{$schedule->id}", ['name' => 'Sneaky'])->assertNotFound();
        $this->putJson("/api/report-schedules/{$schedule->id}", ['is_active' => true])->assertNotFound();
        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertNotFound();

        $this->assertSame('Weekly Crime Summary', ReportSchedule::withTrashed()->find($schedule->id)->name);
    }

    public function test_restoring_a_schedule_that_is_not_archived_is_refused(): void
    {
        $this->admin();
        $schedule = $this->schedule();

        $this->putJson("/api/report-schedules/{$schedule->id}/restore")->assertStatus(422);
        $this->assertDatabaseMissing('audit_logs', ['module' => 'reports', 'action' => 'RESTORE']);
    }

    /**
     * The migration's rollback must not bring an archived schedule back to
     * life. Runs down() and up() against the in-memory test database only.
     */
    public function test_rolling_back_the_archive_migration_pauses_archived_schedules(): void
    {
        $archivedActive = $this->schedule(['name' => 'Archived While Active', 'is_active' => true]);
        $archivedActive->delete();
        $liveActive = $this->schedule(['name' => 'Live Active', 'is_active' => true]);

        $migration = require database_path('migrations/2026_09_17_000003_add_archived_at_to_report_schedules_table.php');

        $migration->down();

        $this->assertFalse(Schema::hasColumn('report_schedules', 'archived_at'));
        $this->assertFalse((bool) DB::table('report_schedules')->where('id', $archivedActive->id)->value('is_active'));
        $this->assertTrue((bool) DB::table('report_schedules')->where('id', $liveActive->id)->value('is_active'));

        $migration->up();

        $this->assertTrue(Schema::hasColumn('report_schedules', 'archived_at'));
        $this->assertNull(DB::table('report_schedules')->where('id', $liveActive->id)->value('archived_at'));
    }

    // ---------------------------------------------------------------
    // Archived schedules are never sent
    // ---------------------------------------------------------------

    public function test_the_dispatcher_never_selects_an_archived_schedule(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-05-04 06:00:00');

        $archived = $this->schedule(['name' => 'Archived Due', 'hour' => 6, 'day_of_week' => 1]);
        $archived->delete();
        $this->schedule(['name' => 'Live Due', 'hour' => 6, 'day_of_week' => 1]);

        $logs = app(ScheduledReportDispatcher::class)->dispatchDue(Carbon::now());

        $this->assertCount(1, $logs);
        $this->assertSame('Live Due', $logs[0]->schedule_name);
        $this->assertSame(0, ReportEmailLog::where('report_schedule_id', $archived->id)->count());

        Carbon::setTestNow();
    }

    public function test_the_hourly_command_never_sends_an_archived_schedule(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-05-04 06:00:00');

        $archived = $this->schedule(['name' => 'Archived Due', 'hour' => 6, 'day_of_week' => 1]);
        $archived->delete();

        $this->artisan('reports:send-scheduled')->assertSuccessful();

        Mail::assertNothingSent();
        $this->assertSame(0, ReportEmailLog::count());

        Carbon::setTestNow();
    }

    public function test_an_archived_schedule_cannot_be_sent_by_id_even_with_force(): void
    {
        Mail::fake();
        $archived = $this->schedule();
        $archived->delete();

        $this->artisan("reports:send-scheduled --schedule={$archived->id} --force")->assertSuccessful();

        Mail::assertNothingSent();
        $this->assertSame(0, ReportEmailLog::count());
        $this->assertNull(ReportSchedule::withTrashed()->find($archived->id)->last_run_at);
    }

    public function test_run_now_is_refused_for_an_archived_schedule(): void
    {
        Mail::fake();
        $this->admin();
        $schedule = $this->schedule();
        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertOk();

        $this->postJson("/api/report-schedules/{$schedule->id}/run")->assertNotFound();

        Mail::assertNothingSent();
        $this->assertSame(0, ReportEmailLog::count());

        // Once restored it can be run again.
        $this->putJson("/api/report-schedules/{$schedule->id}/restore")->assertOk();
        $this->postJson("/api/report-schedules/{$schedule->id}/run")->assertOk();
        Mail::assertSent(ScheduledReportMail::class, 1);
    }

    // ---------------------------------------------------------------
    // Pause state is enforced on EVERY send path
    //
    //   State                  hourly  Run Now  --schedule=ID  --force
    //   active                 sends   sends    sends          sends
    //   paused                 no      no       no             no
    //   archived               no      no       no             no
    //   restored from paused   no      no       no             no
    //   restored from active   sends   sends    sends          sends
    //
    // "no" always means: no mail AND no delivery-log row.
    // ---------------------------------------------------------------

    /** Monday 2026-05-04 06:00 — the slot a weekly Monday 06:00 schedule is due in. */
    private function atDueSlot(): void
    {
        Carbon::setTestNow('2026-05-04 06:00:00');
    }

    private function dueSchedule(array $overrides = []): ReportSchedule
    {
        return $this->schedule(array_merge(['hour' => 6, 'day_of_week' => 1], $overrides));
    }

    private function assertNothingSentOrLogged(ReportSchedule $schedule): void
    {
        Mail::assertNothingSent();
        $this->assertSame(0, ReportEmailLog::where('report_schedule_id', $schedule->id)->count());
        $this->assertNull(ReportSchedule::withTrashed()->find($schedule->id)->last_run_at);
    }

    /**
     * Sends $schedule through one path and reports whether exactly one mail
     * and one log row resulted. `force` and `id` are the two command variants.
     */
    private function sendThrough(string $path, ReportSchedule $schedule): void
    {
        match ($path) {
            'hourly' => $this->artisan('reports:send-scheduled')->run(),
            'id' => $this->artisan("reports:send-scheduled --schedule={$schedule->id}")->run(),
            'force' => $this->artisan("reports:send-scheduled --schedule={$schedule->id} --force")->run(),
            'run-now' => $this->postJson("/api/report-schedules/{$schedule->id}/run"),
        };
    }

    public function test_a_paused_schedule_is_not_processed_by_the_hourly_scheduler(): void
    {
        Mail::fake();
        $this->atDueSlot();
        $paused = $this->dueSchedule(['is_active' => false]);

        $this->assertSame([], app(ScheduledReportDispatcher::class)->dispatchDue(Carbon::now()));
        $this->artisan('reports:send-scheduled')->assertSuccessful();

        $this->assertNothingSentOrLogged($paused);
        Carbon::setTestNow();
    }

    public function test_a_paused_schedule_cannot_be_sent_through_schedule_id(): void
    {
        Mail::fake();
        // Even in its own due slot.
        $this->atDueSlot();
        $paused = $this->dueSchedule(['is_active' => false]);

        $this->artisan("reports:send-scheduled --schedule={$paused->id}")->assertSuccessful();

        $this->assertNothingSentOrLogged($paused);
        Carbon::setTestNow();
    }

    public function test_a_paused_schedule_cannot_be_sent_through_schedule_id_with_force(): void
    {
        Mail::fake();
        $paused = $this->schedule(['is_active' => false]);

        $this->artisan("reports:send-scheduled --schedule={$paused->id} --force")
            ->expectsOutputToContain('is paused')
            ->expectsOutputToContain('sent=0 failed=0 not-due=0 paused=1')
            ->assertSuccessful();

        $this->assertNothingSentOrLogged($paused);
    }

    public function test_a_paused_schedule_cannot_be_sent_through_run_now(): void
    {
        Mail::fake();
        $this->admin();
        $paused = $this->schedule(['is_active' => false]);

        $this->postJson("/api/report-schedules/{$paused->id}/run")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This report schedule is paused. Resume it before running it.');

        $this->assertNothingSentOrLogged($paused);
        $this->assertDatabaseMissing('audit_logs', ['module' => 'reports', 'action' => 'EXPORT']);
    }

    public function test_the_dispatcher_refuses_a_stale_copy_of_a_schedule_paused_after_it_was_loaded(): void
    {
        Mail::fake();
        $schedule = $this->schedule(['is_active' => true]);

        // Somebody pauses it after this copy was loaded.
        DB::table('report_schedules')->where('id', $schedule->id)->update(['is_active' => false]);
        $this->assertTrue($schedule->is_active, 'Precondition: the in-memory copy is stale.');

        $this->assertNull(app(ScheduledReportDispatcher::class)->runOnce($schedule));
        $this->assertNothingSentOrLogged($schedule);
    }

    public function test_an_active_schedule_still_sends_through_every_path(): void
    {
        $this->admin();

        foreach (['hourly', 'id', 'force', 'run-now'] as $path) {
            Mail::fake();
            $this->atDueSlot();
            ReportEmailLog::query()->delete();
            DB::table('report_schedules')->delete();

            $active = $this->dueSchedule(['is_active' => true, 'name' => "Active via {$path}"]);

            $this->sendThrough($path, $active);

            Mail::assertSent(ScheduledReportMail::class, 1);
            $this->assertSame(1, ReportEmailLog::where('report_schedule_id', $active->id)->count(), $path);
            $this->assertSame(ReportEmailLog::STATUS_SENT, ReportEmailLog::first()->status, $path);
        }

        Carbon::setTestNow();
    }

    public function test_a_schedule_restored_from_paused_stays_paused_and_blocked_on_every_path(): void
    {
        $this->admin();
        $schedule = $this->dueSchedule(['is_active' => false]);

        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertOk();
        $this->putJson("/api/report-schedules/{$schedule->id}/restore")
            ->assertOk()
            ->assertJsonPath('isActive', false)
            ->assertJsonPath('isArchived', false);

        foreach (['hourly', 'id', 'force', 'run-now'] as $path) {
            Mail::fake();
            $this->atDueSlot();

            $this->sendThrough($path, $schedule);

            Mail::assertNothingSent();
            $this->assertSame(0, ReportEmailLog::count(), $path);
        }

        $this->assertFalse($schedule->fresh()->is_active);
        $this->assertNull($schedule->fresh()->last_run_at);
        Carbon::setTestNow();
    }

    public function test_a_schedule_restored_from_active_is_sendable_again_on_every_path(): void
    {
        $this->admin();

        foreach (['hourly', 'id', 'force', 'run-now'] as $path) {
            Mail::fake();
            $this->atDueSlot();
            ReportEmailLog::query()->delete();
            DB::table('report_schedules')->delete();

            $schedule = $this->dueSchedule(['is_active' => true, 'name' => "Restored via {$path}"]);
            $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertOk();

            // Archived: blocked.
            $this->sendThrough($path, $schedule);
            Mail::assertNothingSent();
            $this->assertSame(0, ReportEmailLog::count(), "archived via {$path}");

            $this->putJson("/api/report-schedules/{$schedule->id}/restore")
                ->assertOk()
                ->assertJsonPath('isActive', true);

            // Restored from active: sends again.
            $this->sendThrough($path, $schedule);
            Mail::assertSent(ScheduledReportMail::class, 1);
            $this->assertSame(1, ReportEmailLog::where('report_schedule_id', $schedule->id)->count(), "restored via {$path}");
        }

        Carbon::setTestNow();
    }

    // ---------------------------------------------------------------
    // The soft-delete column really is archived_at
    // ---------------------------------------------------------------

    public function test_soft_deletes_use_archived_at_and_never_deleted_at(): void
    {
        $model = new ReportSchedule;

        // How the override works: SoftDeletes::getDeletedAtColumn() returns
        // static::DELETED_AT when the model defines it.
        $this->assertSame('archived_at', ReportSchedule::DELETED_AT);
        $this->assertSame('archived_at', $model->getDeletedAtColumn());
        $this->assertSame('report_schedules.archived_at', $model->getQualifiedDeletedAtColumn());
        $this->assertSame('datetime', $model->getCasts()['archived_at'] ?? null);

        $this->assertFalse(Schema::hasColumn('report_schedules', 'deleted_at'));
        $this->assertTrue(Schema::hasColumn('report_schedules', 'archived_at'));

        // The global scope filters on archived_at.
        $sql = strtolower(ReportSchedule::query()->toSql());
        $this->assertStringContainsString('"report_schedules"."archived_at" is null', $sql);
        $this->assertStringNotContainsString('deleted_at', $sql);
    }

    public function test_archive_and_restore_behave_as_soft_deletes_on_archived_at(): void
    {
        Mail::fake();

        $activeKept = $this->schedule(['name' => 'Active Kept', 'is_active' => true]);
        $activeArchived = $this->schedule(['name' => 'Active Archived', 'is_active' => true]);
        $pausedArchived = $this->schedule(['name' => 'Paused Archived', 'is_active' => false]);

        app(ScheduledReportDispatcher::class)->runOnce($activeArchived);
        $this->assertSame(1, $activeArchived->emailLogs()->count());

        $activeArchived->delete();
        $pausedArchived->delete();

        // Stored: every row is still in the table, the two archived ones with
        // archived_at set and is_active exactly as it was.
        $raw = DB::table('report_schedules')->get()->keyBy('name');
        $this->assertCount(3, $raw);
        $this->assertNull($raw['Active Kept']->archived_at);
        $this->assertNotNull($raw['Active Archived']->archived_at);
        $this->assertNotNull($raw['Paused Archived']->archived_at);
        $this->assertTrue((bool) $raw['Active Archived']->is_active);
        $this->assertFalse((bool) $raw['Paused Archived']->is_active);

        // Normal queries exclude archived; withTrashed includes; onlyTrashed
        // returns only archived.
        $this->assertSame(['Active Kept'], ReportSchedule::orderBy('name')->pluck('name')->all());
        $this->assertSame(
            ['Active Archived', 'Active Kept', 'Paused Archived'],
            ReportSchedule::withTrashed()->orderBy('name')->pluck('name')->all()
        );
        $this->assertSame(
            ['Active Archived', 'Paused Archived'],
            ReportSchedule::onlyTrashed()->orderBy('name')->pluck('name')->all()
        );
        $this->assertNull(ReportSchedule::find($activeArchived->id));

        // An archived record keeps its delivery-log relationship, both ways.
        $archived = ReportSchedule::withTrashed()->find($activeArchived->id);
        $this->assertTrue($archived->trashed());
        $this->assertSame(1, $archived->emailLogs()->count());
        $this->assertNotNull($archived->latestEmailLog);
        $log = ReportEmailLog::first();
        $this->assertSame($activeArchived->id, $log->report_schedule_id);
        $this->assertSame($activeArchived->id, $log->schedule()->withTrashed()->first()->id);

        // restore() clears archived_at and leaves is_active untouched.
        $archived->restore();
        ReportSchedule::withTrashed()->find($pausedArchived->id)->restore();

        $raw = DB::table('report_schedules')->get()->keyBy('name');
        $this->assertNull($raw['Active Archived']->archived_at);
        $this->assertNull($raw['Paused Archived']->archived_at);
        $this->assertTrue((bool) $raw['Active Archived']->is_active);
        $this->assertFalse((bool) $raw['Paused Archived']->is_active);
        $this->assertSame(0, ReportSchedule::onlyTrashed()->count());
    }

    // ---------------------------------------------------------------
    // Recipient privacy
    // ---------------------------------------------------------------

    private const PRIVATE_ADDRESS = 'punong.barangay@example.test';

    private function failedRunQuotingTheAddress(): ReportSchedule
    {
        // A realistic SMTP rejection, which quotes the rejected recipient.
        Mail::shouldReceive('to')->andThrow(new \RuntimeException(
            'Expected response code "250/251/252" but got code "550", with message "550 5.1.1 <'.self::PRIVATE_ADDRESS.'>: Recipient address rejected"'
        ));

        $schedule = $this->schedule(['recipients' => [self::PRIVATE_ADDRESS, 'kagawad@example.test']]);
        app(ScheduledReportDispatcher::class)->runOnce($schedule);

        return $schedule;
    }

    public function test_an_administrator_still_receives_recipients_and_detailed_errors(): void
    {
        $this->admin();
        $this->failedRunQuotingTheAddress();

        $this->getJson('/api/report-schedules')
            ->assertOk()
            ->assertJsonPath('0.recipients', [self::PRIVATE_ADDRESS, 'kagawad@example.test'])
            ->assertJsonPath('0.recipientCount', 2)
            ->assertJsonPath('0.lastRunStatus', ReportEmailLog::STATUS_FAILED)
            ->assertJsonPath('0.lastRunError', fn (string $e) => str_contains($e, self::PRIVATE_ADDRESS));

        $this->getJson('/api/report-email-logs')
            ->assertOk()
            ->assertJsonPath('0.recipients', [self::PRIVATE_ADDRESS, 'kagawad@example.test'])
            ->assertJsonPath('0.recipientCount', 2)
            ->assertJsonPath('0.error', fn (string $e) => str_contains($e, 'Recipient address rejected'));
    }

    public function test_readonly_never_receives_recipient_addresses_or_raw_errors(): void
    {
        $schedule = $this->failedRunQuotingTheAddress();

        $viewer = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        $this->actingAsSupabase($viewer);

        $responses = [
            'schedules' => $this->getJson('/api/report-schedules')->assertOk(),
            'logs' => $this->getJson('/api/report-email-logs')->assertOk(),
        ];

        // Archived schedules are shaped the same way.
        $schedule->delete();
        $responses['archived'] = $this->getJson('/api/report-schedules?archived=1')->assertOk();

        foreach ($responses as $where => $response) {
            $body = $response->getContent();
            foreach ([self::PRIVATE_ADDRESS, 'kagawad@example.test', '@example.test', 'Recipient address rejected', '550'] as $needle) {
                $this->assertStringNotContainsString($needle, $body, "Read-Only {$where} response leaked: {$needle}");
            }

            $row = $response->json('0');
            $this->assertArrayNotHasKey('recipients', $row, $where);
            $this->assertArrayNotHasKey('error', $row, $where);
            $this->assertArrayNotHasKey('lastRunError', $row, $where);
            $this->assertSame(2, $row['recipientCount'], $where);
        }

        // Only the generic delivery status remains.
        $this->assertSame(ReportEmailLog::STATUS_FAILED, $responses['schedules']->json('0.lastRunStatus'));
        $this->assertSame(ReportEmailLog::STATUS_FAILED, $responses['logs']->json('0.status'));
    }

    // ---------------------------------------------------------------
    // Due logic
    // ---------------------------------------------------------------

    public function test_a_weekly_schedule_is_due_only_in_its_own_hour_and_day(): void
    {
        $schedule = $this->schedule(['frequency' => 'weekly', 'hour' => 6, 'day_of_week' => 1]);

        // Monday 06:00 — the configured slot.
        $this->assertTrue($schedule->isDue(Carbon::parse('2026-05-04 06:15:00')));
        // Right day, wrong hour.
        $this->assertFalse($schedule->isDue(Carbon::parse('2026-05-04 07:00:00')));
        // Right hour, wrong day.
        $this->assertFalse($schedule->isDue(Carbon::parse('2026-05-05 06:00:00')));
    }

    public function test_an_inactive_schedule_is_never_due(): void
    {
        $schedule = $this->schedule(['is_active' => false, 'hour' => 6, 'day_of_week' => 1]);

        $this->assertFalse($schedule->isDue(Carbon::parse('2026-05-04 06:00:00')));
    }

    public function test_a_schedule_does_not_run_twice_in_the_same_hour(): void
    {
        // The command runs hourly; without this guard a retry or an
        // overlapping tick would send the same report again.
        $schedule = $this->schedule([
            'hour' => 6,
            'day_of_week' => 1,
            'last_run_at' => Carbon::parse('2026-05-04 06:02:00'),
        ]);

        $this->assertFalse($schedule->isDue(Carbon::parse('2026-05-04 06:40:00')));
        $this->assertTrue($schedule->isDue(Carbon::parse('2026-05-11 06:00:00')));
    }

    public function test_the_period_resolves_to_a_rolling_window(): void
    {
        $now = Carbon::parse('2026-05-15 06:00:00');

        $this->assertSame(
            ['2026-05-08', '2026-05-15'],
            $this->schedule(['period' => 'last_7_days'])->resolvePeriod($now),
        );
        $this->assertSame(
            ['2026-04-01', '2026-04-30'],
            $this->schedule(['period' => 'previous_month'])->resolvePeriod($now),
        );
        $this->assertSame(
            ['2026-05-01', '2026-05-15'],
            $this->schedule(['period' => 'month_to_date'])->resolvePeriod($now),
        );
        $this->assertSame(
            [null, null],
            $this->schedule(['period' => 'all_time'])->resolvePeriod($now),
        );
    }

    // ---------------------------------------------------------------
    // Running, sending and logging
    // ---------------------------------------------------------------

    public function test_a_due_schedule_is_sent_and_a_not_due_one_is_left_alone(): void
    {
        Mail::fake();

        $due = $this->schedule(['name' => 'Due One', 'hour' => 6, 'day_of_week' => 1]);
        $notDue = $this->schedule(['name' => 'Other One', 'hour' => 18, 'day_of_week' => 1]);

        app(ScheduledReportDispatcher::class)->dispatchDue(Carbon::parse('2026-05-04 06:00:00'));

        Mail::assertSent(ScheduledReportMail::class, 1);
        $this->assertSame(1, ReportEmailLog::count());
        $this->assertSame('Due One', ReportEmailLog::first()->schedule_name);

        $this->assertNotNull($due->fresh()->last_run_at);
        $this->assertNull($notDue->fresh()->last_run_at);
    }

    public function test_the_message_goes_to_every_configured_recipient(): void
    {
        Mail::fake();

        $schedule = $this->schedule([
            'recipients' => ['a@example.test', 'b@example.test'],
        ]);

        app(ScheduledReportDispatcher::class)->runOnce($schedule);

        Mail::assertSent(ScheduledReportMail::class, function ($mail) {
            return $mail->hasTo('a@example.test') && $mail->hasTo('b@example.test');
        });
    }

    public function test_a_successful_run_writes_a_sent_log_row_describing_the_scope(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-05-15 06:00:00');

        Incident::factory()->count(2)->create(['sitio' => 'Sitio 1', 'incident_date' => '2026-05-10']);
        Incident::factory()->create(['sitio' => 'Sitio 3', 'incident_date' => '2026-05-10']);

        $schedule = $this->schedule([
            'period' => 'last_30_days',
            'filters' => ['sitio' => 'Sitio 1'],
        ]);

        $log = app(ScheduledReportDispatcher::class)->runOnce($schedule);

        $this->assertSame(ReportEmailLog::STATUS_SENT, $log->status);
        $this->assertSame(ReportEmailLog::TRIGGER_MANUAL, $log->trigger);
        // Two of the three incidents match the schedule's sitio filter, so the
        // logged count is evidence that the filter reached the file.
        $this->assertSame(2, $log->row_count);
        $this->assertStringContainsString('Sitio: Sitio 1', $log->filters_summary);
        $this->assertNull($log->error);

        Carbon::setTestNow();
    }

    public function test_a_failed_send_is_recorded_rather_than_thrown(): void
    {
        // One unreachable mail host must not stop the other schedules in the
        // same hourly run, and the failure has to be findable afterwards.
        Mail::shouldReceive('to')->once()->andThrow(new \RuntimeException('SMTP connection refused'));

        $schedule = $this->schedule();

        $log = app(ScheduledReportDispatcher::class)->runOnce($schedule);

        $this->assertSame(ReportEmailLog::STATUS_FAILED, $log->status);
        $this->assertStringContainsString('SMTP connection refused', $log->error);
        $this->assertNull($log->row_count);

        // Stamped even on failure, so a broken mail host produces one logged
        // attempt per slot instead of one per tick of the hourly command.
        $this->assertNotNull($schedule->fresh()->last_run_at);
    }

    public function test_an_administrator_can_run_a_schedule_immediately(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $schedule = $this->schedule();

        $this->postJson("/api/report-schedules/{$schedule->id}/run")
            ->assertOk()
            ->assertJsonPath('log.status', ReportEmailLog::STATUS_SENT)
            ->assertJsonPath('log.trigger', ReportEmailLog::TRIGGER_MANUAL);

        Mail::assertSent(ScheduledReportMail::class, 1);

        $log = ReportEmailLog::first();
        $this->assertSame($admin->id, $log->triggered_by);
    }

    public function test_the_email_log_endpoint_returns_the_run_history(): void
    {
        Mail::fake();
        $this->admin();
        $schedule = $this->schedule();

        app(ScheduledReportDispatcher::class)->runOnce($schedule);

        $this->getJson('/api/report-email-logs')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.scheduleName', 'Weekly Crime Summary')
            ->assertJsonPath('0.status', ReportEmailLog::STATUS_SENT)
            ->assertJsonPath('0.reportLabel', 'Crime Data Collection');
    }

    // ---------------------------------------------------------------
    // What must not leak
    // ---------------------------------------------------------------

    public function test_the_message_body_describes_the_report_without_containing_it(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-CONFIDENTIAL-1',
            'victim_name' => 'Juana Dela Cruz',
            'incident_date' => Carbon::now()->toDateString(),
        ]);

        $report = app(ReportGenerator::class)->generate('incidents');

        $body = (new ScheduledReportMail(
            scheduleName: 'Weekly Crime Summary',
            reportLabel: $report['label'],
            scopeSummary: $report['summary'],
            rowCount: $report['rowCount'],
            generatedAt: '15 May 2026, 6:00 AM',
            attachmentName: $report['filename'],
            attachmentContents: $report['contents'],
        ))->render();

        // The body names the report and its scope...
        $this->assertStringContainsString('Weekly Crime Summary', $body);
        $this->assertStringContainsString('Crime Data Collection', $body);

        // ...and carries no record from it. Mail leaves this system's access
        // control entirely: it is relayed, stored on servers nobody here
        // administers, and read in inboxes that Supabase MFA does not guard.
        $this->assertStringNotContainsString('CN-CONFIDENTIAL-1', $body);
        $this->assertStringNotContainsString('Juana Dela Cruz', $body);
    }

    public function test_the_email_log_stores_no_report_content(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-05-15 06:00:00');

        Incident::factory()->create([
            'case_number' => 'CN-CONFIDENTIAL-2',
            'victim_name' => 'Juana Dela Cruz',
            'incident_date' => '2026-05-10',
        ]);

        $log = app(ScheduledReportDispatcher::class)->runOnce($this->schedule());

        $serialised = json_encode($log->toArray());
        $this->assertStringNotContainsString('CN-CONFIDENTIAL-2', $serialised);
        $this->assertStringNotContainsString('Juana Dela Cruz', $serialised);

        Carbon::setTestNow();
    }

    // ---------------------------------------------------------------
    // The Artisan entry point the scheduler calls
    // ---------------------------------------------------------------

    public function test_the_command_sends_only_what_is_due(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-05-04 06:00:00');

        $this->schedule(['name' => 'Due One', 'hour' => 6, 'day_of_week' => 1]);
        $this->schedule(['name' => 'Evening One', 'hour' => 18, 'day_of_week' => 1]);

        $this->artisan('reports:send-scheduled')->assertSuccessful();

        Mail::assertSent(ScheduledReportMail::class, 1);
        $this->assertSame(1, ReportEmailLog::count());

        Carbon::setTestNow();
    }

    public function test_the_command_can_force_one_schedule_for_a_demonstration(): void
    {
        Mail::fake();

        $schedule = $this->schedule(['hour' => 18, 'day_of_week' => 1]);

        // --force skips the due check and nothing else: the same message and
        // the same log row a scheduled run would have produced.
        $this->artisan("reports:send-scheduled --schedule={$schedule->id} --force")
            ->assertSuccessful();

        Mail::assertSent(ScheduledReportMail::class, 1);
        $this->assertSame(ReportEmailLog::TRIGGER_SCHEDULED, ReportEmailLog::first()->trigger);
    }

    public function test_the_command_reports_failure_through_its_exit_code(): void
    {
        // A cron runner reads the exit code. Reporting success while nothing
        // arrived would hide exactly the outage this feature must surface.
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('SMTP connection refused'));

        $schedule = $this->schedule();

        $this->artisan("reports:send-scheduled --schedule={$schedule->id} --force")->assertFailed();

        $this->assertSame(ReportEmailLog::STATUS_FAILED, ReportEmailLog::first()->status);
    }

    // ---------------------------------------------------------------
    // Scheduled Reports module presentation fields
    // ---------------------------------------------------------------

    public function test_next_run_follows_the_schedulers_own_due_rule(): void
    {
        // Wednesday 2026-09-16 10:30.
        $now = Carbon::parse('2026-09-16 10:30:00');

        // Daily at 06:00 has passed today -> tomorrow 06:00.
        $daily = $this->schedule(['frequency' => 'daily', 'hour' => 6, 'day_of_week' => null]);
        $this->assertSame('2026-09-17 06:00:00', $daily->nextRunAt($now)->format('Y-m-d H:i:s'));

        // Daily at 18:00 is still ahead today.
        $evening = $this->schedule(['frequency' => 'daily', 'hour' => 18, 'day_of_week' => null]);
        $this->assertSame('2026-09-16 18:00:00', $evening->nextRunAt($now)->format('Y-m-d H:i:s'));

        // Weekly on Monday (1) at 06:00 -> next Monday.
        $weekly = $this->schedule(['frequency' => 'weekly', 'hour' => 6, 'day_of_week' => 1]);
        $this->assertSame('2026-09-21 06:00:00', $weekly->nextRunAt($now)->format('Y-m-d H:i:s'));

        // Monthly on the 5th -> next month.
        $monthly = $this->schedule(['frequency' => 'monthly', 'hour' => 6, 'day_of_week' => null, 'day_of_month' => 5]);
        $this->assertSame('2026-10-05 06:00:00', $monthly->nextRunAt($now)->format('Y-m-d H:i:s'));

        // The current hour counts only until it has run.
        $thisHour = $this->schedule(['frequency' => 'daily', 'hour' => 10, 'day_of_week' => null]);
        $this->assertSame('2026-09-16 10:00:00', $thisHour->nextRunAt($now)->format('Y-m-d H:i:s'));
        $thisHour->last_run_at = Carbon::parse('2026-09-16 10:01:00');
        $this->assertSame('2026-09-17 10:00:00', $thisHour->nextRunAt($now)->format('Y-m-d H:i:s'));

        // A paused schedule has no next run.
        $paused = $this->schedule(['is_active' => false]);
        $this->assertNull($paused->nextRunAt($now));
    }

    public function test_the_list_reports_next_run_and_the_latest_delivery_result(): void
    {
        $this->admin();
        $schedule = $this->schedule();

        $this->getJson('/api/report-schedules')
            ->assertOk()
            ->assertJsonPath('0.lastRunStatus', null)
            ->assertJsonPath('0.lastRunError', null)
            ->assertJsonPath('0.nextRunAt', $schedule->nextRunAt(now())->toIso8601String());

        Mail::shouldReceive('to')->andThrow(new \RuntimeException('SMTP connection refused'));
        $this->postJson("/api/report-schedules/{$schedule->id}/run")->assertOk();

        $this->getJson('/api/report-schedules')
            ->assertOk()
            ->assertJsonPath('0.lastRunStatus', ReportEmailLog::STATUS_FAILED)
            ->assertJsonPath('0.lastRunError', 'SMTP connection refused');
    }

    public function test_the_role_permissions_matrix_lists_reports_as_admin_managed_and_readonly_viewable(): void
    {
        $this->admin();

        $modules = collect($this->getJson('/api/role-permissions')->assertOk()->json('data.modules'))->keyBy('id');

        $this->assertArrayNotHasKey('scheduled-reports', $modules->all());
        $this->assertSame('Reports', $modules['reports']['label']);
        $this->assertSame('full', $modules['reports']['access'][User::ROLE_BADAC_ADMIN]);
        $this->assertSame('none', $modules['reports']['access'][User::ROLE_ENCODER]);
        $this->assertSame('view', $modules['reports']['access'][User::ROLE_BADAC_VALIDATOR]);
    }
}
