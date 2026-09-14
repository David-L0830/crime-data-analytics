<?php

namespace App\Http\Middleware;

use App\Services\EmailMfaService;
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
//   0. EXCEPTION, checked before 2: an account explicitly configured for
//      email MFA (users.mfa_method = 'email_otp') follows its own rule — see
//      handleEmailOtpAccount(). If it owes a second factor, its session must
//      be `email_mfa_verified` whatever the JWT `aal` says (so a genuine aal2
//      token from a self-enrolled authenticator is not enough), plus aal2 if
//      it also holds a verified factor. Unverified gets
//      {mfaRequired: true, mfaMethod: 'email_otp'}. `email_mfa_verified` is an
//      application-level state, never Supabase aal2.
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

        // Accounts explicitly configured for email MFA are decided entirely by
        // their own rule, and that rule runs BEFORE the aal2 short-circuit
        // below. It has to: a password-only attacker can enrol a TOTP factor
        // of their own at aal1 (Supabase permits a first enrolment there) and
        // receive a genuine aal2 token, so for these accounts aal2 alone must
        // never be enough. Every other account skips this line and runs the
        // unchanged logic that follows.
        if ($request->user()?->usesEmailOtpMfa()) {
            return $this->handleEmailOtpAccount($request, $next);
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

    /**
     * The rule for an account with users.mfa_method = 'email_otp'.
     *
     * The configured method IS the obligation (see EmailMfaService::appliesTo):
     * it does not depend on Supabase's `mfa_required` flag, so no
     * authenticator administration action can turn it off. The request is
     * admitted only if:
     *
     *   1. this token's session is `email_mfa_verified` — a server-side
     *      verification row for its signed session_id, confirmed live with
     *      GoTrue — REGARDLESS of the JWT's `aal`; and
     *   2. if the account also holds a verified Supabase factor, the token is
     *      genuinely aal2 as well.
     *
     * Both, never either. A genuine aal2 token cannot stand in for the email
     * code (a self-enrolled authenticator would otherwise defeat it), and the
     * email code cannot stand in for an enrolled authenticator. An attacker
     * who enrols a factor therefore only ADDS a requirement; the email code
     * for their own session is still owed. The JWT is read, never altered.
     */
    private function handleEmailOtpAccount(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user->supabase_user_id) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $emailMfa = app(EmailMfaService::class);

        try {
            $hasVerifiedFactor = app(SupabaseAdminService::class)->hasVerifiedFactor($user->supabase_user_id);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Two-factor authentication status could not be verified. Please try again.',
            ], 401);
        }

        // Deliberately no "nothing owed" exit here: an email_otp account always
        // owes the email code, whatever Supabase's mfa_required flag says.
        if (! $emailMfa->isSessionVerified($request, $user)) {
            return response()->json([
                'mfaRequired' => true,
                'mfaMethod' => 'email_otp',
                'message' => 'This action requires a completed second-factor sign-in.',
            ], 401);
        }

        if ($hasVerifiedFactor && $request->attributes->get('supabase_aal') !== 'aal2') {
            return response()->json([
                'mfaRequired' => true,
                'message' => 'This action requires a completed second-factor sign-in.',
            ], 401);
        }

        $request->attributes->set('email_mfa_verified', true);

        return $next($request);
    }
}
