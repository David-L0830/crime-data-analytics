<?php

namespace App\Services;

use App\Jobs\SendEmailMfaCode;
use App\Models\EmailMfaChallenge;
use App\Models\EmailMfaFailureWindow;
use App\Models\EmailMfaVerifiedSession;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

// Email one-time-code MFA — an application-level second factor for accounts
// EXPLICITLY configured with users.mfa_method = 'email_otp'.
//
// WHAT THIS IS, AND WHAT IT IS NOT
// --------------------------------
// It is not Supabase MFA and it never produces Supabase aal2. The signed JWT
// `aal` claim is left exactly as Supabase issued it (aal1). What this adds is
// a separate, server-side fact — `email_mfa_verified` — that EnsureSupabaseAal2
// accepts IN PLACE of aal2 only for accounts configured for it, and only when
// all of the following hold on the request being authorised:
//
//   1. the Supabase access token verified (signature, exp, aud, iss) — the
//      'supabase' guard has already done this before anything here runs;
//   2. a verification row exists for this user AND this token's signed
//      `session_id` claim, and has not expired;
//   3. GoTrue still recognises that session right now (sessionIsLive), so a
//      signed-out, globally revoked, or password-reset-revoked session cannot
//      keep using a verification recorded before it ended.
//
// It is a deliberately weaker factor than TOTP: whoever controls the mailbox
// can both reset the password and receive the code. That trade-off was
// accepted explicitly for this account. It is also why appliesTo() refuses
// email MFA for any account that has a verified TOTP factor — email must never
// become a way around an authenticator somebody actually enrolled.
//
// THE CODE ITSELF
// ---------------
// 6 digits from random_int() (CSPRNG). Stored only as an HMAC-SHA256 keyed
// from APP_KEY over "user id | session id | code", so a leaked table cannot be
// brute-forced offline without the application key, and a hash is meaningless
// for any other user or session. Compared with hash_equals(). Never logged,
// never returned, never placed in a URL: it exists in plaintext only in memory
// between generation and the mail being handed to the mailer.
class EmailMfaService
{
    /**
     * Does THIS account owe the email code?
     *
     * Exactly when users.mfa_method = 'email_otp' (and the account is linked
     * to a Supabase identity, without which it cannot authenticate at all).
     * Nothing Supabase records can switch it off:
     *
     *   - Not `app_metadata.mfa_required`. The administrator actions that
     *     write that flag — "Require 2FA", "Cancel 2FA Requirement" and
     *     "Clear 2FA" (UserController::requireTwoFactor/disableTwoFactor) —
     *     manage the AUTHENTICATOR APP requirement, as their UI says. If the
     *     email obligation followed that flag, "Clear 2FA" used to recover an
     *     account from an attacker's self-enrolled authenticator would also
     *     silently remove email MFA and let that attacker in with only the
     *     password.
     *   - Not a verified TOTP factor. Supabase lets a first factor be enrolled
     *     at aal1, so a password holder could otherwise enrol their own and
     *     turn email off. A factor ADDS the aal2 requirement on top of the
     *     email code (see EnsureSupabaseAal2::handleEmailOtpAccount); it never
     *     replaces it.
     *
     * Removing email MFA from an account therefore means changing its
     * mfa_method — a deliberate act, not a side effect of authenticator
     * administration.
     */
    public function appliesTo(User $user): bool
    {
        return $user->usesEmailOtpMfa() && (bool) $user->supabase_user_id;
    }

    /**
     * Has the Supabase session behind this request completed email MFA?
     *
     * Fails closed on everything: no session id, no row, an expired row, or a
     * session GoTrue no longer recognises.
     */
    public function isSessionVerified(Request $request, User $user): bool
    {
        $sessionId = $request->attributes->get('supabase_session_id');

        if (! is_string($sessionId) || $sessionId === '') {
            return false;
        }

        $verified = EmailMfaVerifiedSession::query()
            ->where('user_id', $user->id)
            ->where('supabase_session_id', $sessionId)
            ->where('expires_at', '>', now())
            ->exists();

        // Cheap database check first; the network check only runs for a
        // session that would otherwise be admitted.
        return $verified && $this->sessionIsLive($request, $user);
    }

    /**
     * Does GoTrue still recognise the session this access token belongs to?
     *
     * A Supabase access token stays cryptographically valid until `exp` even
     * after its session is signed out or revoked. GoTrue's own GET /user
     * answers 403 session_not_found for such a token, so asking it is what
     * stops a revoked session from riding a verification it earned earlier.
     * Called with the caller's OWN token — this reads nobody else's account.
     */
    public function sessionIsLive(Request $request, User $user): bool
    {
        $token = $request->bearerToken();
        $url = rtrim((string) config('supabase.url'), '/');

        if (! $token || $url === '' || ! $user->supabase_user_id) {
            return false;
        }

        try {
            $response = Http::timeout(5)
                ->withHeaders([
                    // The API gateway requires an apikey header; the session
                    // being checked is the one in Authorization.
                    'apikey' => (string) config('supabase.service_role_key'),
                    'Authorization' => 'Bearer '.$token,
                ])
                ->get($url.'/auth/v1/user');
        } catch (\Throwable $e) {
            Log::warning('Email MFA: could not reach Supabase to confirm the session is still active.');

            return false;
        }

        return $response->successful()
            && $response->json('id') === $user->supabase_user_id;
    }

