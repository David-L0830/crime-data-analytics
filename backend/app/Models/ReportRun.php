<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One run of the reporting process.
 *
 * Reporting is a process inside CDARS rather than a module: a person exports
 * from the module that owns the data, and this row records that it happened.
 * There is no Reports page, no listing endpoint and no export of this table —
 * it is backend history. See the create_report_runs_table migration for what
 * the row deliberately does not contain (the report itself, any personal
 * detail, any recipient).
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
     * A historical run of the retired scheduled-report feature, preserved by
     * the backfill. Nothing writes this value any more.
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
