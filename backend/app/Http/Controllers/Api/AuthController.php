<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use Carbon\Carbon;
use Illuminate\Http\Request;

// Final auth migration — Supabase Auth is the only credential system this
// application has. AuthController no longer authenticates anyone itself
// (there is no more login()/password check/session start here — see
// AUTH_MIGRATION_STATUS.md); it only ever runs AFTER
// App\Services\SupabaseTokenValidator has already verified a Supabase JWT
// and resolved it to a local User (see the 'supabase' guard in
// AppServiceProvider::boot() and the 'auth:supabase' middleware in
// routes/api.php). Every method below assumes $request->user() is already
// populated by that guard.
class AuthController extends Controller
{
    // POST /api/logout
    // Stateless by design: there is no Laravel session or Sanctum token to
    // invalidate anymore. The actual sign-out (ending the Supabase session,
    // clearing the client's stored Supabase JWT) happens entirely on the
    // frontend via supabase.auth.signOut() — see AuthContext.jsx. This
    // endpoint's only remaining job is writing the audit trail entry while
    // the caller's token is still verifiably valid.
    public function logout(Request $request)
    {
        $user = $request->user();

        if ($user) {
            AuditLog::create([
                'user_id' => $user->id,
                'action' => 'LOGOUT',
                'module' => 'auth',
                'target_type' => 'auth',
                'description' => 'User signed out',
                'ip_address' => $request->ip(),
            ]);
        }

        return response()->json(['message' => 'Logged out.']);
    }

    // How long after the authentication instant this endpoint will still
    // record a LOGIN. Sized to absorb a Render free-tier cold start (~40s
    // observed) plus clock skew between Supabase's issuer and this container,
    // while staying an order of magnitude below the 3600s access-token
    // lifetime so it can never straddle a refresh boundary. Its second job is
    // to stop the first deploy back-filling LOGIN rows for sessions that were
    // already long-running.
    private const LOGIN_AUDIT_WINDOW_SECONDS = 300;

    // GET /api/user
    public function user(Request $request)
    {
        $this->recordLoginIfFreshSignIn($request);

        return new UserResource($request->user());
    }

    /**
     * Writes a LOGIN audit row on a genuinely fresh sign-in.
     *
     * Sign-in itself happens entirely in Supabase on the frontend, so this
     * endpoint — the first authenticated call the app makes after
     * signInWithPassword resolves — is the only place Laravel ever observes
     * one. Before this, the audit trail recorded LOGOUT but never LOGIN.
     *
     * Two conditions must both hold, and neither is a rolling time debounce:
     *
     *  1. The authentication instant (see
     *     SupabaseTokenValidator::authTimeFromClaims — `amr` first, `iat` only
     *     as a fallback) is within LOGIN_AUDIT_WINDOW_SECONDS.
     *  2. No LOGIN row for this user exists at or after that instant.
     *
     * Because the authentication instant is constant for the whole session,
     * condition 2 means precisely "this sign-in has not been recorded yet" —
     * so repeated /api/user calls, browser refreshes and silent token
     * refreshes all collapse to a single row. The query filters on `user_id`,
     * `action` and `created_at`, and the audit_logs migration already indexes
     * both `action` and `created_at`, so no schema change is needed.
     */
    private function recordLoginIfFreshSignIn(Request $request): void
    {
        $user = $request->user();
        $authTime = $request->attributes->get('supabase_auth_time');

        if (! $user || ! is_int($authTime)) {
            return;
        }

        if ((time() - $authTime) > self::LOGIN_AUDIT_WINDOW_SECONDS) {
            return;
        }

        $alreadyRecorded = AuditLog::query()
            ->where('user_id', $user->id)
            ->where('action', 'LOGIN')
            ->where('created_at', '>=', Carbon::createFromTimestamp($authTime))
            ->exists();

        if ($alreadyRecorded) {
            return;
        }

        AuditLog::create([
            'user_id' => $user->id,
            'action' => 'LOGIN',
            'module' => 'auth',
            'target_type' => 'auth',
            'description' => 'User signed in',
            'ip_address' => $request->ip(),
        ]);
    }
}
