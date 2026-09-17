<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Criminal;
use App\Models\Incident;
use App\Models\ReportSchedule;
use App\Models\User;
use App\Models\Victim;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

// Coverage for the badac_validator role (seeded account "Badac" / "Gilbert
// Franco" — see database/seeders/UserSeeder.php), which replaced the former
// read-only BADAC role. Exercises the actual backend authorization (EnsureRole
// / role: middleware in routes/api.php) and the resources' contact-detail
// allow-list, not just frontend rendering — a restricted role hitting these
// endpoints directly must be rejected, and must not receive withheld fields,
// regardless of what the UI shows or hides.
//
// Checkpoint 38 — the 'supabase.mfa' (EnsureSupabaseAal2) middleware has
// been removed from every route in routes/api.php (Two-Factor Authentication
// / aal2 step-up is no longer enforced anywhere in this app; see
// SupabaseMfaTest.php's own header note). Plain actingAs() still never goes
// through SupabaseTokenValidator, so this file continues to authenticate
// through a genuine signed test JWT (same shared-secret mechanism
// SupabaseMfaTest used) — that keeps authentication (401) and role
// authorization (403) exercised as two genuinely distinct layers, matching
// what production actually enforces, independent of the now-removed MFA
// layer.
class BadacValidatorTest extends TestCase
{
    use RefreshDatabase;

    // Builds a real, signed (HS256, test-only shared secret — see
    // phpunit.xml's SUPABASE_JWT_SECRET) Supabase-style access token for
    // $user and attaches it as the request's Authorization header for the
    // rest of this test, so subsequent requests are authenticated the same
    // way a production request is: through SupabaseTokenValidator, which
    // populates the 'supabase_aal' attribute EnsureSupabaseAal2 requires.
    protected function actingAsSupabase(User $user, string $aal = 'aal2'): static
    {
        if (! $user->supabase_user_id) {
            $user->forceFill(['supabase_user_id' => 'supabase-test-'.$user->id])->save();
        }

        $now = time();
        $claims = [
            'sub' => $user->supabase_user_id,
            'aud' => 'authenticated',
            'iss' => rtrim(config('supabase.url'), '/').'/auth/v1',
            'email' => $user->email,
            'email_verified' => true,
            'aal' => $aal,
            'iat' => $now,
            'exp' => $now + 3600,
        ];

        $token = JWT::encode($claims, config('supabase.jwt_secret'), 'HS256');

        return $this->withHeader('Authorization', 'Bearer '.$token);
    }

