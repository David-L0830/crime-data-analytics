<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use Illuminate\Http\Request;

// Final auth migration — Supabase Auth is the only credential system this
// application has. AuthController no longer authenticates anyone itself
// (there is no more login()/password check/session start here — see
// AUTH_MIGRATION_STATUS.md); it only ever runs AFTER
// App\Services\SupabaseTokenValidator has already verified a Supabase JWT
// and resolved it to a local User (see the 'supabase' guard in
// AppServiceProvider::boot() and the 'auth:supabase' middleware in
// routes/api.php). Every method below assumes $request->user() is already
// populated by that guard.
class AuthController extends Controller
{
    // POST /api/logout
    // Stateless by design: there is no Laravel session or Sanctum token to
    // invalidate anymore. The actual sign-out (ending the Supabase session,
    // clearing the client's stored Supabase JWT) happens entirely on the
    // frontend via supabase.auth.signOut() — see AuthContext.jsx. This
    // endpoint's only remaining job is writing the audit trail entry while
    // the caller's token is still verifiably valid.
    public function logout(Request $request)
    {
        $user = $request->user();

        if ($user) {
            AuditLog::create([
                'user_id' => $user->id,
                'action' => 'LOGOUT',
                'module' => 'auth',
                'target_type' => 'auth',
                'description' => 'User signed out',
                'ip_address' => $request->ip(),
            ]);
        }

        return response()->json(['message' => 'Logged out.']);
    }

    // GET /api/user
    public function user(Request $request)
    {
        return new UserResource($request->user());
    }
}
