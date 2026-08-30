<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Closes a row-level-security gap on the three tables added by the
 * 2026_08_28 migrations, and puts RLS under version control so the gap
 * cannot silently reopen.
 *
 * THE PROBLEM
 *
 * Seventeen of the twenty tables in `public` have RLS enabled. The three
 * created most recently — crime_types, incident_evidence and
 * notification_reads — do not. Verified directly against the database:
 * relrowsecurity = false and zero policies on each.
 *
 * That matters because Supabase exposes every table in `public` through
 * PostgREST, and the default grants give `anon` and `authenticated` full
 * SELECT/INSERT/UPDATE/DELETE on them. The publishable key that unlocks
 * those roles ships inside the frontend bundle by design. With RLS off,
 * anyone loading the deployed site can read evidence descriptions, insert
 * or delete evidence rows, rewrite the crime-type vocabulary the Crime
 * Mapping legend is built from, and enumerate user ids from
 * notification_reads — none of which passes through the `role:` middleware
 * in routes/api.php.
 *
 * The root cause is not the three tables. It is that RLS was enabled by
 * hand in the Supabase dashboard for the older tables and never expressed
 * in a migration, so every new table since has shipped unprotected. This
 * migration is where that stops.
 *
 * WHY NO POLICIES
 *
 * RLS with no policies is deny-all for every role except the table owner.
 * That is exactly the posture the other tables already use (incidents and
 * audit_logs are RLS-enabled with zero policies), and it is the correct one
 * here: this application reaches its data ONLY through the Laravel API,
 * never through PostgREST. Adding a permissive policy would re-open the
 * surface this migration exists to close.
 *
 * WHY THE APPLICATION IS UNAFFECTED
 *
 * Laravel connects as `postgres`, which owns all three tables, and
 * PostgreSQL exempts a table's owner from RLS unless FORCE ROW LEVEL
 * SECURITY is also set. It is deliberately NOT set here — the goal is to
 * block the anon/authenticated PostgREST surface, not to change how the
 * API reads its own tables. Verified before writing: relowner = postgres
 * and relforcerowsecurity = false on all three.
 *
 * WHY THIS IS THE FIRST MIGRATION IN THE REPOSITORY TO USE RAW SQL
 *
 * Laravel's schema builder has no RLS API, so ALTER TABLE is the only
 * route. The statement is PostgreSQL-only, and the test suite runs on
 * in-memory SQLite (see phpunit.xml), where every migration is executed by
 * RefreshDatabase. The driver guard below is therefore load-bearing, not
 * defensive tidiness: without it the whole suite fails before the first
 * assertion. Table names are hard-coded constants in this file — none is
 * derived from input.
 *
 * Both directions are idempotent. PostgreSQL treats enabling RLS on a
 * table that already has it (and disabling on one that does not) as a
 * no-op rather than an error, and the hasTable() guard keeps this safe
 * against a partially migrated database.
 */
return new class extends Migration
{
    /**
     * The tables left without RLS by the 2026_08_28 migrations.
     *
     * Deliberately an explicit list rather than "every table without RLS":
     * this migration should do exactly what it was reviewed to do, and a
     * table added later needs its own considered decision, not an
     * automatic one inherited from here.
     */
    private const TABLES = [
        'crime_types',
        'incident_evidence',
        'notification_reads',
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
     * Note for whoever runs this: rolling back re-exposes these three
     * tables to the anon/authenticated PostgREST surface described above.
     * It is the correct inverse of up() and is provided so the migration
     * is reversible, but it is not a neutral operation.
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
     * equivalent and no exposed surface to protect, so this is a no-op
     * there rather than a failure.
     */
    private function supportsRowLevelSecurity(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }
};