    private function actingBadacValidator(): User
    {
        $user = User::factory()->create([
            'username' => 'Badac',
            'name' => 'Gilbert Franco',
            'role' => User::ROLE_BADAC_VALIDATOR,
        ]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function actingRole(string $role): User
    {
        $user = User::factory()->create(['role' => $role]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function incidentWithSeparateComplainant(): Incident
    {
        return Incident::factory()->create([
            'validation_status' => Incident::VALIDATION_PENDING,
            'complainant_is_victim' => false,
            'complainant_name' => 'Maria Reyes',
            'complainant_relationship' => 'Sister',
            'complainant_contact' => '09171234567',
            'complainant_address' => '14 Mabini St., Sitio 2',
        ]);
    }

    // --- Role model ----------------------------------------------------------

    public function test_exactly_three_roles_exist_and_the_readonly_role_is_gone(): void
    {
        $this->assertSame(
            [User::ROLE_BADAC_ADMIN, User::ROLE_ENCODER, User::ROLE_BADAC_VALIDATOR],
            array_keys(User::ROLE_LABELS)
        );
        $this->assertSame('badac_validator', User::ROLE_BADAC_VALIDATOR);
        $this->assertArrayNotHasKey('badac_readonly', User::ROLE_LABELS);
        $this->assertFalse(defined(User::class.'::ROLE_BADAC_READONLY'));
    }

    public function test_an_account_cannot_be_created_with_the_retired_readonly_role(): void
    {
        $this->actingRole(User::ROLE_BADAC_ADMIN);

        $this->postJson('/api/users', [
            'fullName' => 'Old Role',
            'username' => 'oldrole',
            'email' => 'oldrole@example.com',
            'role' => 'badac_readonly',
        ])->assertUnprocessable()->assertJsonValidationErrors('role');

        $this->assertDatabaseMissing('users', ['username' => 'oldrole']);
    }

    // --- Authentication ---------------------------------------------------
    //
    // There is no local Laravel /api/login endpoint to test — authentication
    // is Supabase Auth only (see AUTH_MIGRATION_STATUS.md and
    // routes/api.php). What this backend actually enforces is that a
    // request without a valid Supabase JWT is rejected before any
    // controller runs, and that a valid one resolves to the right seeded
    // user/role — both covered below.

    public function test_unauthenticated_request_is_rejected(): void
    {
        $this->getJson('/api/user')->assertUnauthorized();
    }

    public function test_badac_validator_authenticated_user_can_be_retrieved(): void
    {
        $user = $this->actingBadacValidator();

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.username', $user->username)
            ->assertJsonPath('data.roleLabel', 'BADAC Validator');
    }

    // --- Allowed read access ------------------------------------------------

    public function test_badac_validator_can_access_dashboard(): void
    {
        $this->actingBadacValidator();

        $this->getJson('/api/dashboard')->assertOk();
    }

    public function test_badac_validator_can_list_incidents(): void
    {
        $this->actingBadacValidator();
        Incident::factory()->count(2)->create();

        $this->getJson('/api/incidents')->assertOk();
    }

    public function test_badac_validator_can_view_criminal_records(): void
    {
        $this->actingBadacValidator();
        Criminal::factory()->create();

        $this->getJson('/api/criminals')->assertOk();
    }

    public function test_badac_validator_can_view_victim_information(): void
    {
        $this->actingBadacValidator();
        Victim::factory()->create();

        $this->getJson('/api/victims')->assertOk();
    }

    public function test_badac_validator_can_view_analytics(): void
    {
        $this->actingBadacValidator();

        $this->getJson('/api/analytics')->assertOk();
    }

    public function test_badac_validator_can_view_report_schedules_and_delivery_logs(): void
    {
        $this->actingBadacValidator();

        $this->getJson('/api/report-schedules')->assertOk();
        $this->getJson('/api/report-email-logs')->assertOk();
    }

    // --- Validation: the one mutation this role has --------------------------

    public function test_badac_validator_can_validate_a_pending_record(): void
    {
        $validator = $this->actingBadacValidator();
        $incident = Incident::factory()->create(['validation_status' => Incident::VALIDATION_PENDING]);

        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'validated')
            ->assertJsonPath('data.validatedBy', 'Gilbert Franco');

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_VALIDATED, $fresh->validation_status);
        $this->assertSame($validator->id, $fresh->validated_by);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $validator->id,
            'action' => 'VALIDATE',
        ]);
    }

