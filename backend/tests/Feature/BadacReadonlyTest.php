<?php

namespace Tests\Feature;

use App\Models\Criminal;
use App\Models\Incident;
use App\Models\User;
use App\Models\Victim;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Coverage for the badac_readonly role (seeded account "Badac" / "Gilbert
// Franco" — see database/seeders/UserSeeder.php). Exercises the actual
// backend authorization (EnsureRole / role: middleware in routes/api.php),
// not just frontend rendering — a restricted role hitting these endpoints
// directly must be rejected regardless of what the UI shows or hides.
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
class BadacReadonlyTest extends TestCase
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

    private function actingBadacReadonly(): User
    {
        $user = User::factory()->create([
            'username' => 'Badac',
            'name' => 'Gilbert Franco',
            'role' => User::ROLE_BADAC_READONLY,
        ]);
        $this->actingAsSupabase($user);

        return $user;
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

    public function test_badac_readonly_authenticated_user_can_be_retrieved(): void
    {
        $user = $this->actingBadacReadonly();

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.username', $user->username)
            ->assertJsonPath('data.roleLabel', 'BADAC');
    }

    // --- Allowed read access ------------------------------------------------

    public function test_badac_readonly_can_access_dashboard(): void
    {
        $this->actingBadacReadonly();

        $this->getJson('/api/dashboard')->assertOk();
    }

    public function test_badac_readonly_can_list_incidents(): void
    {
        $this->actingBadacReadonly();
        Incident::factory()->count(2)->create();

        $this->getJson('/api/incidents')->assertOk();
    }

    public function test_badac_readonly_can_view_criminal_records(): void
    {
        $this->actingBadacReadonly();
        Criminal::factory()->create();

        $this->getJson('/api/criminals')->assertOk();
    }

    public function test_badac_readonly_can_view_victim_information(): void
    {
        $this->actingBadacReadonly();
        Victim::factory()->create();

        $this->getJson('/api/victims')->assertOk();
    }

    public function test_badac_readonly_can_view_analytics(): void
    {
        $this->actingBadacReadonly();

        $this->getJson('/api/analytics')->assertOk();
    }

    // --- Denied: User Management / Settings / Audit Logs (admin-only, not part of Badac's module list) ---

    // Checkpoint 38 — Audit Logs access revoked for badac_readonly (was
    // previously allowed; see routes/api.php GET /audit-logs).
    public function test_badac_readonly_cannot_view_audit_logs(): void
    {
        $this->actingBadacReadonly();

        $this->getJson('/api/audit-logs')->assertForbidden();
    }

    public function test_badac_readonly_cannot_list_users(): void
    {
        $this->actingBadacReadonly();

        $this->getJson('/api/users')->assertForbidden();
    }

    public function test_badac_readonly_cannot_view_settings(): void
    {
        $this->actingBadacReadonly();

        $this->getJson('/api/settings')->assertForbidden();
    }

    // --- Forbidden mutations -------------------------------------------------

    public function test_badac_readonly_cannot_create_incident(): void
    {
        $this->actingBadacReadonly();

        $this->postJson('/api/incidents', [])->assertForbidden();
    }

    public function test_badac_readonly_cannot_update_incident(): void
    {
        $this->actingBadacReadonly();
        $incident = Incident::factory()->create();

        $this->putJson("/api/incidents/{$incident->id}", ['status' => 'Solved'])->assertForbidden();
    }

    public function test_badac_readonly_cannot_archive_incident(): void
    {
        $this->actingBadacReadonly();
        $incident = Incident::factory()->create();

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertForbidden();
    }

    public function test_badac_readonly_cannot_create_criminal_record(): void
    {
        $this->actingBadacReadonly();

        $this->postJson('/api/criminals', [])->assertForbidden();
    }

    public function test_badac_readonly_cannot_update_criminal_record(): void
    {
        $this->actingBadacReadonly();
        $criminal = Criminal::factory()->create();

        $this->putJson("/api/criminals/{$criminal->id}", [])->assertForbidden();
    }

    public function test_badac_readonly_cannot_create_victim(): void
    {
        $this->actingBadacReadonly();

        $this->postJson('/api/victims', [])->assertForbidden();
    }

    public function test_badac_readonly_cannot_update_victim(): void
    {
        $this->actingBadacReadonly();
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}", [])->assertForbidden();
    }

    public function test_badac_readonly_cannot_archive_victim(): void
    {
        $this->actingBadacReadonly();
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}/archive")->assertForbidden();
    }

    public function test_badac_readonly_cannot_update_user_management_records(): void
    {
        $this->actingBadacReadonly();
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);

        $this->putJson("/api/users/{$admin->id}", ['fullName' => 'Hacked'])->assertForbidden();
    }

    // --- Existing roles retain their intended mutation permissions -----------

    public function test_badac_admin_retains_write_access_after_badac_readonly_addition(): void
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

    public function test_encoder_retains_incident_write_access_after_badac_readonly_addition(): void
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
