<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One record of one automated-report run.
 *
 * This is the evidence the Reporting System checklist asks for under
 * "Scheduled Reports — Email Logs": it answers what report was generated, for
 * whom, when, on whose behalf, over what scope, and whether it arrived.
 *
 * It answers none of those by storing report content. `row_count` and
 * `filters_summary` describe the file; the file itself exists only as the
 * attachment on the message that was sent. A log that accumulated copies of
 * the incident data would be a second, unguarded store of exactly the records
 * the API guards.
 */
class ReportEmailLog extends Model
{
    use HasFactory;

    public const STATUS_SENT = 'sent';

    public const STATUS_FAILED = 'failed';

    public const TRIGGER_SCHEDULED = 'scheduled';

    public const TRIGGER_MANUAL = 'manual';

    /**
     * An exception message can be arbitrarily long (a stack-trace-laden PDO
     * error, a full SMTP transcript). It is truncated to this before being
     * written, so one bad run cannot bloat the table it is meant to be
     * diagnosable from.
     */
    public const ERROR_MAX = 2000;

    protected $fillable = [
        'report_schedule_id',
        'schedule_name',
        'report_key',
        'recipients',
        'status',
        'trigger',
        'row_count',
        'filters_summary',
        'error',
        'triggered_by',
        'generated_at',
    ];

    protected function casts(): array
    {
        return [
            'recipients' => 'array',
            'row_count' => 'integer',
            'generated_at' => 'datetime',
        ];
    }

    public function schedule()
    {
        return $this->belongsTo(ReportSchedule::class, 'report_schedule_id');
    }

    public function triggeredBy()
    {
        return $this->belongsTo(User::class, 'triggered_by');
    }
}
