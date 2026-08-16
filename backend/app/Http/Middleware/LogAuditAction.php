<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// Currently a pass-through placeholder — controllers write audit_logs entries
// directly (see AuditLog::create() calls) because the log message needs
// action-specific context (e.g. which case number changed). Kept as a named
// middleware alias so routes can be annotated for readability and so a
// generic request-level audit trail can be added later without touching
// every controller.
class LogAuditAction
{
    public function handle(Request $request, Closure $next): Response
    {
        return $next($request);
    }
}
