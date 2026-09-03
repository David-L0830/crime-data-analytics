<?php

namespace App\Http\Middleware;

use App\Services\SupabaseAdminService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// Login-time enforcement of Supabase MFA.
//
// Gates a route on the current Supabase session's verified `aal` claim. The
// only source of truth this middleware ever reads for that claim is the
// 'supabase_aal' request attribute set by
// SupabaseTokenValidator::resolveUser() *after* it has already verified the
// JWT's signature, audience, and issuer — nothing here is derived from
// anything client-controlled (no request body field, no header Laravel didn't
// itself put there, and obviously nothing from React state or localStorage,
// which never reach the backend at all).
//
// WHY THIS IS ADAPTIVE RATHER THAN "aal2 OR NOTHING"
// --------------------------------------------------
// Requiring aal2 unconditionally would lock out every account that has not
// enrolled an authenticator, which today is nearly all of them. Supabase's own
// model is that a session's REQUIRED level is a property of the account: an
// account with no verified factor can never exceed aal1, so demanding aal2
// from it is not a stricter policy, it is a permanent denial.
//
// So the rule is the one Supabase documents for its own RLS policies — aal2 is
// required exactly when the account has a verified factor to satisfy it with:
//
//   1. No 'supabase_aal' attribute -> 401, unconditionally, regardless of
//      whether $request->user() happens to be set. We cannot know the caller's
//      assurance level, so we must not assume it is sufficient. (This is the
//      Checkpoint 6C fail-closed fix and is deliberately kept.)
//   2. 'supabase_aal' === 'aal2' -> allow, with no further work. This is the
//      first branch checked for a reason: an already-verified session never
//      touches the network, so the enrolled accounts this feature exists for
//      pay no per-request cost at all.
//   3. 'aal1' and the account has NO verified factor -> allow. Unchanged
//      behaviour for everyone who has not enrolled.
//   4. 'aal1' and the account HAS a verified factor -> 401 with a
//      distinguishable {mfaRequired: true} body, so the frontend can route to
//      the step-up challenge instead of showing a generic auth failure (see
//      src/services/api.js, which turns this into type 'mfa_required').
//
// FAIL-CLOSED ON AN UNANSWERABLE LOOKUP
// -------------------------------------
// Step 3/4 needs an answer Supabase alone holds — there is no "enrolled
// factors" JWT claim — so it asks the Admin API (cached; see
// SupabaseAdminService::hasVerifiedFactor). If that lookup cannot be
// completed, this denies the request rather than allowing it. Allowing would
// mean a Supabase outage silently switches MFA enforcement off for exactly the
// accounts it protects, which is the failure mode this whole change exists to
// remove. The availability cost is close to nil: Supabase Auth is already a
// hard dependency of signing in at all, so if it is unreachable, nobody is
// obtaining a session either way.
//
// Which routes carry this: every protected route in routes/api.php except
// GET /user and POST /logout, both of which must stay reachable at aal1 —
// see the comment on those two routes for why.
class EnsureSupabaseAal2
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->attributes->has('supabase_aal')) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($request->attributes->get('supabase_aal') === 'aal2') {
            return $next($request);
        }

        $supabaseUserId = $request->user()?->supabase_user_id;

        // An authenticated request always has one — SupabaseTokenValidator
        // resolves the user FROM the token's `sub` and links it. Its absence
        // would mean the user was populated some other way, which is the same
        // "we cannot establish this caller's standing" case as branch 1.
        if (! $supabaseUserId) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        try {
            // Two ways an account can owe a second factor, and this asks about
            // both in one call: it has enrolled a verified factor, or an
            // administrator has required one of it (see
            // SupabaseAdminService::requiresAal2). The second case is the one
            // that has no factor to challenge yet — such a session is still
            // refused here, and the frontend answers the refusal by putting
            // the person through enrolment before letting them in, rather than
            // by letting them past.
            $requiresAal2 = app(SupabaseAdminService::class)
                ->requiresAal2($supabaseUserId);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Two-factor authentication status could not be verified. Please try again.',
            ], 401);
        }

        if (! $requiresAal2) {
            return $next($request);
        }

        return response()->json([
            'mfaRequired' => true,
            'message' => 'This action requires a completed second-factor sign-in.',
        ], 401);
    }
}
