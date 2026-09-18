<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\EmailMfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// POST /api/mfa/email/send, POST /api/mfa/email/verify
//
// Both run behind 'auth:supabase' only — never 'supabase.mfa', because they
// are how an aal1 session that owes email MFA gets past that gate — and each
// behind its own 'throttle:' limiter (see AppServiceProvider). Neither takes
// an email address, a user id or a session id from the request: the account
// is the verified token's own user and the session is the token's own signed
// `session_id` claim, so nobody can request or check a code for anybody else.
class EmailMfaController extends Controller
{
    private const INVALID_CODE_MESSAGE = 'The code is invalid or has expired. Request a new code and try again.';

    public function send(Request $request, EmailMfaService $emailMfa): JsonResponse
    {
        if ($refusal = $this->refuseUnlessEmailMfaIsOwed($request, $emailMfa)) {
            return $refusal;
        }

        try {
            $emailMfa->sendCode($request->user(), $request->attributes->get('supabase_session_id'));
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'The verification code could not be sent. Please try again.',
            ], 503);
        }

        return response()->json([
            'message' => 'A verification code has been sent to your email address.',
            'expiresInSeconds' => (int) config('supabase.email_mfa.code_ttl_seconds', 300),
        ], 202);
    }

    public function verify(Request $request, EmailMfaService $emailMfa): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'max:12'],
        ]);

        if ($refusal = $this->refuseUnlessEmailMfaIsOwed($request, $emailMfa)) {
            return $refusal;
        }

        $verified = $emailMfa->verifyCode(
            $request->user(),
            $request->attributes->get('supabase_session_id'),
            trim($validated['code']),
        );

        if (! $verified) {
            return response()->json(['message' => self::INVALID_CODE_MESSAGE], 422);
        }

        return response()->json(['verified' => true]);
    }

    /**
     * The shared preconditions. Returns a response to send instead, or null
     * when this session genuinely owes email MFA and may proceed.
     */
    private function refuseUnlessEmailMfaIsOwed(Request $request, EmailMfaService $emailMfa): ?JsonResponse
    {
        $user = $request->user();
        $sessionId = $request->attributes->get('supabase_session_id');

        // Any verified Supabase session with a session id may owe this —
        // including an aal2 one. For an email_otp account aal2 does not
        // replace the email code (see EnsureSupabaseAal2::
        // handleEmailOtpAccount), so an aal2 session must still be able to
        // request and redeem it.
        if (! in_array($request->attributes->get('supabase_aal'), ['aal1', 'aal2'], true) || ! is_string($sessionId) || $sessionId === '') {
            return response()->json(['message' => 'Email verification is not required for this session.'], 422);
        }

        try {
            $applies = $emailMfa->appliesTo($user);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Two-factor authentication status could not be verified. Please try again.',
            ], 503);
        }

        if (! $applies) {
            return response()->json(['message' => 'Email verification is not required for this session.'], 422);
        }

        // A signed-out or revoked session must not be able to mint or redeem
        // codes with a token that has simply not expired yet.
        if (! $emailMfa->sessionIsLive($request, $user)) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        return null;
    }
}
