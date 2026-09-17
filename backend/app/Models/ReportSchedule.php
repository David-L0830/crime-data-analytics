<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

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
     * ARCHIVE, NOT DELETE. SoftDeletes on `archived_at` (see the
     * 2026_09_17_000003 migration). Its global scope removes an archived
     * schedule from EVERY query unless one asks for it explicitly with
     * withTrashed()/onlyTrashed(): the hourly command (including its
     * --schedule=ID path), ScheduledReportDispatcher::dispatchDue(), and
     * route-model binding, so editing or running an archived schedule is a 404
     * until it is restored. Nothing has to remember to filter it out.
     *
     * Archive state is independent of pause state: archiving and restoring
     * never read or write `is_active`. delete() archives and restore()
     * un-archives; the row is never removed, so its delivery history keeps its
     * link. There is deliberately no forceDelete() call anywhere.
     */
    use SoftDeletes;

    public const DELETED_AT = 'archived_at';

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
     * The most recent run of this schedule, scheduled or manual — what the
     * Scheduled Reports module shows as "Last result". Read from the email log
     * rather than stored on the schedule, so it can never disagree with it.
     */
    public function latestEmailLog()
    {
        return $this->hasOne(ReportEmailLog::class)->latestOfMany('generated_at');
    }

    /**
     * The next hour slot at which isDue() will return true, or null for a
     * paused schedule.
     *
     * Derived from isDue() itself — each candidate slot is tested with the
     * same method the hourly command uses — so this display value cannot
     * describe a rule the scheduler does not actually follow. The current hour
     * counts only while it has not already run in it. 62 days of hourly slots
     * covers every monthly schedule (day 1-28) from any starting point.
     */
    public function nextRunAt(CarbonInterface $now): ?CarbonInterface
    {
        if (! $this->is_active) {
            return null;
        }

        // Today's slot, or tomorrow's if today's hour has already passed.
        $slot = $now->copy()->startOfDay()->setTime((int) $this->hour, 0);
        if ($slot->lessThan($now->copy()->startOfHour())) {
            $slot->addDay();
        }

        for ($i = 0; $i <= 62; $i++) {
            if ($this->isDue($slot)) {
                return $slot;
            }
            $slot = $slot->copy()->addDay();
        }

        return null;
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
    /**
     * May this schedule send mail at all, by ANY path?
     *
     * The single rule behind every send: the hourly command, its
     * --schedule=ID (and --force) path, and Run Now all go through
     * ScheduledReportDispatcher::runOnce(), which refuses a schedule for which
     * this is false. Due-ness is a separate, narrower question (isDue) that
     * only the automatic path asks — --force skips that, never this.
     *
     *   active        sendable
     *   paused        not sendable (is_active = false)
     *   archived      not sendable (archived_at set), whatever is_active says
     *
     * Restoring clears archived_at only, so a schedule restored from paused
     * stays unsendable until it is resumed.
     */
    public function isSendable(): bool
    {
        return $this->exists && $this->is_active && ! $this->trashed();
    }

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