    public function test_badac_validator_can_return_a_record_for_correction(): void
    {
        $validator = $this->actingBadacValidator();
        $incident = Incident::factory()->create(['validation_status' => Incident::VALIDATION_PENDING]);

        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => 'Wrong sitio recorded.'])
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'returned')
            ->assertJsonPath('data.correctionReason', 'Wrong sitio recorded.');

        $this->assertSame($validator->id, $incident->fresh()->returned_by);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $validator->id,
            'action' => 'RETURN',
        ]);
    }

    // --- Denied: User Management / Settings / Audit Logs (admin-only, not part of the Validator's module list) ---

    // Checkpoint 38 — Audit Logs access revoked for the BADAC role (was
    // previously allowed; see routes/api.php GET /audit-logs).
    public function test_badac_validator_cannot_view_audit_logs(): void
    {
        $this->actingBadacValidator();

        $this->getJson('/api/audit-logs')->assertForbidden();
    }

    public function test_badac_validator_cannot_list_users(): void
    {
        $this->actingBadacValidator();

        $this->getJson('/api/users')->assertForbidden();
    }

    public function test_badac_validator_cannot_view_settings(): void
    {
        $this->actingBadacValidator();

        $this->getJson('/api/settings')->assertForbidden();
    }

    public function test_badac_validator_cannot_change_settings(): void
    {
        $this->actingBadacValidator();

        $this->putJson('/api/settings', ['threshold' => 1])->assertForbidden();
        $this->postJson('/api/crime-types', ['name' => 'Vandalism'])->assertForbidden();
    }

    public function test_badac_validator_cannot_manage_report_schedules(): void
    {
        $this->actingBadacValidator();
        $schedule = ReportSchedule::create([
            'name' => 'Weekly Crime Summary',
            'report_key' => 'incidents',
            'period' => 'last_30_days',
            'frequency' => 'weekly',
            'hour' => 6,
            'day_of_week' => 1,
            'recipients' => ['punong.barangay@example.test'],
            'filters' => [],
            'is_active' => true,
        ]);

        $this->postJson('/api/report-schedules', [])->assertForbidden();
        $this->putJson("/api/report-schedules/{$schedule->id}", [])->assertForbidden();
        $this->putJson("/api/report-schedules/{$schedule->id}/archive")->assertForbidden();
        $this->postJson("/api/report-schedules/{$schedule->id}/run")->assertForbidden();
    }

    // --- Forbidden mutations -------------------------------------------------

    public function test_badac_validator_cannot_create_incident(): void
    {
        $this->actingBadacValidator();

        $this->postJson('/api/incidents', [])->assertForbidden();
    }

    public function test_badac_validator_cannot_update_incident(): void
    {
        $this->actingBadacValidator();
        $incident = Incident::factory()->create();

        $this->putJson("/api/incidents/{$incident->id}", ['status' => 'Solved'])->assertForbidden();
    }

    public function test_badac_validator_cannot_archive_incident(): void
    {
        $this->actingBadacValidator();
        $incident = Incident::factory()->create();

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertForbidden();
    }

    public function test_badac_validator_cannot_restore_incident(): void
    {
        $this->actingBadacValidator();
        $incident = Incident::factory()->create(['status' => 'Archived', 'previous_status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}/restore")->assertForbidden();
        $this->assertSame('Archived', $incident->fresh()->status);
    }

    public function test_badac_validator_cannot_create_criminal_record(): void
    {
        $this->actingBadacValidator();

        $this->postJson('/api/criminals', [])->assertForbidden();
    }

    public function test_badac_validator_cannot_update_criminal_record(): void
    {
        $this->actingBadacValidator();
        $criminal = Criminal::factory()->create();

        $this->putJson("/api/criminals/{$criminal->id}", [])->assertForbidden();
    }

    public function test_badac_validator_cannot_archive_criminal_record(): void
    {
        $this->actingBadacValidator();
        $criminal = Criminal::factory()->create();

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertForbidden();
    }

    public function test_encoder_cannot_archive_criminal_record(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);
        $criminal = Criminal::factory()->create();

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertForbidden();
    }

    public function test_badac_validator_cannot_create_victim(): void
    {
        $this->actingBadacValidator();

        $this->postJson('/api/victims', [])->assertForbidden();
    }

    public function test_badac_validator_cannot_update_victim(): void
    {
        $this->actingBadacValidator();
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}", [])->assertForbidden();
    }

    public function test_badac_validator_cannot_archive_victim(): void
    {
        $this->actingBadacValidator();
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}/archive")->assertForbidden();
    }

    // Restore is the inverse of archive and lives in the same
    // role:badac_admin group in routes/api.php, so the same two roles must be
    // refused. Asserted here rather than assumed from the route file: a route
    // accidentally moved out of that group would still pass a reading of the
    // code but would fail these.
    public function test_badac_validator_cannot_restore_criminal_record(): void
    {
        $this->actingBadacValidator();
        $criminal = Criminal::factory()->create(['status' => 'Archived']);

        $this->putJson("/api/criminals/{$criminal->id}/restore")->assertForbidden();
        $this->assertSame('Archived', $criminal->fresh()->status);
    }

    public function test_badac_validator_cannot_restore_victim(): void
    {
        $this->actingBadacValidator();
        $victim = Victim::factory()->create(['status' => 'Archived']);

        $this->putJson("/api/victims/{$victim->id}/restore")->assertForbidden();
        $this->assertSame('Archived', $victim->fresh()->status);
    }

    public function test_encoder_cannot_restore_criminal_record(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);
        $criminal = Criminal::factory()->create(['status' => 'Archived']);

        $this->putJson("/api/criminals/{$criminal->id}/restore")->assertForbidden();
    }

    public function test_encoder_cannot_restore_victim(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);
        $victim = Victim::factory()->create(['status' => 'Archived']);

        $this->putJson("/api/victims/{$victim->id}/restore")->assertForbidden();
    }

    public function test_unauthenticated_user_cannot_restore_a_record(): void
    {
        $criminal = Criminal::factory()->create(['status' => 'Archived']);
        $victim = Victim::factory()->create(['status' => 'Archived']);

        $this->putJson("/api/criminals/{$criminal->id}/restore")->assertUnauthorized();
        $this->putJson("/api/victims/{$victim->id}/restore")->assertUnauthorized();
    }

    public function test_badac_validator_cannot_update_user_management_records(): void
    {
        $this->actingBadacValidator();
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);

        $this->putJson("/api/users/{$admin->id}", ['fullName' => 'Hacked'])->assertForbidden();
    }

    // --- Contact details withheld from the Validator (API, not UI) ------------

    public function test_badac_validator_does_not_receive_complainant_contact_or_address(): void
    {
        $this->actingBadacValidator();
        $incident = $this->incidentWithSeparateComplainant();

        $list = $this->getJson('/api/incidents')->assertOk();
        $show = $this->getJson("/api/incidents/{$incident->id}")->assertOk();

        foreach ([$list->json('data.0'), $show->json('data')] as $payload) {
            $this->assertArrayNotHasKey('complainantContact', $payload);
            $this->assertArrayNotHasKey('complainantAddress', $payload);
            // What the Validator needs to review the complainant is kept.
            $this->assertSame('Maria Reyes', $payload['complainantName']);
            $this->assertSame('Sister', $payload['complainantRelationship']);
        }

        $this->assertStringNotContainsString('09171234567', $list->getContent().$show->getContent());
        $this->assertStringNotContainsString('14 Mabini St.', $list->getContent().$show->getContent());
    }

    public function test_complainant_contact_and_address_are_withheld_from_validation_action_responses(): void
    {
        $this->actingBadacValidator();
        $first = $this->incidentWithSeparateComplainant();
        $second = $this->incidentWithSeparateComplainant();

        $validated = $this->putJson("/api/incidents/{$first->id}/validate")->assertOk();
        $returned = $this->putJson("/api/incidents/{$second->id}/return", ['reason' => 'Wrong sitio recorded.'])
            ->assertOk();

        foreach ([$validated, $returned] as $response) {
            $this->assertArrayNotHasKey('complainantContact', $response->json('data'));
            $this->assertArrayNotHasKey('complainantAddress', $response->json('data'));
            $this->assertStringNotContainsString('09171234567', $response->getContent());
        }
    }

    public function test_badac_validator_does_not_receive_victim_contact_number_or_address(): void
    {
        $this->actingBadacValidator();
        $victim = Victim::factory()->create([
            'full_name' => 'Ana Cruz',
            'contact_number' => '09998887777',
            'address' => '22 Luna St., Sitio 3',
        ]);

        $list = $this->getJson('/api/victims')->assertOk();
        $show = $this->getJson("/api/victims/{$victim->id}")->assertOk();

        foreach ([$list->json('data.0'), $show->json('data')] as $payload) {
            $this->assertArrayNotHasKey('contactNumber', $payload);
            $this->assertArrayNotHasKey('address', $payload);
            $this->assertSame('Ana Cruz', $payload['fullName']);
        }

        $this->assertStringNotContainsString('09998887777', $list->getContent().$show->getContent());
        $this->assertStringNotContainsString('22 Luna St.', $list->getContent().$show->getContent());
    }

    public function test_badac_validator_does_not_receive_criminal_contact_number_or_address(): void
    {
        $this->actingBadacValidator();
        $criminal = Criminal::factory()->create([
            'full_name' => 'Pedro Santos',
            'contact_number' => '09223334444',
            'address' => '7 Rizal St., Sitio 1',
        ]);

        $list = $this->getJson('/api/criminals')->assertOk();
        $show = $this->getJson("/api/criminals/{$criminal->id}")->assertOk();

        foreach ([$list->json('data.0'), $show->json('data')] as $payload) {
            $this->assertArrayNotHasKey('contactNumber', $payload);
            $this->assertArrayNotHasKey('address', $payload);
            $this->assertSame('Pedro Santos', $payload['fullName']);
        }

        $this->assertStringNotContainsString('09223334444', $list->getContent().$show->getContent());
        $this->assertStringNotContainsString('7 Rizal St.', $list->getContent().$show->getContent());
    }

    public function test_administrator_still_receives_every_contact_detail(): void
    {
        $this->actingRole(User::ROLE_BADAC_ADMIN);
        $incident = $this->incidentWithSeparateComplainant();
        $victim = Victim::factory()->create(['contact_number' => '09998887777', 'address' => '22 Luna St.']);
        $criminal = Criminal::factory()->create(['contact_number' => '09223334444', 'address' => '7 Rizal St.']);

        $this->getJson("/api/incidents/{$incident->id}")
            ->assertOk()
            ->assertJsonPath('data.complainantContact', '09171234567')
            ->assertJsonPath('data.complainantAddress', '14 Mabini St., Sitio 2');
        $this->getJson("/api/victims/{$victim->id}")
            ->assertOk()
            ->assertJsonPath('data.contactNumber', '09998887777')
            ->assertJsonPath('data.address', '22 Luna St.');
        $this->getJson("/api/criminals/{$criminal->id}")
            ->assertOk()
            ->assertJsonPath('data.contactNumber', '09223334444')
            ->assertJsonPath('data.address', '7 Rizal St.');
    }

    public function test_encoder_still_receives_complainant_contact_details(): void
    {
        $this->actingRole(User::ROLE_ENCODER);
        $incident = $this->incidentWithSeparateComplainant();

        $this->getJson("/api/incidents/{$incident->id}")
            ->assertOk()
            ->assertJsonPath('data.complainantContact', '09171234567')
            ->assertJsonPath('data.complainantAddress', '14 Mabini St., Sitio 2');
    }

    public function test_a_role_outside_the_allow_list_receives_no_contact_details(): void
    {
        // The rule is an allow-list: an unrecognised role gets nothing,
        // rather than everything a deny-list forgot to name.
        $this->assertTrue((new User(['role' => User::ROLE_BADAC_ADMIN]))->canViewContactDetails());
        $this->assertTrue((new User(['role' => User::ROLE_ENCODER]))->canViewContactDetails());
        $this->assertFalse((new User(['role' => User::ROLE_BADAC_VALIDATOR]))->canViewContactDetails());
        $this->assertFalse((new User(['role' => 'some_future_role']))->canViewContactDetails());
    }

    // --- Role data migration ---------------------------------------------------

    public function test_the_role_migration_renames_only_the_readonly_role_and_is_reversible(): void
    {
        $migration = require database_path('migrations/2026_09_18_000001_rename_badac_readonly_role_to_badac_validator.php');

        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $legacy = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        DB::table('users')->where('id', $legacy->id)->update(['role' => 'badac_readonly']);
        $updatedAtBefore = DB::table('users')->where('id', $legacy->id)->value('updated_at');

        $both = AppNotification::create(['title' => 'A', 'message' => 'm', 'type' => 'info', 'read' => false, 'audience_roles' => ',badac_admin,badac_readonly,']);
        $only = AppNotification::create(['title' => 'B', 'message' => 'm', 'type' => 'info', 'read' => false, 'audience_roles' => ',badac_readonly,']);
        $adminOnly = AppNotification::create(['title' => 'C', 'message' => 'm', 'type' => 'info', 'read' => false, 'audience_roles' => ',badac_admin,']);
        $everyone = AppNotification::create(['title' => 'D', 'message' => 'm', 'type' => 'info', 'read' => false, 'audience_roles' => null]);

        $migration->up();

        $this->assertSame('badac_validator', $legacy->fresh()->role);
        $this->assertSame('badac_admin', $admin->fresh()->role);
        $this->assertSame('encoder', $encoder->fresh()->role);
        $this->assertSame($updatedAtBefore, DB::table('users')->where('id', $legacy->id)->value('updated_at'));
        $this->assertSame(',badac_admin,badac_validator,', $both->fresh()->audience_roles);
        $this->assertSame(',badac_validator,', $only->fresh()->audience_roles);
        $this->assertSame(',badac_admin,', $adminOnly->fresh()->audience_roles);
        $this->assertNull($everyone->fresh()->audience_roles);
        $this->assertSame(0, DB::table('users')->where('role', 'badac_readonly')->count());

        $migration->down();

        $this->assertSame('badac_readonly', $legacy->fresh()->role);
        $this->assertSame('badac_admin', $admin->fresh()->role);
        $this->assertSame('encoder', $encoder->fresh()->role);
        $this->assertSame(',badac_admin,badac_readonly,', $both->fresh()->audience_roles);
        $this->assertSame(',badac_readonly,', $only->fresh()->audience_roles);
        $this->assertSame(',badac_admin,', $adminOnly->fresh()->audience_roles);
        $this->assertNull($everyone->fresh()->audience_roles);
    }

    // --- Existing roles retain their intended mutation permissions -----------

    public function test_badac_admin_retains_write_access_after_badac_validator_transition(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($admin);

        // Checkpoint 28 — Resident Registry (and its /residents routes) was
        // removed from the system; this now exercises the same
        // role:badac_admin-only mutation guarantee via POST /criminals
        // instead, which is unaffected by that removal.
        $this->postJson('/api/criminals', [
            'fullName' => 'Juan Santos',
        ])->assertStatus(201);
    }

    public function test_encoder_retains_incident_write_access_after_badac_validator_transition(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2025-8888',
            'crimeType' => 'Theft',
            'date' => '2025-06-01',
            'sitio' => 'Sitio 1',
            'street' => '12 Rizal St.',
            'status' => 'Open',
        ])->assertCreated();
    }
}
