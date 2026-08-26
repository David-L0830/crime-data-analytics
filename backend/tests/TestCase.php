<?php

namespace Tests;

use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->registerSqliteToCharForTests();
    }

    /**
     * Shared authentication helper for all API feature tests.
     *
     * Generates a valid Supabase-style JWT and attaches it as:
     *
     * Authorization: Bearer <token>
     */
    protected function actingAsSupabase(
        User $user,
        string $aal = 'aal1'
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
