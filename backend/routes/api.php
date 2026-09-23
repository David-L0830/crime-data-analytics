<?php

use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CrimeTypeController;
use App\Http\Controllers\Api\CriminalController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\EmailMfaController;
use App\Http\Controllers\Api\IncidentController;
use App\Http\Controllers\Api\MetabaseEmbedController;
use App\Http\Controllers\Api\MetabaseStatusController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PasswordController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\ReportScheduleController;
use App\Http\Controllers\Api\RolePermissionController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\SyncLogController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VictimController;
use App\Models\User;
use Illuminate\Support\Facades\Route;

// ===== Final auth migration (Supabase Auth is now the ONLY authentication
// system for this API — see AUTH_MIGRATION_STATUS.md and
// HANDOFF_FINAL_AUTH_MIGRATION.md for the full history and rationale) =====
//
// There is no public /login, /forgot-password, /reset-password, or
// /auth/google/* route left in this file (or in routes/web.php) — every
// credential path (email/password, Google OAuth, TOTP MFA, password reset)
// is handled entirely by Supabase Auth on the frontend, via supabase-js
// (see src/context/AuthContext.jsx / src/lib/supabaseClient.js). This
// backend never sees a password and never issues a session cookie; it only
// ever verifies an already-issued Supabase JWT (see
// App\Services\SupabaseTokenValidator) and answers "who is this user" /
// "what are they allowed to do".
//
// Every protected route below uses the single 'supabase' guard (registered
// in AppServiceProvider::boot() via Auth::viaRequest, backed by
// SupabaseTokenValidator). There is no guard fallback — an invalid, missing,
// or expired Supabase access token gets a 401 from Laravel's own
// Illuminate\Auth\AuthenticationException handling, before any controller
// runs.
//
// Two-factor authentication IS enforced here. Every protected route below
// carries 'supabase.mfa' (App\Http\Middleware\EnsureSupabaseAal2) in
// addition to 'auth:supabase', with exactly two exceptions called out at
// their own registrations: GET /user and POST /logout.
//
// 'supabase.mfa' is adaptive, not a blanket aal2 demand — an account with no
// verified authenticator is unaffected and still reaches everything at aal1,
// while an account that HAS enrolled one cannot touch any of these routes
// until its session has actually completed the TOTP challenge. Read that
// middleware's own comment for the full rule, including why it fails closed
// when the enrolment status cannot be established. The decision is made from
// the cryptographically verified `aal` claim, never from anything the client
// sends or stores.
//
// The two exemptions are deliberate and are the minimum the sign-in flow
// needs. GET /user answers "who am I, and do I still owe a second factor"
// (UserResource exposes authAssuranceLevel and mfaRequired) — that is what
// the frontend reads to decide whether to show the challenge screen, so
// gating it behind the challenge would make the challenge unreachable. It
// discloses the caller's OWN profile and nothing else. POST /logout only
// writes the audit row for a sign-out; refusing to let a half-authenticated
// session sign out would strand it.
//
// 'role:' (EnsureRole) is unchanged — it is Authorization, a separate
// concern from Authentication, and enforces the Super Administrator /
// BADAC Administrator / Encoder / BADAC Validator boundaries. MFA is
// layered on top of it and replaces none of it.
//
// Super Administrator (System Governance) is listed on the read routes of the
// operational and analytics modules, on Settings, crime-type writes, the audit
// trail and User Management, and on NO operational mutation route: it can
// never create, edit, archive, restore or validate a record. Which accounts it
// may manage is decided by the 'manage-account' Gate, not by this file.
// GET /user — NO 'supabase.mfa'. See the exemption note above: this is the
// endpoint the login flow reads to discover that a second factor is still
// owed, so it must answer at aal1.
Route::middleware('auth:supabase')->get('/user', [AuthController::class, 'user']);

// POST /mfa/email/send, POST /mfa/email/verify — NO 'supabase.mfa', for the
// same reason as GET /user: they are how an aal1 session that owes EMAIL MFA
// (users.mfa_method = 'email_otp') completes it, so gating them behind that
// requirement would make it unsatisfiable. They act only on the token's own
// user and signed session_id, refuse every account email MFA does not apply
// to, and are rate limited (see AppServiceProvider). A successful verify never
// changes the JWT: it records `email_mfa_verified` for that one Supabase
// session, which EnsureSupabaseAal2 then honours for that account only.
Route::middleware(['auth:supabase', 'throttle:email-mfa-send'])
    ->post('/mfa/email/send', [EmailMfaController::class, 'send']);
