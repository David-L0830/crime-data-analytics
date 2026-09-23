<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SupabasePasswordUpdateException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\EnsurePasswordChanged;
use App\Models\User;
use App\Rules\AcceptablePassword;
use App\Services\SupabaseAdminService;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use RuntimeException;

/**
 * POST /api/me/password — the account holder replaces their own password.
 *
 * This is how a temporary password issued by an administrator is replaced, and
 * it is the one application route a `must_change_password` account can use
 * besides GET /user, POST /logout and the email-MFA endpoints (see
 * EnsurePasswordChanged). It is self-service only: it always acts on the
 * caller's own account and there is no user id in the route.
 *
 * Registered behind 'auth:supabase' and 'supabase.mfa' but NOT
 * 'password.changed', so an owed change can be made while every other route is
 * blocked. The two rules of that middleware that still apply here — an expired
 * temporary password, and a session opened before a later password change —
 * are enforced inline, before anything else.
 *
 * The order of checks is deliberate: state that makes a change impossible is
 * reported deterministically before the input is even looked at, and nothing
 * local is written until Supabase Auth has confirmed the new password.
 *
 * Passwords are never stored, logged, audited, returned or placed in an
 * exception message. Supabase Auth remains the only password store.
 */
class PasswordController extends Controller
{
    public function update(Request $request, SupabaseAdminService $supabaseAdmin): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User || ! $user->supabase_user_id) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // Taken before anything else, from the same row every check below
        // reads; step 6 compares against it.
        $issuanceAtStart = self::issuanceState($user);

        // 1. Expired temporary password, or a session opened before the last
        //    password change. Either way this session may not change anything.
        if ($refusal = EnsurePasswordChanged::refusalFor($user, $request, includeMustChange: false)) {
            return $refusal;
        }

        // 2. Recent sign-in. Taken from the signed `amr` timestamps only (see
        //    SupabaseTokenValidator::sessionAuthenticatedAtFromClaims); a
        //    session whose sign-in time cannot be established is refused.
        if (! $this->sessionIsRecent($request)) {
            return response()->json([
                'message' => 'For your security, sign in again before changing your password.',
                'reauthenticationRequired' => true,
            ], 403);
        }

        // 3. Input.
        $validator = Validator::make($request->all(), $this->rules($user), $this->messages());
        if ($validator->fails()) {
            return response()->json([
                'message' => 'Please check the form for errors.',
                'errors' => $validator->errors(),
            ], 422);
        }

        $currentPassword = $request->input('current_password');
        $newPassword = $request->input('password');

        // 4. The current password must really be the current password. This is
        //    what makes "the new password must differ from it" meaningful, and
        //    means a stolen access token alone cannot replace the password.
        try {
            $currentIsCorrect = $supabaseAdmin->verifyPassword($user->email, $currentPassword);
        } catch (RuntimeException) {
            return $this->updateFailed();
        }

        if (! $currentIsCorrect) {
            return response()->json([
                'message' => 'Please check the form for errors.',
                'errors' => ['current_password' => ['The current password is incorrect.']],
            ], 422);
        }

        // 5. Supabase Auth, with no database transaction or row lock held.
        //    Nothing local is written unless Supabase accepted the password.
        $wasTemporary = (bool) $user->must_change_password;
        $changedAt = now();

        try {
            $supabaseAdmin->setPassword($user->supabase_user_id, $newPassword);
        } catch (RuntimeException $e) {
            if ($e instanceof SupabasePasswordUpdateException && $e->isWeakPassword()) {
                return response()->json([
                    'message' => 'Please check the form for errors.',
                    'errors' => ['password' => ['That password was rejected. Choose a longer, less predictable password.']],
                ], 422);
            }

            return $this->updateFailed();
        }

        // 6. The local record, under a row lock, and only if no administrator
        //    has issued a temporary password since this request began (see
        //    issuanceState()). Otherwise Supabase may now hold the
        //    administrator's password, and clearing the requirement would
        //    open the account with it.
        $persist = function () use ($user, $request, $wasTemporary, $changedAt, $issuanceAtStart): ?JsonResponse {
            $row = User::whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            if (self::issuanceState($row) !== $issuanceAtStart) {
                return $this->supersededByReissue($user);
            }

            // The temporary password lapsed while this change was in flight.
            // Fail closed: it stays expired, and an administrator reissues.
            if ($row->temporaryPasswordExpired()) {
                return EnsurePasswordChanged::temporaryPasswordExpired();
            }

            $row->forceFill([
                'must_change_password' => false,
                'temporary_password_expires_at' => null,
                'password_changed_at' => $changedAt,
            ])->save();

            Audit::record([
                'user_id' => $user->id,
                'action' => 'UPDATE',
                'module' => 'auth',
                'target_type' => 'auth',
                'description' => $wasTemporary
                    ? 'Replaced temporary password'
                    : 'Changed password',
                'ip_address' => $request->ip(),
            ]);

            return null;
        };

        try {
            $refusal = DB::transaction($persist);
        } catch (\Throwable) {
            return $this->recoverAfterSupabaseChange($user, $persist);
        }

        if ($refusal !== null) {
            return $refusal;
        }

        // Every session established before this moment — including the one
        // making this request — is now refused by EnsurePasswordChanged, so a
        // fresh sign-in with the new password is required.
        return response()->json([
            'message' => 'Your password has been changed. Sign in again with your new password.',
            'passwordChanged' => true,
            'reauthenticationRequired' => true,
        ]);
    }

    private function sessionIsRecent(Request $request): bool
    {
        $authenticatedAt = $request->attributes->get('supabase_session_authenticated_at');

        if (! is_int($authenticatedAt)) {
            return false;
        }

        $now = now()->getTimestamp();

        // A sign-in time meaningfully in the future is not a real sign-in time;
        // a minute absorbs clock skew between Supabase and this server.
        if ($authenticatedAt > $now + 60) {
            return false;
        }

        return ($now - $authenticatedAt) <= User::PASSWORD_CHANGE_RECENT_AUTH_SECONDS;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    private function rules(User $user): array
    {
        return [
            'current_password' => ['required', 'string'],
            'password' => [
                'required',
                'string',
                'min:'.User::TEMPORARY_PASSWORD_MIN_LENGTH,
                new AcceptablePassword('the new password', $user->username, $user->email),
                'confirmed',
                'different:current_password',
            ],
        ];
    }

    /**
     * Fixed sentences only: no message ever contains a submitted value.
     *
     * @return array<string, string>
     */
    private function messages(): array
    {
        return [
            'current_password.required' => 'Enter your current password.',
            'current_password.string' => 'The current password must be text.',
            'password.required' => 'Enter a new password.',
            'password.string' => 'The new password must be text.',
            'password.min' => 'The new password must be at least '.User::TEMPORARY_PASSWORD_MIN_LENGTH.' characters.',
            'password.confirmed' => 'The new password and its confirmation do not match.',
            'password.different' => 'The new password must be different from your current password.',
        ];
    }

    /**
     * Supabase Auth now holds the new password, but recording the change
     * locally failed and was rolled back. Supabase and this database are not
     * one transaction, so the password change cannot be undone.
     *
     * The local write is idempotent, so it is retried once. If that also fails
     * the account is left exactly as it was (still owing a change, which keeps
     * every session blocked) and the person is told the truth: their NEW
     * password is the one that works, and completing the change again with it
     * as the current password finishes the job. Logged with the account id
     * only.
     */
    private function recoverAfterSupabaseChange(User $user, \Closure $persist): JsonResponse
    {
        try {
            if ($refusal = DB::transaction($persist)) {
                return $refusal;
            }

            return response()->json([
                'message' => 'Your password has been changed. Sign in again with your new password.',
                'passwordChanged' => true,
                'reauthenticationRequired' => true,
            ]);
        } catch (\Throwable $e) {
            Log::error('Supabase password was changed, but the local account state could not be saved.', [
                'user_id' => $user->id,
                'exception' => $e::class,
            ]);

            return response()->json([
                'message' => 'Your password was changed, but CDARS could not finish updating your account. Sign in with your new password and complete the change again.',
                'passwordChangedPendingSync' => true,
            ], 503);
        }
    }

    /**
     * The temporary-password fields as they stand. Every administrator
     * issuance changes at least one of them in its first committed write (an
     * unflagged account becomes flagged; a pending one gets an expiry of "now",
     * which no pending expiry can equal), so a difference between the start of
     * a change and its final write means an issuance began in between.
     *
     * @return array{0: bool, 1: int|null, 2: int|null}
     */
    private static function issuanceState(User $user): array
    {
        return [
            (bool) $user->must_change_password,
            $user->temporary_password_expires_at?->getTimestamp(),
            $user->temporary_password_issued_by === null ? null : (int) $user->temporary_password_issued_by,
        ];
    }

    /**
     * An administrator issued a temporary password while this change was in
     * flight. The two Supabase updates may have landed in either order, so the
     * requirement is left in place and this session is ended; the account
     * holder signs in with the temporary password their administrator gives
     * them. Logged with the account id only.
     */
    private function supersededByReissue(User $user): JsonResponse
    {
        Log::warning('A password change was not recorded because a temporary password was issued while it was in progress.', [
            'user_id' => $user->id,
        ]);

        return response()->json([
            'message' => 'An administrator issued a new temporary password for this account while your change was in progress, so your change was not completed. Sign in with the temporary password from your Administrator.',
            'reauthenticationRequired' => true,
        ], 409);
    }

    private function updateFailed(): JsonResponse
    {
        return response()->json([
            'message' => 'Your password could not be changed right now. Please try again in a moment.',
            'passwordUpdateFailed' => true,
        ], 503);
    }
}
