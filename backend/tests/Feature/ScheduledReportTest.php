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
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Automated report generation, end to end (Reporting System checklist,
 * "Scheduled Reports" and its "Email Logs" evidence).
 *
 * The feature is worth nothing unless four things hold, and each has its own
 * group of tests below:
 *
 *   - Only an administrator can create, edit, run or read a schedule. A
 *     schedule sends crime records to an address on a timer, with nobody
 *     present; that is a stronger capability than the on-demand export every
 *     role already has.
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

    public function test_an_encoder_cannot_manage_or_read_schedules(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->getJson('/api/report-schedules')->assertForbidden();
        $this->postJson('/api/report-schedules', $this->payload())->assertForbidden();
        $this->getJson('/api/report-email-logs')->assertForbidden();
    }

    public function test_a_readonly_badac_account_cannot_manage_or_read_schedules(): void
    {
        // This account may view and export from every report screen, and still
        // may not stand up an automation that mails those records out on a
        // timer. Viewing data you are entitled to see is not the same
        // permission as sending it somewhere.
        $viewer = User::factory()->create(['role' => User::ROLE_BADAC_READONLY]);
        $this->actingAsSupabase($viewer);

        $this->getJson('/api/report-schedules')->assertForbidden();
        $this->postJson('/api/report-schedules', $this->payload())->assertForbidden();
        $this->getJson('/api/report-email-logs')->assertForbidden();
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

    public function test_an_administrator_can_update_and_delete_a_schedule(): void
    {
        $this->admin();
        $schedule = $this->schedule();

        $this->putJson("/api/report-schedules/{$schedule->id}", ['name' => 'Renamed', 'is_active' => false])
            ->assertOk()
            ->assertJsonPath('name', 'Renamed')
            ->assertJsonPath('isActive', false);

        $this->deleteJson("/api/report-schedules/{$schedule->id}")->assertOk();
        $this->assertDatabaseMissing('report_schedules', ['id' => $schedule->id]);
    }

    public function test_deleting_a_schedule_keeps_the_history_of_what_it_already_sent(): void
    {
        Mail::fake();
        $this->admin();
        $schedule = $this->schedule();

        app(ScheduledReportDispatcher::class)->runOnce($schedule);
        $this->assertSame(1, ReportEmailLog::count());

        $this->deleteJson("/api/report-schedules/{$schedule->id}")->assertOk();

        // The row survives with its own copy of the name: a log that vanished
        // when someone tidied up a schedule would be evidence of nothing.
        $log = ReportEmailLog::first();
        $this->assertNotNull($log);
        $this->assertNull($log->report_schedule_id);
        $this->assertSame('Weekly Crime Summary', $log->schedule_name);
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
}