Route::middleware(['auth:supabase', 'throttle:email-mfa-verify'])
    ->post('/mfa/email/verify', [EmailMfaController::class, 'verify']);

// POST /me/password — the account holder replaces their own password. Behind
// 'supabase.mfa' like every other protected route, so MFA is still completed
// first, but deliberately NOT behind 'password.changed': it is the one way out
// of a must_change_password state, so blocking it would make that state
// permanent. PasswordController applies that middleware's expiry and
// stale-session rules inline, and adds its own recent-sign-in requirement.
Route::middleware(['auth:supabase', 'supabase.mfa', 'throttle:password-change'])
    ->post('/me/password', [PasswordController::class, 'update']);

// 'password.changed' (EnsurePasswordChanged) is listed after 'supabase.mfa' on
// every protected route below, so an account that still owes a password change
// — or a session opened before one — cannot reach normal application
// functionality by calling these endpoints directly. The only authenticated
// routes without it are GET /user, POST /logout, the two email-MFA routes and
// POST /me/password; tests/Feature/PasswordChangeEnforcementTest.php fails if
// any other route is registered without it.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed'])->group(function () {
    Route::put('/me', [ProfileController::class, 'update']);
    Route::post('/me/avatar', [ProfileController::class, 'avatar']);
});

Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_VALIDATOR.','.User::ROLE_SUPER_ADMIN])
    ->get('/dashboard', [DashboardController::class, 'index']);

Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_VALIDATOR.','.User::ROLE_SUPER_ADMIN])->group(function () {
    Route::get('/analytics', [AnalyticsController::class, 'index']);
    Route::get('/analytics/crime-types', [AnalyticsController::class, 'crimeTypes']);
    Route::get('/analytics/monthly', [AnalyticsController::class, 'monthly']);
    Route::get('/analytics/locations', [AnalyticsController::class, 'locations']);

    // Signed Metabase embed URLs for Dashboard/Analytics/Trends — same
    // roles as the analytics endpoints above, since this is the same data.
    Route::get('/embed/metabase/{dashboardKey}', [MetabaseEmbedController::class, 'show']);
});

// GET /settings — read-only business configuration. Super Administrator owns
// it; the Administrator keeps READ access only because its Dashboard, Trends
// and Statistical Analysis compute crime rates and alerts from these values,
// and without them would silently fall back to built-in defaults. Changing
// settings (PUT /settings below) and the System Settings page are Super
// Administrator only. BADAC Validator is intentionally excluded — see GET
// /sync-logs below for the same "BADAC has no Settings access" note.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_SUPER_ADMIN])
    ->get('/settings', [SettingController::class, 'show']);

// GET /notifications — shared by every role (Encoder still needs to see
// their own incident notifications in the topbar).
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed'])->get('/notifications', [NotificationController::class, 'index']);

// GET /crime-types — readable by EVERY authenticated role, unlike /settings.
// This is not administrative configuration in the way thresholds are: it is
// the vocabulary the incident form, the FilterBar and the Crime Mapping legend
// are built out of, and the BADAC Validator uses all three. The colour travels
// with the name because the map legend is meaningless without it.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed'])->get('/crime-types', [CrimeTypeController::class, 'index']);

// POST/PUT /crime-types — Super Administrator only (managing crime types is a
// System Settings capability), and enforced HERE rather than by hiding System
// Settings in the UI. Anyone else who calls this endpoint directly gets a 403
// from the role: middleware before the controller runs.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_SUPER_ADMIN])->group(function () {
    Route::post('/crime-types', [CrimeTypeController::class, 'store']);
    Route::put('/crime-types/{crimeType}', [CrimeTypeController::class, 'update']);
});

