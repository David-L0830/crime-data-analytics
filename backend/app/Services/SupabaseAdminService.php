<?php

namespace App\Services;

use App\Exceptions\SupabasePasswordUpdateException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
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
    /**
     * The one message used whenever Supabase refuses a password on policy
     * grounds. Supabase's own `msg` is deliberately not passed through: it is
     * written for end users of Supabase, not administrators of this system,
     * and a fixed sentence is guaranteed to contain nothing from the request.
     */
    public const WEAK_PASSWORD_MESSAGE = 'Supabase rejected the password. Choose a longer, less predictable password.';

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
     * With no `$password`, a random one is generated purely because a Supabase
     * account with no credential at all is an awkward, half-provisioned state;
     * nobody — including the admin who created the account — ever knows it, and
     * the new user sets their own through the recovery link.
     *
     * With a `$password`, it is the administrator-supplied TEMPORARY password
     * (see UserController::store) and is handed to Supabase unchanged.
     *
     * In both cases the value exists here only as an argument to the Admin API
     * call. It is never returned, logged, written to this database, or placed
     * in an exception message. #[\SensitiveParameter] keeps it out of stack
     * traces as well, which PHP would otherwise print argument values into.
     *
     * @throws RuntimeException when Supabase is not configured or unreachable,
     *                          the address already exists in Supabase Auth,
     *                          Supabase rejects the password, or the Admin API
     *                          refuses the request. The caller is expected to
     *                          roll back its own local row.
     */
    public function createUser(string $email, #[\SensitiveParameter] ?string $password = null, array $appMetadata = []): string
    {
        $payload = [
            'email' => $email,
            'password' => $password ?? Str::random(48),
            'email_confirm' => true,
        ];

        // Only sent when there is something to set (UserController::store
        // passes ['mfa_required' => true] for an Authenticator App account),
        // so the request for every other account is exactly as before.
        // app_metadata can only be written with the service-role key, which is
        // why an account cannot later clear the flag on itself.
        if ($appMetadata !== []) {
            $payload['app_metadata'] = $appMetadata;
        }

        $response = $this->send('creating an account', 'post', '/users', $payload);

        // Checked BEFORE the duplicate test below, which also treats a bare
        // 422 as a duplicate: Supabase answers a policy-rejected password with
        // 422 as well, and telling an administrator "already registered" for a
        // weak password would send them chasing the wrong problem.
        if ($this->isWeakPasswordResponse($response)) {
            Log::warning('Supabase admin: rejected the password for a new user.', [
                'status' => $response->status(),
            ]);

            throw new RuntimeException(self::WEAK_PASSWORD_MESSAGE);
        }

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
     * Replaces an existing Supabase Auth user's password.
     *
     * Used by the administrator reissue (UserController) and the account
     * holder's own change (PasswordController). Same handling rules as
     * createUser(): the value is passed straight to the Admin API and is never
     * returned, logged, stored, or placed in an exception message.
     *
     * Every failure says what is KNOWN about its effect, because callers must
     * never treat "could not confirm" as "did not happen":
     *
     *   WEAK_PASSWORD   - refused on policy grounds; nothing applied.
     *   NOT_APPLIED     - no request was sent (missing configuration), or a
     *                     definite 4xx refusal; nothing applied.
     *   OUTCOME_UNKNOWN - timeout, network failure, 5xx, or a 4xx that a proxy
     *                     or rate limiter may send without saying whether the
     *                     request was processed (408, 425, 429, 499). Supabase
     *                     may already hold the new password.
     *
     * @throws SupabasePasswordUpdateException
     */
    public function setPassword(string $supabaseUserId, #[\SensitiveParameter] string $password): void
    {
        $operation = 'setting a password';

        // A configuration fault is raised here, before any request exists, so
        // it is a certain "not applied".
        try {
            $this->client($operation);
        } catch (RuntimeException $e) {
            throw new SupabasePasswordUpdateException($e->getMessage(), SupabasePasswordUpdateException::NOT_APPLIED);
        }

        try {
            $response = $this->send($operation, 'put', "/users/{$supabaseUserId}", ['password' => $password]);
        } catch (RuntimeException $e) {
            // send() only throws for a transport failure, which may have
            // happened after Supabase received and applied the request.
            throw new SupabasePasswordUpdateException($e->getMessage(), SupabasePasswordUpdateException::OUTCOME_UNKNOWN);
        }

        if ($this->isWeakPasswordResponse($response)) {
            Log::warning('Supabase admin: rejected a password update.', [
                'supabase_user_id' => $supabaseUserId,
                'status' => $response->status(),
            ]);

            throw new SupabasePasswordUpdateException(self::WEAK_PASSWORD_MESSAGE, SupabasePasswordUpdateException::WEAK_PASSWORD);
        }

        if (! $response->successful()) {
            $outcome = self::isDefiniteRefusalStatus($response->status())
                ? SupabasePasswordUpdateException::NOT_APPLIED
                : SupabasePasswordUpdateException::OUTCOME_UNKNOWN;

            Log::warning('Supabase admin: failed to set a password.', [
                'supabase_user_id' => $supabaseUserId,
                'status' => $response->status(),
                'outcome' => $outcome,
            ]);

            throw new SupabasePasswordUpdateException('Supabase could not update the password right now. Please try again.', $outcome);
        }
    }

    /**
     * A 4xx is a definite refusal (the request was rejected, not applied),
     * except the statuses a gateway or rate limiter can return without the
     * request's fate being known. Anything else that is not a success —
     * 5xx, an unfollowed redirect — is treated as an unknown outcome.
     */
    private static function isDefiniteRefusalStatus(int $status): bool
    {
        return $status >= 400 && $status < 500
            && ! in_array($status, [408, 425, 429, 499], true);
    }

    /**
     * Is `$password` this account's CURRENT Supabase Auth password?
     *
     * Used by POST /me/password (PasswordController) so the "new password must
     * differ from the current one" rule rests on a verified current password
     * rather than on whatever the client claims it is, and so a stolen access
     * token alone is not enough to replace the password.
     *
     * Supabase has no "check password" endpoint, so this performs Supabase's own
     * password grant (POST /auth/v1/token?grant_type=password). A successful
     * grant opens a throwaway session; its access token never leaves this
     * method and that session is revoked straight away (best effort).
     *
     * @return bool true when Supabase accepts the credentials, false when it
     *              reports them invalid
     *
     * @throws RuntimeException when Supabase is not configured, unreachable, or
     *                          answers with anything other than success or
     *                          "invalid credentials" (e.g. rate limited)
     */
    public function verifyPassword(string $email, #[\SensitiveParameter] string $password): bool
    {
        $operation = 'verifying the current password';
        $key = $this->serviceRoleKey($operation);
        $authUrl = rtrim((string) config('supabase.url'), '/').'/auth/v1';

        try {
            $response = Http::timeout(10)
                ->withHeaders(['apikey' => $key])
                ->post($authUrl.'/token?grant_type=password', [
                    'email' => $email,
                    'password' => $password,
                ]);
        } catch (\Throwable $e) {
            Log::warning("Supabase admin: could not reach Supabase while {$operation}.", [
                'exception' => $e::class,
            ]);

            throw new RuntimeException("Supabase could not be reached while {$operation}. Please try again.");
        }

        if ($response->successful()) {
            $this->revokeSession($key, $authUrl, $response->json('access_token'));

            return true;
        }

        // GoTrue reports wrong credentials as HTTP 400 with error_code
        // `invalid_credentials` (older releases: error `invalid_grant`).
        $code = $response->json('error_code') ?? $response->json('error');
        if ($response->status() === 400 && in_array($code, ['invalid_credentials', 'invalid_grant'], true)) {
            return false;
        }

        Log::warning('Supabase admin: could not verify a password.', [
            'status' => $response->status(),
            'error_code' => is_string($code) ? $code : null,
        ]);

        throw new RuntimeException('Supabase could not verify the current password right now. Please try again.');
    }

    /**
     * Ends the throwaway session verifyPassword() opened. Best effort: a
     * failure is logged (without the token) and otherwise ignored, because the
     * verification itself already succeeded and its token was never exposed.
     */
    private function revokeSession(string $key, string $authUrl, #[\SensitiveParameter] mixed $accessToken): void
    {
        if (! is_string($accessToken) || $accessToken === '') {
            return;
        }

        try {
            $response = Http::timeout(10)
                ->withHeaders(['apikey' => $key])
                ->withToken($accessToken)
                ->post($authUrl.'/logout?scope=local');

            if (! $response->successful()) {
                Log::warning('Supabase admin: could not revoke a password-verification session.', [
                    'status' => $response->status(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('Supabase admin: could not reach Supabase to revoke a password-verification session.', [
                'exception' => $e::class,
            ]);
        }
    }

    /**
     * Supabase reports a password that fails the project's password policy
     * with the `weak_password` error code (it also carries a `weak_password`
     * object listing the reasons). Either signal is accepted.
     */
    private function isWeakPasswordResponse(Response $response): bool
    {
        if ($response->successful()) {
            return false;
        }

        $code = $response->json('error_code') ?? $response->json('code');

        return $code === 'weak_password' || is_array($response->json('weak_password'));
    }

    /**
     * Sends a credential-bearing Admin API request.
     *
     * A transport failure (DNS, TLS, timeout) is converted into a plain
     * RuntimeException carrying a fixed message and NO previous exception.
     * Left to propagate, the client exception would be reported with a stack
     * trace, and PHP prints argument values into traces: the request body —
     * password included — would be one frame away from the application log.
     *
     * @param  array<string, mixed>  $payload
     *
     * @throws RuntimeException
     */
    private function send(string $operation, string $method, string $path, #[\SensitiveParameter] array $payload): Response
    {
        $client = $this->client($operation);

        try {
            return $client->{$method}($path, $payload);
        } catch (\Throwable $e) {
            Log::warning("Supabase admin: could not reach Supabase while {$operation}.", [
                'exception' => $e::class,
            ]);

            throw new RuntimeException("Supabase could not be reached while {$operation}. Please try again.");
        }
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
     * The two facts that decide whether a session must reach aal2, read in a
     * single Admin API call:
     *
     *   hasVerifiedFactor  - Supabase holds a verified TOTP factor for this
     *                        account, so it CAN complete a challenge.
     *   mfaRequiredByAdmin - an administrator has switched this account's
     *                        `app_metadata.mfa_required` flag on, so it MUST,
     *                        whether or not it has enrolled anything yet.
     *
     * app_metadata is the right home for that flag and not merely a convenient
     * one: Supabase only permits it to be written with the service-role key,
     * so it is not something an account can set on itself the way
     * user_metadata would be, and it rides along on the very same
     * `GET /admin/users/{id}` response that already carries `factors`. So
     * requiring MFA costs no extra round trip on the enforcement path, and
     * takes effect on the account's next request rather than waiting for a
     * token to be reissued.
     *
     * Throws on a failed lookup rather than defaulting - see requiresAal2().
     *
     * @return array{hasVerifiedFactor: bool, mfaRequiredByAdmin: bool}
     *
     * @throws RuntimeException
     */
    public function securityState(string $supabaseUserId): array
    {
        $key = $this->factorStatusCacheKey($supabaseUserId);
        $cached = Cache::get($key);

        if (is_array($cached)) {
            return $cached;
        }

        $state = $this->fetchSecurityState($supabaseUserId);

        // ONLY AN OBLIGATION IS EVER CACHED, AND THAT ASYMMETRY IS THE POINT.
        //
        // Caching the "nothing owed" answer is what defeated login-time
        // enforcement outright once before. Enrolment happens client-side,
        // straight from the browser to Supabase, so this backend never sees it
        // and has nothing to invalidate on: a cached "nothing owed" written
        // moments before someone enrolled stayed authoritative for the rest of
        // its TTL, and every sign-in inside that window walked in at aal1.
        //
        // The two answers are not equally safe to remember, so they are not
        // remembered the same way. A state carrying an obligation GRANTS
        // NOTHING - the worst it can do is demand a code from somebody whose
        // obligation was just lifted, which is the fail-closed direction, self
        // heals when the entry expires, and is invalidated outright by both
        // administrator actions (see UserController). A state carrying no
        // obligation GRANTS ACCESS, and can only ever be wrong in the
        // direction of letting an account skip its second factor. So it is
        // never cached: every request that has not already been told
        // "obligated" asks Supabase.
        if ($state['hasVerifiedFactor'] || $state['mfaRequiredByAdmin']) {
            Cache::put($key, $state, (int) config('supabase.mfa_status_cache_ttl', 60));
        }

        return $state;
    }

    /**
     * Must a session for this account reach aal2 before it may touch anything
     * protected? True if it has a factor to prove, OR an administrator has
     * required one of it.
     *
     * @throws RuntimeException when Supabase could not be asked - callers must
     *                          fail closed rather than read that as "no"
     */
    public function requiresAal2(string $supabaseUserId): bool
    {
        $state = $this->securityState($supabaseUserId);

        return $state['hasVerifiedFactor'] || $state['mfaRequiredByAdmin'];
    }

    /**
     * Does this account have at least one VERIFIED MFA factor?
     *
     * Verified only - an abandoned, unverified enrolment protects nobody and
     * must not be able to lock its owner out of the application.
     *
     * @throws RuntimeException
     */
    public function hasVerifiedFactor(string $supabaseUserId): bool
    {
        return $this->securityState($supabaseUserId)['hasVerifiedFactor'];
    }

    /**
     * Has an administrator required a second factor of this account?
     *
     * @throws RuntimeException
     */
    public function mfaRequiredByAdmin(string $supabaseUserId): bool
    {
        return $this->securityState($supabaseUserId)['mfaRequiredByAdmin'];
    }

    /**
     * Switches the administrator-imposed MFA requirement on or off.
     *
     * Deliberately a read-modify-write rather than a bare PUT of
     * `{"app_metadata": {"mfa_required": ...}}`. GoTrue does merge app_metadata
     * keys, but this flag shares that object with keys Supabase itself
     * maintains - `provider` and `providers`, which record how the account
     * signs in - and quietly depending on someone else's merge semantics to
     * preserve them is not a risk worth taking to save one HTTP call. The
     * existing object is fetched, one key is changed, and the whole thing is
     * written back.
     *
     * Never touches factors, credentials, or anything else on the identity: an
     * administrator can say that a second factor is required, and nothing
     * more. Enrolling one stays the account holder's own job, performed
     * against Supabase from their own browser, so no administrator ever sees
     * the TOTP secret or its QR code.
     *
     * @throws RuntimeException when Supabase is not configured or refuses
     */
    public function setMfaRequired(string $supabaseUserId, bool $required): void
    {
        $client = $this->client('changing the two-factor requirement');

        $current = $client->get("/users/{$supabaseUserId}");

        if (! $current->successful()) {
            Log::warning('Supabase admin: could not read the account before changing its MFA requirement.', [
                'supabase_user_id' => $supabaseUserId,
                'status' => $current->status(),
            ]);

            throw new RuntimeException('Supabase could not be reached to change the two-factor requirement.');
        }

        $appMetadata = $current->json('app_metadata') ?? [];
        $appMetadata['mfa_required'] = $required;

        $response = $client->put("/users/{$supabaseUserId}", [
            'app_metadata' => $appMetadata,
        ]);

        if (! $response->successful()) {
            Log::warning('Supabase admin: failed to change the MFA requirement.', [
                'supabase_user_id' => $supabaseUserId,
                'status' => $response->status(),
            ]);

            throw new RuntimeException('Supabase could not change the two-factor requirement right now. Please try again.');
        }

        // The obligation just changed, and a cached one outliving it would
        // either keep demanding a code nobody owes or be read as current by
        // the next request.
        $this->forgetFactorStatus($supabaseUserId);
    }

    /**
     * The uncached lookup. Throws rather than returning a default, so that a
     * caller can never mistake "Supabase did not answer" for "nothing owed".
     *
     * @return array{hasVerifiedFactor: bool, mfaRequiredByAdmin: bool}
     *
     * @throws RuntimeException
     */
    protected function fetchSecurityState(string $supabaseUserId): array
    {
        try {
            $response = $this->client('checking two-factor enrolment')
                ->get("/users/{$supabaseUserId}");
        } catch (RuntimeException $e) {
            // Missing URL/service-role key - a configuration fault, already
            // phrased for a human by serviceRoleKey().
            throw $e;
        } catch (\Throwable $e) {
            Log::warning('Supabase admin: could not reach Supabase to check MFA enrolment.', [
                'supabase_user_id' => $supabaseUserId,
            ]);

            throw new RuntimeException('Supabase could not confirm the two-factor enrolment for this account.');
        }

        if (! $response->successful()) {
            Log::warning('Supabase admin: MFA enrolment lookup was refused.', [
                'supabase_user_id' => $supabaseUserId,
                'status' => $response->status(),
            ]);

            throw new RuntimeException('Supabase could not confirm the two-factor enrolment for this account.');
        }

        $hasVerifiedFactor = false;
        foreach ($response->json('factors') ?? [] as $factor) {
            if (($factor['status'] ?? null) === 'verified') {
                $hasVerifiedFactor = true;
                break;
            }
        }

        return [
            'hasVerifiedFactor' => $hasVerifiedFactor,
            // Anything other than a literal true is "not required". The flag is
            // written by setMfaRequired() above as a real boolean, so being
            // strict here means a stray string or a leftover key from some
            // other tool cannot silently impose an obligation.
            'mfaRequiredByAdmin' => $response->json('app_metadata.mfa_required') === true,
        ];
    }

    /**
     * Is the configured Supabase Admin credential actually accepted?
     *
     * Exists because of the 2026-09-03 incident: a rejected service-role
     * credential made every MFA security-state lookup throw, the system failed
     * closed exactly as designed, and the only outward sign was users being
     * told to enrol in two-factor authentication. Nothing failed loudly, and
     * the warnings went to a container-local log file nobody could see. A
     * deploy must be able to answer "can this backend still talk to Supabase
     * as an administrator?" without waiting for a person to hit the symptom.
     *
     * DELIBERATELY LOOKS UP THE NIL UUID. A credential check must not
     * enumerate or read anybody's account, so this asks for a user id that
     * cannot exist. The answer still separates the two cases cleanly, because
     * GoTrue authenticates before it looks anything up:
     *
     *   404 -> the credential was ACCEPTED; there is simply no such user.
     *          This is the success case.
     *   401 -> the credential was rejected. This is the incident.
     *   403 -> authenticated but not authorised for admin operations.
     *
     * Goes through client() rather than building its own request, so it
     * exercises the exact credential, headers and base URL the real MFA lookup
     * uses. A check that assembled its own request could pass while the thing
     * it is meant to protect fails.
     *
     * Returns only a status code and a verdict. The response body is never
     * read, and the key, the Authorization header and the project URL never
     * appear in the return value.
     *
     * @return array{ok: bool, status: int|null, reason: string}
     */
    public function checkAdminCredential(): array
    {
        $nilUuid = '00000000-0000-0000-0000-000000000000';

        try {
            $response = $this->client('checking the Supabase admin credential')
                ->get("/users/{$nilUuid}");
        } catch (RuntimeException $e) {
            // Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. That message is
            // already written for a human and names no value.
            return ['ok' => false, 'status' => null, 'reason' => $e->getMessage()];
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => null, 'reason' => 'Supabase could not be reached.'];
        }

        $status = $response->status();

        if ($status === 404 || $response->successful()) {
            return ['ok' => true, 'status' => $status, 'reason' => 'Credential accepted.'];
        }

        if ($status === 401) {
            return [
                'ok' => false,
                'status' => 401,
                'reason' => 'Supabase rejected the admin credential. If this project has migrated to the new API key system, a legacy service_role JWT will be refused - use the project secret key.',
            ];
        }

        if ($status === 403) {
            return [
                'ok' => false,
                'status' => 403,
                'reason' => 'The credential authenticated but is not authorised for admin operations.',
            ];
        }

        return [
            'ok' => false,
            'status' => $status,
            'reason' => 'Unexpected response from the Supabase Admin API.',
        ];
    }

    /**
     * Drops the cached obligation for one account.
     *
     * Called after either administrator action - clearing factors
     * (UserController::disableTwoFactor) or changing the requirement
     * (setMfaRequired above). Without it, an account would keep being told a
     * second factor is required for up to a full cache TTL after that stopped
     * being true, which is precisely the break-glass case those actions exist
     * to solve.
     */
    public function forgetFactorStatus(string $supabaseUserId): void
    {
        Cache::forget($this->factorStatusCacheKey($supabaseUserId));
    }

    protected function factorStatusCacheKey(string $supabaseUserId): string
    {
        return 'supabase:mfa-verified-factor:'.sha1($supabaseUserId);
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
