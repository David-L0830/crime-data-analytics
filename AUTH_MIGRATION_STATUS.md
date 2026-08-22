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

- No route enforces AAL2 (`supabase.mfa` middleware alias exists but is
  never attached to any route).
- `app/Http/Middleware/EnsureSupabaseAal2.php` is deliberately kept in the
  codebase, unwired, in case step-up MFA is reintroduced later. It is not
  currently invoked anywhere.
- Login-flow MFA screens were removed from `src/pages/Login.jsx` and
  `src/context/AuthContext.jsx`.
- `POST /api/users/{user}/two-factor/disable` remains active by design —
  it lets a `badac_admin` remotely clear a target user's Supabase MFA
  factors (e.g. to unlock someone who lost their authenticator), via
  `app/Services/SupabaseAdminService.php`, logged to `audit_logs`.

## For future sessions

If you're reading this while continuing work on this project: treat the
facts above as current as of this file's creation. If you change any of
this architecture (re-adding Sanctum, enforcing AAL2 on new routes, adding
a backend login route, etc.), update this file in the same change — it is
the thing every other file in this codebase points to.