// Incidents (Crime Data Collection Module) — read side. Not role-restricted
// (Administrator, Encoder, and BADAC Validator all read these; the Validator
// receives no complainant contact/address — see IncidentResource); per-record ownership
// for Encoder is enforced inside IncidentController on the write side.
// GET /incidents/map is registered before GET /incidents/{incident} so
// Laravel doesn't greedily match "map" as a route-model-binding id.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed'])->group(function () {
    Route::get('/incidents/map', [IncidentController::class, 'map']);
    Route::get('/incidents', [IncidentController::class, 'index']);
    Route::get('/incidents/{incident}', [IncidentController::class, 'show']);
});

Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_VALIDATOR.','.User::ROLE_SUPER_ADMIN])->group(function () {
    Route::get('/criminals', [CriminalController::class, 'index']);
    Route::get('/criminals/{criminal}', [CriminalController::class, 'show']);

    // Victim Information — only ever reached through a case; same
    // PII-bearing-business-data treatment as criminals above. Read-only for
    // the BADAC Validator and the Super Administrator, neither of which
    // receives a contact number or address — see CriminalResource /
    // VictimResource.
    Route::get('/victims', [VictimController::class, 'index']);
    Route::get('/victims/{victim}', [VictimController::class, 'show']);
});

// Checkpoint 38 — audit logs are now admin-only. The BADAC role previously
// had audit-log access (as the former `role:badac_admin,badac_readonly`); that is
// intentionally revoked per the "BADAC users must not have Audit Logs
// access" requirement. Audit-log records/logging themselves are untouched —
// this only narrows who may call GET /audit-logs.
//
// System Governance: the raw audit trail now belongs to the Super
// Administrator alone. The Administrator is the operational actor the trail
// records, and no longer reads it.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_SUPER_ADMIN])
    ->get('/audit-logs', [AuditLogController::class, 'index']);

// POST /report-export-audit — records that a report was exported, the way
// POST /users/{user}/password-reset-audit records that a reset was sent. The
// frontend calls it only after exportWorkbook() reports success.
//
// Authenticated but NOT role-restricted, unlike GET /audit-logs above: every
// role exports something it is entitled to see — Encoder from Crime Data
// Collection, BADAC Validator from Records and the analytics pages — so
// restricting the write to administrators would silently drop exactly the
// events an administrator reviews the trail for. Writing an entry about
// yourself is not the same permission as reading everyone's.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed'])
    ->post('/report-export-audit', [AuditLogController::class, 'reportExported']);

// ===== Reports (automated report schedules) =====
//
// READ: Administrator and BADAC Validator. The Validator may see schedules (active,
// or archived with ?archived=1) and their delivery status, but the controller
// withholds recipient addresses and raw delivery errors from every
// non-administrator — see ReportScheduleController. Encoder gets a 403.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_VALIDATOR])->group(function () {
    Route::get('/report-schedules', [ReportScheduleController::class, 'index']);

    // The delivery log: what ran, when, and whether it arrived.
    Route::get('/report-email-logs', [ReportScheduleController::class, 'logs']);
});

// WRITE: ADMINISTRATOR ONLY. A schedule is a standing instruction to e-mail
// crime records to an address, repeatedly, with nobody present — a stronger
// capability than the on-demand export above, because the recipient need not
// be a user of this system. Validator and Encoder get a 403 from the role:
// middleware before the controller runs.
//
// There is deliberately NO delete route. A schedule is archived and restored
// (SoftDeletes on report_schedules.archived_at); the row and its delivery
// history are never removed. update and run bind non-archived schedules only,
// so an archived schedule answers 404 there until it is restored. restore is
// the one route bound withTrashed(), because its target IS archived.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN])->group(function () {
    Route::post('/report-schedules', [ReportScheduleController::class, 'store']);
    Route::put('/report-schedules/{reportSchedule}', [ReportScheduleController::class, 'update']);
    Route::put('/report-schedules/{reportSchedule}/archive', [ReportScheduleController::class, 'archive']);
    Route::put('/report-schedules/{reportSchedule}/restore', [ReportScheduleController::class, 'restore'])
        ->withTrashed();

    // Runs the schedule now, through the identical path the scheduler uses.
    Route::post('/report-schedules/{reportSchedule}/run', [ReportScheduleController::class, 'run']);
});

// GET /sync-logs, GET /users, GET /users/{user} — Administrator and Super
// Administrator. Both tiers use User Management (for different accounts,
// decided per account by the 'manage-account' Gate), and the Administrator's
// Dashboard import KPIs are built on /sync-logs. BADAC Validator has no User
// Management, Settings, or Audit Logs access.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_SUPER_ADMIN])->group(function () {
    Route::get('/sync-logs', [SyncLogController::class, 'index']);
    Route::get('/users', [UserController::class, 'index']);
    Route::get('/users/{user}', [UserController::class, 'show']);
});

