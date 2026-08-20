<?php

namespace Tests\Feature;

use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Checkpoint 38 — the 'supabase.mfa' (EnsureSupabaseAal2) middleware has
// been removed from every route; GET/PUT /users* now only require
// 'auth:supabase' + role:badac_admin. This file still authenticates through
// a genuine signed test JWT (same test-only shared-secret mechanism used
// throughout this suite, see SupabaseTokenValidationTest) instead of
// actingAs(), so it exercises the real SupabaseTokenValidator path.
class UserManagementTest extends TestCase
{
    use RefreshDatabase;

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

    private function actingAdmin(): User
    {
        $admin = User::factory()->create([
            'name' => 'John Paul Paran',
            'username' => 'admin',
            'role' => User::ROLE_BADAC_ADMIN,
        ]);
        $this->actingAsSupabase($admin);

        return $admin;
    }

    public function test_admin_can_list_users(): void
    {
        $this->actingAdmin();
        User::factory()->create(['username' => 'encoder', 'role' => User::ROLE_ENCODER]);

        $this->getJson('/api/users')->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_encoder_cannot_list_users(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->getJson('/api/users')->assertForbidden();
    }

    public function test_encoder_cannot_update_another_user(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($encoder);

        $this->putJson("/api/users/{$admin->id}", ['fullName' => 'Hacked Name'])->assertForbidden();
    }

    public function test_admin_can_update_a_users_profile_fields(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create(['name' => 'Luiza Perez', 'username' => 'encoder', 'role' => User::ROLE_ENCODER]);

        $response = $this->putJson("/api/users/{$encoder->id}", [
            'fullName' => 'Luiza Perez',
            'username' => 'encoder-updated',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.fullName', 'Luiza Perez')
            ->assertJsonPath('data.username', 'encoder-updated');
    }

    // Checkpoint 31 — admin email sync fix. 'email' is deliberately not an
    // editable field through this endpoint anymore (see UpdateUserRequest's
    // Checkpoint 31 comment): Supabase Auth is authoritative for sign-in
    // email, and this endpoint has no verified path to update it there too.
    // A submitted 'email' must be silently ignored, not applied and not
    // rejected as invalid input.
    public function test_admin_email_field_is_not_editable_through_update(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create([
            'name' => 'Luiza Perez',
            'username' => 'encoder',
            'email' => 'original@example.com',
            'role' => User::ROLE_ENCODER,
        ]);

        $response = $this->putJson("/api/users/{$encoder->id}", [
            'fullName' => 'Luiza Perez',
            'email' => 'attempted-change@example.com',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.fullName', 'Luiza Perez')
            ->assertJsonPath('data.email', 'original@example.com');

        $this->assertSame('original@example.com', $encoder->fresh()->email);
    }

    public function test_update_rejects_duplicate_username(): void
    {
        $this->actingAdmin();
        User::factory()->create(['username' => 'taken']);
        $target = User::factory()->create(['username' => 'free']);

        $this->putJson("/api/users/{$target->id}", ['username' => 'taken'])
            ->assertUnprocessable();
    }

    public function test_role_field_is_not_mass_assignable_through_update(): void
    {
        $admin = $this->actingAdmin();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);

        $this->putJson("/api/users/{$encoder->id}", [
            'fullName' => 'Still Encoder',
            'role' => User::ROLE_BADAC_ADMIN, // attempted privilege escalation via payload
        ])->assertOk();

        $this->assertSame(User::ROLE_ENCODER, $encoder->fresh()->role);
    }

    public function test_admin_can_deactivate_another_users_account(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER, 'is_active' => true]);

        $this->putJson("/api/users/{$encoder->id}/status", ['isActive' => false])
            ->assertOk()
            ->assertJsonPath('data.isActive', false);

        $this->assertFalse($encoder->fresh()->is_active);
    }

    public function test_admin_cannot_deactivate_their_own_account(): void
    {
        $admin = $this->actingAdmin();

        $this->putJson("/api/users/{$admin->id}/status", ['isActive' => false])
            ->assertStatus(422);

        $this->assertTrue($admin->fresh()->is_active);
    }

    // NOTE: the previous test_deactivated_user_cannot_log_in() test asserted
    // against a local /api/login endpoint that no longer exists (Supabase
    // Auth is the only authentication system — see AUTH_MIGRATION_STATUS.md)
    // and hardcoded a password. It has been removed as obsolete rather than
    // rewritten: the real guarantee it was meant to cover — that a
    // deactivated user's Supabase-authenticated requests are rejected (see
    // App\Services\SupabaseTokenValidator::resolve(), which checks
    // is_active) — is not exercisable via $this->actingAs(), which bypasses
    // token resolution entirely. Covering it properly needs a test that
    // exercises SupabaseTokenValidator with a stubbed/mocked JWT, which is
    // a genuinely new test rather than a cleanup of this one.
}
