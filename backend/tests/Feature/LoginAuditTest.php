<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// LOGIN auditing. Sign-in happens entirely in Supabase on the frontend, so
// GET /api/user — the first authenticated call the app makes after
// signInWithPassword resolves — is the only place Laravel ever observes one.
// Before AuthController::recordLoginIfFreshSignIn() the audit trail recorded
// LOGOUT but never LOGIN (production showed LOGIN stopping on 2026-08-14 while
// LOGOUT continued).
//
// The detection deliberately does NOT key on `iat` alone. supabaseClient.js
// enables autoRefreshToken, so an active session mints a new token — and a new
// `iat` — roughly every hour; an `iat`-only check would fabricate a LOGIN after
// every silent refresh. `amr[].timestamp` records when the authentication
// METHOD was performed and is not re-stamped by a refresh, so it is the
// primary signal, with `iat` kept only as a fallback for tokens that carry no
// `amr`. test_refreshed_token_does_not_create_a_second_login below is the case
// an `iat`-only implementation would get wrong.
class LoginAuditTest extends TestCase
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

    /** Claims for a session whose sign-in happened $secondsAgo seconds ago. */
    private function signedInSecondsAgo(int $secondsAgo): array
    {
        $authTime = time() - $secondsAgo;

        return [
            'iat' => $authTime,
            'amr' => [['method' => 'password', 'timestamp' => $authTime]],
        ];
    }

    private function loginRows(User $user): int
    {
        return AuditLog::where('user_id', $user->id)->where('action', 'LOGIN')->count();
    }

    public function test_fresh_sign_in_creates_exactly_one_login_audit_event(): void
    {
        $user = $this->makeUser();

        $this->actingAsSupabaseWithClaims($user, $this->signedInSecondsAgo(2))
            ->getJson('/api/user')
            ->assertOk();

        $this->assertSame(1, $this->loginRows($user));
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $user->id,
            'action' => 'LOGIN',
            'module' => 'auth',
            'target_type' => 'auth',
        ]);
    }

    public function test_older_token_does_not_create_a_login_event(): void
    {
        $user = $this->makeUser();

        // Well outside the 300s window — a long-running session, not a sign-in.
        $this->actingAsSupabaseWithClaims($user, $this->signedInSecondsAgo(3600))
            ->getJson('/api/user')
            ->assertOk();

        $this->assertSame(0, $this->loginRows($user));
        $this->assertDatabaseMissing('audit_logs', ['action' => 'LOGIN']);
    }

    public function test_repeated_user_calls_with_the_same_token_create_only_one_login(): void
    {
        $user = $this->makeUser();
        $claims = $this->signedInSecondsAgo(2);

        for ($i = 0; $i < 3; $i++) {
            $this->actingAsSupabaseWithClaims($user, $claims)
                ->getJson('/api/user')
                ->assertOk();
        }

        $this->assertSame(1, $this->loginRows($user));
    }

    public function test_refreshed_token_does_not_create_a_second_login(): void
    {
        $user = $this->makeUser();
        $authTime = time() - 120;

        // Original sign-in.
        $this->actingAsSupabaseWithClaims($user, [
            'iat' => $authTime,
            'amr' => [['method' => 'password', 'timestamp' => $authTime]],
        ])->getJson('/api/user')->assertOk();

        $this->assertSame(1, $this->loginRows($user));

        // autoRefreshToken mints a NEW token: `iat` moves to now, but `amr`
        // still records the original authentication. An iat-only check would
        // wrongly log a second LOGIN here.
        $this->actingAsSupabaseWithClaims($user, [
            'iat' => time(),
            'amr' => [['method' => 'password', 'timestamp' => $authTime]],
        ])->getJson('/api/user')->assertOk();

        $this->assertSame(1, $this->loginRows($user));
    }

    public function test_token_without_amr_falls_back_to_iat(): void
    {
        $user = $this->makeUser();

        // No `amr` claim at all — fresh `iat` must still be honoured.
        $this->actingAsSupabaseWithClaims($user, ['iat' => time() - 5])
            ->getJson('/api/user')
            ->assertOk();

        $this->assertSame(1, $this->loginRows($user));
    }

    public function test_user_endpoint_response_is_unchanged(): void
    {
        $user = $this->makeUser();

        // Same assertions whether or not a LOGIN row is written.
        $this->actingAsSupabaseWithClaims($user, $this->signedInSecondsAgo(2))
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.username', $user->username)
            ->assertJsonPath('data.role', User::ROLE_ENCODER);

        $this->actingAsSupabaseWithClaims($user, $this->signedInSecondsAgo(3600))
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.username', $user->username)
            ->assertJsonPath('data.role', User::ROLE_ENCODER);
    }

    public function test_unauthenticated_user_request_writes_no_audit_row(): void
    {
        $this->getJson('/api/user')->assertUnauthorized();

        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_logout_auditing_is_unchanged(): void
    {
        $user = $this->makeUser();

        // Deliberately an old token, so the only row written is the LOGOUT.
        $this->actingAsSupabaseWithClaims($user, $this->signedInSecondsAgo(3600))
            ->postJson('/api/logout')
            ->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $user->id,
            'action' => 'LOGOUT',
            'module' => 'auth',
            'target_type' => 'auth',
        ]);
        $this->assertSame(0, $this->loginRows($user));
        $this->assertDatabaseCount('audit_logs', 1);
    }
}