// PUT /users/{user}, PUT /users/{user}/status, POST /users/{user}/two-factor/disable
// — mutation routes on another account, for both governance tiers. The route
// admits the two roles; UserController then puts every action through the
// 'manage-account' Gate, so a Super Administrator reaches only Administrator
// accounts, an Administrator only Encoder and Validator accounts, and nobody a
// Super Administrator. The existing self-lockout guard on updateStatus() and
// the mass-assignment exclusion of `role` on update() are unchanged (see
// UserController).
// two-factor/disable still calls Supabase's Admin API to remove any
// factor(s) a target account enrolled before this app removed MFA — see
// UserController::disableTwoFactor() and App\Services\SupabaseAdminService.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_SUPER_ADMIN])->group(function () {
    Route::put('/users/{user}', [UserController::class, 'update']);
    Route::put('/users/{user}/status', [UserController::class, 'updateStatus']);
    Route::post('/users/{user}/two-factor/disable', [UserController::class, 'disableTwoFactor']);

    // POST /users/{user}/two-factor/require - administrator control over
    // whether an account MUST use a second factor, independent of whether it
    // has enrolled one yet. Same group, and same 'manage-account' Gate, as
    // every other action on someone else's account. It writes a boolean and
    // nothing else: enrolment stays self-service, and no administrator ever
    // sees another account's TOTP secret or QR code. See
    // UserController::requireTwoFactor().
    Route::post('/users/{user}/two-factor/require', [UserController::class, 'requireTwoFactor']);

    // POST /users/{user}/temporary-password — issue a NEW temporary password
    // to an existing account and require it to be changed at next sign-in.
    // Same group, and same 'manage-account' Gate, as every other action on
    // someone else's account.
    // The target comes from {user} alone; the password is supplied by the
    // administrator's browser and is never stored or returned. See
    // UserController::issueTemporaryPassword().
    Route::post('/users/{user}/temporary-password', [UserController::class, 'issueTemporaryPassword']);

    // POST /users — Account Administration. Administrator-provisioned
    // account creation, in the same group as every other mutation on an
    // account. Which role the new account may have is limited to the
    // caller's own manageable roles by StoreUserRequest, so neither tier can
    // create a Super Administrator. Creating an account writes to BOTH
    // Supabase Auth (via the service-role key, server-side only) and this
    // database, which is exactly why it can only live on the backend: the
    // frontend must never hold a credential capable of provisioning an
    // identity. See UserController::store() and StoreUserRequest.
    Route::post('/users', [UserController::class, 'store']);

    // POST /users/{user}/password-reset-audit — records that an admin sent
    // a password-reset email. Named for exactly what it does: it does NOT
    // send the email and never touches a credential. Supabase sends the
    // email, requested from the browser via resetPasswordForEmail() — the
    // same mechanism the public Forgot Password page uses.
    Route::post('/users/{user}/password-reset-audit', [UserController::class, 'passwordResetAudit']);

    // GET /role-permissions — reads the `role:` middleware off this very
    // file's routes and reports which roles each module actually admits.
    // It defines nothing and grants nothing; backend authorization stays
    // authoritative. Limited to the two account-managing roles, since a
    // precise map of who may reach what is reconnaissance. See
    // RolePermissionController.
    Route::get('/role-permissions', [RolePermissionController::class, 'index']);
});

// GET /users/{user}/activity — one account's own audit trail, for the User
// Activity view. Reuses audit_logs and AuditLogResource; no second activity
// store exists. Super Administrator only, for the same reason GET /audit-logs
// is: these ARE raw audit-log rows, just filtered to one account.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_SUPER_ADMIN])
    ->get('/users/{user}/activity', [UserController::class, 'activity']);

// PUT /settings — Super Administrator only. Changing the configuration every
// analytics page computes with is System Governance; the Administrator keeps
// read access only (see GET /settings above).
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_SUPER_ADMIN])
    ->put('/settings', [SettingController::class, 'update']);

