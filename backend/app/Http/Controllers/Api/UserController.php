<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Resources\AuditLogResource;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\SupabaseAdminService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use RuntimeException;

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
//  - Accounts CAN now be created here (POST /api/users), which they could
//    not before. Role is chosen at creation because that is provisioning,
//    not escalation of a live identity — see StoreUserRequest. Role still
//    cannot be CHANGED through update(), for the reason directly above.
//  - No delete endpoint. Both seeded accounts are referenced by
//    incidents.reported_by and audit_logs.user_id; deleting a user would
//    orphan or cascade-delete historical crime records. Deactivate
//    (is_active = false) covers the "an account should stop being usable"
//    need without destroying data. Can be added later if actually needed.
//  - An admin cannot deactivate their own account (self-lockout guard).
class UserController extends Controller
{
    // The LOGIN-row aggregate behind UserResource's `lastLoginAt`. Applied as
    // a single withMax subquery so listing every account costs one extra
    // query in total rather than one per row — see User::lastLoginAt(), which
    // reads this aggregate when it is present.
    private function withLastLogin(Builder $query): Builder
    {
        return $query->withMax(
            ['auditLogs as last_login_at' => fn ($q) => $q->where('action', 'LOGIN')],
            'created_at'
        );
    }

    // GET /api/users
    public function index()
    {
        return UserResource::collection(
            $this->withLastLogin(User::query())->orderBy('name')->get()
        );
    }

    // GET /api/users/{user}
    public function show(User $user)
    {
        return new UserResource(
            $this->withLastLogin(User::query())->findOrFail($user->id)
        );
    }

    // POST /api/users
    //
    // Administrator-provisioned account creation. An account is only usable
    // when it exists in BOTH systems: Supabase Auth (which owns every
    // credential — this backend has never held a password) and this
    // database's users table (which owns identity, role and status). Writing
    // only the local row would produce an account that can never sign in, so
    // both are written here, in one request, or neither is.
    //
    // Ordering and failure handling are deliberate:
    //   1. The local row is inserted inside a transaction first, so username
    //      and email uniqueness are decided by the database rather than
    //      guessed at before the call to Supabase.
    //   2. Supabase Auth is provisioned via the Admin API (service-role key,
    //      server-side only — see SupabaseAdminService::createUser).
    //   3. If Supabase refuses, the transaction is rolled back and NO local
    //      row survives — there is no half-created account, and the admin
    //      gets Supabase's actionable reason (e.g. the address is already
    //      registered there).
    //
    // The administrator never chooses or sees a password. The new user
    // receives a Supabase password-recovery email (requested from the
    // frontend through the same supabase.auth.resetPasswordForEmail
    // mechanism the public Forgot Password page already uses) and sets their
    // own.
    public function store(StoreUserRequest $request, SupabaseAdminService $supabaseAdmin)
    {
        $data = $request->validated();

        // Captured by reference so it survives the transaction being rolled
        // back. Supabase is a separate system: a database rollback undoes the
        // local row but cannot undo an account created over HTTP, so this
        // records whether there is anything to compensate for.
        $supabaseUserId = null;

        try {
            $user = DB::transaction(function () use ($data, $supabaseAdmin, &$supabaseUserId) {
                $user = User::create([
                    'name' => $data['fullName'],
                    'username' => $data['username'],
                    'email' => $data['email'],
                    'role' => $data['role'],
                    'is_active' => $data['isActive'] ?? true,
                ]);

                $supabaseUserId = $supabaseAdmin->createUser($data['email']);

                $user->forceFill([
                    'supabase_user_id' => $supabaseUserId,
                    'email_verified_at' => now(),
                ])->save();

                return $user;
            });
        } catch (\Throwable $e) {
            // The local row is already gone — the transaction rolled it back.
            // If Supabase was provisioned before the failure, undo that too,
            // otherwise the address is silently taken in Supabase Auth
            // forever: every retry would then fail with "already registered"
            // and the administrator would have no way forward from the UI.
            // The orphan would not be a privilege risk (it has no local
            // account, so SupabaseTokenValidator rejects its tokens and it can
            // never sign in) but it would be an unrecoverable dead end.
            if ($supabaseUserId !== null) {
                $supabaseAdmin->deleteUser($supabaseUserId);
            }

            // SupabaseAdminService throws RuntimeException for a missing
            // service-role key, an already-registered address, or an Admin API
            // refusal. Those messages are written for an administrator to act
            // on and contain no credential or internal detail, so they are
            // passed through.
            if ($e instanceof RuntimeException) {
                return response()->json(['message' => $e->getMessage()], 422);
            }

            // Anything else (a database failure, for instance) is a genuine
            // server fault. It is re-thrown rather than flattened into a 422,
            // so it is logged and reported as the 500 it actually is instead
            // of masquerading as bad input from the administrator.
            throw $e;
        }

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'CREATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "Created {$user->role_label} account {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return (new UserResource($user))->response()->setStatusCode(201);
    }

    // GET /api/users/{user}/activity
    //
    // The selected account's own audit trail, for the User Activity view.
    // This deliberately reuses the existing audit_logs table and
    // AuditLogResource rather than introducing any second activity store:
    // every row here was written by the same controllers that write the
    // Audit Logs module, and nothing new is recorded to support this view.
    //
    // Scoped by user_id at the query level, not filtered in the browser, so
    // a user's older activity cannot be hidden by the global 200-row cap on
    // GET /audit-logs.
    public function activity(Request $request, User $user)
    {
        $logs = $user->auditLogs()
            ->with('user')
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        // Reading one account's activity is itself an administrative act on
        // another person's record, so it is auditable in its own right.
        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'VIEW',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "Viewed account activity for {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return AuditLogResource::collection($logs);
    }

    // POST /api/users/{user}/password-reset-audit
    //
    // Records that an administrator sent this account a password-reset
    // email. It is named for exactly what it does: it does NOT send the
    // email and does NOT touch any credential.
    //
    // The email itself is sent by Supabase, requested from the browser via
    // supabase.auth.resetPasswordForEmail() — the identical mechanism the
    // public Forgot Password page uses (see src/pages/ForgotPassword.jsx).
    // That call is made first and this endpoint is only reached once it has
    // succeeded, so the audit trail never claims a reset was sent when it
    // was not. No token, link, or password ever passes through here.
    public function passwordResetAudit(Request $request, User $user)
    {
        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => "Sent a password reset email to {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return response()->json(['message' => 'Password reset recorded.']);
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
