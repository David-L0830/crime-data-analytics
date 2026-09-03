# Auth Migration Status

This document is the single source of truth for BADAC CDARS' authentication
architecture, referenced by comments throughout both `backend/` and `src/`.
Every statement below was verified directly against the running application
and live database, not assumed.

## Current state: Supabase Auth only

- **No Laravel Sanctum.** `laravel/sanctum` is not present in
  `backend/composer.json` (`require` or `require-dev`) at all.
- **No backend-hosted login.** There is no `/login`, `/forgot-password`,
  `/reset-password`, or `/auth/google/*` route anywhere in
  `backend/routes/`. All authentication (email/password and Google OAuth)
  happens entirely client-side via the Supabase JS SDK
  (`src/lib/supabaseClient.js`).
- **Stateless Bearer-token API.** The backend authenticates every request
  via a custom `supabase` guard (`app/Services/SupabaseTokenValidator.php`)
  that validates the Supabase-issued JWT on each request — first via JWKS,
  falling back to the shared HS256 secret if the JWKS endpoint is
  unreachable. No session cookies, no CSRF tokens. `config/cors.php` sets
  `supports_credentials => false` accordingly.
- **`users.password` is nullified**, not used for authentication.
  `User::$fillable` does not include it. Identity is established purely by
  Supabase JWT claims, matched to a local user via `users.supabase_user_id`.
- **`personal_access_tokens` table dropped.** Removed by
  `2025_02_01_000001_final_auth_migration_drop_sanctum_tokens_and_nullify_password.php`.
- **`google_id` and `supabase_user_id` columns** were added to `users` to
  support account linking; linking is restricted to pre-existing accounts
  only (no auto-created accounts on first Google login), and a user's role
  cannot be changed via Google login.

## MFA / 2FA

**As of "feat: enforce MFA at sign-in and let administrators require it"
(2026-08-31), MFA is enforced.** The two bullets that used to appear here
("no route enforces AAL2", "`EnsureSupabaseAal2` is unwired") are no longer
true and are corrected below.

- **`supabase.mfa` (`App\Http\Middleware\EnsureSupabaseAal2`) is now attached
  to every protected route in `routes/api.php`, with exactly two named
  exceptions: `GET /api/user` and `POST /api/logout`.** Both must stay
  reachable at `aal1` — `GET /api/user` is what the frontend reads to
  discover a second factor is still owed, and `POST /api/logout` must let a
  half-authenticated session end itself.
- **Enforcement is adaptive, not a blanket `aal2` requirement.** An account
  with no verified TOTP factor and no administrator-imposed requirement is
  unaffected and continues to reach every route at `aal1`. `aal2` is demanded
  only from a session whose account either (a) has a verified Supabase MFA
  factor enrolled, or (b) has been flagged by an administrator via
  `POST /api/users/{user}/two-factor/require`. See the extensive comment in
  `EnsureSupabaseAal2.php` for the full adaptive-enforcement rule and its
  fail-closed behaviour when the enrolment/requirement lookup itself cannot
  be completed (a Supabase Admin API failure denies the request rather than
  allowing it).
- **Self-service TOTP enrollment now exists** — `src/components/settings/TwoFactorSelfService.jsx`
  (rendered on `/user-management`) lets any signed-in user enroll, confirm,
  and unenroll their own Supabase TOTP factor via `supabaseMfaService.js`
  (`supabase.auth.mfa.*`). This was explicitly deferred in an earlier
  checkpoint ("self-service enrollment UI is NOT built yet") and has since
  been built.
- **Login step-up challenge** — `src/context/AuthContext.jsx` gates sign-in on
  the account's own required assurance level: after Supabase authenticates
  the password/OAuth step, `AuthContext` checks `GET /api/user`'s
  `mfaRequired` field (backed by `authAssuranceLevel`); if a second factor is
  still owed, `Login.jsx` renders a TOTP challenge screen instead of
  completing sign-in. `verifyMfaChallenge()` / `cancelMfaChallenge()` handle
  completing or abandoning that challenge.
- **Administrators can require MFA of an account that has not enrolled a
  factor yet**, independent of the account's own enrollment: `POST
  /api/users/{user}/two-factor/require` (body: `{"required": true|false}`,
  `badac_admin` only) sets or clears an administrator-imposed obligation via
  `App\Services\SupabaseAdminService::setMfaRequired()`. This does not enroll
  a factor on the account's behalf and no administrator ever sees another
  account's TOTP secret or QR code — it only changes whether that account's
  *next* sign-in is allowed to complete at `aal1`. Surfaced in the User
  Management row menu ("Require 2FA") once an account has no verified
  factor, and reflected in `GET /api/user` / `GET /api/users` as
  `mfaRequiredByAdmin`.
- `POST /api/users/{user}/two-factor/disable` remains active by design —
  it lets a `badac_admin` remotely clear a target user's Supabase MFA
  factors (e.g. to unlock someone who lost their authenticator), via
  `app/Services/SupabaseAdminService.php`, logged to `audit_logs`. It now
  also clears any administrator-imposed MFA requirement on that account (see
  the comment on `UserController::disableTwoFactor()`) and invalidates the
  cached enrolment-status lookup (`SupabaseAdminService::forgetFactorStatus()`)
  so the account is not told a factor is still required for the rest of the
  cache TTL.
- `UserResource` (`GET /api/user`, `GET /api/users`, `GET /api/users/{user}`)
  now exposes four MFA-related fields: `twoFactorEnabled` (has a *verified*
  factor — unverified/abandoned enrollments do not count), `mfaRequired`
  (does the *caller's own* current session still owe a second factor; `null`
  for anyone else's row), `mfaRequiredByAdmin` (has an administrator required
  one of this account), and the pre-existing `authAssuranceLevel` (`aal1` /
  `aal2`, read straight off the verified Supabase JWT's `aal` claim).
- `config/supabase.php` gained `mfa_status_cache_ttl` (60 seconds) — how long
  `SupabaseAdminService` caches "does this account have a verified factor /
  an admin-imposed requirement" before re-querying Supabase's Admin API.
  Explicitly invalidated when an administrator disables an account's MFA.
- Covered by `backend/tests/Feature/MfaEnforcementTest.php` (enforcement,
  adaptive behaviour, fail-closed lookups, the two route exemptions) and
  `backend/tests/Feature/UserManagementTest.php` (the require/disable
  endpoints), plus `src/context/authMfaGate.test.js` on the frontend.

## For future sessions

If you're reading this while continuing work on this project: treat the
facts above as current as of this file's most recent edit. If you change any
of this architecture (re-adding Sanctum, changing which routes carry
`supabase.mfa`, adding a backend login route, etc.), update this file in the
same change — it is the thing every other file in this codebase points to.