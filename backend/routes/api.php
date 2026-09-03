<?php

use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CrimeTypeController;
use App\Http\Controllers\Api\CriminalController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\IncidentController;
use App\Http\Controllers\Api\MetabaseEmbedController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\ProfileController;
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
// Two-factor authentication (Supabase MFA / aal2 step-up) has been removed
// from this application — both in the login UI (src/pages/Login.jsx) and
// here on the backend. The 'supabase.mfa' (EnsureSupabaseAal2) middleware
// is no longer attached to any route below; a valid Supabase access token
// is all that's required to authenticate (aal1 is sufficient). The
// EnsureSupabaseAal2 class itself is left in the codebase in case MFA is
// reintroduced later, but nothing here references it anymore.
// 'role:' (EnsureRole) is unchanged — it is Authorization, a separate
// concern from Authentication, and continues to enforce the existing
// BADAC Administrator / Encoder / Badac (read-only) boundaries.
Route::middleware('auth:supabase')->get('/user', [AuthController::class, 'user']);

Route::middleware('auth:supabase')->group(function () {
    Route::put('/me', [ProfileController::class, 'update']);
    Route::post('/me/avatar', [ProfileController::class, 'avatar']);
});

Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_READONLY])
    ->get('/dashboard', [DashboardController::class, 'index']);

Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_READONLY])->group(function () {
    Route::get('/analytics', [AnalyticsController::class, 'index']);
    Route::get('/analytics/crime-types', [AnalyticsController::class, 'crimeTypes']);
    Route::get('/analytics/monthly', [AnalyticsController::class, 'monthly']);
    Route::get('/analytics/locations', [AnalyticsController::class, 'locations']);

    // Signed Metabase embed URLs for Dashboard/Analytics/Trends — same
    // roles as the analytics endpoints above, since this is the same data.
    Route::get('/embed/metabase/{dashboardKey}', [MetabaseEmbedController::class, 'show']);
});

// GET /settings — read-only, admin-only business configuration. Badac
// (read-only) is intentionally excluded — see GET /sync-logs below for the
// same "Badac has no Settings access" note.
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN])
    ->get('/settings', [SettingController::class, 'show']);

// GET /notifications — shared by every role (Encoder still needs to see
// their own incident notifications in the topbar).
Route::middleware('auth:supabase')->get('/notifications', [NotificationController::class, 'index']);

// GET /crime-types — readable by EVERY authenticated role, unlike /settings.
// This is not administrative configuration in the way thresholds are: it is
// the vocabulary the incident form, the FilterBar and the Crime Mapping legend
// are built out of, and BADAC (read-only) uses all three. The colour travels
// with the name because the map legend is meaningless without it.
Route::middleware('auth:supabase')->get('/crime-types', [CrimeTypeController::class, 'index']);

// POST/PUT /crime-types — Administrator only, and enforced HERE rather than by
// hiding System Settings in the UI. A non-admin who calls this endpoint
// directly gets a 403 from the role: middleware before the controller runs.
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN])->group(function () {
    Route::post('/crime-types', [CrimeTypeController::class, 'store']);
    Route::put('/crime-types/{crimeType}', [CrimeTypeController::class, 'update']);
});

// Incidents (Crime Data Collection Module) — read side. Not role-restricted
// (Administrator, Encoder, and Badac all read these); per-record ownership
// for Encoder is enforced inside IncidentController on the write side.
// GET /incidents/map is registered before GET /incidents/{incident} so
// Laravel doesn't greedily match "map" as a route-model-binding id.
Route::middleware(['auth:supabase'])->group(function () {
    Route::get('/incidents/map', [IncidentController::class, 'map']);
    Route::get('/incidents', [IncidentController::class, 'index']);
    Route::get('/incidents/{incident}', [IncidentController::class, 'show']);
});

Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_BADAC_READONLY])->group(function () {
    Route::get('/criminals', [CriminalController::class, 'index']);
    Route::get('/criminals/{criminal}', [CriminalController::class, 'show']);

    // Victim Information — only ever reached through a case; same
    // PII-bearing-business-data treatment as criminals above.
    Route::get('/victims', [VictimController::class, 'index']);
    Route::get('/victims/{victim}', [VictimController::class, 'show']);
});

// Checkpoint 38 — audit logs are now admin-only. Badac (read-only) previously
// had audit-log access (`role:badac_admin,badac_readonly`); that is
// intentionally revoked per the "BADAC users must not have Audit Logs
// access" requirement. Audit-log records/logging themselves are untouched —
// this only narrows who may call GET /audit-logs.
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN])
    ->get('/audit-logs', [AuditLogController::class, 'index']);

// POST /report-export-audit — records that a report was exported, the way
// POST /users/{user}/password-reset-audit records that a reset was sent. The
// frontend calls it only after exportWorkbook() reports success.
//
// Authenticated but NOT role-restricted, unlike GET /audit-logs above: every
// role exports something it is entitled to see — Encoder from Crime Data
// Collection, Badac (read-only) from Records and the analytics pages — so
// restricting the write to administrators would silently drop exactly the
// events an administrator reviews the trail for. Writing an entry about
// yourself is not the same permission as reading everyone's.
Route::middleware(['auth:supabase'])
    ->post('/report-export-audit', [AuditLogController::class, 'reportExported']);

