<?php

namespace App\Jobs;

use App\Mail\EmailMfaCodeMail;
use App\Models\EmailMfaChallenge;
use App\Models\User;
use App\Services\EmailMfaService;
use Carbon\CarbonInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

// Delivers one email MFA code (EmailMfaService::sendCode dispatches it).
//
// WHY A JOB. Sending over SMTP inside POST /mfa/email/send held the sign-in
// request open for the whole mail round trip. Queued to the 'notifications'
// queue, the API records the challenge and answers at once, and the
// notifications worker (service-notifications in docker-compose.yml) does the
// sending. On the `sync` connection, which every hosted environment uses, the
// job simply runs inside the request exactly as the old inline send did.
//
// THE CODE IS IN THE PAYLOAD, SO THE PAYLOAD IS ENCRYPTED. ShouldBeEncrypted
// makes Laravel encrypt the whole serialised job with APP_KEY before it
// reaches Redis, the jobs table or failed_jobs, so the plaintext code exists
// only in the memory of the process handling it — the same guarantee the
// inline send gave. The API and the worker share APP_KEY (one env_file), which
// is what lets the worker decrypt it.
//
// NOTHING STALE IS EVER SENT. A resend replaces the challenge's code, and a
// delayed or retried job may still carry the old one; delivering it would mail
// a code that can no longer be accepted. So the job re-checks, at send time,
// that its code is still the live, unconsumed, unexpired code for its
// challenge, and silently does nothing otherwise.
class SendEmailMfaCode implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    // A transient SMTP failure gets two more chances. Each retry re-checks
    // the code, so once it expires the remaining attempts send nothing.
    public int $tries = 3;

    public array $backoff = [5, 15];

    public function __construct(
        public int $challengeId,
        private string $code,
        private int $expiresInMinutes,
        private CarbonInterface $expiresAt,
    ) {
        $this->onQueue('notifications');
    }

    public function handle(EmailMfaService $emailMfa): void
    {
        $challenge = EmailMfaChallenge::find($this->challengeId);
        $user = $challenge ? User::find($challenge->user_id) : null;

        if (! $challenge || ! $user || ! $emailMfa->isCurrentCode($challenge, $this->code)) {
            return;
        }

        Mail::to($user->email)->send(
            new EmailMfaCodeMail($this->code, $this->expiresInMinutes, $this->expiresAt)
        );
    }

    /**
     * Every attempt failed. The code was never delivered, so it is removed
     * rather than left enterable — the same rule the inline send followed.
     * Only THIS job's code is removed: if a resend has since replaced it, the
     * newer challenge is left alone for its own job to deliver.
     *
     * The exception message is not logged: transport errors can echo parts of
     * the message they were handed.
     */
    public function failed(?Throwable $e): void
    {
        $challenge = EmailMfaChallenge::find($this->challengeId);

        if ($challenge && app(EmailMfaService::class)->isCurrentCode($challenge, $this->code)) {
            $challenge->delete();
        }

        Log::warning('Email MFA: the verification email could not be delivered.', [
            'challenge_id' => $this->challengeId,
            'exception' => $e ? $e::class : null,
        ]);
    }
}
