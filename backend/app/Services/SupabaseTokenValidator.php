<?php

namespace App\Services;

use App\Models\User;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Firebase\JWT\SignatureInvalidException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use UnexpectedValueException;

// Validates a Supabase Auth access token (JWT) and resolves it to an
// existing local Laravel `User`. This is the sole implementation backing
// the 'supabase' auth guard (registered in AppServiceProvider::boot() via
// Auth::viaRequest) that every protected route in routes/api.php uses.
// Laravel Sanctum has been fully removed from this application (see
// AUTH_MIGRATION_STATUS.md / composer.json) — there is no other guard or
// session-based authentication path left for this class to coexist with.
//
// Verification strategy (per migration spec Section 5 — "do not simply
// decode a JWT and trust its payload"):
//   1. Preferred: verify against the project's JWKS (asymmetric RS256/ES256
//      "JWT signing keys" — the current Supabase default). Keys are fetched
//      from {SUPABASE_URL}/auth/v1/.well-known/jwks.json and cached.
//   2. Fallback: if SUPABASE_JWT_SECRET is configured (legacy HS256
//      projects), verify against that shared secret instead.
// Either path also checks `exp` (handled by firebase/php-jwt itself),
// `aud` === 'authenticated', and `iss` matches the configured project URL.
class SupabaseTokenValidator
{
    /**
     * Validate the bearer token on the given request and return the
     * matching local User, or null if the token is missing, invalid, or
     * does not correspond to an existing application account.
     *
     * Deliberately never creates a new User — this application has no
     * self-registration; every account is admin-provisioned (see
     * database/seeders/UserSeeder.php) and must exist in this table before
     * its matching Supabase Auth user can ever sign in.
     */
    public function resolveUser(Request $request): ?User
    {
        $token = $this->extractBearerToken($request);
        if (! $token) {
            return null;
        }

        try {
            $claims = $this->verify($token);
        } catch (\Throwable $e) {
            Log::info('Supabase token validation failed.', ['reason' => $e->getMessage()]);

            return null;
        }

        $user = $this->mapClaimsToUser($claims);

        if ($user) {
            // Checkpoint 6 — Supabase MFA coexistence. `aal` ("aal1"/"aal2")
            // is a required, undroppable claim on every Supabase access
            // token — see https://supabase.com/docs/guides/auth/jwt-fields —
            // so it's available here with no extra verification step beyond
            // the signature check verify() already performed above. Stashed
            // on the *request*, not the User model: this is a per-session
            // fact ("did *this* token's session complete a second factor"),
            // never a durable property of the account. Anything downstream
            // that needs to know whether this Supabase session completed
            // MFA (UserResource, the EnsureSupabaseAal2 middleware) reads
            // this attribute — never anything client-controlled. If the
            // claim is ever absent, treat that as the least-privileged
            // state (aal1) rather than assuming aal2.
            $request->attributes->set('supabase_aal', $claims['aal'] ?? 'aal1');

            // When did this session's holder actually authenticate? Read by
            // AuthController::user() to write a LOGIN audit row exactly once
            // per sign-in. Stashed on the request for the same reason as
            // `aal` above: it is a per-token fact, never a property of the
            // account.
            $request->attributes->set('supabase_auth_time', $this->authTimeFromClaims($claims));
        }

        return $user;
    }

    /**
     * The moment the token holder actually authenticated, as a Unix timestamp.
     *
     * Prefers `amr` (Authentication Methods References), whose entries record
     * when an authentication METHOD was performed — e.g.
     * [{"method":"password","timestamp":1735815600}]. That timestamp is set at
     * sign-in and is not re-stamped when the session's access token is
     * refreshed.
     *
     * `iat` is only a fallback, and deliberately not the primary source:
     * supabaseClient.js runs with autoRefreshToken enabled, so an active
     * session mints a brand-new token — and therefore a brand-new `iat` —
     * roughly every hour. Keying "is this a fresh sign-in?" on `iat` alone
     * would invent a LOGIN event after every silent refresh, which is worse
     * for an audit trail than recording nothing at all.
     */
    protected function authTimeFromClaims(array $claims): ?int
    {
        $amr = $claims['amr'] ?? null;

        if (is_array($amr)) {
            foreach ($amr as $entry) {
                $timestamp = is_array($entry) ? ($entry['timestamp'] ?? null) : null;
                if (is_numeric($timestamp)) {
                    return (int) $timestamp;
                }
            }
        }

        return is_numeric($claims['iat'] ?? null) ? (int) $claims['iat'] : null;
    }

