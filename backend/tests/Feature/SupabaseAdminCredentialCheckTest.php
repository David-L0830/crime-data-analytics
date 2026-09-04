<?php

namespace Tests\Feature;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The deploy-time credential check — App\Console\Commands\CheckSupabaseAdminCredential.
 *
 * This is the alarm that was missing on 2026-09-03. A rejected service-role
 * credential made every MFA lookup throw; the system failed closed correctly,
 * but the only symptom anyone could see was users being told to enrol in
 * two-factor authentication, and the explanatory warnings went to a
 * container-local log file Render never surfaces.
 *
 * So the two properties worth pinning are: it FAILS on a rejected credential
 * (a check that quietly passes is worse than none), and it never prints the
 * credential.
 */
class SupabaseAdminCredentialCheckTest extends TestCase
{
    public function test_it_passes_when_the_credential_is_accepted(): void
    {
        // 404 for the nil UUID is the success case: GoTrue authenticated the
        // request and then found no such user. That is exactly what proves the
        // credential works without reading anybody's account.
        Http::fake(['*/auth/v1/admin/users/*' => Http::response(['msg' => 'not found'], 404)]);

        $this->artisan('supabase:check-admin-credential')
            ->expectsOutputToContain('OK: the Supabase Admin API credential is accepted.')
            ->assertExitCode(0);
    }

    public function test_it_fails_loudly_on_a_rejected_credential(): void
    {
        // The incident, as a test. A non-zero exit is what makes the entrypoint
        // print its warning banner.
        Http::fake(['*/auth/v1/admin/users/*' => Http::response(['msg' => 'unauthorized'], 401)]);

        $this->artisan('supabase:check-admin-credential')
            ->expectsOutputToContain('FAIL')
            ->assertExitCode(1);
    }

    public function test_it_fails_when_supabase_cannot_be_reached(): void
    {
        Http::fake(function () {
            throw new ConnectionException('unreachable');
        });

        $this->artisan('supabase:check-admin-credential')
            ->expectsOutputToContain('FAIL')
            ->assertExitCode(1);
    }

    public function test_it_never_prints_the_credential(): void
    {
        // The whole point of a check that is safe to run on every boot and
        // paste into a ticket. Asserted against the real rendered output, not
        // by reading the source.
        // Asserted with doesntExpectOutputToContain, which inspects the real
        // rendered output. An earlier version of this test read
        // Artisan::output() after the fact, got an empty string, and passed
        // vacuously — it would have stayed green with the key printed in full.
        config(['supabase.service_role_key' => 'super-secret-key-value-do-not-print']);
        Http::fake(['*/auth/v1/admin/users/*' => Http::response([], 401)]);

        $this->artisan('supabase:check-admin-credential')
            ->doesntExpectOutputToContain('super-secret-key-value-do-not-print')
            ->doesntExpectOutputToContain('Bearer')
            // Presence is reported, the value never is.
            ->expectsOutputToContain('Supabase service key configured:')
            ->assertExitCode(1);
    }

    public function test_it_reports_the_project_reference_so_a_wrong_project_is_visible(): void
    {
        // The likeliest configuration mistake is a credential for a DIFFERENT
        // Supabase project. Naming the project being talked to is what makes
        // that mistake visible in a deploy log. The reference is public — it is
        // in the URL the browser already uses.
        config(['supabase.url' => 'https://examplecdars.supabase.co']);
        Http::fake(['*/auth/v1/admin/users/*' => Http::response([], 404)]);

        $this->artisan('supabase:check-admin-credential')
            ->expectsOutputToContain('examplecdars')
            ->assertExitCode(0);
    }
}
