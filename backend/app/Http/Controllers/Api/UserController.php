<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SupabasePasswordUpdateException;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Resources\AuditLogResource;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Rules\AcceptablePassword;
use App\Services\SupabaseAdminService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
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
    // Two ways to give the new account its first password:
    //
    //   * No `temporaryPassword` (the original path): nobody chooses or sees a
    //     password. The new user receives a Supabase password-recovery email
    //     (requested from the frontend through the same
    //     supabase.auth.resetPasswordForEmail mechanism the public Forgot
    //     Password page uses) and sets their own.
    //
    //   * `temporaryPassword` supplied: Supabase Auth is provisioned with that
    //     password, and the local row is marked must_change_password with a
    //     TEMPORARY_PASSWORD_TTL_HOURS expiry and the issuing administrator. No
    //     recovery email is involved on this path — sending one is the
    //     frontend's job, and it is not requested here.
    //
    // The temporary password is only ever an argument to the Supabase call. It
    // is not stored on the local row, not returned, and not written to the
    // audit trail or the log. (Enforcing the change on next sign-in is a later
    // phase; this only records that it is owed.)
    public function store(StoreUserRequest $request, SupabaseAdminService $supabaseAdmin)
    {
        $data = $request->validated();

        // Pulled out of $data at once so nothing below can pass the whole
        // validated array — password and all — anywhere by accident.
        $temporaryPassword = $data['temporaryPassword'] ?? null;
        unset($data['temporaryPassword']);
        $issuedBy = $request->user()?->id;

        // Validated to one of User::MFA_METHOD_CHOICES. The two methods are
        // stored in the two places enforcement already reads:
        //   email_otp         -> users.mfa_method = 'email_otp'
        //                        (EnsureSupabaseAal2::handleEmailOtpAccount)
        //   authenticator_app -> users.mfa_method stays NULL, and the Supabase
        //                        identity is created with
        //                        app_metadata.mfa_required = true, so the first
        //                        sign-in is sent through authenticator
        //                        enrolment (SupabaseAdminService::requiresAal2)
        $mfaMethod = $data['mfaMethod'];
        $usesAuthenticatorApp = $mfaMethod === User::MFA_METHOD_AUTHENTICATOR_APP;

        // Captured by reference so it survives the transaction being rolled
        // back. Supabase is a separate system: a database rollback undoes the
        // local row but cannot undo an account created over HTTP, so this
        // records whether there is anything to compensate for.
        $supabaseUserId = null;

        try {
            $user = DB::transaction(function () use ($data, $supabaseAdmin, &$supabaseUserId, $temporaryPassword, $issuedBy, $usesAuthenticatorApp) {
                $user = User::create([
                    'name' => $data['fullName'],
                    'username' => $data['username'],
                    'email' => $data['email'],
                    'role' => $data['role'],
                    'is_active' => $data['isActive'] ?? true,
                ]);

                $supabaseUserId = $supabaseAdmin->createUser(
                    $data['email'],
                    $temporaryPassword,
                    $usesAuthenticatorApp ? ['mfa_required' => true] : [],
                );

                // The compensating delete below is only ever allowed to touch
                // an identity THIS operation created. Supabase is expected to
                // reject a duplicate rather than hand back the existing user,
                // but that is an assumption about a third party's behaviour,
                // and the consequence of it being wrong would be deleting a
                // live account belonging to somebody else.
                //
                // So the returned id is checked against the accounts already
                // linked here. If another account holds it, Supabase did not
                // create it for us: the compensation id is cleared BEFORE
                // throwing, which is what disarms the delete in the catch
                // block. Clearing it is the load-bearing line -- without it,
                // the unique constraint on users.supabase_user_id would make
                // the save below fail and the catch would delete the other
                // account's identity.
                //
                // (An id that no local account holds is left alone rather than
                // deleted: it is either genuinely new, or an orphan for this
                // same address, and adopting an orphan is recoverable while
                // deleting one is not.)
                if (User::where('supabase_user_id', $supabaseUserId)->exists()) {
                    $supabaseUserId = null;

                    throw new RuntimeException('That email address is already registered in Supabase Auth.');
                }

                // An Authenticator App account whose requirement did not stick
                // would be an account with no MFA at all, which is exactly what
                // choosing a method is meant to rule out. So the flag is read
                // back from Supabase itself, not assumed from the create call,
                // and if it is not there the account is not created: the throw
                // rolls back the local row and the catch below deletes the
                // Supabase identity this operation just made. A failed lookup
                // throws too, with the same effect.
                if ($usesAuthenticatorApp && ! $supabaseAdmin->mfaRequiredByAdmin($supabaseUserId)) {
                    throw new RuntimeException('Supabase did not confirm the authenticator app requirement, so the account was not created. Please try again.');
                }

                $state = [
                    'supabase_user_id' => $supabaseUserId,
                    'email_verified_at' => now(),
                ];

                // Not fillable (see User), so it is set here alongside the other
                // state, in the same save and under the same rollback.
                if (! $usesAuthenticatorApp) {
                    $state['mfa_method'] = User::MFA_METHOD_EMAIL_OTP;
                }

                // Written in the SAME save as the Supabase link, so a failure
                // here is covered by exactly the same rollback + compensating
                // delete as any other failure after provisioning.
                if ($temporaryPassword !== null) {
                    $state += [
                        'must_change_password' => true,
                        'temporary_password_expires_at' => now()->addHours(User::TEMPORARY_PASSWORD_TTL_HOURS),
                        'temporary_password_issued_by' => $issuedBy,
                    ];
                }

                $user->forceFill($state)->save();

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
            // Only ever non-null for an identity this operation created and
            // that no other account is linked to -- see the guard above.
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
            // Records THAT a temporary password was issued, never anything
            // about the password itself.
            // The MFA method is recorded by name; nothing about a factor,
            // secret or code exists at this point to record.
            'description' => ($temporaryPassword !== null
                ? "Created {$user->role_label} account {$user->username} with a temporary password"
                : "Created {$user->role_label} account {$user->username}")
                .($usesAuthenticatorApp ? ' (MFA method: Authenticator App)' : ' (MFA method: Email OTP)'),
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

    /**
     * POST /api/users/{user}/two-factor/require  { "required": true|false }
     *
     * Administrator control over whether an account MUST use a second factor.
     * Admin-only, enforced by `role:badac_admin` on the route rather than here
     * (see routes/api.php) - the same boundary every other action on someone
     * else's account already sits behind.
     *
     * What this deliberately is NOT: a way to enrol somebody else. Requiring a
     * factor and possessing one are different acts, and only the second
     * involves a secret. All this writes is a boolean on the Supabase identity
     * (see SupabaseAdminService::setMfaRequired); the account holder still
     * scans their own QR code in their own browser, and no administrator ever
     * sees the TOTP secret, the QR code, or a code derived from them. Nor does
     * it let an administrator get past somebody else's challenge - the flag
     * only ever adds an obligation to that account's own sessions.
     *
     * Turning the requirement OFF (required=false) is accepted only for an
     * email_otp account, whose emailed code stays mandatory regardless. Every
     * other account is refused, because for it this flag is the second factor
     * and lifting it would leave the account with no MFA. Replacing a lost
     * authenticator is disableTwoFactor() below, which resets enrolment.
     */
    public function requireTwoFactor(Request $request, User $user, SupabaseAdminService $supabaseAdmin)
    {
        $validated = $request->validate([
            'required' => ['required', 'boolean'],
        ]);

        if (! $user->supabase_user_id) {
            return response()->json([
                'message' => 'This account has not signed in with Supabase yet, so a two-factor requirement cannot be set for it.',
            ], 422);
        }

        $required = (bool) $validated['required'];

        // Lifting the requirement is refused for every account that is not
        // configured for email OTP. For those accounts the Supabase
        // requirement (or an enrolled factor) IS their second factor, so
        // lifting it would leave an Authenticator App account with no MFA at
        // all -- the "none" option account creation deliberately does not
        // offer. Losing an authenticator is handled by disableTwoFactor(),
        // which resets the enrolment instead. For an email_otp account the
        // emailed code stays mandatory whatever this flag says, so lifting the
        // separate authenticator requirement there is still allowed.
        if (! $required && ! $user->usesEmailOtpMfa()) {
            return response()->json([
                'message' => 'Two-factor authentication cannot be switched off for an Authenticator App account. To replace a lost authenticator, use Reset Authenticator, which requires the person to set up a new one.',
            ], 422);
        }

        try {
            $supabaseAdmin->setMfaRequired($user->supabase_user_id, $required);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => $required
                ? "Required two-factor authentication for {$user->username}"
                : "Removed the two-factor authentication requirement for {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }

    /**
     * POST /api/users/{user}/temporary-password  { "temporaryPassword": "..." }
     *
     * Replaces an account's password with a new administrator-issued temporary
     * password and puts the account back under the forced-change requirement.
     * The recovery path for an expired or lost temporary password.
     *
     * Administrator only (`role:badac_admin` on the route). The target is ONLY
     * ever the {user} in the route; nothing in the body can redirect it.
     *
     * The temporary password is supplied by the caller — generated in the
     * administrator's browser — because a server-generated one would have to be
     * sent back in this response. It is passed straight to Supabase Auth and is
     * never stored, returned, audited or logged.
     *
     * FAIL CLOSED. Supabase Auth and this database are not one transaction and
     * this does not pretend they are. Instead, every way the two can end up
     * disagreeing leaves the account LOCKED out of CDARS, never open:
     *
     *   A. Lock, committed before Supabase is contacted: must_change_password,
     *      an expiry of now (so temporaryPasswordExpired() refuses every route,
     *      /me/password included) and the issuer. If this fails, Supabase is
     *      never called and nothing has changed.
     *   B. Supabase, with no database transaction or row lock held.
     *   C. A DEFINITE refusal: the previous state is restored, but only if the
     *      lock is still ours. If restoring fails, the account stays locked.
     *   D. An UNKNOWN outcome (timeout, network, 5xx): nothing is restored.
     *      Supabase may hold the new password, so the account stays locked
     *      until an administrator reissues successfully.
     *   E. Success: the real 72-hour expiry and the audit row are written,
     *      retried once; if both attempts fail the account stays locked.
     *
     * password_changed_at is deliberately untouched: the account holder has not
     * changed anything. Existing sessions are blocked by EnsurePasswordChanged
     * from the moment the lock in step A commits.
     */
    public function issueTemporaryPassword(Request $request, User $user, SupabaseAdminService $supabaseAdmin)
    {
        if ($user->id === $request->user()?->id) {
            return response()->json([
                'message' => 'You cannot issue a temporary password to your own account.',
            ], 422);
        }

        if (! $user->is_active) {
            return response()->json([
                'message' => 'Activate this account before issuing it a temporary password.',
            ], 422);
        }

        if (! $user->supabase_user_id) {
            return response()->json([
                'message' => 'This account has no Supabase sign-in yet, so a temporary password cannot be issued for it.',
            ], 422);
        }

        $request->validate([
            'temporaryPassword' => [
                'required',
                'string',
                'min:'.User::TEMPORARY_PASSWORD_MIN_LENGTH,
                new AcceptablePassword('the temporary password', $user->username, $user->email),
            ],
        ], [
            'temporaryPassword.required' => 'Enter or generate a temporary password.',
            'temporaryPassword.string' => 'The temporary password must be text.',
            'temporaryPassword.min' => 'The temporary password must be at least '.User::TEMPORARY_PASSWORD_MIN_LENGTH.' characters.',
        ]);

        $temporaryPassword = $request->input('temporaryPassword');
        $issuedBy = $request->user()?->id;
        // Whole seconds: the column stores seconds, and the restore in step C
        // recognises its own lock by comparing this exact value.
        $lockedAt = now()->startOfSecond();
        $expiresAt = $lockedAt->copy()->addHours(User::TEMPORARY_PASSWORD_TTL_HOURS);

        // A. Commit the lock BEFORE Supabase is contacted.
        $previous = null;

        try {
            DB::transaction(function () use ($user, $issuedBy, $lockedAt, &$previous) {
                $row = User::whereKey($user->getKey())->lockForUpdate()->firstOrFail();

                $previous = [
                    'must_change_password' => (bool) $row->must_change_password,
                    'temporary_password_expires_at' => $row->temporary_password_expires_at,
                    'temporary_password_issued_by' => $row->temporary_password_issued_by,
                ];

                $row->forceFill([
                    'must_change_password' => true,
                    'temporary_password_expires_at' => $lockedAt,
                    'temporary_password_issued_by' => $issuedBy,
                ])->save();
            });
        } catch (\Throwable $e) {
            Log::error('Could not lock an account before issuing a temporary password. Supabase was not contacted.', [
                'user_id' => $user->id,
                'exception' => $e::class,
            ]);

            return response()->json([
                'message' => 'The temporary password could not be issued right now. Nothing was changed. Please try again.',
            ], 503);
        }

        // B. Supabase, with no transaction open.
        try {
            $supabaseAdmin->setPassword($user->supabase_user_id, $temporaryPassword);
        } catch (SupabasePasswordUpdateException $e) {
            if (! $e->wasDefinitelyNotApplied()) {
                // D. Supabase may already hold the new password.
                Log::warning('Supabase did not confirm a temporary password update. The account was left locked.', [
                    'user_id' => $user->id,
                    'outcome' => $e->outcome,
                ]);

                return $this->accountLeftLocked('The temporary password could not be confirmed, so this account has been locked. Issue a new temporary password.');
            }

            // C. Definitely not applied.
            return $this->restoreAfterRefusal($user, $previous, $lockedAt, $issuedBy, $e->isWeakPassword()
                ? response()->json([
                    'message' => 'Please check the form for errors.',
                    'errors' => ['temporaryPassword' => ['That temporary password was rejected. Choose a longer, less predictable one.']],
                ], 422)
                : response()->json([
                    'message' => 'The temporary password could not be issued right now. Please try again.',
                ], 502));
        } catch (\Throwable $e) {
            // Anything unexpected is an unknown outcome too.
            Log::error('Unexpected failure while issuing a temporary password. The account was left locked.', [
                'user_id' => $user->id,
                'exception' => $e::class,
            ]);

            return $this->accountLeftLocked('The temporary password could not be confirmed, so this account has been locked. Issue a new temporary password.');
        }

        // E. Supabase confirmed it: record the real expiry and the audit row.
        $persist = function () use ($user, $issuedBy, $expiresAt, $request) {
            $row = User::whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            $row->forceFill([
                'must_change_password' => true,
                'temporary_password_expires_at' => $expiresAt,
                'temporary_password_issued_by' => $issuedBy,
            ])->save();

            AuditLog::create([
                'user_id' => $issuedBy,
                'action' => 'UPDATE',
                'module' => 'users',
                'target_type' => 'user',
                'description' => "Issued a new temporary password to {$user->username}",
                'ip_address' => $request->ip(),
            ]);
        };

        try {
            DB::transaction($persist);
        } catch (\Throwable) {
            return $this->recoverAfterSupabaseChange($user, $persist, 'issuing a temporary password');
        }

        return new UserResource($user->fresh());
    }

    /**
     * Step C of issueTemporaryPassword(): Supabase definitely did not apply the
     * password, so the lock taken in step A is undone and the refusal returned.
     *
     * Only OUR lock is undone. If the row no longer carries it, another
     * issuance has locked the account since, and its outcome is not this
     * request's to erase. If restoring fails, the account simply stays locked:
     * inconvenient, never unsafe.
     *
     * @param  array{must_change_password: bool, temporary_password_expires_at: mixed, temporary_password_issued_by: mixed}  $previous
     */
    private function restoreAfterRefusal(User $user, array $previous, Carbon $lockedAt, ?int $issuedBy, JsonResponse $refusal): JsonResponse
    {
        try {
            DB::transaction(function () use ($user, $previous, $lockedAt, $issuedBy) {
                $row = User::whereKey($user->getKey())->lockForUpdate()->firstOrFail();

                $stillOurs = $row->must_change_password
                    && $row->temporary_password_expires_at?->getTimestamp() === $lockedAt->getTimestamp()
                    && (int) $row->temporary_password_issued_by === (int) $issuedBy;

                if ($stillOurs) {
                    $row->forceFill($previous)->save();
                }
            });
        } catch (\Throwable $e) {
            Log::error('Supabase refused a temporary password, and the account lock could not be undone. The account was left locked.', [
                'user_id' => $user->id,
                'exception' => $e::class,
            ]);

            return $this->accountLeftLocked('The temporary password was not accepted, and this account could not be unlocked. It remains locked; issue a new temporary password.');
        }

        return $refusal;
    }

    /**
     * Supabase Auth accepted the new temporary password, but recording its
     * expiry and audit row failed. The account is still locked by step A, so
     * nobody holding the new password can use CDARS.
     *
     * The write is idempotent, so it is retried once. If that also fails the
     * account stays locked, the administrator is told to reissue, and the event
     * is logged with the account id only.
     */
    private function recoverAfterSupabaseChange(User $user, \Closure $persist, string $operation)
    {
        try {
            DB::transaction($persist);

            return new UserResource($user->fresh());
        } catch (\Throwable $e) {
            Log::error("Supabase password was changed while {$operation}, but the local account state could not be saved. The account was left locked.", [
                'user_id' => $user->id,
                'exception' => $e::class,
            ]);

            return $this->accountLeftLocked('The temporary password was set, but CDARS could not finish recording it. This account remains locked; issue a new temporary password.');
        }
    }

    /**
     * Every outcome that ends with the account locked pending a new issuance.
     * The message is a fixed sentence; nothing from Supabase or the exception.
     */
    private function accountLeftLocked(string $message): JsonResponse
    {
        return response()->json([
            'message' => $message,
            'temporaryPasswordPendingSync' => true,
        ], 503);
    }

    // POST /api/users/{user}/two-factor/disable
    // Final auth migration — Laravel TOTP is retired; Supabase MFA is now
    // the only second factor. Reachable only via the same role:badac_admin
    // + supabase.mfa (aal2) route group as the rest of this controller (see
    // routes/api.php) — an Encoder, or an admin who hasn't themselves
    // stepped up to aal2, gets rejected before this method ever runs. This
    // exists for the "lost my phone and my recovery codes" case: an Admin
    // can strip a user's enrolled Supabase MFA factor(s) so they can sign
    // in and re-enroll (for a non-email_otp account that re-enrolment is
    // REQUIRED -- see the reset note in the method), without needing the target's own code (that
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

        // For an account that is NOT configured for email OTP, the authenticator
        // is its only second factor, so this is a RESET, not a removal: the
        // requirement is switched on BEFORE any factor is deleted, and the
        // person must enrol a new authenticator at their next sign-in. The
        // lost-device case this action exists for is still unblocked -- they
        // enrol the replacement device -- but the account is never left with
        // no MFA. If the requirement cannot be written, nothing is deleted.
        $isAuthenticatorReset = ! $user->usesEmailOtpMfa();

        if ($isAuthenticatorReset) {
            try {
                $supabaseAdmin->setMfaRequired($user->supabase_user_id, true);
            } catch (RuntimeException $e) {
                return response()->json([
                    'message' => 'Could not reset this account\'s authenticator right now, so nothing was changed. Please try again.',
                ], 502);
            }
        }

        $removed = $supabaseAdmin->deleteAllFactors($user->supabase_user_id);
        if ($removed === 0) {
            // For a reset the requirement is already on, which is the safe
            // state to be left in: the existing factor still satisfies it.
            return response()->json(['message' => 'Could not remove this account\'s MFA factor(s) right now. Please try again.'], 502);
        }

        // Email OTP accounts keep their previous behaviour: the emailed code
        // stays mandatory (it follows users.mfa_method), so removing the
        // authenticator also lifts the separate authenticator requirement.
        if (! $isAuthenticatorReset) {
            try {
                $supabaseAdmin->setMfaRequired($user->supabase_user_id, false);
            } catch (RuntimeException $e) {
                // The factors are already gone. The email requirement is
                // unaffected either way, and the cache is dropped below.
            }
        }

        // Login-time MFA enforcement reads a CACHED security state on every
        // protected request (EnsureSupabaseAal2 -> SupabaseAdminService). The
        // cached entry still claims a verified factor that no longer exists,
        // so it is dropped; the next request reads the current state.
        $supabaseAdmin->forgetFactorStatus($user->supabase_user_id);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'users',
            'target_type' => 'user',
            'description' => $isAuthenticatorReset
                ? "Reset the authenticator for {$user->username}; a new authenticator must be set up at next sign-in"
                : "Disabled two-factor authentication for {$user->username}",
            'ip_address' => $request->ip(),
        ]);

        return new UserResource($user);
    }
}
