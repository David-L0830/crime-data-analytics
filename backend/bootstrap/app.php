<?php

use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\EnsureSupabaseAal2;
use App\Http\Middleware\LogAuditAction;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // This API has no named 'login' route (Supabase handles login on
        // the frontend only — see routes/web.php). Without this line,
        // Laravel's default Authenticate middleware tries to build a
        // redirect URL via route('login') before it even throws the
        // AuthenticationException, which crashes with
        // "Route [login] not defined" instead of returning a clean JSON
        // 401. This forces it to never attempt a redirect.
        $middleware->redirectGuestsTo(fn () => null);

        // Final auth migration — this API is fully stateless (Bearer
        // Supabase JWTs only). Sanctum's statefulApi() cookie/CSRF
        // middleware was removed along with the laravel/sanctum package
        // itself — see AUTH_MIGRATION_STATUS.md. No route issues or reads
        // a session cookie anymore.
        $middleware->alias([
            'audit.log' => LogAuditAction::class,
            'role' => EnsureRole::class,
            // Requires the Supabase JWT's `aal` claim to be 'aal2' — see
            // EnsureSupabaseAal2's own comment for exactly which routes
            // apply this and why.
            'supabase.mfa' => EnsureSupabaseAal2::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Ensure API routes always receive JSON error responses instead of
        // Laravel's default HTML error pages (see AppExceptions for details).
        $exceptions->shouldRenderJsonWhen(function ($request, Throwable $e) {
            return $request->is('api/*') || $request->expectsJson();
        });
    })->create();
