<?php

namespace App\Console\Commands;

use App\Services\SupabaseAdminService;
use Illuminate\Console\Command;

/**
 * Deploy-time check that this backend can still authenticate to Supabase as an
 * administrator.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-03 the configured service-role credential started being rejected
 * with HTTP 401. Every MFA security-state lookup threw, the middleware failed
 * closed exactly as designed, and the only outward symptom was ordinary users
 * being told - falsely - that their administrator required two-factor
 * authentication. The failure was invisible from outside: Laravel's warnings
 * went to a container-local log file that Render never surfaces, so nothing in
 * the deploy log or the dashboard said anything was wrong.
 *
 * This command is the missing loud failure. It is read-only, touches no
 * account, and is safe to run on every boot.
 *
 * WHAT IT DELIBERATELY DOES NOT PRINT
 * -----------------------------------
 * The service-role/secret key, the Authorization header, any JWT, any TOTP
 * secret, any user record, and the full Supabase URL. It prints a presence
 * flag, the project reference (which is already public - it is in the URL the
 * browser talks to), an HTTP status code, and a sanitized reason. Everything
 * here is safe to paste into a deploy log or a support ticket.
 */
class CheckSupabaseAdminCredential extends Command
{
    protected $signature = 'supabase:check-admin-credential';

    protected $description = 'Verify the Supabase Admin API credential without revealing it';

    public function handle(SupabaseAdminService $supabaseAdmin): int
    {
        // Presence only, never the value. strlen is deliberately NOT reported:
        // the length of a credential is a small leak with no diagnostic value
        // that "configured" does not already give.
        $this->line('Supabase URL configured:            '.(config('supabase.url') ? 'yes' : 'NO'));
        $this->line('Supabase service key configured:    '.(config('supabase.service_role_key') ? 'yes' : 'NO'));
        $this->line('Supabase project:                   '.$this->projectRef());

        $result = $supabaseAdmin->checkAdminCredential();

        $status = $result['status'] === null ? 'none' : (string) $result['status'];
        $this->line('Admin API response status:          '.$status);

        if ($result['ok']) {
            $this->info('OK: the Supabase Admin API credential is accepted.');

            return self::SUCCESS;
        }

        // Loud on purpose. This is the state that previously went unnoticed for
        // hours while users were pushed into two-factor enrolment.
        $this->error('FAIL: '.$result['reason']);
        $this->error('MFA enrolment status cannot be determined while this is failing.');
        $this->error('EnsureSupabaseAal2 fails CLOSED, so users will be told a second');
        $this->error('factor is owed even when no administrator required one.');

        return self::FAILURE;
    }

    /**
     * The project reference from the configured URL - e.g. the "abcdefgh" in
     * https://abcdefgh.supabase.co. Public information: the browser sends it on
     * every request. Reported because the likeliest configuration mistake is a
     * credential belonging to a DIFFERENT project, and naming the project being
     * talked to is what makes that visible.
     */
    private function projectRef(): string
    {
        $host = parse_url((string) config('supabase.url'), PHP_URL_HOST);

        if (! is_string($host) || $host === '') {
            return 'unknown (SUPABASE_URL not set or unparseable)';
        }

        return explode('.', $host)[0];
    }
}
