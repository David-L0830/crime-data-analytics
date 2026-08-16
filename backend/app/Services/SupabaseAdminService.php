<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

// Final auth migration — Supabase MFA is the sole MFA system (Laravel TOTP
// was retired; see AUTH_MIGRATION_STATUS.md). This is the ONLY class in
// this backend that uses the Supabase service-role key, and the service-
// role key is the ONLY thing it uses it for: removing another user's
// enrolled MFA factor(s) on an admin's behalf (the "lost my phone and my
// recovery codes" break-glass case — see UserController::disableTwoFactor).
//
// The service-role key is read from config('supabase.service_role_key')
// (env SUPABASE_SERVICE_ROLE_KEY), which is set ONLY in this backend's
// .env — never in the frontend's .env, never in any VITE_* variable, and
// never returned in any API response. See config/supabase.php and
// .env.example for the "never expose this to the frontend" warnings.
//
// Supabase's Admin API (GoTrue) is a plain REST API, not something
// firebase/php-jwt or any other installed package wraps for us, so this
// talks to it directly over Illuminate\Support\Facades\Http rather than an
// SDK. Every call requires BOTH the `apikey` header and a Bearer
// Authorization header carrying the service-role key (Supabase's
// documented convention for every Admin API request).
class SupabaseAdminService
{
    protected function baseUrl(): string
    {
        $url = rtrim((string) config('supabase.url'), '/');
        if ($url === '') {
            throw new RuntimeException('SUPABASE_URL is not configured.');
        }

        return $url.'/auth/v1/admin';
    }

    protected function serviceRoleKey(): string
    {
        $key = (string) config('supabase.service_role_key');
        if ($key === '') {
            throw new RuntimeException(
                'SUPABASE_SERVICE_ROLE_KEY is not configured. Admin-initiated MFA '.
                'factor removal cannot be performed without it — see .env.example.'
            );
        }

        return $key;
    }

    protected function client()
    {
        $key = $this->serviceRoleKey();

        return Http::baseUrl($this->baseUrl())
            ->timeout(10)
            ->withHeaders([
                'apikey' => $key,
                'Authorization' => 'Bearer '.$key,
            ]);
    }

    /**
     * Every MFA factor Supabase has on file for this user (any status —
     * 'verified' or 'unverified'). Returns [] if the user has none, if the
     * Supabase user id can't be found, or if the request itself fails —
     * callers should treat all of those as "nothing to remove", not
     * silently assume success.
     *
     * @return array<int, array{id: string, factor_type: string, status: string}>
     */
    public function listFactors(string $supabaseUserId): array
    {
        $response = $this->client()->get("/users/{$supabaseUserId}");

        if (! $response->successful()) {
            Log::warning('Supabase admin: failed to fetch user for MFA factor lookup.', [
                'supabase_user_id' => $supabaseUserId,
                'status' => $response->status(),
            ]);

            return [];
        }

        return $response->json('factors') ?? [];
    }

    /**
     * Deletes a single MFA factor via Supabase's Admin API. Returns true
     * only on a genuine 2xx from Supabase — never assumed on our side.
     */
    public function deleteFactor(string $supabaseUserId, string $factorId): bool
    {
        $response = $this->client()->delete("/users/{$supabaseUserId}/factors/{$factorId}");

        if (! $response->successful()) {
            Log::warning('Supabase admin: failed to delete MFA factor.', [
                'supabase_user_id' => $supabaseUserId,
                'factor_id' => $factorId,
                'status' => $response->status(),
            ]);
        }

        return $response->successful();
    }

    /**
     * The actual operation UserController::disableTwoFactor() needs: strip
     * every factor (verified or not — an abandoned unverified enrollment
     * should not survive an admin-initiated reset either) so the target
     * account is back to "no MFA enrolled" and can sign in and re-enroll.
     * Returns the count actually deleted; throws only on a configuration
     * error (missing URL/key), never on a per-factor delete failure (those
     * are logged and skipped so one bad factor doesn't block the rest).
     */
    public function deleteAllFactors(string $supabaseUserId): int
    {
        $factors = $this->listFactors($supabaseUserId);
        $deleted = 0;

        foreach ($factors as $factor) {
            if (! empty($factor['id']) && $this->deleteFactor($supabaseUserId, $factor['id'])) {
                $deleted++;
            }
        }

        return $deleted;
    }
}
