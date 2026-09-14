<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Finishes what 2026_08_29_000001 started: every table in `public` is now
 * RLS-enabled by migration rather than by hand.
 *
 * THE PROBLEM
 *
 * That earlier migration protected the three tables it named and recorded
 * that the rest of `public` was already covered. That was true of the
 * PRODUCTION database, where RLS had been switched on by hand in the
 * Supabase dashboard. It was never true of a database built purely from
 * this repository: a fresh `php artisan migrate` produces tables with RLS
 * OFF, because the dashboard clicks were never expressed as migrations.
 *
 * Measured on a local stack built from this repository: of twenty-four
 * tables in `public`, seven had RLS enabled (the three from 2026_08_29,
 * report_schedules and report_email_logs from 2026_09_11, and the two
 * email_mfa_* tables from 2026_09_14) and seventeen did not.
 *
 * The seventeen were reachable through PostgREST with the publishable key
 * that ships in the frontend bundle. Verified against the local Data API,
 * unauthenticated:
 *
 *   - SELECT returned real rows from users (password hash, two_factor_secret,
 *     two_factor_recovery_codes, supabase_user_id), audit_logs, cache,
 *     migrations and settings.
 *   - INSERT into settings SUCCEEDED and created a row, because every column
 *     it needs has a default.
 *   - INSERT into users/incidents/criminals/audit_logs/cache reached the
 *     NOT NULL checks, i.e. authorization had already passed.
 *   - UPDATE was accepted (0 rows changed only because the filter matched
 *     nothing).
 *
 * `cache` is the sharpest edge: it holds the cached MFA security state and
 * the rate-limit counters, so write access to it is write access to the
 * second-factor decision in EnsureSupabaseAal2.
 *
 * WHY NO POLICIES
 *
 * RLS with no policies is deny-all for every role except one that bypasses
 * it. That is the posture 2026_08_29 chose, and it is right here too: this
 * application reaches its data ONLY through the Laravel API. The frontend
 * contains no supabase.from()/rpc()/channel() call and the backend makes no
 * PostgREST request, so no client needs the Data API at all. A permissive
 * policy would re-open exactly what this closes.
 *
 * WHY THE APPLICATION IS UNAFFECTED
 *
 * Laravel connects as `postgres`, which has BYPASSRLS and owns these tables;
 * PostgreSQL exempts both from RLS unless FORCE ROW LEVEL SECURITY is set,
 * and it is deliberately NOT set here. `anon` and `authenticated` cannot log
 * in directly at all (rolcanlogin = false) — they exist only as the roles
 * PostgREST switches into, which is precisely the surface being closed.
 *
 * BEFORE DEPLOYING THIS BEYOND A LOCAL STACK
 *
 * Confirm which database user Metabase connects as (docs/CURRENT_STATE.md
 * question H-3 — recorded there as unverified). RLS with no policies hides
 * every row from a role that does not bypass it, so a Metabase datasource
 * connecting as something other than `postgres` would see empty dashboards.
 * Two things suggest this is already fine in production — the 2026_08_29
 * docblock records `incidents` and `audit_logs` as already RLS-enabled with
 * zero policies there, and Metabase reads `incidents` — but that is
 * inference, not verification, and the owner can settle it in one look at
 * Metabase → Admin → Databases.
 *
 * Both directions are idempotent: PostgreSQL treats enabling RLS on a table
 * that already has it (and disabling on one that does not) as a no-op, so
 * this is safe against a database where some of these are already protected.
 * Grants are deliberately left alone; revoking anon/authenticated privileges
 * is separate defence-in-depth work, not part of this change.
 */
return new class extends Migration
{
    /**
     * The seventeen tables measured without RLS on a repository-built stack.
     *
     * An explicit list, for the same reason 2026_08_29 used one: this
     * migration should do exactly what it was reviewed to do, and any table
     * added later deserves its own decision rather than one inherited here.
     */
    private const TABLES = [
        'app_notifications',
        'audit_logs',
        'cache',
        'cache_locks',
        'criminal_incident',
        'criminals',
        'failed_jobs',
        'incident_victim',
        'incidents',
        'jobs',
        'migrations',
        'password_reset_tokens',
        'sessions',
        'settings',
        'sync_logs',
        'users',
        'victims',
    ];

    public function up(): void
    {
        if (! $this->supportsRowLevelSecurity()) {
            return;
        }

        foreach (self::TABLES as $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            DB::statement("ALTER TABLE public.\"{$table}\" ENABLE ROW LEVEL SECURITY");
        }
    }

    /**
     * Restores the exact prior state.
     *
     * Note for whoever runs this: rolling back re-exposes all seventeen
     * tables — including users, incidents, criminals, victims and cache — to
     * the anon/authenticated PostgREST surface described above. It is the
     * correct inverse of up() and is provided so the migration is
     * reversible, but it is not a neutral operation.
     */
    public function down(): void
    {
        if (! $this->supportsRowLevelSecurity()) {
            return;
        }

        foreach (self::TABLES as $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            DB::statement("ALTER TABLE public.\"{$table}\" DISABLE ROW LEVEL SECURITY");
        }
    }

    /**
     * Row-level security is a PostgreSQL feature. SQLite (tests) has no
     * equivalent and no exposed surface to protect, so this is a no-op there
     * rather than a failure.
     */
    private function supportsRowLevelSecurity(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }
};