// GET /settings/metabase-status — Super Administrator only. Read-only view of
// the Metabase embedding configuration: site URL, dashboard IDs, and whether
// the embedding secret is SET. The secret itself stays in the environment and
// is never returned — see MetabaseStatusController.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_SUPER_ADMIN])
    ->get('/settings/metabase-status', [MetabaseStatusController::class, 'show']);

// Incidents — write side. Not role-restricted at the route level for
// create/update (Encoder is a legitimate caller of both); IncidentController
// enforces per-record ownership (reported_by) for Encoder internally on
// update(). Archive is kept out of this group only so it can carry its own
// explanatory comment — it allows the same two roles, see the route below.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_ENCODER])->group(function () {
    Route::post('/incidents', [IncidentController::class, 'store']);
    Route::put('/incidents/{incident}', [IncidentController::class, 'update']);
});

// PUT /incidents/{incident}/archive — Encoder and BADAC Admin may both
// reach this route. Per-record ownership (Encoder may only archive an
// incident they personally encoded) is enforced inside
// IncidentController::archive() — the same pattern used by update().
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_ENCODER])
    ->put('/incidents/{incident}/archive', [IncidentController::class, 'archive']);

// PUT /incidents/{incident}/restore — the inverse of archive() above,
// deliberately registered with the identical middleware stack as that route:
// the same role set (badac_admin + encoder) AND the same 'supabase.mfa' gate,
// so "whoever may archive may restore, under the same assurance level" holds
// by construction. It matches the
// PUT /criminals/{criminal}/restore / PUT /victims/{victim}/restore pattern
// below. Per-record ownership (Encoder may only restore an incident they
// personally encoded) is enforced inside IncidentController::restore().
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_ENCODER])
    ->put('/incidents/{incident}/restore', [IncidentController::class, 'restore']);

// PUT /incidents/{incident}/validate, PUT /incidents/{incident}/return —
// record validation. ADMINISTRATOR and BADAC VALIDATOR, deliberately different
// from the create/update/archive routes above: an Encoder submits records and
// must not be able to approve them, including their own, and the Validator
// reviews records without being able to create, edit or archive them. Encoder
// gets a 403 here before the controller runs, regardless of what the frontend
// shows. See IncidentController::approve()/returnForCorrection().
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_VALIDATOR])->group(function () {
    Route::put('/incidents/{incident}/validate', [IncidentController::class, 'approve']);
    Route::put('/incidents/{incident}/return', [IncidentController::class, 'returnForCorrection']);
});

Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed', 'role:'.User::ROLE_BADAC_ADMIN])->group(function () {
    Route::post('/criminals', [CriminalController::class, 'store']);
    Route::put('/criminals/{criminal}', [CriminalController::class, 'update']);
    Route::put('/criminals/{criminal}/archive', [CriminalController::class, 'archive']);
    // PUT /criminals/{criminal}/restore, PUT /victims/{victim}/restore — the
    // inverses of the two archive routes above, deliberately registered in
    // this same role:badac_admin group rather than a group of their own, so
    // "whoever may archive may restore" holds by construction and cannot
    // drift. Encoder and badac_validator are excluded here exactly as they are
    // for archive. The frontend reuses the existing 'archive_record'
    // permission for the same reason — no restore-specific permission exists.
    Route::put('/criminals/{criminal}/restore', [CriminalController::class, 'restore']);

    Route::post('/victims', [VictimController::class, 'store']);
    Route::put('/victims/{victim}', [VictimController::class, 'update']);
    Route::put('/victims/{victim}/archive', [VictimController::class, 'archive']);
    Route::put('/victims/{victim}/restore', [VictimController::class, 'restore']);
});

// PUT /notifications/read-all, PUT /notifications/{notification}/read —
// shared by both roles; AppNotification has no per-user ownership column.
Route::middleware(['auth:supabase', 'supabase.mfa', 'password.changed'])->group(function () {
    Route::put('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::put('/notifications/{notification}/read', [NotificationController::class, 'markRead']);
});

// POST /logout — session-lifecycle action. No `role:` middleware — every
// role logs out the same way — and no 'supabase.mfa' either: a session that
// has not completed its second factor must still be able to end itself, and
// abandoning the challenge screen is exactly that (see
// AuthContext.cancelMfaChallenge).
Route::middleware('auth:supabase')->post('/logout', [AuthController::class, 'logout']);
