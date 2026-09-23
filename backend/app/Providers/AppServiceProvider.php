<?php

namespace App\Providers;

use App\Models\User;
use App\Services\Audit\AuditStore;
use App\Services\Audit\DatabaseAuditStore;
use App\Services\Audit\ServiceAuditStore;
use App\Services\SupabaseTokenValidator;
use Illuminate\Auth\Access\Response;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Where the audit trail lives: audit_logs here (the default, and every
        // hosted environment), or the isolated service-audit microservice in
        // the local compose stack. See config/audit.php.
        $this->app->singleton(AuditStore::class, fn ($app) => config('audit.driver') === 'service'
            ? $app->make(ServiceAuditStore::class)
            : $app->make(DatabaseAuditStore::class));
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

        // Account governance: may this caller act on that account through
        // User Management? The `role:` middleware on the /users routes decides
        // who may use User Management at all; this decides WHICH accounts,
        // which a role list on a route cannot express. Super Administrator
        // manages Administrators, Administrator manages Encoders and
        // Validators, and nobody manages a Super Administrator. See
        // User::manageableRoles().
        Gate::define('manage-account', function (User $actor, User $target) {
            return $actor->canManageAccount($target)
                ? Response::allow()
                : Response::deny('You do not have permission to manage this account.');
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
