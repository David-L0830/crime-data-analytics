# BADAC CDARS — Backend (Laravel API)

Laravel 12 REST API for the **Barangay 178 (North Caloocan) Crime Data
Analytics and Reporting System**. Talks to PostgreSQL/Supabase through
Eloquent; the React frontend only ever talks to this API, never to the
database directly.

## Stack

- Laravel 12 / PHP 8.2+
- Supabase Auth (JWT bearer tokens) — the only authentication system; no
  Laravel session cookies, no Sanctum, no local password login
- PostgreSQL (local Postgres in development, Supabase in production)

## Setup

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
# edit .env with your local Postgres or Supabase credentials, plus
# SUPABASE_URL / SUPABASE_PROJECT_ID (and SUPABASE_JWT_SECRET only if your
# project still uses legacy HS256 signing keys instead of JWKS)
php artisan migrate --seed
php artisan serve
```

The API is now available at `http://localhost:8000/api`.

Accounts are **not** created by registering through this app — every user
must already exist in this database (see `database/seeders/UserSeeder.php`)
*and* be created in Supabase Auth (matching email) before they can sign in.
There is no self-registration endpoint.

## Roles

Three account types, enforced server-side by the `role:` route middleware
(`app/Http/Middleware/EnsureRole.php`), never by the frontend alone:

- **Administrator** (`role = badac_admin`) — full access, including
  User Management and Settings.
- **Encoder** (`role = encoder`) — restricted to the Crime Data Collection
  module; can only create/update/archive incidents they reported themselves.
- **BADAC** (`role = badac_readonly`) — full view access from
  the Dashboard through Audit Logs, no create/edit/archive rights anywhere.

See `app/Models/User.php` for the role constants and `routes/api.php` for
which roles each endpoint allows.

## Authentication flow

Supabase Auth issues the JWT; this backend only ever verifies it — it never
sees a password and never issues a session cookie or CSRF token.

```
React (Supabase JS client)
   |
   v
Supabase Auth  (email/password, Google via Supabase's own OAuth provider,
   |             Supabase MFA)
   v
Supabase access token (JWT)
   |
   v
Authorization: Bearer <token>   (attached automatically by src/services/api.js)
   |
   v
Laravel 'auth:supabase' guard -> App\Services\SupabaseTokenValidator
   (verifies signature via JWKS or SUPABASE_JWT_SECRET, checks exp/aud/iss)
   |
   v
GET /api/user  -> current authenticated user + MFA assurance level
```

There is no `/api/login`, `/api/register`, `/forgot-password`,
`/reset-password`, or `/auth/google/*` route in this API — every credential
path is handled by Supabase directly from the frontend
(`src/context/AuthContext.jsx`, `src/lib/supabaseClient.js`). Routes that
touch business/PII data additionally require the token's `aal` claim to be
`aal2` (i.e. the session completed a Supabase MFA challenge) — see
`App\Http\Middleware\EnsureSupabaseAal2`.

An Administrator can force-remove another user's MFA factor (the "lost my
phone" break-glass action, `POST /api/users/{user}/two-factor/disable`) via
`App\Services\SupabaseAdminService`, which uses the Supabase
**service-role key** server-side only — see the Security notes below and
`.env.example`.

## API endpoints

| Method | Endpoint | Notes |
|---|---|---|
| GET | /api/user | auth — current user + MFA assurance level |
| POST | /api/logout | auth |
| GET | /api/dashboard | auth, MFA (aal2) |
| GET/POST | /api/incidents | auth, MFA |
| GET/PUT | /api/incidents/{id} | auth, MFA |
| PUT | /api/incidents/{id}/archive | auth, MFA — soft-archive (sets status to Archived); replaces the old DELETE as of Checkpoint 20 |
| GET | /api/incidents/map | auth, MFA — Leaflet map payload |
| GET/POST | /api/residents | auth, MFA — admin only |
| GET/PUT | /api/residents/{id} | auth, MFA — admin only |
| PUT | /api/residents/{id}/archive | auth, MFA — admin only; soft-archive; replaces the old DELETE as of Checkpoint 20 |
| GET/POST | /api/criminals | auth, MFA — admin only |
| GET/PUT | /api/criminals/{id} | auth, MFA — admin only |
| GET/POST | /api/victims | auth, MFA — admin only |
| GET/PUT | /api/victims/{id} | auth, MFA — admin only |
| PUT | /api/victims/{id}/archive | auth, MFA — admin only; soft-archive; replaces the old DELETE as of Checkpoint 20 |
| GET | /api/analytics, /crime-types, /monthly, /locations | auth, MFA — admin/readonly |
| GET | /api/audit-logs | auth, MFA — admin/readonly |
| GET | /api/sync-logs | auth, MFA — admin only |
| GET | /api/notifications | auth |
| PUT | /api/notifications/{id}/read, /notifications/read-all | auth |
| GET/PUT | /api/settings | auth, MFA — admin only |
| GET/PUT | /api/users, /api/users/{id}, /api/users/{id}/status | auth, MFA — admin only |
| POST | /api/users/{id}/two-factor/disable | auth, MFA — admin only, force-removes the target user's Supabase MFA factor |

No route in this table performs a physical `DELETE` on an incident, resident,
or victim record — all three use the `.../archive` PUT endpoint above, which
sets `status` to `Archived` rather than removing the row.

All mutating endpoints write an `audit_logs` row (user, action, module,
description, IP).

## Testing

```bash
php artisan test
```

Tests run against an in-memory SQLite database (see `phpunit.xml`) so they
never touch your real Postgres/Supabase database.
`tests/Feature/SupabaseMfaTest.php` builds hand-signed JWTs against
`SUPABASE_JWT_SECRET` to exercise the Supabase auth/MFA/RBAC paths without a
live Supabase project or network access — see that file's header comment for
exactly what it can and cannot verify in a sandboxed environment.

## Data scope

All seeded data is fictional and scoped to Barangay 178, North Caloocan
(`BARANGAY_178_CENTER` in the frontend constants — incident coordinates are
seeded within a small radius of that point). This is not a nationwide
database.

## Security notes

- No password is ever handled by this backend. New/existing accounts
  authenticate entirely through Supabase Auth; the legacy `users.password`
  column is nullable and unused for authentication (kept only so already-
  migrated rows aren't destructively altered — see the
  `2025_02_01_000001_final_auth_migration_drop_sanctum_tokens_and_nullify_password`
  migration).
- `.env` is git-ignored; only `.env.example` (placeholders) is committed.
- CORS (`config/cors.php`) is driven entirely by the `FRONTEND_URL` /
  `CORS_ALLOWED_ORIGINS` env vars — nothing is hardcoded. `supports_credentials`
  is `false`: this API is Bearer-token-only, so the browser never needs to
  send cookies cross-origin.
- The Supabase **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) IS used by
  this backend — but only server-side, only by `App\Services\SupabaseAdminService`,
  and only for the admin-forced MFA removal action described above. It must
  never be placed in the frontend's `.env` or in any `VITE_*` variable — see
  `.env.example` for the full warning.
