<?php

namespace App\Providers;

use App\Services\SupabaseTokenValidator;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        if (config('app.env') === 'production') {
            URL::forceScheme('https');
        }

        // Final auth migration — Supabase Auth is the only authentication
        // system this application has (see AUTH_MIGRATION_STATUS.md).
        // Registers the stateless, request-based 'supabase' guard
        // (config/auth.php), backed entirely by SupabaseTokenValidator,
        // which verifies the Supabase JWT's signature (JWKS, with an
        // HS256 shared-secret fallback), `exp`, `aud`, and `iss` before
        // ever resolving a local User — see that class for the full
        // verification chain. Every 'auth:supabase' route in
        // routes/api.php goes through this guard; there is no other guard
        // and no fallback.
        Auth::viaRequest('supabase', function (Request $request) {
            return app(SupabaseTokenValidator::class)->resolveUser($request);
        });

        // Email MFA throttles (routes/api.php, EmailMfaController). Keyed on
        // the authenticated user — these routes sit behind 'auth:supabase', so
        // there is always one — and each Limit carries its own key, because
        // limits sharing a key would share a counter.
        //
        // Sending: one code a minute, five an hour, which caps mail volume.
        // Verifying: ten tries a minute across requests, on top of the five
        // wrong entries each individual code tolerates (EmailMfaService).
        // Together that bounds guessing to roughly 25 attempts an hour against
        // a 1-in-1,000,000 code, for someone who already holds the password.
        RateLimiter::for('email-mfa-send', function (Request $request) {
            $key = (string) $request->user()?->id;

            return [
                Limit::perMinute(1)->by('email-mfa-send:minute:'.$key),
                Limit::perHour(5)->by('email-mfa-send:hour:'.$key),
            ];
        });

        RateLimiter::for('email-mfa-verify', function (Request $request) {
            return Limit::perMinute(10)->by('email-mfa-verify:'.$request->user()?->id);
        });

        // POST /me/password. Each attempt makes up to two Supabase Auth calls
        // (verify the current password, then set the new one), so it is kept
        // tight enough that it cannot be used to guess the current password.
        RateLimiter::for('password-change', function (Request $request) {
            $key = (string) $request->user()?->id;

            return [
                Limit::perMinute(5)->by('password-change:minute:'.$key),
                Limit::perHour(20)->by('password-change:hour:'.$key),
            ];
        });

        // Password reset (like login, MFA, and Google OAuth) is handled
        // entirely by Supabase Auth's own client-side flow
        // (supabase.auth.resetPasswordForEmail() /
        // supabase.auth.updateUser({ password }) — see
        // src/pages/ForgotPassword.jsx / ResetPassword.jsx). This backend
        // never sends a password-reset email and never issues a reset
        // token, so there is no ResetPassword notification to customize
        // here anymore.
    }
}
