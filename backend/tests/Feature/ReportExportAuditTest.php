<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Exporting a report is now recorded in the audit trail.
 *
 * The Audit Logs filter dropdown has always offered REPORT_EXPORTED
 * (src/pages/AuditLogs.jsx), and ACTION_COLORS gives it a colour, but no
 * application code ever wrote one: the only sources were AuditLogSeeder's
 * fabricated demo rows and mockData.js. Filtering by it could therefore only
 * ever match seeded data. Meanwhile every real export — nine exportWorkbook
 * call sites across Dashboard, Statistical Analysis, Crime Data Collection,
 * Audit Logs, Criminal/Victim Records and Profiles, and the incident record
 * modal — left no trace at all, which is exactly the thing an audit trail
 * exists to answer for a barangay records system.
 *
 * The endpoint follows the POST /users/{user}/password-reset-audit precedent:
 * an audit-only route that records an action performed elsewhere, called by the
 * frontend only AFTER that action has actually succeeded, so the trail never
 * claims something that did not happen.
 *
 * REPORT_GENERATED is deliberately NOT written here. Printing goes through
 * window.print(), which reports no success and whose onafterprint fires on
 * cancellation too, so a print audit could only claim a report that may never
 * have been produced. That token is left alone rather than made to look
 * functional.
 */
class ReportExportAuditTest extends TestCase
{
    use RefreshDatabase;

    private const ENDPOINT = '/api/report-export-audit';

    private function actingUser(string $role = User::ROLE_BADAC_ADMIN): User
    {
        $user = User::factory()->create(['role' => $role]);
        $this->actingAsSupabase($user);

        return $user;
    }

    // ---- the row it writes ----

    public function test_it_records_a_report_exported_audit_row(): void
    {
        $user = $this->actingUser();

        $this->postJson(self::ENDPOINT, ['report' => 'analytics'])->assertOk();

        $log = AuditLog::where('action', 'REPORT_EXPORTED')->firstOrFail();
        $this->assertSame($user->id, $log->user_id);
        // Same vocabulary the seeded demo row used and the Audit Logs filter
        // already offers as a target type.
        $this->assertSame('reports', $log->module);
        $this->assertSame('report', $log->target_type);
    }

    public function test_the_description_names_the_report_and_nothing_else(): void
    {
        $this->actingUser();

        $this->postJson(self::ENDPOINT, ['report' => 'analytics'])->assertOk();

        $description = AuditLog::where('action', 'REPORT_EXPORTED')->value('description');
        $this->assertStringContainsString('Statistical Analysis', $description);
        // Minimal by design: no row counts, no filter values, no sensitive
        // state about what the export contained.
        $this->assertDoesNotMatchRegularExpression('/\d+\s*(rows?|records?)/i', $description);
        $this->assertStringNotContainsString('Sitio', $description);
        $this->assertStringNotContainsString('From:', $description);
    }

    public function test_it_records_the_callers_ip_address(): void
    {
        $this->actingUser();

        $this->postJson(self::ENDPOINT, ['report' => 'dashboard'])->assertOk();

        $this->assertNotNull(AuditLog::where('action', 'REPORT_EXPORTED')->value('ip_address'));
    }

    // ---- who may call it ----

    public function test_it_requires_authentication(): void
    {
        $this->postJson(self::ENDPOINT, ['report' => 'dashboard'])->assertUnauthorized();
    }

    public function test_an_encoder_may_record_an_export(): void
    {
        // Encoder exports from Crime Data Collection and the incident record
        // modal, so the write endpoint must not be admin-only.
        $this->actingUser(User::ROLE_ENCODER);

        $this->postJson(self::ENDPOINT, ['report' => 'incidents'])->assertOk();

        $this->assertSame(1, AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    public function test_a_read_only_badac_user_may_record_an_export(): void
    {
        $this->actingUser(User::ROLE_BADAC_READONLY);

        $this->postJson(self::ENDPOINT, ['report' => 'criminal-records'])->assertOk();

        $this->assertSame(1, AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    // ---- the report name is a controlled vocabulary ----

    public function test_an_unknown_report_is_rejected(): void
    {
        // The description is written into the audit trail, so the caller picks
        // from a fixed set rather than supplying free text.
        $this->actingUser();

        $this->postJson(self::ENDPOINT, ['report' => 'not-a-report'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['report']);

        $this->assertSame(0, AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    public function test_a_missing_report_is_rejected(): void
    {
        $this->actingUser();

        $this->postJson(self::ENDPOINT, [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['report']);
    }

    public function test_every_export_surface_has_a_recordable_report_key(): void
    {
        // One key per exportWorkbook call site in the frontend.
        $this->actingUser();

        $keys = [
            'dashboard', 'analytics', 'incidents', 'audit-logs',
            'criminal-records', 'criminal-profile',
            'victim-records', 'victim-profile', 'incident-record',
        ];

        foreach ($keys as $key) {
            $this->postJson(self::ENDPOINT, ['report' => $key])
                ->assertOk();
        }

        $this->assertSame(count($keys), AuditLog::where('action', 'REPORT_EXPORTED')->count());
    }

    // ---- the read side is unchanged ----

    public function test_the_audit_log_list_remains_admin_only(): void
    {
        $this->actingUser(User::ROLE_BADAC_READONLY);

        $this->postJson(self::ENDPOINT, ['report' => 'dashboard'])->assertOk();
        // Recording an export must not have widened who can READ the trail.
        $this->getJson('/api/audit-logs')->assertForbidden();
    }
}
