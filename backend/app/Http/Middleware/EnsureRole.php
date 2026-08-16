<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// Route-level role guard: `role:badac_admin` (or a comma-separated list)
// restricts a route to the given role(s). This is the server-side half of
// RBAC — the React sidebar/ProtectedRoute hides links, but a restricted
// Encoder hitting the endpoint directly still gets a 403 here, since
// frontend-only hiding is not real authorization.
class EnsureRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user || ! in_array($user->role, $roles, true)) {
            return response()->json(['message' => 'Forbidden — insufficient role.'], 403);
        }

        return $next($request);
    }
}
