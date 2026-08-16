<?php

namespace App\Providers;

use App\Services\SupabaseTokenValidator;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
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
