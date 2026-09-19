<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * The message an automated report arrives in.
 *
 * DELIBERATELY PLAIN TEXT, AND DELIBERATELY EMPTY OF REPORT CONTENT. The body
 * names the report, states the scope it covers and how many records it found,
 * and says the file is attached. It contains no incident record, no name, no
 * address and no case number.
 *
 * That is the whole security posture of this feature. Mail leaves the system's
 * control the moment it is handed to the provider: it is relayed, stored on
 * servers nobody here administers, and is likely to sit in an inbox that is
 * not protected by Supabase MFA or the `role:` middleware. Putting the records
 * in the body would route personal data straight around the access control the
 * API exists to enforce. Putting them in an attachment is a considered
 * exception — the administrator configuring the schedule is choosing to send
 * that file to named recipients — and the body stays clean so a preview pane,
 * a notification, or a forwarded message never leaks the contents.
 *
 * There is also no link back to the application. A "view this report online"
 * URL would have to be reachable without a session to be useful from an inbox,
 * and an unauthenticated report URL is precisely the thing this feature must
 * not create.
 */
class ScheduledReportMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $scheduleName,
        public string $reportLabel,
        public string $scopeSummary,
        public int $rowCount,
        public string $generatedAt,
        private string $attachmentName,
        private string $attachmentContents,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: sprintf(
                'Barangay 178 BADAC Analytics — %s (%s) — Official Records',
                $this->reportLabel,
                $this->periodText(),
            ),
        );
    }

    /**
     * The reporting period, pulled out of $scopeSummary rather than passed in
     * separately. ReportGenerator::describeScope() always starts its summary
     * with 'Period: <text> · ' (or just 'Period: <text>' when nothing else
     * follows), so this reads the one piece the subject line needs without
     * widening the constructor or duplicating how the period text is built.
     * Falls back to the label alone if the summary is ever in an unexpected
     * shape — a subject missing its date range is a smaller problem than a
     * fatal error building the e-mail.
     */
    private function periodText(): string
    {
        if (preg_match('/^Period: (.*?)(?: · |$)/', $this->scopeSummary, $matches) === 1) {
            return $matches[1];
        }

        return 'All dates';
    }

    public function content(): Content
    {
        // text:, not view: — there is no HTML alternative on purpose. An HTML
        // body would invite a letterhead, and a second copy of the Barangay
        // 178 letterhead maintained apart from PrintReport.jsx is two
        // letterheads to keep identical.
        return new Content(text: 'mail.scheduled-report');
    }

    /**
     * @return array<int, Attachment>
     */
    public function attachments(): array
    {
        return [
            Attachment::fromData(fn () => $this->attachmentContents, $this->attachmentName)
                ->withMime('text/csv'),
        ];
    }
}
