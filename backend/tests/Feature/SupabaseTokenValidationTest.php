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

    // === First sign-in of an admin-provisioned account ======================
    //
    // mapClaimsToUser() has two paths: an already-linked supabase_user_id, and
    // an email fallback that links the account the first time it signs in. The
    // whole suite only ever exercised the first one — every token minted here
    // and in Tests\TestCase carries `email_verified` at the TOP level, which
    // short-circuits the `??` chain before the fallback's nested lookup runs.
    //
    // Real Supabase tokens do not look like that. They carry `email_verified`
    // inside `user_metadata`, and JWT::decode returns that nested claim as a
    // stdClass while decodeToken()'s `(array)` cast is shallow. Reading it as
    // an array threw "Cannot use object of type stdClass as array", so every
    // first sign-in returned 500 and no account was ever linked. Observed
    // against the live app: Supabase issued a token (200) and GET /api/user
    // then failed (500).
    //
    // These two tests pin the fallback itself, so the shape real Supabase
    // sends is covered rather than only the shape the test helpers happen to
    // mint.

    /**
     * Builds a token in the shape Supabase actually issues: no top-level
     * `email_verified`, the flag nested inside `user_metadata`.
     *
     * Written out literally rather than through actingAsSupabaseWithClaims()
     * for one reason — that helper merges overrides over its defaults, and
     * array_merge cannot REMOVE the default top-level `email_verified`. The
     * omission is the whole point of these tests, so the claims are assembled
     * here, following the same pattern the aal test above already uses.
     */
    private function nestedVerifiedToken(bool $verified, string $sub): string
    {
        $now = time();

        $claims = [
            'sub' => $sub,
            'aud' => 'authenticated',
            'iss' => rtrim(config('supabase.url'), '/').'/auth/v1',
            'email' => 'encoder1@example.com',
            // 'email_verified' intentionally omitted at the top level.
            'user_metadata' => ['email_verified' => $verified],
            'aal' => 'aal1',
            'iat' => $now,
            'exp' => $now + 3600,
        ];

        return JWT::encode($claims, config('supabase.jwt_secret'), 'HS256');
    }

    public function test_nested_verified_email_links_an_account_on_first_sign_in(): void
    {
        $user = $this->makeUser(['supabase_user_id' => null]);

        $response = $this->withHeader(
            'Authorization',
            'Bearer '.$this->nestedVerifiedToken(true, 'supabase-first-signin-id')
        )->getJson('/api/user');

        $response->assertOk();
        $response->assertJsonPath('data.id', (string) $user->id);

        // The account is now linked, so every later request takes the fast path.
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'supabase_user_id' => 'supabase-first-signin-id',
        ]);
    }

    public function test_nested_unverified_email_is_rejected_and_links_nothing(): void
    {
        $user = $this->makeUser(['supabase_user_id' => null]);

        $this->withHeader(
            'Authorization',
            'Bearer '.$this->nestedVerifiedToken(false, 'supabase-unverified-id')
        )->getJson('/api/user')->assertUnauthorized();

        // The guard must stay closed: an unverified address cannot be used to
        // claim an existing account, and nothing may be linked on the way out.
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'supabase_user_id' => null,
        ]);
    }
}
