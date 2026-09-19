<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One run of the reporting process.
 *
 * A person exports from the module that owns the data, or an active schedule
 * sends one automatically (see ReportSchedule / ScheduledReportDispatcher),
 * and this row records that it happened. Reporting is a functional capability
 * of CDARS — the output stage of Crime Data Collection -> Validation ->
 * Analytics -> Reporting — not a separate operational module beside them.
 *
 * THIS TABLE SPECIFICALLY has no page of its own, no listing endpoint and no
 * export — it is backend history, read directly from the database. That is a
 * statement about report_runs, not about Reporting as a whole: the Reports
 * page (/reports) is a real, supported part of the product, listing
 * report_schedules and report_email_logs. See the create_report_runs_table
 * migration for what a row here deliberately does not contain (the report
 * itself, any personal detail, any recipient).
 */
class ReportRun extends Model
{
    use HasFactory;

    /** A person exported from a module. */
    public const ORIGIN_MANUAL = 'manual';

    /**
     * A future authenticated system-to-system report request. NOT IMPLEMENTED
     * — no external subsystem is integrated yet, and nothing writes this value
     * today. It is named here so the vocabulary is settled before the
     * interface exists.
     */
    public const ORIGIN_EXTERNAL_REQUEST = 'external_request';

    /**
     * A historical run of the scheduled/e-mailed report feature, preserved by
     * the create_report_runs_table migration's backfill from
     * report_email_logs. That feature is not retired — it remains a live,
     * supported part of CDARS (see ScheduledReportDispatcher) — but it writes
     * to report_email_logs, not to this table, so nothing writes
     * ORIGIN_SCHEDULED_LEGACY going forward. The value exists only so the
     * backfilled rows below say honestly where they came from.
     */
    public const ORIGIN_SCHEDULED_LEGACY = 'scheduled_legacy';

    public const ORIGINS = [
        self::ORIGIN_MANUAL,
        self::ORIGIN_EXTERNAL_REQUEST,
        self::ORIGIN_SCHEDULED_LEGACY,
    ];

    protected $fillable = [
        'report_key',
        'report_label',
        'period_from',
        'period_to',
        'filters_summary',
        'row_count',
        'generated_by',
        'origin',
        'generated_at',
    ];

    protected function casts(): array
    {
        return [
            'period_from' => 'date:Y-m-d',
            'period_to' => 'date:Y-m-d',
            'generated_at' => 'datetime',
            'row_count' => 'integer',
        ];
    }

    public function generatedBy()
    {
        return $this->belongsTo(User::class, 'generated_by');
    }
}
