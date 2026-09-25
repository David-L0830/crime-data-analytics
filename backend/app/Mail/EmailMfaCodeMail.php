<?php

namespace App\Mail;

use Carbon\CarbonInterface;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Carries an email MFA sign-in code (see EmailMfaService::sendCode).
 *
 * Sent as HTML (an official CDARS notice layout) with a plain-text
 * alternative carrying the same content, and deliberately minimal: the code,
 * when it expires, and a warning not to share it. No link of any kind — a
 * "click to verify" URL would put the secret in a URL, where it ends up in
 * browser history, proxies and mail scanners that pre-fetch links.
 *
 * The code is a PRIVATE property handed to the view through Content::with,
 * so it is never exposed as a public property of the mailable. The code is
 * also kept out of the subject line, which notification previews and
 * lock screens show to anyone looking.
 *
 * Never queued ITSELF: a queued mailable is serialised — code included — in
 * plaintext into the jobs table or a queue backend. Delivery is queued through
 * App\Jobs\SendEmailMfaCode instead, which implements ShouldBeEncrypted and
 * sends this mailable synchronously from inside the job.
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
            subject: '[CDARS] Your sign-in verification code',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.email-mfa-code-html',
            text: 'mail.email-mfa-code',
            with: [
                'code' => $this->code,
                'expiresInMinutes' => $this->expiresInMinutes,
                'expiresAt' => $this->expiresAt->copy()
                    ->setTimezone(config('app.timezone'))
                    ->format('M j, Y g:i A T'),
                'isLocal' => false,
            ],
        );
    }
}
