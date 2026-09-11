<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One administrator-configured automated report.
 *
 * The scheduling model is deliberately coarse. Laravel's scheduler runs
 * `reports:send-scheduled` once an hour and this class answers a single
 * question for each row — "is this one due now?" — rather than each schedule
 * registering its own cron expression. That keeps the number of moving parts
 * at one cron entry regardless of how many schedules exist, and it means a
 * schedule created at 14:05 does not need the process restarted to take
 * effect.
 */
class ReportSchedule extends Model
{
    use HasFactory;

    /**
     * Rolling windows, resolved against the moment of the run.
     *
     * There is deliberately no fixed-date option. A schedule pinned to two
     * literal dates emails a byte-identical file on every run, which looks
     * like working automation and delivers nothing; an administrator who
     * wants one specific date range wants a one-off export, and the report
     * pages already produce that on demand.
     */
    public const PERIODS = [
        'last_7_days',
        'last_30_days',
        'previous_month',
        'month_to_date',
        'all_time',
    ];

    public const FREQUENCIES = ['daily', 'weekly', 'monthly'];

    protected $fillable = [
        'name',
        'report_key',
        'period',
        'filters',
        'recipients',
        'frequency',
        'hour',
        'day_of_week',
        'day_of_month',
        'is_active',
        'last_run_at',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'filters' => 'array',
            'recipients' => 'array',
            'is_active' => 'boolean',
            'hour' => 'integer',
            'day_of_week' => 'integer',
            'day_of_month' => 'integer',
            'last_run_at' => 'datetime',
        ];
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function emailLogs()
    {
        return $this->hasMany(ReportEmailLog::class);
    }

    /**
     * Should this schedule run at `$now`?
     *
     * Three conditions, all of which must hold:
     *
     *   1. The schedule is active.
     *   2. The calendar slot has arrived — the right hour, and for weekly and
     *      monthly schedules the right day.
     *   3. It has not already run in this slot.
     *
     * (3) is the one that matters most, and it is why `last_run_at` exists.
     * The command runs hourly; without this check a slow run, a retry, or two
     * overlapping scheduler ticks would each pass conditions (1) and (2) and
     * send the same report twice. Comparing against the START of the current
     * hour (rather than "less than an hour ago") makes the guard depend on the
     * clock slot rather than on how long the previous run took.
     */
    public function isDue(CarbonInterface $now): bool
    {
        if (! $this->is_active) {
            return false;
        }

        if ((int) $now->hour !== (int) $this->hour) {
            return false;
        }

        if ($this->frequency === 'weekly'
            && $this->day_of_week !== null
            && (int) $now->dayOfWeek !== (int) $this->day_of_week) {
            return false;
        }

        if ($this->frequency === 'monthly'
            && $this->day_of_month !== null
            && (int) $now->day !== (int) $this->day_of_month) {
            return false;
        }

        if ($this->last_run_at !== null
            && $this->last_run_at->greaterThanOrEqualTo($now->copy()->startOfHour())) {
            return false;
        }

        return true;
    }

    /**
     * The concrete [from, to] date strings this schedule's period resolves to
     * at `$now`, as 'Y-m-d' or null for an open end.
     *
     * Returned as dates rather than timestamps because incidents carry a date
     * and no time-of-day component in `incident_date`, so an inclusive
     * whole-day range is the only one that matches what the report pages show.
     */
    public function resolvePeriod(CarbonInterface $now): array
    {
        return match ($this->period) {
            'last_7_days' => [$now->copy()->subDays(7)->toDateString(), $now->toDateString()],
            'previous_month' => [
                $now->copy()->subMonthNoOverflow()->startOfMonth()->toDateString(),
                $now->copy()->subMonthNoOverflow()->endOfMonth()->toDateString(),
            ],
            'month_to_date' => [$now->copy()->startOfMonth()->toDateString(), $now->toDateString()],
            'all_time' => [null, null],
            // last_30_days is the default, and also the fallback for a value
            // that somehow escaped validation — a report over a known window
            // is a better failure than one over an undefined one.
            default => [$now->copy()->subDays(30)->toDateString(), $now->toDateString()],
        };
    }
}
