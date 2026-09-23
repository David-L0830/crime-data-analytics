<?php

namespace Tests\Feature;

use App\Mail\EmailMfaCodeMail;
use App\Models\EmailMfaChallenge;
use App\Models\EmailMfaFailureWindow;
use App\Models\EmailMfaVerifiedSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

// Email one-time-code MFA — EmailMfaService, EmailMfaController and the email
// branch of EnsureSupabaseAal2.
//
// Supabase is faked with ONE callback registered per test, not a list of
// stubs: Laravel merges Http::fake() stubs and the first match wins, so a
// scenario that needs a session to be revoked part-way through could not be
// expressed by re-faking. The callback reads this test's own state instead.
// preventStrayRequests() makes any unexpected call to Supabase fail the test
// loudly rather than quietly reaching the network.
class EmailMfaTest extends TestCase
{
    use RefreshDatabase;

    private const SESSION_A = '11111111-1111-4111-8111-111111111111';

    private const SESSION_B = '22222222-2222-4222-8222-222222222222';

    private const SESSION_C = '33333333-3333-4333-8333-333333333333';

    /** @var array<int, array<string, string>> */
    private array $factors = [];

    private bool $mfaRequiredByAdmin = true;

    /** @var array<int, string> session ids GoTrue no longer recognises */
    private array $revokedSessions = [];

    /**
     * Sessions whose real owner differs from the presenting token's `sub`.
     *
     * GoTrue resolves a session by its session_id and answers with the user
     * that session actually belongs to. Keyed session id => that owner's
     * supabase_user_id. Empty by default, so the fake keeps answering with the
     * token's own `sub` exactly as before.
     *
     * @var array<string, string>
     */
    private array $sessionOwners = [];

    /**
     * Makes ONLY the liveness endpoint (/auth/v1/user) unavailable, leaving the
     * Admin API answering normally.
     *
     * 'connection'   - GoTrue cannot be reached at all (timeout/DNS/refused).
     * 'server_error' - GoTrue answers, but with a 5xx. The body deliberately
     *                  still carries the correct owner id, so the only thing
     *                  rejecting it is the response-status check.
     *
     * Null means healthy. Distinct from $revokedSessions, which is GoTrue
     * successfully answering "that session does not exist".
     */
    private ?string $livenessEndpointFailure = null;

    protected function setUp(): void
    {
        parent::setUp();

        Http::preventStrayRequests();
        Http::fake(function (HttpRequest $request) {
            $url = $request->url();

            // Administrator writes (UserController::requireTwoFactor /
            // disableTwoFactor) are applied to this test's state, so a later
            // read reflects them exactly as Supabase would.
            if (str_contains($url, '/auth/v1/admin/users/') && $request->method() === 'DELETE' && str_contains($url, '/factors/')) {
                $this->factors = array_values(array_filter($this->factors, fn ($f) => ! str_ends_with($url, '/factors/'.$f['id'])));

                return Http::response([], 200);
            }

            if (str_contains($url, '/auth/v1/admin/users/') && $request->method() === 'PUT') {
                $this->mfaRequiredByAdmin = ($request->data()['app_metadata']['mfa_required'] ?? null) === true;

                return Http::response(['app_metadata' => $request->data()['app_metadata'] ?? []], 200);
            }

            if (str_contains($url, '/auth/v1/admin/users/')) {
                return Http::response([
                    'factors' => $this->factors,
                    'app_metadata' => ['provider' => 'email', 'mfa_required' => $this->mfaRequiredByAdmin],
                ], 200);
            }

            if (str_ends_with($url, '/auth/v1/user')) {
                $claims = $this->claimsFromAuthorization($request->header('Authorization')[0] ?? '');

                // Liveness cannot be established — NOT an answer about the
                // session. See $livenessEndpointFailure.
                if ($this->livenessEndpointFailure === 'connection') {
                    throw new ConnectionException('Could not reach the Supabase Auth API.');
                }

                if ($this->livenessEndpointFailure === 'server_error') {
                    return Http::response([
                        'id' => $this->sessionOwners[$claims['session_id'] ?? ''] ?? ($claims['sub'] ?? null),
                        'message' => 'upstream failure',
                    ], 500);
                }

                if (in_array($claims['session_id'] ?? null, $this->revokedSessions, true)) {
                    return Http::response(['error_code' => 'session_not_found'], 403);
                }

                // The owner of the session, which is not necessarily the
                // presenter of the token — see $sessionOwners.
                $owner = $this->sessionOwners[$claims['session_id'] ?? ''] ?? ($claims['sub'] ?? null);

                return Http::response(['id' => $owner], 200);
            }

            return Http::response(['message' => 'unexpected Supabase call in test'], 500);
        });
    }

    // --- Fixtures ----------------------------------------------------------

    private function emailMfaAdmin(): User
    {
        return User::factory()->create([
            'username' => 'emailmfa-admin',
            'name' => 'Email MFA Administrator',
            'email' => 'emailmfa-admin@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-email-mfa-admin',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);
    }

    private function as(User $user, string $sessionId, string $aal = 'aal1'): static
    {
        return $this->actingAsSupabaseWithClaims($user, ['session_id' => $sessionId], $aal);
    }

    /** @return array<string, mixed> */
    private function claimsFromAuthorization(string $header): array
    {
        $parts = explode('.', str_replace('Bearer ', '', $header));

        return isset($parts[1])
            ? (array) json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true)
            : [];
    }

    /** Sends a code for the session and returns what arrived in the mailbox. */
    private function sendAndReadCode(User $user, string $sessionId): string
    {
        $this->as($user, $sessionId)->postJson('/api/mfa/email/send')->assertStatus(202);

        return $this->latestMailedCode();
    }

    private function latestMailedCode(): string
    {
        $messages = Mail::mailer()->getSymfonyTransport()->messages();
        $this->assertNotEmpty($messages, 'No email was sent.');

        $body = $messages->last()->getOriginalMessage()->getTextBody();
        $this->assertMatchesRegularExpression('/^ {4}(\d{6})$/m', $body);
        preg_match('/^ {4}(\d{6})$/m', $body, $m);

        return $m[1];
    }

