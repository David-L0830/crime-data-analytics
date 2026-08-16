<?php

namespace Tests\Feature;

use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Checkpoint 38 — extracted from the retired SupabaseMfaTest.php (1725
// lines) when Two-Factor Authentication / aal2 step-up enforcement was
// removed from the application (see routes/api.php, EnsureSupabaseAal2's
// own comment, and HANDOFF_CHECKPOINT_38.md). Almost all of that file
// asserted that routes REJECT an aal1 session — behavior that was
// intentionally removed and is no longer true anywhere in this app, so the
// rest of that file was retired rather than rewritten.
//
// The handful of tests kept here don't depend on aal2 enforcement at all —
// they only verify that SupabaseTokenValidator correctly parses/reports the
// `aal` JWT claim (still present on real Supabase tokens even though the
// backend no longer requires aal2) and correctly rejects a tampered
// signature. Both remain genuinely useful regardless of whether MFA
// enforcement exists.
//
// Not verified: no PHP/Composer available in this sandbox (see
// HANDOFF_CHECKPOINT_38.md) — this file has been reviewed for correctness
// against the assertions it was extracted from, not executed.
class SupabaseTokenValidationTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'username' => 'encoder1',
            'name' => 'Test Encoder',
            'email' => 'encoder1@example.com',
            'role' => User::ROLE_ENCODER,
        ], $overrides));
    }

    private function supabaseToken(array $claimOverrides = []): string
    {
        $now = time();

        $claims = array_merge([
            'sub' => 'supabase-test-user-id',
            'aud' => 'authenticated',
            'iss' => rtrim(config('supabase.url'), '/').'/auth/v1',
            'email' => 'encoder1@example.com',
            'email_verified' => true,
            'aal' => 'aal1',
            'iat' => $now,
            'exp' => $now + 3600,
        ], $claimOverrides);

        return JWT::encode($claims, config('supabase.jwt_secret'), 'HS256');
    }

    public function test_supabase_token_with_aal2_resolves_user_with_aal2_in_response(): void
    {
        $user = $this->makeUser(['supabase_user_id' => 'supabase-test-user-id']);

        $response = $this->withHeader('Authorization', 'Bearer '.$this->supabaseToken(['aal' => 'aal2']))
            ->getJson('/api/user');

        $response->assertOk();
        $response->assertJsonPath('data.authAssuranceLevel', 'aal2');
        $response->assertJsonPath('data.id', (string) $user->id);
    }

    public function test_supabase_token_with_aal1_resolves_user_and_reports_aal1(): void
    {
        $this->makeUser(['supabase_user_id' => 'supabase-test-user-id']);

        $response = $this->withHeader('Authorization', 'Bearer '.$this->supabaseToken(['aal' => 'aal1']))
            ->getJson('/api/user');

        // aal1 is fully sufficient to authenticate now (no route enforces
        // aal2 anymore) — the point of this test is just that the response
        // honestly reports aal1.
        $response->assertOk();
        $response->assertJsonPath('data.authAssuranceLevel', 'aal1');
    }

    public function test_supabase_token_missing_aal_claim_defaults_to_aal1_not_aal2(): void
    {
        $this->makeUser(['supabase_user_id' => 'supabase-test-user-id']);

        $now = time();
        $claims = [
            'sub' => 'supabase-test-user-id',
            'aud' => 'authenticated',
            'iss' => rtrim(config('supabase.url'), '/').'/auth/v1',
            'email' => 'encoder1@example.com',
            'email_verified' => true,
            // 'aal' intentionally omitted.
            'iat' => $now,
            'exp' => $now + 3600,
        ];
        $token = JWT::encode($claims, config('supabase.jwt_secret'), 'HS256');

        $response = $this->withHeader('Authorization', 'Bearer '.$token)->getJson('/api/user');

        $response->assertOk();
        // Fail-closed default: absence of the claim must never be read as
        // the *more* privileged aal2.
        $response->assertJsonPath('data.authAssuranceLevel', 'aal1');
    }

    public function test_tampered_supabase_token_is_rejected(): void
    {
        $this->makeUser(['supabase_user_id' => 'supabase-test-user-id']);

        $token = $this->supabaseToken(['aal' => 'aal2']);
        $tampered = substr($token, 0, -2).'xx'; // corrupt the signature

        $this->withHeader('Authorization', 'Bearer '.$tampered)
            ->getJson('/api/user')
            ->assertUnauthorized();
    }

    public function test_actingas_authenticated_request_has_no_supabase_aal(): void
    {
        $user = $this->makeUser();

        $response = $this->actingAs($user)->getJson('/api/user');

        $response->assertOk();
        // A session set up via actingAs() never touches SupabaseTokenValidator
        // at all, so the field must be null — not "aal1" and not "aal2" — for
        // a session that was never a Supabase session in the first place.
        $response->assertJsonPath('data.authAssuranceLevel', null);
    }
}
