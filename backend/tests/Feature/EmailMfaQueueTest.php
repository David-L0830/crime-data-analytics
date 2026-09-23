<?php

namespace Tests\Feature;

use App\Jobs\SendEmailMfaCode;
use App\Mail\EmailMfaCodeMail;
use App\Models\EmailMfaChallenge;
use App\Models\User;
use App\Services\EmailMfaService;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

// Email MFA delivery through the notifications queue (Phase 2).
//
// The API records the challenge and queues an ENCRYPTED SendEmailMfaCode job
// on the 'notifications' queue; the notifications worker sends it. These tests
// pin the parts of that which protect the code: the payload is encrypted, a
// stale job never mails a dead code, and a job that finally fails removes only
// its own challenge. The inline (`sync`) behaviour the rest of the suite runs
// under is covered by EmailMfaTest, which is unchanged.
class EmailMfaQueueTest extends TestCase
{
    use RefreshDatabase;

    private const SESSION = 'session-queue-test';

    private function emailMfaUser(): User
    {
        return User::factory()->create([
            'role' => User::ROLE_ENCODER,
            'email' => 'queued-mfa@example.com',
            'supabase_user_id' => 'supabase-queued-mfa',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);
    }

    private function service(): EmailMfaService
    {
        return app(EmailMfaService::class);
    }

    /** @return array<int, SendEmailMfaCode> */
    private function pushedJobs(): array
    {
        return Queue::pushed(SendEmailMfaCode::class)->all();
    }

    public function test_sending_a_code_queues_an_encrypted_job_on_the_notifications_queue(): void
    {
        Queue::fake();
        Mail::fake();
        $user = $this->emailMfaUser();

        $this->service()->sendCode($user, self::SESSION);

        Queue::assertPushedOn('notifications', SendEmailMfaCode::class);
        $this->assertInstanceOf(ShouldBeEncrypted::class, $this->pushedJobs()[0]);

        // Queued, not sent: the request did not wait for the mail.
        Mail::assertNothingSent();
        $this->assertSame(1, EmailMfaChallenge::where('user_id', $user->id)->count());
    }

    public function test_the_queued_payload_never_contains_the_code_or_the_address(): void
    {
        $user = $this->emailMfaUser();
        $challenge = EmailMfaChallenge::create([
            'user_id' => $user->id,
            'supabase_session_id' => self::SESSION,
            'code_hash' => 'not-relevant-here',
            'attempts' => 0,
            'expires_at' => now()->addMinutes(5),
        ]);

        // A real asynchronous driver, so the payload is actually serialised,
        // dispatched the same way EmailMfaService dispatches it.
        config(['queue.default' => 'database']);
        Bus::dispatch(new SendEmailMfaCode($challenge->id, '918273', 5, now()->addMinutes(5)));

        $payload = (string) DB::table('jobs')->value('payload');
        $this->assertNotSame('', $payload);
        $this->assertStringNotContainsString('918273', $payload);
        $this->assertStringNotContainsString('queued-mfa@example.com', $payload);
        $this->assertSame('notifications', DB::table('jobs')->value('queue'));
    }

    public function test_the_worker_delivers_the_current_code(): void
    {
        Queue::fake();
        Mail::fake();
        $user = $this->emailMfaUser();

        $this->service()->sendCode($user, self::SESSION);
        $this->pushedJobs()[0]->handle($this->service());

        Mail::assertSent(EmailMfaCodeMail::class, fn ($mail) => $mail->hasTo('queued-mfa@example.com'));
    }

    public function test_a_job_whose_code_was_replaced_by_a_resend_sends_nothing(): void
    {
        Queue::fake();
        Mail::fake();
        $user = $this->emailMfaUser();

        $this->service()->sendCode($user, self::SESSION);
        $this->service()->sendCode($user, self::SESSION);
        [$stale, $current] = $this->pushedJobs();

        $stale->handle($this->service());
        Mail::assertNothingSent();

        $current->handle($this->service());
        Mail::assertSent(EmailMfaCodeMail::class, 1);
    }

    public function test_a_job_for_an_expired_or_used_code_sends_nothing(): void
    {
        Queue::fake();
        Mail::fake();
        $user = $this->emailMfaUser();

        $this->service()->sendCode($user, self::SESSION);
        $job = $this->pushedJobs()[0];

        $this->travel(10)->minutes();
        $job->handle($this->service());

        Mail::assertNothingSent();
    }

    public function test_a_finally_failed_job_removes_only_its_own_challenge(): void
    {
        Queue::fake();
        $user = $this->emailMfaUser();

        $this->service()->sendCode($user, self::SESSION);
        $this->service()->sendCode($user, self::SESSION);
        [$stale, $current] = $this->pushedJobs();

        // The superseded job failing must not delete the newer challenge.
        $stale->failed(new RuntimeException('smtp down'));
        $this->assertSame(1, EmailMfaChallenge::where('user_id', $user->id)->count());

        // The current job failing leaves no un-sent code enterable.
        $current->failed(new RuntimeException('smtp down'));
        $this->assertSame(0, EmailMfaChallenge::where('user_id', $user->id)->count());
    }

    public function test_a_queue_that_cannot_accept_the_job_leaves_no_code_behind(): void
    {
        $user = $this->emailMfaUser();
        // An asynchronous queue whose push genuinely fails (its table does not
        // exist) — the stand-in for Redis being unreachable.
        config([
            'queue.default' => 'database',
            'queue.connections.database.table' => 'missing_jobs_table',
        ]);

        try {
            $this->service()->sendCode($user, self::SESSION);
            $this->fail('A failed dispatch was reported as sent.');
        } catch (RuntimeException $e) {
            $this->assertSame('The verification code could not be sent.', $e->getMessage());
        }

        $this->assertSame(0, EmailMfaChallenge::where('user_id', $user->id)->count());
    }
}