    protected function extractBearerToken(Request $request): ?string
    {
        $header = $request->header('Authorization', '');
        if (! str_starts_with($header, 'Bearer ')) {
            return null;
        }

        $token = trim(substr($header, 7));

        return $token !== '' ? $token : null;
    }

    /**
     * @return array<string, mixed> decoded claims
     *
     * @throws UnexpectedValueException|SignatureInvalidException|ExpiredException
     */
    protected function verify(string $token): array
    {
        $projectUrl = rtrim((string) config('supabase.url'), '/');
        if ($projectUrl === '') {
            throw new UnexpectedValueException('SUPABASE_URL is not configured.');
        }

        $decoded = $this->verifyViaJwks($token, $projectUrl);

        if ($decoded === null) {
            $decoded = $this->verifyViaSharedSecret($token);
        }

        if ($decoded === null) {
            throw new UnexpectedValueException('No verification method succeeded for this token.');
        }

        $claims = (array) $decoded;

        if (($claims['aud'] ?? null) !== config('supabase.audience', 'authenticated')) {
            throw new UnexpectedValueException('Unexpected audience claim.');
        }

        // Supabase issuers look like {SUPABASE_URL}/auth/v1
        $expectedIssuer = $projectUrl.'/auth/v1';
        if (($claims['iss'] ?? null) !== $expectedIssuer) {
            throw new UnexpectedValueException('Unexpected issuer claim.');
        }

        return $claims;
    }

    /**
     * @return array<string, mixed>|null
     */
    protected function verifyViaJwks(string $token, string $projectUrl): ?array
    {
        $jwksUrl = $projectUrl.'/auth/v1/.well-known/jwks.json';

        $cacheKey = 'supabase:jwks:'.md5($jwksUrl);

        try {
            $jwks = Cache::remember($cacheKey, config('supabase.jwks_cache_ttl', 3600), function () use ($jwksUrl) {
                $response = Http::timeout(5)->get($jwksUrl);

                return $response->successful() ? $response->json() : null;
            });
        } catch (\Throwable $e) {
            // Http::get() throws (rather than returning a failed response)
            // on a connection-level failure: unreachable host, DNS failure,
            // timeout, TLS error, etc. This must fall through to the
            // shared-secret path below, same as "JWKS returned no keys"
            // does — not abort verification entirely.
            Log::debug('Supabase JWKS endpoint unreachable.', ['reason' => $e->getMessage()]);

            return null;
        }

        if (! $jwks || empty($jwks['keys'])) {
            return null;
        }

        try {
            $keys = JWK::parseKeySet($jwks);
            $decoded = JWT::decode($token, $keys);

            return (array) $decoded;
        } catch (\Throwable $e) {
            // Falls through to the shared-secret path (if configured) or
            // ultimately fails verification in verify().
            Log::debug('Supabase JWKS verification did not succeed.', ['reason' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    protected function verifyViaSharedSecret(string $token): ?array
    {
        $secret = config('supabase.jwt_secret');
        if (! $secret) {
            return null;
        }

        $decoded = JWT::decode($token, new Key($secret, 'HS256'));

        return (array) $decoded;
    }

    /**
     * Map validated claims to an existing local User. Preference order:
     *   1. Already-linked supabase_user_id (fast path, most requests).
     *   2. Verified email match -> link supabase_user_id to that account
     *      (the first time an admin-provisioned account signs in through
     *      Supabase — email/password or Google — this is what links it).
     * Never creates a new account.
     */
    protected function mapClaimsToUser(array $claims): ?User
    {
        $supabaseUserId = $claims['sub'] ?? null;
        if (! $supabaseUserId) {
            return null;
        }

        $user = User::where('supabase_user_id', $supabaseUserId)->first();
        if ($user) {
            return $user->is_active ? $user : null;
        }

        // Supabase's own `email_verified` claim is what makes this safe:
        // Supabase itself attests the token holder controls that mailbox
        // (via its own signup/verification flow, or the upstream OAuth
        // provider's verified email for Google sign-in), so linking by
        // email here is only ever done once Supabase has already confirmed
        // that ownership — never on an unverified claim.
        $email = $claims['email'] ?? null;
        $emailVerified = $claims['email_verified'] ?? ($claims['user_metadata']['email_verified'] ?? false);

        if (! $email || ! $emailVerified) {
            return null;
        }

        $user = User::whereRaw('lower(email) = ?', [strtolower($email)])->first();
        if (! $user || ! $user->is_active) {
            return null;
        }

        $user->forceFill(['supabase_user_id' => $supabaseUserId])->save();

        return $user;
    }
}
