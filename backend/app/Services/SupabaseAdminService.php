<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;

// Final auth migration — Supabase MFA is the sole MFA system (Laravel TOTP
// was retired; see AUTH_MIGRATION_STATUS.md). This is the ONLY class in
// this backend that uses the Supabase service-role key, and it uses it for
// exactly two administrator operations, both of which are impossible
// without it:
//   1. Removing another user's enrolled MFA factor(s) on an admin's behalf
//      (the "lost my phone and my recovery codes" break-glass case — see
//      UserController::disableTwoFactor).
//   2. Provisioning the Supabase Auth half of an admin-created account
//      (see createUser() below and UserController::store). A local users
//      row on its own cannot authenticate — Supabase Auth owns every
//      credential — so administrator account creation is only possible
//      through the Admin API.
// It is still never used for anything else, and the key is still never
// returned, logged, or exposed to the frontend.
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

    /**
     * @param  string  $operation  what the caller was trying to do, phrased to
     *                             complete "... so {$operation} is not possible"
     *
     * The operation is a parameter rather than fixed text because this message
     * is surfaced to an administrator (UserController::store returns it
     * verbatim in a 422). It used to name MFA factor removal unconditionally,
     * which was accurate while that was this class's only job — once account
     * creation started using the same key, an admin who clicked "Create User"
     * was told that "admin-initiated MFA factor removal" had failed, naming an
     * operation they had not performed.
     *
     * The message deliberately says where the key belongs and where it must
     * never go. It never contains the key itself.
     */
    protected function serviceRoleKey(string $operation): string
    {
        $key = (string) config('supabase.service_role_key');
        if ($key === '') {
            throw new RuntimeException(
                "SUPABASE_SERVICE_ROLE_KEY is not configured, so {$operation} is not possible. ".
                "Set it in this backend's own .env — never in the frontend or any VITE_ variable. ".
                'See backend/.env.example.'
            );
        }

        return $key;
    }

    /**
     * @param  string  $operation  passed through to serviceRoleKey() so a
     *                             missing-key failure names the real operation
     */
    protected function client(string $operation)
    {
        $key = $this->serviceRoleKey($operation);

        return Http::baseUrl($this->baseUrl())
            ->timeout(10)
            ->withHeaders([
                'apikey' => $key,
                'Authorization' => 'Bearer '.$key,
            ]);
    }

    /**
     * Provisions a brand-new Supabase Auth user for an admin-created account
     * (see UserController::store) and returns its uuid.
     *
     * `email_confirm: true` marks the address as verified without sending a
     * confirmation mail, which is what makes the account eligible for the
     * password-recovery email the admin sends immediately afterwards — and
     * what lets SupabaseTokenValidator link it to the local row on first
     * sign-in (it links only on a verified email).
     *
     * A random password is generated purely because a Supabase account with
     * no credential at all is an awkward, half-provisioned state; it is
     * never returned, never logged, never written to this database, and
     * never shown to the administrator. The new user sets their own password
     * through the recovery link, so nobody — including the admin who created
     * the account — ever knows this value.
     *
     * @throws RuntimeException when Supabase is not configured, or the
     *                          address already exists in Supabase Auth, or
     *                          the Admin API refuses the request. The caller
     *                          is expected to roll back its own local row.
     */
    public function createUser(string $email): string
    {
        $response = $this->client('creating an account')->post('/users', [
            'email' => $email,
            'password' => Str::random(48),
            'email_confirm' => true,
        ]);

        // Duplicate detection deliberately does NOT rest on the HTTP status
        // alone. Supabase publishes `email_exists` and `user_already_exists`
        // as error CODES, and documents no HTTP status for either -- its error
        // registry lists a null httpStatusCode for every auth error -- so the
        // status is the weaker of the two signals. Both are checked, and the
        // code is preferred, so a duplicate is still recognised if Supabase
        // reports it as 400 or anything else.
        $errorCode = $response->json('error_code') ?? $response->json('code');

        $isDuplicate = in_array($errorCode, ['email_exists', 'user_already_exists', 'phone_exists'], true)
            || in_array($response->status(), [409, 422], true);

        if ($isDuplicate) {
            // The one failure an administrator can actually act on: the
            // address is already in Supabase Auth, e.g. from an account that
            // was removed locally.
            Log::warning('Supabase admin: refused to create user.', [
                'status' => $response->status(),
                'error_code' => is_string($errorCode) ? $errorCode : null,
            ]);

            throw new RuntimeException('That email address is already registered in Supabase Auth.');
        }

        if (! $response->successful()) {
            Log::warning('Supabase admin: failed to create user.', [
                'status' => $response->status(),
            ]);

            throw new RuntimeException('Supabase could not create this account right now. Please try again.');
        }

        $id = $response->json('id');

        if (! is_string($id) || $id === '') {
            throw new RuntimeException('Supabase created the account but returned no user id.');
        }

        return $id;
    }

    /**
     * Removes a Supabase Auth user. This exists for exactly one purpose:
     * undoing a createUser() whose local counterpart did not survive (see
     * UserController::store).
     *
     * Deliberately best-effort and non-throwing. It is only ever called while
     * already handling another failure, and turning a compensation failure
     * into a second exception would replace the real, actionable error with a
     * confusing one. A failure here is logged so the orphan can be cleaned up
     * by hand in the Supabase dashboard.
     *
     * This is NOT an account-deletion feature and is not reachable from any
     * route. Deleting an account an administrator can see is deliberately not
     * offered anywhere in this application — deactivation covers that need
     * without destroying history (see UserController class comment).
     */
    public function deleteUser(string $supabaseUserId): bool
    {
        try {
            $response = $this->client('undoing an account creation')->delete("/users/{$supabaseUserId}");
        } catch (\Throwable $e) {
            Log::error('Supabase admin: could not reach Supabase to undo a user creation. An orphaned Supabase Auth user may remain.', [
                'supabase_user_id' => $supabaseUserId,
            ]);

            return false;
        }

        if (! $response->successful()) {
            Log::error('Supabase admin: failed to undo a user creation. An orphaned Supabase Auth user may remain.', [
                'supabase_user_id' => $supabaseUserId,
                'status' => $response->status(),
            ]);
        }

        return $response->successful();
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
        $response = $this->client('checking two-factor authentication status')->get("/users/{$supabaseUserId}");

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
        $response = $this->client('removing a two-factor authentication factor')->delete("/users/{$supabaseUserId}/factors/{$factorId}");

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
