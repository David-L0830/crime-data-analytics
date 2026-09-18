<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// 'password.changed' — blocks normal application access for an account that
// still owes a password change, and for sessions opened before a change.
//
// WHERE IT RUNS
//
// On every protected route group in routes/api.php, listed immediately after
// 'supabase.mfa'. Route middleware runs in the order listed, so an account
// that owes BOTH a second factor and a password change is told about the
// second factor first: the existing sign-in flow is completed before this
// requirement is raised, and MFA behaviour is unchanged.
//
// It is deliberately NOT on the handful of routes the forced-change flow itself
// needs, all of which already sit outside the 'supabase.mfa' groups or are
// registered on their own:
//
//   GET  /user              who am I, and what do I still owe (UserResource)
//   POST /logout            ending the session must always be possible
//   POST /mfa/email/send    completing email MFA, which comes first
//   POST /mfa/email/verify
//   POST /me/password       the change itself (PasswordController enforces
//                           the same expiry and stale-session rules inline)
//
// A test walks the entire route table and fails if any other authenticated
// route lacks this middleware (see PasswordChangeEnforcementTest), so a route
// added later cannot silently escape it.
//
// THE RULES, in order
//
//   1. must_change_password and the temporary password has expired
//        -> 403 {passwordChangeRequired: true, temporaryPasswordExpired: true}
//   2. must_change_password
//        -> 403 {passwordChangeRequired: true}
//   3. the session was established before the last password change (or its
//      establishment time is unknown while a change is on record)
//        -> 403 {reauthenticationRequired: true}
//   4. otherwise -> continue
//
// Accounts that have never been issued a temporary password and never changed
// their password here satisfy none of 1–3, so existing users are unaffected.
class EnsurePasswordChanged
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($refusal = self::refusalFor($user, $request)) {
            return $refusal;
        }

        return $next($request);
    }

    /**
     * The refusal this user's current state calls for, or null when normal
     * access is allowed. Shared with PasswordController, which must apply the
     * expiry and stale-session rules without the "must change" rule.
     */
    public static function refusalFor(User $user, Request $request, bool $includeMustChange = true): ?JsonResponse
    {
        if ($user->temporaryPasswordExpired()) {
            return self::temporaryPasswordExpired();
        }

        if ($includeMustChange && $user->must_change_password) {
            return response()->json([
                'message' => 'Your temporary password must be changed before you can continue.',
                'passwordChangeRequired' => true,
            ], 403);
        }

        $sessionAuthenticatedAt = $request->attributes->get('supabase_session_authenticated_at');

        if ($user->sessionPredatesPasswordChange(is_int($sessionAuthenticatedAt) ? $sessionAuthenticatedAt : null)) {
            return response()->json([
                'message' => 'Your password was changed. Please sign in again.',
                'reauthenticationRequired' => true,
            ], 403);
        }

        return null;
    }

    public static function temporaryPasswordExpired(): JsonResponse
    {
        return response()->json([
            'message' => 'Your temporary password has expired. Contact your BADAC Administrator to be issued a new one.',
            'passwordChangeRequired' => true,
            'temporaryPasswordExpired' => true,
        ], 403);
    }
}
