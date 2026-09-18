<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * C2 regression guard — every table in `public` must be closed to the
 * Supabase Data API.
 *
 * WHAT WENT WRONG, AND WHY A TEST EXISTS NOW
 *
 * Supabase exposes every table in `public` through PostgREST, and the default
 * grants give `anon` and `authenticated` full SELECT/INSERT/UPDATE/DELETE on
 * them. The publishable key that unlocks those roles ships inside the frontend
 * bundle by design. Row-level security is therefore the only thing standing
 * between a table and the open internet.
 *
 * RLS had been switched on by hand in the Supabase dashboard rather than in a
 * migration, so a database built purely from this repository was born
 * unprotected: seventeen of twenty-four tables had RLS off, and an
 * unauthenticated caller could read users (password hash, two_factor_secret,
 * supabase_user_id), audit_logs, cache, migrations and settings — and could
 * INSERT into settings successfully. 2026_09_14_000003 closed that and put the
 * state under version control.
 *
 * Neither that migration nor the ones before it can stop the NEXT table from
 * shipping unprotected, because nothing checks. That is exactly how the gap
 * opened the first time. This test is the check.
 *
 * WHY THE TABLE LIST IS DISCOVERED, NOT HARD-CODED
 *
 * Asserting against a fixed list of today's twenty-four tables would pass
 * forever while a twenty-fifth shipped wide open — the precise regression this
 * guards. The list comes from pg_class at run time, so a new table is covered
 * the moment it exists, and its author has to make a deliberate decision.
 *
 * WHY ZERO POLICIES
 *
 * RLS with no policies is deny-all for every role that does not bypass it.
 * That is the posture this application chose: it reaches its data ONLY through
 * the Laravel API (which connects as `postgres`, a BYPASSRLS role), the
 * frontend makes no supabase.from()/rpc()/channel() call, and the backend makes
 * no PostgREST request. So no client needs the Data API at all, and any policy
 * would re-open part of the surface the migration closed. The repository
 * currently documents no exception; if one is ever genuinely needed, this test
 * is where that decision gets recorded.
 *
 * WHY THERE IS NO RefreshDatabase HERE
 *
 * This test only reads the PostgreSQL catalog — it creates nothing and changes
 * nothing. Adding RefreshDatabase would be actively dangerous: the only way to
 * run these assertions is to point the suite at a real PostgreSQL database,
 * and RefreshDatabase would then migrate and wipe whatever database that is,
 * including a developer's local Supabase stack.
 */
class RowLevelSecurityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Row-level security is a PostgreSQL feature and pg_catalog does not
        // exist elsewhere. The suite's default connection is in-memory SQLite
        // (see phpunit.xml), where there is no Data API and nothing to expose,
        // so this skips cleanly rather than failing. See this class's report
        // note: to actually exercise it, run this file with DB_CONNECTION=pgsql
        // pointed at a local Supabase stack.
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Row-level security is PostgreSQL-only; the default test connection is SQLite.');
        }
    }

    /**
     * Every ordinary and partitioned table in `public`, straight from the
     * catalog. Views, sequences and indexes are excluded: RLS does not apply
     * to them.
     *
     * @return array<int, object{relname: string, relrowsecurity: bool}>
     */
    private function publicTables(): array
    {
        return DB::select(
            "select c.relname, c.relrowsecurity
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relkind in ('r', 'p')
              order by c.relname"
        );
    }

    public function test_every_public_table_has_row_level_security_enabled(): void
    {
        $tables = $this->publicTables();

        // Guards against a vacuous pass: an empty result would satisfy every
        // assertion below while proving nothing at all.
        $this->assertNotEmpty(
            $tables,
            'No tables were found in schema public — this test is not inspecting the CDARS database.'
        );

        $unprotected = array_map(
            fn ($table) => $table->relname,
            array_filter($tables, fn ($table) => ! $table->relrowsecurity)
        );

        $this->assertSame(
            [],
            array_values($unprotected),
            "These tables in `public` have row-level security DISABLED, which exposes them through the Supabase Data API to anyone holding the publishable key that ships in the frontend bundle.\n".
            'Enable RLS in a migration (see 2026_09_14_000003_enable_row_level_security_on_remaining_public_tables.php) rather than by hand in the Supabase dashboard — a dashboard change is invisible to a freshly built database, which is how this gap opened the first time.'
        );
    }

    public function test_no_policy_re_opens_a_public_table_to_anon_or_authenticated(): void
    {
        $policies = DB::select(
            "select tablename, policyname, cmd, roles::text as roles
               from pg_policies
              where schemaname = 'public'
              order by tablename, policyname"
        );

        $described = array_map(
            fn ($policy) => "{$policy->tablename}.{$policy->policyname} (cmd={$policy->cmd}, roles={$policy->roles})",
            $policies
        );

        $this->assertSame(
            [],
            $described,
            "A row-level-security policy exists on a table in `public`. This application serves all data through the Laravel API and needs no Data API access, so RLS here is deliberately deny-all with zero policies; any policy grants some role direct PostgREST access to application data.\n".
            'If a policy is genuinely required, it must be added in a migration together with the reason, and this expectation updated to record it as a documented exception.'
        );
    }
}
