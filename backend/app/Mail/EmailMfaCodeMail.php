<?php

namespace App\Mail;

use Carbon\CarbonInterface;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Carries an email MFA sign-in code (see EmailMfaService::sendCode).
 *
 * Plain text, like ScheduledReportMail, and deliberately minimal: the code,
 * when it expires, and a warning not to share it. No link of any kind — a
 * "click to verify" URL would put the secret in a URL, where it ends up in
 * browser history, proxies and mail scanners that pre-fetch links.
 *
 * The code is a PRIVATE property handed to the view through Content::with,
 * so it is never exposed as a public property of the mailable. The code is
 * also kept out of the subject line, which notification previews and
 * lock screens show to anyone looking.
 *
 * Not queued, and must never be: a queued mailable is serialised — code
 * included — into the jobs table or a queue backend.
 */
class EmailMfaCodeMail extends Mailable
{
    public function __construct(
        private string $code,
        private int $expiresInMinutes,
        private CarbonInterface $expiresAt,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: app()->environment('local')
                ? '[CDARS LOCAL DEV] Your sign-in verification code'
                : '[CDARS] Your sign-in verification code',
        );
    }

    public function content(): Content
    {
        return new Content(
            text: 'mail.email-mfa-code',
            with: [
                'code' => $this->code,
                'expiresInMinutes' => $this->expiresInMinutes,
                'expiresAt' => $this->expiresAt->copy()
                    ->setTimezone(config('app.timezone'))
                    ->format('M j, Y g:i A T'),
                'isLocal' => app()->environment('local'),
            ],
        );
    }
}