    /**
     * Issues a fresh code for this user + session and queues it for delivery.
     *
     * Replaces any earlier challenge for the same session (one active code per
     * session), and prunes this user's expired or consumed rows.
     *
     * Delivery is a SendEmailMfaCode job on the 'notifications' queue, so with
     * QUEUE_CONNECTION=redis this returns as soon as the job is queued and the
     * notifications worker sends the mail; a job that finally fails removes
     * its own challenge (SendEmailMfaCode::failed). On the `sync` connection
     * the job runs right here, and a send failure is thrown back into this
     * method exactly as the inline send used to be.
     *
     * @throws RuntimeException when mail is not safely deliverable, or the job
     *                          could not be queued or (on `sync`) sent — the
     *                          challenge is removed in that case, so no un-sent
     *                          code is left enterable
     */
    public function sendCode(User $user, string $sessionId): void
    {
        $this->assertMailerDoesNotLogMessages();
        $this->pruneFor($user);

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $ttl = (int) config('supabase.email_mfa.code_ttl_seconds', 300);
        $expiresAt = now()->addSeconds($ttl);

        $challenge = EmailMfaChallenge::updateOrCreate(
            ['user_id' => $user->id, 'supabase_session_id' => $sessionId],
            [
                'code_hash' => $this->hashCode($user, $sessionId, $code),
                'attempts' => 0,
                'expires_at' => $expiresAt,
                'consumed_at' => null,
            ],
        );

        try {
            // Bus::dispatch, not the dispatch() helper: the helper queues from
            // a destructor, after this try block has already been left.
            Bus::dispatch(new SendEmailMfaCode($challenge->id, $code, intdiv($ttl, 60), $expiresAt));
        } catch (\Throwable $e) {
            $challenge->delete();

            // The exception message is not logged: transport errors can echo
            // parts of the message they were handed.
            Log::warning('Email MFA: the verification email could not be sent.', [
                'user_id' => $user->id,
                'exception' => $e::class,
            ]);

            throw new RuntimeException('The verification code could not be sent.');
        }
    }

    /**
     * Checks a submitted code. On success the challenge is consumed and this
     * session is recorded as email-MFA verified.
     *
     * Returns a bare boolean on purpose: wrong, expired, already used, locked
     * out and never-sent are indistinguishable to the caller, so the endpoint
     * built on this cannot become an oracle for any of them.
     */
    public function verifyCode(User $user, string $sessionId, string $code): bool
    {
        $maxAttempts = (int) config('supabase.email_mfa.max_attempts', 5);

        return DB::transaction(function () use ($user, $sessionId, $code, $maxAttempts) {
            // Row lock: two concurrent submissions of the same correct code
            // serialise here, and only the first finds it unconsumed.
            $challenge = EmailMfaChallenge::query()
                ->where('user_id', $user->id)
                ->where('supabase_session_id', $sessionId)
                ->lockForUpdate()
                ->first();

            if (! $challenge
                || $challenge->consumed_at !== null
                || $challenge->expires_at->isPast()
                || $challenge->attempts >= $maxAttempts) {
                return false;
            }

            // The cumulative budget, locked SECOND — always after the
            // challenge, so every path through this method takes the two row
            // locks in the same order and concurrent verifications cannot
            // deadlock against each other.
            $window = $this->lockFailureWindow($user);

            // Out of budget. Deliberately checked BEFORE the code is compared,
            // so a correct code cannot spend its way past a lockout, and
            // returned as the same bare false as every other refusal: the
            // caller cannot tell a wrong code from an exhausted budget. The
            // per-code attempt counter is left alone, so being locked out does
            // not also burn the challenge.
            if ($window->failures >= (int) config('supabase.email_mfa.max_failures_per_window', 10)) {
                return false;
            }

            $challenge->attempts++;

            if (! hash_equals($challenge->code_hash, $this->hashCode($user, $sessionId, $code))) {
                $challenge->save();

                // A real guess against a live code, so it counts against the
                // budget. Nothing the caller controls — resending, signing
                // out, opening a new session — undoes this.
                $window->failures++;
                $window->save();

                return false;
            }

            $challenge->consumed_at = now();
            $challenge->save();

            // Proving possession of the mailbox clears the budget outright.
            $window->delete();

            EmailMfaVerifiedSession::updateOrCreate(
                ['user_id' => $user->id, 'supabase_session_id' => $sessionId],
                [
                    'verified_at' => now(),
                    'expires_at' => now()->addSeconds((int) config('supabase.email_mfa.verified_ttl_seconds', 43200)),
                ],
            );

            return true;
        });
    }

