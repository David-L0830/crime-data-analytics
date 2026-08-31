<?php

namespace Tests;

use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->registerSqliteToCharForTests();
    }

    /**
     * Make every Bearer-token request in a test re-authenticate from scratch.
     *
     * A test that issues two requests reuses ONE application instance, and
     * Illuminate\Auth\RequestGuard memoises the user it resolved the first
     * time. So the second request never re-enters
     * SupabaseTokenValidator::resolveUser() — it gets the cached user, but
     * none of the per-token facts that method stashes on the request
     * alongside it: 'supabase_aal' (the verified assurance level) and
     * 'supabase_auth_time'. Anything reading those then sees a request that
     * looks like it came from no Supabase token at all.
     *
     * That was harmless while nothing consumed 'supabase_aal'. It stopped
     * being harmless when login-time MFA enforcement started reading it:
     * EnsureSupabaseAal2 correctly fails closed on a missing assurance level,
     * so the second request in ~50 existing tests began returning
     * "Unauthenticated." for a reason that exists only in the test harness.
     *
     * Forgetting the guards before each request restores the real per-request
     * behaviour — a deployment handles every request in a fresh container and
     * never memoises across two of them, which is precisely why this is
     * corrected here rather than by weakening the middleware.
     *
     * Gated on an Authorization header so it touches only the token path.
     * Laravel's own actingAs() works by setting a user ON a guard instance;
     * forgetting guards unconditionally would discard it and break the one
     * test that deliberately uses actingAs() to prove a non-Supabase session
     * reports no assurance level (see SupabaseTokenValidationTest).
     *
     * @param  array<string, mixed>  $parameters
     * @param  array<string, mixed>  $cookies
     * @param  array<string, mixed>  $files
     * @param  array<string, mixed>  $server
     */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        if (isset($this->defaultHeaders['Authorization'])) {
            Auth::forgetGuards();
        }

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    /**
     * Shared authentication helper for all API feature tests.
     *
     * Generates a valid Supabase-style JWT and attaches it as:
     *
     * Authorization: Bearer <token>
     */
    /**
     * The default is 'aal2' because that is what a signed-in session looks
     * like once login-time MFA enforcement exists: EnsureSupabaseAal2 guards
     * every protected route (see routes/api.php), so a suite that minted aal1
     * tokens by default would be testing a session that, for an MFA-enrolled
     * account, is not allowed into the application at all.
     *
     * The aal1 paths are NOT left uncovered by this default -- they are
     * covered deliberately and in both directions by
     * tests/Feature/MfaEnforcementTest.php, which is the only place that
     * should be asserting on assurance levels. Tests elsewhere that care pass
     * $aal explicitly.
     */
    protected function actingAsSupabase(
        User $user,
        string $aal = 'aal2'
    ): static {
        // Ensure the local user has a Supabase user ID.
        if (! $user->supabase_user_id) {
            $user->update([
                'supabase_user_id' => (string) $user->id,
            ]);

            $user->refresh();
        }

        $now = time();

        $claims = [
            'sub' => (string) $user->supabase_user_id,
            'email' => $user->email,

            'aud' => config(
                'supabase.audience',
                'authenticated'
            ),

            'iss' => rtrim(
                (string) config('supabase.url'),
                '/'
            ).'/auth/v1',

            'iat' => $now,
            'exp' => $now + 3600,

            // Authentication Assurance Level
            'aal' => $aal,

            // Include if your validator requires this claim
            'email_verified' => true,
        ];

        $token = JWT::encode(
            $claims,
            config('supabase.jwt_secret'),
            'HS256'
        );

        return $this->withHeader(
            'Authorization',
            'Bearer '.$token
        );
    }

    /**
     * Same as actingAsSupabase(), but lets a test control individual claims —
     * used by LoginAuditTest to mint a deliberately old token, or one whose
     * `amr` authentication-method timestamp differs from its `iat` (what a
     * silently refreshed access token looks like).
     *
     * Deliberately a separate method rather than a third parameter on
     * actingAsSupabase(): BadacReadonlyTest overrides that method with its own
     * signature, and widening the base signature would break the override.
     *
     * @param  array<string, mixed>  $claimOverrides  merged over the defaults
     */
    protected function actingAsSupabaseWithClaims(
        User $user,
        array $claimOverrides,
        string $aal = 'aal1'
    ): static {
        if (! $user->supabase_user_id) {
            $user->update(['supabase_user_id' => (string) $user->id]);
            $user->refresh();
        }

        $now = time();

        $claims = array_merge([
            'sub' => (string) $user->supabase_user_id,
            'email' => $user->email,
            'aud' => config('supabase.audience', 'authenticated'),
            'iss' => rtrim((string) config('supabase.url'), '/').'/auth/v1',
            'iat' => $now,
            'exp' => $now + 3600,
            'aal' => $aal,
            'email_verified' => true,
        ], $claimOverrides);

        $token = JWT::encode(
            $claims,
            config('supabase.jwt_secret'),
            'HS256'
        );

        return $this->withHeader('Authorization', 'Bearer '.$token);
    }

    // Test-only SQLite compatibility shim.
    // Production (AnalyticsController) intentionally uses PostgreSQL's
    // to_char(date, 'YYYY-MM') for the monthly analytics grouping.
    private function registerSqliteToCharForTests(): void
    {
        if (config('database.default') !== 'sqlite') {
            return;
        }

        $pdo = DB::connection()->getPdo();

        $pdo->sqliteCreateFunction('to_char', function ($value, $format) {
            if ($value === null || $format === null) {
                return null;
            }

            try {
                $date = new \DateTime($value);
            } catch (\Exception) {
                return null;
            }

            $phpFormat = strtr($format, [
                'YYYY' => 'Y',
                'MM' => 'm',
                'DD' => 'd',
            ]);

            return $date->format($phpFormat);
        }, 2);
    }
}
