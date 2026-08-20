<?php

namespace Tests\Feature;

use App\Models\Criminal;
use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Checkpoint 38 — the 'supabase.mfa' (EnsureSupabaseAal2) middleware has
// been removed from every route; GET/PUT /criminals* now only require
// 'auth:supabase' + role. This file still authenticates through a genuine
// signed test JWT (same test-only shared-secret mechanism used throughout
// this suite, see SupabaseTokenValidationTest) instead of actingAs(), so it
// exercises the real SupabaseTokenValidator path.
class CriminalRecordTest extends TestCase
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

    private function actingUser(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    public function test_can_list_criminal_records(): void
    {
        $this->actingUser();
        Criminal::factory()->count(2)->create();

        $this->getJson('/api/criminals')->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_can_view_a_criminal_record(): void
    {
        $this->actingUser();
        $criminal = Criminal::factory()->create();

        $this->getJson("/api/criminals/{$criminal->id}")
            ->assertOk()
            ->assertJsonPath('data.fullName', $criminal->full_name);
    }

    public function test_can_update_a_criminal_record(): void
    {
        $this->actingUser();
        $criminal = Criminal::factory()->create(['status' => 'Active']);

        $this->putJson("/api/criminals/{$criminal->id}", ['status' => 'Incarcerated'])
            ->assertOk()
            ->assertJsonPath('data.status', 'Incarcerated');
    }
}