    /**
     * Removes every email MFA challenge and verification for this account.
     *
     * Called on logout. supabase-js signs out with global scope by default,
     * revoking every session of the account, so every verification goes with
     * it rather than only the calling session's.
     *
     * DELIBERATELY LEAVES THE CUMULATIVE FAILURE WINDOW ALONE. POST /logout is
     * reachable at aal1, so somebody holding only the password can call it
     * freely; clearing the budget here would hand them a one-request reset and
     * restore exactly the unbounded guessing this budget exists to stop. Only
     * a successful verification, or the window elapsing, clears it.
     */
    public function forgetUser(User $user): void
    {
        EmailMfaChallenge::where('user_id', $user->id)->delete();
        EmailMfaVerifiedSession::where('user_id', $user->id)->delete();
    }

    /**
     * This user's cumulative failure budget, locked for the rest of the
     * calling transaction.
     *
     * MUST be called inside verifyCode()'s transaction and AFTER the challenge
     * row is locked — see the call site for the lock-ordering rule.
     *
     * Creating the row is the interesting part under concurrency. A plain
     * "select, and insert if missing" lets two simultaneous first-ever
     * failures both find nothing and both insert, and the loser dies on the
     * unique index — turning a wrong code into a 500. INSERT ... ON CONFLICT
     * DO NOTHING (insertOrIgnore) makes the create idempotent, and the
     * lockForUpdate that follows then serialises the two transactions on a row
     * that is guaranteed to exist. The second waits, re-reads the committed
     * count, and increments from it rather than from a stale zero.
     *
     * The window is rolled forward here rather than by a scheduled job: an
     * elapsed window is simply a counter that starts again at the next
     * failure, so there is no cleanup to run and no clock to trust but the
     * database's own.
     */
    protected function lockFailureWindow(User $user): EmailMfaFailureWindow
    {
        EmailMfaFailureWindow::query()->insertOrIgnore([
            'user_id' => $user->id,
            'failures' => 0,
            'window_started_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $window = EmailMfaFailureWindow::query()
            ->where('user_id', $user->id)
            ->lockForUpdate()
            ->first();

        $windowSeconds = (int) config('supabase.email_mfa.failure_window_seconds', 3600);

        if ($window->window_started_at->addSeconds($windowSeconds)->isPast()) {
            $window->failures = 0;
            $window->window_started_at = now();
        }

        return $window;
    }

    protected function pruneFor(User $user): void
    {
        EmailMfaChallenge::where('user_id', $user->id)
            ->where(fn ($q) => $q->where('expires_at', '<=', now())->orWhereNotNull('consumed_at'))
            ->delete();

        EmailMfaVerifiedSession::where('user_id', $user->id)
            ->where('expires_at', '<=', now())
            ->delete();
    }

    /**
     * Is $code still the live code of this challenge — unconsumed, unexpired,
     * and not replaced by a resend? SendEmailMfaCode asks this before sending
     * and before removing a challenge, so a delayed or retried job can neither
     * mail a dead code nor delete a newer one.
     */
    public function isCurrentCode(EmailMfaChallenge $challenge, string $code): bool
    {
        if ($challenge->consumed_at !== null || $challenge->expires_at->isPast()) {
            return false;
        }

        $user = User::find($challenge->user_id);

        return $user !== null
            && hash_equals($challenge->code_hash, $this->hashCode($user, $challenge->supabase_session_id, $code));
    }

    protected function hashCode(User $user, string $sessionId, string $code): string
    {
        $appKey = (string) config('app.key');

        if ($appKey === '') {
            throw new RuntimeException('APP_KEY is not configured.');
        }

        return hash_hmac('sha256', $user->id.'|'.$sessionId.'|'.$code, 'cdars-email-mfa|'.$appKey);
    }

    /**
     * The 'log' mail transport writes the entire message — code included — to
     * the application log. Sending a code through it would break the "never
     * logged" guarantee, so it is refused outright rather than trusted to be
     * a harmless local default.
     */
    protected function assertMailerDoesNotLogMessages(): void
    {
        $default = (string) config('mail.default');
        $mailer = (array) config("mail.mailers.{$default}", []);
        $transports = [$mailer['transport'] ?? $default];

        foreach ((array) ($mailer['mailers'] ?? []) as $nested) {
            $transports[] = config("mail.mailers.{$nested}.transport", $nested);
        }

        if (in_array('log', $transports, true)) {
            throw new RuntimeException('Email MFA refuses to send through a mailer that logs message bodies.');
        }
    }
}