    private function wrongCodeFor(string $code): string
    {
        return $code === '000000' ? '111111' : '000000';
    }

    // --- 1. Refused until verified -----------------------------------------

    public function test_email_mfa_account_is_refused_as_mfa_required_before_verification(): void
    {
        $user = $this->emailMfaAdmin();

        $this->as($user, self::SESSION_A)
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);

        $this->as($user, self::SESSION_A)
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true)
            ->assertJsonPath('data.mfaMethod', 'email_otp');
    }

    // --- 2. Valid code ----------------------------------------------------

    public function test_a_valid_code_admits_that_session_without_pretending_it_is_aal2(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertOk()
            ->assertExactJson(['verified' => true]);

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();

        $this->as($user, self::SESSION_A)
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', false)
            // The JWT is untouched: still exactly what Supabase issued.
            ->assertJsonPath('data.authAssuranceLevel', 'aal1');
    }

    public function test_the_email_names_cdars_the_expiry_and_not_sharing_and_keeps_the_code_out_of_the_subject(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $message = Mail::mailer()->getSymfonyTransport()->messages()->last()->getOriginalMessage();

        $this->assertSame('emailmfa-admin@example.com', $message->getTo()[0]->getAddress());
        $this->assertStringNotContainsString($code, $message->getSubject());
        $this->assertStringContainsString('CDARS', $message->getSubject());
        $this->assertStringContainsString('expires in 5 minutes', $message->getTextBody());
        $this->assertStringContainsString('Do not share this code', $message->getTextBody());

        // The HTML part is the official CDARS notice layout. It carries the
        // same code and warnings as the text part, and — the property that
        // matters for security — still no link of any kind, so the secret can
        // never end up in a URL, a browser history or a link scanner.
        $html = $message->getHtmlBody();
        $this->assertIsString($html);
        $this->assertStringContainsString($code, $html);
        $this->assertStringContainsString('Crime Data Analytics and Reporting System', $html);
        $this->assertStringContainsString('Barangay 178 Public Safety and Security', $html);
        $this->assertStringContainsString('Do not share this code with anyone.', $html);
        $this->assertStringContainsString('If you did not attempt to sign in to CDARS, you can safely ignore this email.', $html);
        $this->assertStringNotContainsStringIgnoringCase('href=', $html);
        $this->assertStringNotContainsStringIgnoringCase('<img', $html);
        $this->assertSame('[CDARS] Your sign-in verification code', $message->getSubject());
    }

    public function test_the_email_says_local_development_when_running_locally(): void
    {
        $this->app['env'] = 'local';

        $mail = new EmailMfaCodeMail('123456', 5, now()->addMinutes(5));

        $this->assertStringContainsString('LOCAL DEVELOPMENT AUTHENTICATION CODE', $mail->render());
        $this->assertStringContainsString('LOCAL DEV', $mail->envelope()->subject);
    }

    // --- 3. Invalid code ---------------------------------------------------

    public function test_an_invalid_code_is_refused_generically_and_admits_nothing(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $this->wrongCodeFor($code)])
            ->assertStatus(422)
            ->assertExactJson(['message' => 'The code is invalid or has expired. Request a new code and try again.']);

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
    }

    // --- 4. Expired code ---------------------------------------------------

    public function test_an_expired_code_is_refused_with_the_same_generic_answer(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $this->travel(301)->seconds();

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertStatus(422)
            ->assertExactJson(['message' => 'The code is invalid or has expired. Request a new code and try again.']);

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
    }

    // --- 5. Reused code ----------------------------------------------------

    public function test_a_code_cannot_be_used_twice(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertStatus(422);

        $this->assertNotNull(EmailMfaChallenge::first()->consumed_at);
    }

    // --- 6. Attempt limit --------------------------------------------------

    public function test_a_code_is_dead_after_five_wrong_attempts_even_if_the_right_one_follows(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        for ($i = 0; $i < 5; $i++) {
            $this->as($user, self::SESSION_A)
                ->postJson('/api/mfa/email/verify', ['code' => $this->wrongCodeFor($code)])
                ->assertStatus(422);
        }

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertStatus(422);

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
    }

    // --- 6b. Cumulative brute-force budget across resends (M1) --------------
    //
    // max_attempts caps guesses PER CODE, and sendCode() resets it, so on its
    // own it never bounded the total: resend, get five more, forever. These
    // pin the per-user budget that resending cannot reset.

    /** Submits $count wrong codes, resending whenever the current code dies. */
    private function burnFailures(User $user, string $sessionId, int $count): void
    {
        $perCode = (int) config('supabase.email_mfa.max_attempts');

        for ($i = 0; $i < $count; $i++) {
            if ($i % $perCode === 0) {
                // A fresh code — which resets THIS code's attempt counter.
                $this->travel(61)->seconds();
                $this->as($user, $sessionId)->postJson('/api/mfa/email/send')->assertStatus(202);
            }

            $this->as($user, $sessionId)
                ->postJson('/api/mfa/email/verify', ['code' => '000000'])
                ->assertStatus(422);
        }
    }

    public function test_a_resend_does_not_reset_the_cumulative_failure_budget(): void
    {
        $user = $this->emailMfaAdmin();
        $max = (int) config('supabase.email_mfa.max_failures_per_window');

        // Five wrong codes exhaust the first challenge, then a resend hands out
        // a fresh per-code allowance — the behaviour this budget sits on top of.
        $this->burnFailures($user, self::SESSION_A, 6);

        $window = EmailMfaFailureWindow::where('user_id', $user->id)->firstOrFail();
        $this->assertSame(6, $window->failures, 'Resending must not reset the cumulative count.');
        $this->assertLessThan($max, $window->failures);

        // Still usable below the threshold: the real code is accepted.
        $this->travel(61)->seconds();
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();
    }

    public function test_repeated_resends_cannot_buy_unlimited_guesses(): void
    {
        $user = $this->emailMfaAdmin();
        $max = (int) config('supabase.email_mfa.max_failures_per_window');

        $this->burnFailures($user, self::SESSION_A, $max);

        $this->assertSame($max, EmailMfaFailureWindow::where('user_id', $user->id)->value('failures'));

        // Budget spent. A further guess is refused with the SAME generic body
        // as an ordinary wrong code — no hint that a lockout exists.
        $this->travel(61)->seconds();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => '000000'])
            ->assertStatus(422)
            ->assertExactJson(['message' => 'The code is invalid or has expired. Request a new code and try again.']);

        // ...and the CORRECT code is refused too, so a lockout cannot be spent
        // through. This is the assertion that makes the budget a real ceiling.
        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertStatus(422)
            ->assertExactJson(['message' => 'The code is invalid or has expired. Request a new code and try again.']);

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);

        // A refusal on an exhausted budget must not burn the challenge either.
        $this->assertSame(0, EmailMfaChallenge::where('user_id', $user->id)->value('attempts'));
    }

    public function test_the_budget_recovers_once_the_window_elapses(): void
    {
        $user = $this->emailMfaAdmin();
        $max = (int) config('supabase.email_mfa.max_failures_per_window');

        $this->burnFailures($user, self::SESSION_A, $max);
        $this->travel(61)->seconds();
        $lockedOutCode = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $lockedOutCode])->assertStatus(422);

        // Wait the window out — the documented recovery path.
        $this->travel((int) config('supabase.email_mfa.failure_window_seconds') + 1)->seconds();

        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();
        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();
    }

    public function test_a_successful_verification_clears_the_cumulative_budget(): void
    {
        $user = $this->emailMfaAdmin();

        $this->burnFailures($user, self::SESSION_A, 3);
        $this->assertSame(3, EmailMfaFailureWindow::where('user_id', $user->id)->value('failures'));

        $this->travel(61)->seconds();
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        $this->assertSame(0, EmailMfaFailureWindow::where('user_id', $user->id)->count());
    }

    // Signing out is reachable at aal1, so if it cleared the budget anyone
    // holding the password could reset it with a single request.
    public function test_logging_out_does_not_clear_the_cumulative_budget(): void
    {
        $user = $this->emailMfaAdmin();

        $this->burnFailures($user, self::SESSION_A, 4);
        $this->as($user, self::SESSION_A)->postJson('/api/logout')->assertOk();

        $this->assertSame(4, EmailMfaFailureWindow::where('user_id', $user->id)->value('failures'));
        $this->assertSame(0, EmailMfaChallenge::where('user_id', $user->id)->count());
    }

    // Nor does starting a brand-new Supabase session: the budget is per USER,
    // not per session, or an attacker would simply sign in again.
    public function test_the_budget_is_per_user_and_survives_a_new_session(): void
    {
        $userA = $this->emailMfaAdmin();
        $userB = User::factory()->create([
            'username' => 'emailmfa-admin-b',
            'email' => 'emailmfa-admin-b@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-email-mfa-admin-b',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);

        $max = (int) config('supabase.email_mfa.max_failures_per_window');
        $this->burnFailures($userA, self::SESSION_A, $max);

        // A's fresh session is still locked out...
        $this->travel(61)->seconds();
        $onB = $this->sendAndReadCode($userA, self::SESSION_B);
        $this->as($userA, self::SESSION_B)->postJson('/api/mfa/email/verify', ['code' => $onB])->assertStatus(422);

        // ...while B is completely unaffected.
        $this->assertSame(0, EmailMfaFailureWindow::where('user_id', $userB->id)->count());
        $codeB = $this->sendAndReadCode($userB, self::SESSION_A);
        $this->as($userB, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $codeB])->assertOk();
        $this->as($userB, self::SESSION_A)->getJson('/api/dashboard')->assertOk();
    }

    public function test_verification_requests_are_throttled(): void
    {
        $user = $this->emailMfaAdmin();
        $this->sendAndReadCode($user, self::SESSION_A);

        for ($i = 0; $i < 10; $i++) {
            $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => 'abcdef']);
        }

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => 'abcdef'])
            ->assertStatus(429);
    }

    // --- 7. Resend throttling ----------------------------------------------

    public function test_sending_is_limited_to_one_a_minute_and_five_an_hour(): void
    {
        $user = $this->emailMfaAdmin();

        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(202);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(429);

        for ($i = 0; $i < 4; $i++) {
            $this->travel(61)->seconds();
            $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(202);
        }

        $this->travel(61)->seconds();
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(429);

        $this->assertCount(5, Mail::mailer()->getSymfonyTransport()->messages());
    }

    public function test_a_resend_replaces_the_earlier_code(): void
    {
        $user = $this->emailMfaAdmin();
        $first = $this->sendAndReadCode($user, self::SESSION_A);

        $this->travel(61)->seconds();
        $second = $this->sendAndReadCode($user, self::SESSION_A);

        $this->assertSame(1, EmailMfaChallenge::count());

        if ($first !== $second) {
            $this->as($user, self::SESSION_A)
                ->postJson('/api/mfa/email/verify', ['code' => $first])
                ->assertStatus(422);
        }

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $second])
            ->assertOk();
    }

    // --- 8. Never stored in plaintext --------------------------------------

    public function test_the_code_is_stored_only_as_a_keyed_hash(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $row = EmailMfaChallenge::first();
        $this->assertSame(64, strlen($row->code_hash));
        $this->assertNotSame(hash('sha256', $code), $row->code_hash);

        foreach ($row->getAttributes() as $column => $value) {
            $this->assertStringNotContainsString($code, (string) $value, "Column {$column} contains the code.");
        }

        $this->assertArrayNotHasKey('code_hash', $row->toArray());

        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        foreach (EmailMfaVerifiedSession::first()->getAttributes() as $column => $value) {
            $this->assertStringNotContainsString($code, (string) $value, "Column {$column} contains the code.");
        }
    }

    public function test_no_api_response_contains_the_code(): void
    {
        $user = $this->emailMfaAdmin();

        $send = $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(202);
        $code = $this->latestMailedCode();
        $this->assertStringNotContainsString($code, $send->getContent());

        $verify = $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code]);
        $this->assertStringNotContainsString($code, $verify->getContent());
    }

    // --- 9. Never logged ---------------------------------------------------

    public function test_the_code_never_reaches_the_log(): void
    {
        $logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $e) use (&$logged) {
            $logged[] = $e->message.' '.json_encode($e->context);
        });

        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $this->wrongCodeFor($code)]);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        foreach ($logged as $line) {
            $this->assertStringNotContainsString($code, $line);
        }
    }

    // The 'log' mail transport writes whole messages into the application log,
    // so it must never be allowed to carry a code.
    public function test_sending_is_refused_when_the_mailer_would_log_the_message(): void
    {
        config(['mail.default' => 'log']);
        $user = $this->emailMfaAdmin();

        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(503);

        $this->assertSame(0, EmailMfaChallenge::count());
    }

    // --- 10. Session binding -----------------------------------------------

    public function test_a_code_sent_to_session_a_cannot_be_redeemed_by_session_b(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $this->as($user, self::SESSION_B)
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertStatus(422);

        $this->as($user, self::SESSION_B)->getJson('/api/dashboard')->assertStatus(401);
        $this->assertSame(0, EmailMfaVerifiedSession::count());
    }

    public function test_session_a_verification_does_not_admit_session_b(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();

        $this->as($user, self::SESSION_B)
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
    }

    public function test_a_token_without_a_session_id_can_neither_send_nor_be_admitted(): void
    {
        $user = $this->emailMfaAdmin();

        $this->actingAsSupabaseWithClaims($user, [], 'aal1')
            ->postJson('/api/mfa/email/send')
            ->assertStatus(422);

        $this->actingAsSupabaseWithClaims($user, [], 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401);
    }

    // User binding. A's verification must mean nothing to B — including the
    // worst case, a B token carrying A's verified session_id. The GoTrue fake
    // confirms any session as live for the token's own `sub`, so in that case
    // only the verification's user binding stands between B and the app.
    public function test_user_a_email_verification_never_satisfies_user_b(): void
    {
        $userA = $this->emailMfaAdmin();
        $userB = User::factory()->create([
            'username' => 'emailmfa-admin-b',
            'email' => 'emailmfa-admin-b@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-email-mfa-admin-b',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);

        // 1-2. A signs in at aal1 and completes email MFA.
        $codeA = $this->sendAndReadCode($userA, self::SESSION_A);
        $this->as($userA, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $codeA])->assertOk();
        $this->as($userA, self::SESSION_A)->getJson('/api/dashboard')->assertOk();

        // 3-5. B — on its own session, or presenting A's verified session id —
        // is refused at either aal.
        foreach ([self::SESSION_B, self::SESSION_A] as $sessionId) {
            foreach (['aal1', 'aal2'] as $aal) {
                $this->as($userB, $sessionId, $aal)
                    ->getJson('/api/dashboard')
                    ->assertStatus(401)
                    ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
                $this->as($userB, $sessionId, $aal)->getJson('/api/user')->assertJsonPath('data.mfaRequired', true);
            }
        }

        // 6. A's code cannot verify B, and nothing was recorded for B.
        $this->as($userB, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $codeA])
            ->assertStatus(422);
        $this->assertSame(0, EmailMfaVerifiedSession::where('user_id', $userB->id)->count());

        // 7. B's own verification still works, and A is unaffected.
        $codeB = $this->sendAndReadCode($userB, self::SESSION_B);
        $this->as($userB, self::SESSION_B)->postJson('/api/mfa/email/verify', ['code' => $codeB])->assertOk();
        $this->as($userB, self::SESSION_B)->getJson('/api/dashboard')->assertOk();
        $this->as($userA, self::SESSION_A)->getJson('/api/dashboard')->assertOk();
    }

    // Liveness is bound to the SUPABASE USER, not just to a live session.
    //
    // The sibling test above proves the verification row's user binding. This
    // one isolates the other half — the `id === supabase_user_id` comparison in
    // EmailMfaService::sessionIsLive() — by deliberately removing every other
    // defence: user B is configured for email MFA, and a verification row for
    // (B, A's session id) is planted directly so the row lookup SUCCEEDS.
    //
    // GoTrue is then asked about that session and truthfully answers that it
    // belongs to A. The only thing left standing between B and the application
    // is that answer being compared against B's own supabase_user_id. If that
    // comparison is ever dropped, a session belonging to one Supabase user
    // would count as live for a different Laravel user.
    public function test_a_session_belonging_to_another_supabase_user_is_never_live_for_this_user(): void
    {
        $userA = $this->emailMfaAdmin();
        $userB = User::factory()->create([
            'username' => 'emailmfa-admin-b',
            'email' => 'emailmfa-admin-b@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-email-mfa-admin-b',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);

        // A genuinely completes email MFA on its own session.
        $codeA = $this->sendAndReadCode($userA, self::SESSION_A);
        $this->as($userA, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $codeA])->assertOk();
        $this->as($userA, self::SESSION_A)->getJson('/api/dashboard')->assertOk();

        // GoTrue reports SESSION_A's true owner: user A.
        $this->sessionOwners[self::SESSION_A] = (string) $userA->supabase_user_id;

        // Remove the row-binding defence for B so only sessionIsLive() remains.
        EmailMfaVerifiedSession::create([
            'user_id' => $userB->id,
            'supabase_session_id' => self::SESSION_A,
            'verified_at' => now(),
            'expires_at' => now()->addHour(),
        ]);

        foreach (['aal1', 'aal2'] as $aal) {
            $this->as($userB, self::SESSION_A, $aal)
                ->getJson('/api/dashboard')
                ->assertStatus(401)
                ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);

            $this->as($userB, self::SESSION_A, $aal)
                ->getJson('/api/user')
                ->assertJsonPath('data.mfaRequired', true);
        }

        // B cannot mint or redeem codes on a session it does not own either.
        $this->as($userB, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(401);
        $this->as($userB, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => '123456'])
            ->assertStatus(401);
        $this->assertSame(0, EmailMfaChallenge::where('user_id', $userB->id)->count());

        // Both sides of the binding: the legitimate owner is still admitted on
        // the very same session, so this rejects impostors rather than
        // rejecting everything.
        $this->as($userA, self::SESSION_A)->getJson('/api/dashboard')->assertOk();
        $this->as($userA, self::SESSION_A)->getJson('/api/user')->assertJsonPath('data.mfaRequired', false);
    }

    // --- 11. Logout --------------------------------------------------------

    public function test_logout_invalidates_the_verification(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();
        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();

        $this->as($user, self::SESSION_A)->postJson('/api/logout')->assertOk();

        $this->assertSame(0, EmailMfaVerifiedSession::count());
        $this->assertSame(0, EmailMfaChallenge::count());
        $this->as($user, self::SESSION_A)
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true]);
    }

    // --- 12. Revoked / invalid sessions ------------------------------------

    // A signed-out or password-reset-revoked session still holds an access
    // token that verifies until `exp`. GoTrue no longer recognises it, and
    // neither may the email MFA state it earned.
    public function test_a_revoked_supabase_session_cannot_use_its_verification(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();
        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();

        $this->revokedSessions[] = self::SESSION_A;

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
        $this->as($user, self::SESSION_A)->getJson('/api/user')->assertJsonPath('data.mfaRequired', true);
    }

    public function test_a_revoked_session_can_neither_request_nor_redeem_a_code(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);

        $this->revokedSessions[] = self::SESSION_A;

        $this->as($user, self::SESSION_A)
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertStatus(401);

        $this->travel(61)->seconds();
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(401);
        $this->assertSame(0, EmailMfaVerifiedSession::count());
    }

    // FAIL CLOSED when liveness cannot be ESTABLISHED.
    //
    // Distinct from the revoked-session test above, and that distinction is the
    // whole point. There, GoTrue answers successfully and says the session is
    // gone. Here GoTrue gives no usable answer at all — it is unreachable, or
    // returns a 5xx — so the application cannot know whether the session is
    // still valid. "Don't know" must be treated as "no", otherwise a Supabase
    // outage would silently turn the second factor off for exactly the accounts
    // it protects.
    //
    // Only the liveness endpoint fails; the Admin API keeps answering. That
    // isolates sessionIsLive()'s error handling, because EnsureSupabaseAal2
    // consults the Admin API first and would otherwise deny for that reason
    // instead — the test would then pass without proving anything.
    public function test_email_mfa_fails_closed_while_session_liveness_cannot_be_established(): void
    {
        $user = $this->emailMfaAdmin();

        // A genuine, working verification first: this is what must stop being
        // sufficient the moment liveness cannot be confirmed.
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();
        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();

        foreach (['connection', 'server_error'] as $failure) {
            // Past the one-a-minute send limit, so the send assertion below
            // exercises the liveness gate rather than being short-circuited
            // by a 429 from the throttle in front of it.
            $this->travel(61)->seconds();

            $this->livenessEndpointFailure = $failure;

            foreach (['aal1', 'aal2'] as $aal) {
                $this->as($user, self::SESSION_A, $aal)
                    ->getJson('/api/dashboard')
                    ->assertStatus(401)
                    ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
            }

            // The login flow is told the same thing, so it cannot conclude the
            // session is fine while the backend refuses it.
            $this->as($user, self::SESSION_A)
                ->getJson('/api/user')
                ->assertOk()
                ->assertJsonPath('data.mfaRequired', true);

            // Nor can a new code be minted or redeemed while liveness is unknown.
            $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(401);
            $this->as($user, self::SESSION_A)
                ->postJson('/api/mfa/email/verify', ['code' => '123456'])
                ->assertStatus(401);

            // Denied, but not destroyed: the earned verification is still on
            // record, so this is a hold rather than a silent logout.
            $this->assertSame(1, EmailMfaVerifiedSession::where('user_id', $user->id)
                ->where('supabase_session_id', self::SESSION_A)->count());
        }

        // And when GoTrue answers again, the same session works again — proving
        // the denial was caused by the unavailability itself and nothing else.
        $this->livenessEndpointFailure = null;
        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();
        $this->as($user, self::SESSION_A)->getJson('/api/user')->assertJsonPath('data.mfaRequired', false);
    }

    public function test_the_verification_expires_after_its_absolute_lifetime(): void
    {
        $user = $this->emailMfaAdmin();
        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        $this->travel(43201)->seconds();

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
    }

    public function test_an_expired_or_invalid_token_is_unauthenticated_everywhere(): void
    {
        $user = $this->emailMfaAdmin();

        $this->actingAsSupabaseWithClaims($user, ['session_id' => self::SESSION_A, 'exp' => time() - 10], 'aal1')
            ->postJson('/api/mfa/email/send')
            ->assertStatus(401);

        $this->withHeader('Authorization', 'Bearer not-a-jwt')
            ->postJson('/api/mfa/email/verify', ['code' => '123456'])
            ->assertStatus(401);

        $this->withHeaders([])->postJson('/api/mfa/email/send')->assertStatus(401);
    }

    // --- 13. Accounts without email MFA ------------------------------------

    public function test_an_account_without_email_mfa_is_unchanged_and_cannot_use_the_endpoints(): void
    {
        $user = User::factory()->create([
            'username' => 'plain-admin',
            'email' => 'plain-admin@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-plain-admin',
        ]);

        // Required, nothing enrolled: the existing enrolment signal, with no
        // email method offered.
        $response = $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
        $this->assertSame(['mfaRequired' => true, 'message' => 'This action requires a completed second-factor sign-in.'], $response->json());

        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(422);
        $this->assertCount(0, Mail::mailer()->getSymfonyTransport()->messages());
    }

    public function test_an_account_with_neither_requirement_nor_factor_still_signs_in_at_aal1(): void
    {
        $this->mfaRequiredByAdmin = false;
        $plain = User::factory()->create([
            'username' => 'plain-encoder',
            'email' => 'plain-encoder@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-plain-encoder',
        ]);

        $this->as($plain, self::SESSION_A)->getJson('/api/incidents')->assertOk();
        $this->as($plain, self::SESSION_A)->getJson('/api/user')->assertJsonPath('data.mfaRequired', false);
    }

    // --- 16. mfa_method = 'email_otp' is itself the obligation --------------
    //
    // DELIBERATE CHANGE of an earlier behaviour: an email_otp account with
    // mfa_required=false and no factor used to be admitted at aal1. It no
    // longer is. The Supabase flag is authenticator-app administration, and
    // letting it switch email MFA off is the recovery vulnerability below.

    public function test_email_mfa_is_required_whether_mfa_required_is_true_or_false(): void
    {
        $user = $this->emailMfaAdmin();

        foreach ([true, false] as $flag) {
            $this->mfaRequiredByAdmin = $flag;
            Cache::flush();

            foreach (['aal1', 'aal2'] as $aal) {
                $this->as($user, self::SESSION_A, $aal)
                    ->getJson('/api/dashboard')
                    ->assertStatus(401)
                    ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);

                $this->as($user, self::SESSION_A, $aal)
                    ->getJson('/api/user')
                    ->assertJsonPath('data.mfaRequired', true);
            }
        }
    }

    public function test_with_mfa_required_false_the_email_code_is_still_sendable_and_admits_only_that_session(): void
    {
        $this->mfaRequiredByAdmin = false;
        $user = $this->emailMfaAdmin();

        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertOk();
        $this->as($user, self::SESSION_A)->getJson('/api/user')->assertJsonPath('data.mfaRequired', false);
        $this->as($user, self::SESSION_A, 'aal2')->getJson('/api/dashboard')->assertOk();

        $this->as($user, self::SESSION_B)->getJson('/api/dashboard')->assertStatus(401);
        $this->as($user, self::SESSION_B, 'aal2')->getJson('/api/dashboard')->assertStatus(401);
    }

    // The full recovery scenario from the audit, through the real
    // administrator endpoint the "Clear 2FA" button calls.
    public function test_clear_2fa_recovery_removes_the_attackers_authenticator_but_never_email_mfa(): void
    {
        $owner = $this->emailMfaAdmin();
        $admin = $this->superAdmin();

        // 1-3. An attacker holding the password enrols their own authenticator
        // and reaches genuine aal2 in their session; C1 still refuses them.
        $this->factors = $this->verifiedTotpFactor();
        $this->as($owner, self::SESSION_A, 'aal2')->getJson('/api/dashboard')->assertStatus(401);

        // 4-5. An administrator runs the recovery: factor removed AND Supabase
        // mfa_required cleared.
        $this->as($admin, self::SESSION_B, 'aal2')
            ->postJson("/api/users/{$owner->id}/two-factor/disable")
            ->assertOk()
            ->assertJsonPath('data.mfaMethod', 'email_otp');

        $this->assertSame([], $this->factors);
        $this->assertFalse($this->mfaRequiredByAdmin);
        $this->assertSame(User::MFA_METHOD_EMAIL_OTP, $owner->fresh()->mfa_method);

        // 6-7. The attacker's password-only session gets nothing, at either aal.
        foreach (['aal1', 'aal2'] as $aal) {
            $this->as($owner, self::SESSION_A, $aal)
                ->getJson('/api/dashboard')
                ->assertStatus(401)
                ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
            $this->as($owner, self::SESSION_A, $aal)->getJson('/api/user')->assertJsonPath('data.mfaRequired', true);
        }

        // The owner recovers with an email code in their own session.
        $code = $this->sendAndReadCode($owner, self::SESSION_C);
        $this->as($owner, self::SESSION_C)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();
        $this->as($owner, self::SESSION_C)->getJson('/api/dashboard')->assertOk();
        $this->as($owner, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
    }

    public function test_cancelling_the_2fa_requirement_does_not_remove_email_mfa(): void
    {
        $owner = $this->emailMfaAdmin();
        $admin = $this->superAdmin();

        $this->as($admin, self::SESSION_B, 'aal2')
            ->postJson("/api/users/{$owner->id}/two-factor/require", ['required' => false])
            ->assertOk()
            ->assertJsonPath('data.mfaRequiredByAdmin', false)
            ->assertJsonPath('data.mfaMethod', 'email_otp');

        $this->assertFalse($this->mfaRequiredByAdmin);
        $this->assertSame(User::MFA_METHOD_EMAIL_OTP, $owner->fresh()->mfa_method);

        foreach (['aal1', 'aal2'] as $aal) {
            $this->as($owner, self::SESSION_A, $aal)
                ->getJson('/api/dashboard')
                ->assertStatus(401)
                ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
            $this->as($owner, self::SESSION_A, $aal)->getJson('/api/user')->assertJsonPath('data.mfaRequired', true);
        }
    }

    // Phase 1 (MFA Option B): on an account NOT configured for email MFA the
    // authenticator is the only second factor, so neither administrator action
    // may leave it with none. Cancelling the requirement is refused, and
    // clearing the factor resets enrolment instead of opening the account.
    public function test_authenticator_administration_never_leaves_a_non_email_account_without_mfa(): void
    {
        $target = User::factory()->create([
            'username' => 'totp-target',
            'email' => 'totp-target@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-totp-target',
        ]);
        $admin = $this->plainAdmin();

        // Requirement on, nothing enrolled: refused at aal1 as before.
        $this->as($target, self::SESSION_A)->getJson('/api/incidents')->assertStatus(401);

        // Cancelling it is refused, and the account is still refused at aal1.
        $this->as($admin, self::SESSION_B, 'aal2')
            ->postJson("/api/users/{$target->id}/two-factor/require", ['required' => false])
            ->assertStatus(422);
        $this->assertTrue($this->mfaRequiredByAdmin);
        $this->as($target, self::SESSION_A)->getJson('/api/incidents')->assertStatus(401);

        // An enrolled authenticator is demanded at aal1 and satisfied at aal2.
        $this->factors = $this->verifiedTotpFactor();
        Cache::flush();
        $this->as($target, self::SESSION_A)->getJson('/api/incidents')->assertStatus(401);
        $this->as($target, self::SESSION_A, 'aal2')->getJson('/api/incidents')->assertOk();

        // Clearing it resets enrolment: the factor is gone, the requirement
        // stays on, and an aal1 session is still refused until a new
        // authenticator is enrolled.
        $this->as($admin, self::SESSION_B, 'aal2')
            ->postJson("/api/users/{$target->id}/two-factor/disable")
            ->assertOk();
        $this->assertSame([], $this->factors);
        $this->assertTrue($this->mfaRequiredByAdmin);
        $this->as($target, self::SESSION_A)
            ->getJson('/api/incidents')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true]);
        $this->as($target, self::SESSION_A)->getJson('/api/user')->assertJsonPath('data.mfaRequired', true);
    }

    public function test_only_administrators_can_use_the_authenticator_administration_actions(): void
    {
        $encoder = User::factory()->create([
            'username' => 'emailmfa-encoder',
            'email' => 'emailmfa-encoder@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-email-mfa-encoder',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);
        $owner = $this->emailMfaAdmin();

        $code = $this->sendAndReadCode($encoder, self::SESSION_A);
        $this->as($encoder, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        $this->as($encoder, self::SESSION_A)
            ->postJson("/api/users/{$owner->id}/two-factor/disable")
            ->assertStatus(403);
        $this->as($encoder, self::SESSION_A)
            ->postJson("/api/users/{$owner->id}/two-factor/require", ['required' => false])
            ->assertStatus(403);

        $this->assertTrue($this->mfaRequiredByAdmin);
    }

    // --- 14. aal2 never replaces the email code (audit finding C1); TOTP -----
    //         accounts are unchanged

    private const GENERIC_MFA_BODY = ['mfaRequired' => true, 'message' => 'This action requires a completed second-factor sign-in.'];

    /** @return array<int, array<string, string>> */
    private function verifiedTotpFactor(): array
    {
        return [['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']];
    }

    private function plainAdmin(): User
    {
        return User::factory()->create([
            'username' => 'plain-admin',
            'email' => 'plain-admin@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-plain-admin',
        ]);
    }

    // The account that manages an Administrator's MFA ('manage-account' Gate).
    private function superAdmin(): User
    {
        return User::factory()->create([
            'username' => 'super-admin',
            'email' => 'super-admin@example.com',
            'role' => User::ROLE_SUPER_ADMIN,
            'supabase_user_id' => 'supabase-super-admin',
        ]);
    }

    // C1 regression, step by step. Someone holding only the password signs
    // in, enrols an authenticator of their own (Supabase permits a first
    // enrolment at aal1), verifies it, and so holds a GENUINE aal2 token for
    // the same session. That must still not open anything without the email
    // code for that session.
    public function test_c1_a_self_enrolled_authenticator_and_genuine_aal2_do_not_bypass_the_email_code(): void
    {
        $user = $this->emailMfaAdmin();

        // Steps 1-2: password sign-in, aal1, email code owed.
        $this->as($user, self::SESSION_A)
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);

        // Steps 3-5: a verified factor now exists and Supabase re-issues the
        // same session at aal2. (The cached security state is dropped so the
        // new factor is seen, as it would be once its TTL passes.)
        $this->factors = $this->verifiedTotpFactor();
        Cache::flush();

        // Step 6: protected endpoints still demand the email code.
        foreach (['/api/dashboard', '/api/users', '/api/incidents', '/api/audit-logs', '/api/notifications'] as $uri) {
            $this->as($user, self::SESSION_A, 'aal2')
                ->getJson($uri)
                ->assertStatus(401)
                ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
        }

        // ...and the login flow is told the same, not "nothing owed".
        $this->as($user, self::SESSION_A, 'aal2')
            ->getJson('/api/user')
            ->assertJsonPath('data.mfaRequired', true)
            ->assertJsonPath('data.mfaMethod', 'email_otp')
            ->assertJsonPath('data.authAssuranceLevel', 'aal2');

        // Enrolling a factor did not change the account's configured method.
        $this->assertSame(User::MFA_METHOD_EMAIL_OTP, $user->fresh()->mfa_method);
        $this->assertSame(0, EmailMfaVerifiedSession::count());
    }

    // Required behaviour C.
    public function test_email_otp_account_with_a_genuine_aal2_token_but_no_email_verification_is_refused(): void
    {
        $user = $this->emailMfaAdmin();

        $this->as($user, self::SESSION_A, 'aal2')
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);

        $this->as($user, self::SESSION_A, 'aal2')
            ->getJson('/api/user')
            ->assertJsonPath('data.mfaRequired', true);
    }

    // Required behaviour D — including that an aal2 session can request and
    // redeem the code, since it still owes it.
    public function test_email_otp_account_with_aal2_is_admitted_once_that_session_verifies_the_email_code(): void
    {
        $user = $this->emailMfaAdmin();

        $this->as($user, self::SESSION_A, 'aal2')->postJson('/api/mfa/email/send')->assertStatus(202);
        $code = $this->latestMailedCode();

        $this->as($user, self::SESSION_A, 'aal2')
            ->postJson('/api/mfa/email/verify', ['code' => $code])
            ->assertOk();

        $this->as($user, self::SESSION_A, 'aal2')->getJson('/api/dashboard')->assertOk();
        $this->as($user, self::SESSION_A, 'aal2')
            ->getJson('/api/user')
            ->assertJsonPath('data.mfaRequired', false)
            ->assertJsonPath('data.authAssuranceLevel', 'aal2');
    }

    public function test_an_email_verification_made_at_aal2_still_does_not_admit_another_session(): void
    {
        $user = $this->emailMfaAdmin();
        $this->as($user, self::SESSION_A, 'aal2')->postJson('/api/mfa/email/send')->assertStatus(202);
        $this->as($user, self::SESSION_A, 'aal2')
            ->postJson('/api/mfa/email/verify', ['code' => $this->latestMailedCode()])
            ->assertOk();

        foreach (['aal1', 'aal2'] as $aal) {
            $this->as($user, self::SESSION_B, $aal)
                ->getJson('/api/dashboard')
                ->assertStatus(401)
                ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
        }
    }

    // An email_otp account that also holds a verified factor needs BOTH: the
    // email code can never stand in for the authenticator, nor the reverse.
    public function test_an_email_otp_account_with_a_verified_factor_needs_both_the_email_code_and_aal2(): void
    {
        $this->factors = $this->verifiedTotpFactor();
        $user = $this->emailMfaAdmin();

        $this->as($user, self::SESSION_A, 'aal2')
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);

        $code = $this->sendAndReadCode($user, self::SESSION_A);
        $this->as($user, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        // Email verified, but still aal1: the authenticator is owed too.
        $response = $this->as($user, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
        $this->assertSame(self::GENERIC_MFA_BODY, $response->json());
        $this->as($user, self::SESSION_A)->getJson('/api/user')->assertJsonPath('data.mfaRequired', true);

        // Email verified AND aal2.
        $this->as($user, self::SESSION_A, 'aal2')->getJson('/api/dashboard')->assertOk();
        $this->as($user, self::SESSION_A, 'aal2')->getJson('/api/user')->assertJsonPath('data.mfaRequired', false);
    }

    // Required behaviour E: unchanged, including no MFA lookup at all.
    public function test_a_non_email_account_with_aal2_is_admitted_exactly_as_before(): void
    {
        $this->factors = $this->verifiedTotpFactor();
        $plain = $this->plainAdmin();

        $this->as($plain, self::SESSION_A, 'aal2')->getJson('/api/dashboard')->assertOk();

        // The middleware's aal2 short-circuit runs before any MFA lookup for
        // these accounts, as it always has. Asserted straight after the
        // protected call: GET /user below does its own badge lookups
        // (twoFactorEnabled, mfaRequiredByAdmin) regardless of aal, as it
        // always did. The token validator's JWKS fetch is unrelated.
        Http::assertNotSent(fn (HttpRequest $r) => str_contains($r->url(), '/auth/v1/admin/users/')
            || str_ends_with($r->url(), '/auth/v1/user'));

        $this->as($plain, self::SESSION_A, 'aal2')->getJson('/api/user')->assertJsonPath('data.mfaRequired', false);
        $this->as($plain, self::SESSION_A, 'aal2')->postJson('/api/mfa/email/send')->assertStatus(422);
    }

    // Required behaviour G: a TOTP account keeps its exact behaviour, and an
    // email verification row cannot substitute for its authenticator.
    public function test_a_totp_account_is_unchanged_and_an_email_verification_cannot_stand_in_for_totp(): void
    {
        $this->factors = $this->verifiedTotpFactor();
        $plain = $this->plainAdmin();

        $response = $this->as($plain, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
        $this->assertSame(self::GENERIC_MFA_BODY, $response->json());

        $this->as($plain, self::SESSION_A)->postJson('/api/mfa/email/send')->assertStatus(422);

        EmailMfaVerifiedSession::create([
            'user_id' => $plain->id,
            'supabase_session_id' => self::SESSION_A,
            'verified_at' => now(),
            'expires_at' => now()->addHour(),
        ]);

        $response = $this->as($plain, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(401);
        $this->assertSame(self::GENERIC_MFA_BODY, $response->json());

        $this->as($plain, self::SESSION_A, 'aal2')->getJson('/api/dashboard')->assertOk();
    }

    public function test_the_email_routes_are_authenticated_but_not_mfa_gated(): void
    {
        foreach (['api/mfa/email/send', 'api/mfa/email/verify'] as $uri) {
            $route = collect(Route::getRoutes())->first(fn ($r) => $r->uri() === $uri);

            $this->assertNotNull($route, "Route {$uri} is missing.");
            $this->assertContains('auth:supabase', $route->gatherMiddleware());
            $this->assertNotContains('supabase.mfa', $route->gatherMiddleware());
            $this->assertNotEmpty(array_filter($route->gatherMiddleware(), fn ($m) => str_starts_with($m, 'throttle:')));
        }
    }

    // --- 15. RBAC unchanged ------------------------------------------------

    public function test_role_authorization_still_applies_to_an_email_mfa_verified_session(): void
    {
        $encoder = User::factory()->create([
            'username' => 'emailmfa-encoder',
            'email' => 'emailmfa-encoder@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-email-mfa-encoder',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);

        $code = $this->sendAndReadCode($encoder, self::SESSION_A);
        $this->as($encoder, self::SESSION_A)->postJson('/api/mfa/email/verify', ['code' => $code])->assertOk();

        $this->as($encoder, self::SESSION_A)->getJson('/api/incidents')->assertOk();
        $this->as($encoder, self::SESSION_A)->getJson('/api/users')->assertStatus(403);
        $this->as($encoder, self::SESSION_A)->getJson('/api/dashboard')->assertStatus(403);
    }

    public function test_role_authorization_still_applies_to_an_aal2_email_verified_session(): void
    {
        $encoder = User::factory()->create([
            'username' => 'emailmfa-encoder',
            'email' => 'emailmfa-encoder@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-email-mfa-encoder',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);

        // Unverified aal2: refused by MFA before any role decision.
        $this->as($encoder, self::SESSION_A, 'aal2')->getJson('/api/incidents')->assertStatus(401);

        $this->as($encoder, self::SESSION_A, 'aal2')->postJson('/api/mfa/email/send')->assertStatus(202);
        $this->as($encoder, self::SESSION_A, 'aal2')
            ->postJson('/api/mfa/email/verify', ['code' => $this->latestMailedCode()])
            ->assertOk();

        $this->as($encoder, self::SESSION_A, 'aal2')->getJson('/api/incidents')->assertOk();
        $this->as($encoder, self::SESSION_A, 'aal2')->getJson('/api/users')->assertStatus(403);
        $this->as($encoder, self::SESSION_A, 'aal2')->getJson('/api/dashboard')->assertStatus(403);
    }
}