// GET /sync-logs, GET /users, GET /users/{user} — admin-only. Badac
// (read-only) has no User Management, Settings, or Audit Logs access.
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN])->group(function () {
    Route::get('/sync-logs', [SyncLogController::class, 'index']);
    Route::get('/users', [UserController::class, 'index']);
    Route::get('/users/{user}', [UserController::class, 'show']);
});

// PUT /users/{user}, PUT /users/{user}/status, POST /users/{user}/two-factor/disable
// — admin-only mutation routes on another account. The existing
// self-lockout guard on updateStatus() and the mass-assignment exclusion
// of `role` on update() are unchanged (see UserController).
// two-factor/disable still calls Supabase's Admin API to remove any
// factor(s) a target account enrolled before this app removed MFA — see
// UserController::disableTwoFactor() and App\Services\SupabaseAdminService.
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN])->group(function () {
    Route::put('/users/{user}', [UserController::class, 'update']);
    Route::put('/users/{user}/status', [UserController::class, 'updateStatus']);
    Route::post('/users/{user}/two-factor/disable', [UserController::class, 'disableTwoFactor']);

    // POST /users — Account Administration. Administrator-provisioned
    // account creation, in the same admin-only group as every other
    // mutation on an account. Creating an account writes to BOTH Supabase
    // Auth (via the service-role key, server-side only) and this database,
    // which is exactly why it can only live on the backend: the frontend
    // must never hold a credential capable of provisioning an identity.
    // See UserController::store() and StoreUserRequest.
    Route::post('/users', [UserController::class, 'store']);

    // GET /users/{user}/activity — one account's own audit trail, for the
    // User Activity view. Reuses audit_logs and AuditLogResource; no second
    // activity store exists. Admin-only for the same reason GET
    // /audit-logs is (Checkpoint 38).
    Route::get('/users/{user}/activity', [UserController::class, 'activity']);

    // POST /users/{user}/password-reset-audit — records that an admin sent
    // a password-reset email. Named for exactly what it does: it does NOT
    // send the email and never touches a credential. Supabase sends the
    // email, requested from the browser via resetPasswordForEmail() — the
    // same mechanism the public Forgot Password page uses.
    Route::post('/users/{user}/password-reset-audit', [UserController::class, 'passwordResetAudit']);

    // GET /role-permissions — reads the `role:` middleware off this very
    // file's routes and reports which roles each module actually admits.
    // It defines nothing and grants nothing; backend authorization stays
    // authoritative. Admin-only, since a precise map of who may reach what
    // is reconnaissance. See RolePermissionController.
    Route::get('/role-permissions', [RolePermissionController::class, 'index']);
});

// PUT /settings — admin-only business configuration mutation, same
// treatment as GET /settings.
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN])
    ->put('/settings', [SettingController::class, 'update']);

// Incidents — write side. Not role-restricted at the route level for
// create/update (Encoder is a legitimate caller of both); IncidentController
// enforces per-record ownership (reported_by) for Encoder internally on
// update(). Archive is kept out of this group only so it can carry its own
// explanatory comment — it allows the same two roles, see the route below.
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_ENCODER])->group(function () {
    Route::post('/incidents', [IncidentController::class, 'store']);
    Route::put('/incidents/{incident}', [IncidentController::class, 'update']);
});

// PUT /incidents/{incident}/archive — Encoder and BADAC Admin may both
// reach this route. Per-record ownership (Encoder may only archive an
// incident they personally encoded) is enforced inside
// IncidentController::archive() — the same pattern used by update().
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_ENCODER])
    ->put('/incidents/{incident}/archive', [IncidentController::class, 'archive']);

// PUT /incidents/{incident}/restore — the inverse of archive() above,
// deliberately registered with the identical role set (badac_admin + encoder)
// so "whoever may archive may restore" holds by construction, matching the
// PUT /criminals/{criminal}/restore / PUT /victims/{victim}/restore pattern
// below. Per-record ownership (Encoder may only restore an incident they
// personally encoded) is enforced inside IncidentController::restore().
Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN.','.User::ROLE_ENCODER])
    ->put('/incidents/{incident}/restore', [IncidentController::class, 'restore']);

Route::middleware(['auth:supabase', 'role:'.User::ROLE_BADAC_ADMIN])->group(function () {
    Route::post('/criminals', [CriminalController::class, 'store']);
    Route::put('/criminals/{criminal}', [CriminalController::class, 'update']);
    Route::put('/criminals/{criminal}/archive', [CriminalController::class, 'archive']);
    // PUT /criminals/{criminal}/restore, PUT /victims/{victim}/restore — the
    // inverses of the two archive routes above, deliberately registered in
    // this same role:badac_admin group rather than a group of their own, so
    // "whoever may archive may restore" holds by construction and cannot
    // drift. Encoder and badac_readonly are excluded here exactly as they are
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
Route::middleware('auth:supabase')->group(function () {
    Route::put('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::put('/notifications/{notification}/read', [NotificationController::class, 'markRead']);
});

// POST /logout — session-lifecycle action. No `role:` middleware — every
// role logs out the same way.
Route::middleware('auth:supabase')->post('/logout', [AuthController::class, 'logout']);
