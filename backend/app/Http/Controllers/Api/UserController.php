<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\SupabaseAdminService;
use Illuminate\Http\Request;

// Phase 4 — Admin User Management.
//
// Every action here is reachable only through the `role:badac_admin`
// middleware group in routes/api.php — an Encoder hitting these endpoints
// directly gets a 403 from EnsureRole before this controller ever runs.
// That is the real security boundary; the frontend hiding the "User
// Management" nav item for Encoder is a UX nicety on top of it, same
// pattern as IncidentController's ownership checks.
//
// Scope decisions (documented here rather than silently assumed):
//  - Role is NOT editable through this endpoint. With exactly two role
//    values in the system (badac_admin / encoder), allowing role edits here
//    would turn this into a privilege-escalation surface for very little
//    benefit — Phase 4 requirements were "manage user accounts", not
//    "reassign roles", so it's left out rather than risking that.
//  - No delete endpoint. Both seeded accounts are referenced by
//    incidents.reported_by and audit_logs.user_id; deleting a user would
//    orphan or cascade-delete historical crime records. Deactivate
//    (is_active = false) covers the "an account should stop being usable"
//    need without destroying data. Can be added later if actually needed.
//  - An admin cannot deactivate their own account (self-lockout guard).
class UserController extends Controller
{
    // GET /api/users
    public function index()
    {
        return UserResource::collection(User::orderBy('name')->get());
    }

    // GET /api/users/{user}
    public function show(User $user)
    {
        return new UserResource($user);
    }

    // PUT /api/users/{user}
    //
    // Checkpoint 31: 'email' is intentionally NOT written here. See
    // UpdateUserRequest::rules() — email is not validated/accepted, so
    // $data never contains it even if a caller sends it. This prevents
    // users.email from silently drifting away from the email the user
    // actually authenticates with at Supabase (see AUTH_MIGRATION_STATUS.md
    // and UpdateUserRequest's Checkpoint 31 comment for the full rationale).
    public function update(UpdateUserRequest $request, User $user)
    {
        $data = $request->validated();

        $user->update([
            ...(array_key_exists('fullName', $data) ? ['name' => $data['fullName']] : []),
            ...(array_key_exists('username', $data) ? ['username' => $data['username']] : []),
        ]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "Updated account details for {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }

    // PUT /api/users/{user}/status
    public function updateStatus(Request $request, User $user)
    {
        $request->validate(['isActive' => ['required', 'boolean']]);

        if ($user->id === $request->user()?->id && ! $request->boolean('isActive')) {
            return response()->json(['message' => 'You cannot deactivate your own account.'], 422);
        }

        $user->update(['is_active' => $request->boolean('isActive')]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => ($request->boolean('isActive') ? 'Activated' : 'Deactivated')." account {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }

    // POST /api/users/{user}/two-factor/disable
    // Final auth migration — Laravel TOTP is retired; Supabase MFA is now
    // the only second factor. Reachable only via the same role:badac_admin
    // + supabase.mfa (aal2) route group as the rest of this controller (see
    // routes/api.php) — an Encoder, or an admin who hasn't themselves
    // stepped up to aal2, gets rejected before this method ever runs. This
    // exists for the "lost my phone and my recovery codes" case: an Admin
    // can strip a user's enrolled Supabase MFA factor(s) so they can sign
    // in and re-enroll, without needing the target's own code (that
    // self-service path — supabase.auth.mfa.unenroll() — lives entirely on
    // the frontend; see supabaseMfaService.js).
    //
    // The target's MFA factor lives in Supabase, not in this database, so
    // this can only be done via Supabase's Admin API (service-role key,
    // server-side only — see SupabaseAdminService). If the target has no
    // supabase_user_id yet (never signed in through Supabase) there is
    // nothing to remove.
    public function disableTwoFactor(Request $request, User $user, SupabaseAdminService $supabaseAdmin)
    {
        if (! $user->supabase_user_id) {
            return response()->json(['message' => 'This account has not signed in with Supabase yet — there is no MFA factor to remove.'], 422);
        }

        $factors = $supabaseAdmin->listFactors($user->supabase_user_id);
        if (empty($factors)) {
            return response()->json(['message' => 'Two-factor authentication is not enabled for this account.'], 422);
        }

        $removed = $supabaseAdmin->deleteAllFactors($user->supabase_user_id);
        if ($removed === 0) {
            return response()->json(['message' => 'Could not remove this account\'s MFA factor(s) right now. Please try again.'], 502);
        }

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "Disabled two-factor authentication for {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }
}
