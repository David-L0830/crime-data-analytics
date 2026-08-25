# BADAC CDARS — Backend (Laravel API)

Laravel 12 REST API for the **Barangay 178 (North Caloocan) Crime Data
Analytics and Reporting System (CDARS)**.

This service is the only component that talks to the application database.
The React frontend never queries PostgreSQL directly — it authenticates
against Supabase Auth, then calls this API with the resulting access token.

---

## Table of Contents

1. [Backend Overview](#1-backend-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Installation / Local Development](#5-installation--local-development)
6. [Environment Variables](#6-environment-variables)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [API Endpoints](#8-api-endpoints)
9. [Metabase Integration](#9-metabase-integration)
10. [CORS](#10-cors)
11. [Docker / Production Deployment](#11-docker--production-deployment)
12. [Testing](#12-testing)
13. [Health Check](#13-health-check)
14. [Troubleshooting](#14-troubleshooting)
15. [Security Notes](#15-security-notes)

---

## 1. Backend Overview

The Laravel backend is the system's authoritative data and authorization
layer. It:

- **Serves the REST API** consumed by the React SPA — incidents, criminals,
  victims, users, settings, notifications, audit logs and sync logs.
- **Verifies Supabase access tokens.** It never sees a password, never issues
  a session cookie, and never creates accounts.
- **Enforces role-based authorization** server-side, so a restricted account
  calling an endpoint directly is rejected even though the React UI already
  hides the link.
- **Computes dashboard and analytics aggregates** for the Chart.js content
  the frontend renders itself.
- **Signs Metabase embedding URLs.** The Metabase embedding secret lives only
  here; the browser receives a signed URL, never the key.
- **Writes audit-log records** for mutating actions.

### Role in the wider system

| Component | Host | Responsibility |
|---|---|---|
| React SPA | Vercel | UI, filter state, Chart.js rendering, Supabase sign-in |
| **Laravel API** | **Render (Docker)** | **Business data, authorization, Metabase URL signing** |
| Supabase | Supabase Cloud | Auth (JWT issuer) **and** the PostgreSQL database |
| Metabase | Self-hosted | Embedded dashboards, queries PostgreSQL directly |

Two consequences of this split are worth stating explicitly:

- The **browser**, not Render, loads the Metabase iframe. This backend only
  builds and signs a URL string — it never makes an HTTP request to Metabase.
- Sign-in is completed by the browser against Supabase, but the frontend then
  calls `GET /api/user` to resolve the local account and role. **If this API
  is unreachable, sign-in cannot complete**, even when Supabase itself
  succeeded.

---

## 2. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Laravel **12** (`12.66.0` at time of writing) | |
| Language | PHP **^8.2** (`composer.json`); the container image is `php:8.2-fpm-alpine` | Verified locally on PHP 8.3 |
| Database | PostgreSQL (`pgsql` driver) | Supabase Cloud in production; local Postgres also works |
| Authentication | Supabase Auth — Bearer JWT only | No Sanctum, no sessions, no password login |
| JWT library | `firebase/php-jwt` `^7.1` | Used for both Supabase verification and Metabase signing |
| BI embedding | Metabase static (signed) embedding | HS256 JWT signed server-side |
| Web server | nginx + php-fpm | Only in the Docker image; `php artisan serve` locally |
| Tests | PHPUnit `^11` | In-memory SQLite |
| Code style | Laravel Pint `^1.13` | `./vendor/bin/pint --test` in CI |

Cache, session and queue all default to non-Redis drivers: `cache = database`,
`session = database`, `queue = sync`, `mail = log`. There is no Redis, no
queue worker and no scheduler in this deployment.

---

## 3. Architecture

### 3.1 Request flow

```
React SPA (Vercel)
      │  Authorization: Bearer <Supabase access token>
      ▼
Laravel API (Render, nginx → php-fpm)
      │  1. auth:supabase guard  → SupabaseTokenValidator (verify JWT)
      │  2. role: middleware     → EnsureRole (403 on wrong role)
      │  3. Controller           → FormRequest validation
      │  4. Eloquent
      ▼
Supabase PostgreSQL
```

Responses are always JSON: `bootstrap/app.php` forces JSON rendering for any
request matching `api/*` or expecting JSON, so errors never come back as
Laravel's HTML error pages.

### 3.2 Authentication flow

```
Browser ──▶ Supabase Auth        (email/password or Google — handled by supabase-js)
Supabase ──▶ access token (JWT)
Browser ──▶ Laravel  Authorization: Bearer <token>
Laravel  ──▶ SupabaseTokenValidator
               ├─ verify signature via JWKS  (primary)
               ├─ or via SUPABASE_JWT_SECRET (HS256 fallback, legacy projects)
               ├─ check exp (library), aud === 'authenticated', iss === {SUPABASE_URL}/auth/v1
               └─ map claims → existing local User
```

There is **no** `/login`, `/register`, `/forgot-password`, `/reset-password`
or `/auth/google/*` route in this API. Every credential path is owned by
Supabase and executed from the frontend.

### 3.3 Metabase embedding flow

```
React  ──▶ GET /api/embed/metabase/{crime|analytics|trends}?dateFrom=&dateTo=&crimeType=&sitio=&status=&category=
Laravel ──▶ MetabaseEmbedController::buildLockedParams()   (map filter names → Metabase slugs)
        ──▶ MetabaseEmbedService::embedUrlFor()            (sign HS256 JWT with the embedding secret)
        ──▶ { "url": "https://<metabase>/embed/dashboard/<jwt>#<display options>" }
React  ──▶ <iframe src={url}>   ← the browser loads Metabase directly
```

### 3.4 CORS

`config/cors.php` applies to `api/*` only. Allowed origins are built entirely
from environment variables (`FRONTEND_URL` plus a comma-separated
`CORS_ALLOWED_ORIGINS`); nothing is hardcoded. `supports_credentials` is
`false` because this API is Bearer-token-only and never relies on cookies.

### 3.5 Role-based authorization

Authorization is applied at two levels:

1. **Route middleware** — `role:` (`App\Http\Middleware\EnsureRole`) returns
   `403 Forbidden — insufficient role.` when the authenticated user's role is
   not in the allowed list.
2. **Per-record ownership inside controllers** — an Encoder may only update or
   archive an incident they personally encoded (`incidents.reported_by`).

FormRequest classes deliberately return `true` from `authorize()`; they handle
validation only. Authorization lives in the middleware and the controller
ownership checks described above.

---

## 4. Project Structure

```
backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/Api/       13 controllers (see §8)
│   │   ├── Middleware/
│   │   │   ├── EnsureRole.php            role: middleware — RBAC
│   │   │   ├── EnsureSupabaseAal2.php    MFA/aal2 gate — registered but NOT used (see below)
│   │   │   └── LogAuditAction.php        alias registered but NOT attached to any route
│   │   ├── Requests/              7 FormRequests (Store/Update Incident, Criminal, Victim, User)
│   │   └── Resources/             6 API Resources (Incident, Criminal, Victim, User, AuditLog, Notification)
│   ├── Models/                    User, Incident, Criminal, Victim, AuditLog, AppNotification, Setting, SyncLog
│   ├── Providers/AppServiceProvider.php   registers the 'supabase' guard; forces HTTPS in production
│   └── Services/
│       ├── SupabaseTokenValidator.php     JWT verification + user resolution
│       ├── SupabaseAdminService.php       Supabase Admin API (MFA factor removal only)
│       └── MetabaseEmbedService.php       signs Metabase embed JWTs
├── bootstrap/app.php              routing, /up health route, middleware aliases, JSON exceptions
├── config/                        app, auth, cache, cors, database, filesystems, logging,
│                                  mail, metabase, queue, services, session, supabase, view
├── database/
│   ├── factories/                 model factories used by tests and seeders
│   ├── migrations/                schema history (incl. the residents-table drop)
│   └── seeders/                   User, Incident, Criminal, Victim, AuditLog, Notification, Setting, SyncLog
├── docker/
│   ├── entrypoint.sh              renders nginx config, caches config in production, starts php-fpm + nginx
│   ├── nginx.conf.template        nginx vhost, ${PORT} substituted at start-up
│   ├── nginx.conf                 vhost used by the docker-compose network
│   └── php-fpm-pool.conf          moves php-fpm to 127.0.0.1:9001
├── routes/
│   ├── api.php                    all 38 API routes
│   ├── web.php                    GET / service banner only
│   └── console.php
├── tests/Feature/                 7 feature test classes
├── Dockerfile                     nginx + php-fpm production image
└── phpunit.xml                    in-memory SQLite test environment
```

**Two classes exist but are not wired to any route**, and are documented here
so nobody assumes otherwise:

- `EnsureSupabaseAal2` (`supabase.mfa`) — MFA/`aal2` step-up was **removed**
  from this application. The alias is still registered in `bootstrap/app.php`
  and the class is retained in case MFA is reintroduced, but **no route uses
  it**. A valid Supabase access token (`aal1`) is sufficient everywhere.
- `LogAuditAction` (`audit.log`) — the alias is registered, but audit entries
  are written directly inside the controllers rather than by this middleware.

There is **no `Resident` model and no `/api/residents` endpoint**. The
`residents` table was dropped by
`database/migrations/2026_08_21_200721_drop_residents_table.php`.

---

## 5. Installation / Local Development

### Prerequisites

- PHP **8.2+** with the extensions Laravel requires plus `pdo_pgsql`
- Composer 2
- PostgreSQL — a local instance or a Supabase project
- A Supabase project (for authentication)
- Optional: Docker, if you prefer running via `docker-compose`

### Steps

```bash
cd backend

# 1. Install PHP dependencies
composer install

# 2. Create your environment file
cp .env.example .env

# 3. Generate the application key
php artisan key:generate

# 4. Edit .env — at minimum the DB_* and SUPABASE_* values, plus the
#    METABASE_* values if you need embedded dashboards locally (see §6).

# 5. Create the schema and seed reference data
php artisan migrate --seed

# 6. Serve the API
php artisan serve
```

The API is then available at `http://localhost:8000/api`.

### Accounts

There is **no self-registration**. A person can sign in only when both are
true:

1. A row exists in this database's `users` table
   (see `database/seeders/UserSeeder.php`), and
2. A Supabase Auth user exists with a **matching, verified email**.

On first sign-in the backend links the two by writing `supabase_user_id` onto
the local row.

### Cache / config commands

Local development runs **without** a config cache, which is deliberate — see
the warning in §15. If you ever run `php artisan config:cache` locally, clear
it before committing:

```bash
php artisan config:clear
php artisan route:clear
php artisan cache:clear
```

### Running the tests

```bash
php artisan test
```

---

## 6. Environment Variables

Only **names** are listed here. Never commit real values, and never copy
values out of `.env` into documentation, issues or commits.

### Required in production

| Variable | Purpose |
|---|---|
| `APP_KEY` | Laravel encryption key. Generate with `php artisan key:generate`. |
| `APP_ENV` | `production` on Render, `local` in development. Also gates config caching in the entrypoint. |
| `APP_DEBUG` | Must be `false` in production. |
| `APP_URL` | Public base URL of this API. |
| `DB_CONNECTION` | `pgsql`. |
| `DB_HOST` / `DB_PORT` / `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` | PostgreSQL / Supabase connection details. |
| `DB_SSLMODE` | `require` for Supabase. |
| `FRONTEND_URL` | Primary allowed CORS origin (the Vercel URL in production). |
| `SUPABASE_URL` | Project URL. Used to derive the JWKS endpoint and to validate the token `iss` claim. |
| `SUPABASE_PROJECT_ID` | Supabase project reference. |

### Required for Metabase embedding

Read by `config/metabase.php`. Without them, `GET /api/embed/metabase/{key}`
returns **503**.

| Variable | Purpose |
|---|---|
| `METABASE_SITE_URL` | Base URL of the Metabase instance, no trailing slash. |
| `METABASE_EMBEDDING_SECRET_KEY` | Static-embedding secret. Signs every embed JWT. **Secret.** |
| `METABASE_DASHBOARD_ID_CRIME` | Numeric dashboard ID for the `crime` key. |
| `METABASE_DASHBOARD_ID_ANALYTICS` | Numeric dashboard ID for the `analytics` key. |
| `METABASE_DASHBOARD_ID_TRENDS` | Numeric dashboard ID for the `trends` key. |

> **Note:** these five variables are **not currently listed in
> `.env.example`**, even though the code reads them. Set them manually in
> `backend/.env` and in the Render environment.

### Optional

| Variable | Purpose |
|---|---|
| `CORS_ALLOWED_ORIGINS` | Extra allowed origins, comma-separated, merged with `FRONTEND_URL`. |
| `SUPABASE_JWT_SECRET` | Legacy **HS256** shared secret. Only needed for older Supabase projects that have not moved to JWKS signing keys. Distinct from the service-role key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required **only** for `POST /api/users/{user}/two-factor/disable`. Highly privileged — see §15. |
| `APP_NAME`, `APP_TIMEZONE` | Display name and timezone (`Asia/Manila`). |
| `LOG_CHANNEL`, `LOG_LEVEL` | Logging configuration. |
| `SESSION_*`, `CACHE_STORE`, `QUEUE_CONNECTION` | Framework defaults; no Redis or queue worker is used. |
| `MAIL_*` | Unused in practice — this backend sends no email (Supabase owns password resets). |

### Supplied automatically by Render

| Variable | Purpose |
|---|---|
| `PORT` | Injected by Render at runtime. `docker/entrypoint.sh` substitutes it into the nginx config and falls back to `9000` when unset. **Do not set this manually.** |

---

## 7. Authentication & Authorization

### Supabase authentication

Supabase Auth is the only credential system. The frontend signs in with
`supabase-js`; this backend only ever **verifies** an already-issued token.

### JWT verification — `App\Services\SupabaseTokenValidator`

For every request on an `auth:supabase` route:

1. Read the `Authorization: Bearer <token>` header. Missing or malformed →
   unauthenticated.
2. **Verify the signature via JWKS** (primary path). Keys are fetched from
   `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` and cached for
   `jwks_cache_ttl` (3600s). This supports Supabase's current asymmetric
   RS256/ES256 signing keys. A network failure here is non-fatal — it falls
   through to step 3.
3. **Fallback: HS256 shared secret** — used only when `SUPABASE_JWT_SECRET`
   is configured (legacy projects).
4. Validate claims: `exp` (enforced by the JWT library), `aud` must equal
   `authenticated`, and `iss` must equal `{SUPABASE_URL}/auth/v1`.
5. Any failure is logged and results in a **401** before any controller runs.

The token is never merely decoded and trusted.

### User lookup and linking

1. **Fast path** — match `users.supabase_user_id` against the token's `sub`.
2. **First-time linking** — if no match, and the token carries an email with
   `email_verified` true, find the local account by case-insensitive email and
   write `supabase_user_id` onto it.
3. **Never creates a user.** No local row, unverified email, or
   `is_active = false` → unauthenticated.

The token's `aal` claim is stored on the request as `supabase_aal` (defaulting
to `aal1` when absent) and surfaced through `UserResource`, but **no route
requires `aal2`** — MFA step-up has been removed.

### Roles

Defined as constants on `App\Models\User`:

| Constant | Value | Label |
|---|---|---|
| `ROLE_BADAC_ADMIN` | `badac_admin` | Administrator |
| `ROLE_ENCODER` | `encoder` | Encoder |
| `ROLE_BADAC_READONLY` | `badac_readonly` | BADAC |

### Which roles can do what

| Capability | Administrator | Encoder | BADAC (read-only) |
|---|:---:|:---:|:---:|
| Current user, profile, avatar, notifications, logout | ✅ | ✅ | ✅ |
| Read incidents (list, detail, map) | ✅ | ✅ | ✅ |
| Create / update / archive incidents | ✅ | ✅ *(own records only)* | ❌ |
| Dashboard, analytics, Metabase embed URLs | ✅ | ❌ | ✅ |
| Read criminals and victims | ✅ | ❌ | ✅ |
| Create / update / archive criminals and victims | ✅ | ❌ | ❌ |
| Settings (read and write) | ✅ | ❌ | ❌ |
| User management, audit logs, sync logs | ✅ | ❌ | ❌ |

### Ownership restriction

`IncidentController::update()` and `IncidentController::archive()` both check
that an Encoder owns the record:

> `Encoders may only update incidents they personally encoded.` → **403**
> `Encoders may only archive incidents they personally encoded.` → **403**

Administrators are not subject to this check. Ownership is
`incidents.reported_by`, set from the authenticated user at creation time.

### Archiving instead of deleting

No route performs a physical `DELETE` on an incident, criminal or victim.
All three expose `PUT .../archive`, which changes `status` rather than
removing the row.

---

## 8. API Endpoints

**Full request/response reference:
[`docs/API_ENDPOINTS.md`](../docs/API_ENDPOINTS.md)** — parameters, request
bodies, response shapes, status codes and worked examples. The summary below
is a routing index; it is not a substitute for that document.

The application exposes **38 API routes**, plus `GET /` and `GET /up`. This
table was generated from `php artisan route:list` and cross-checked against
`docs/API_ENDPOINTS.md`.

Legend — **Auth**: all `/api/*` routes require a valid Supabase Bearer token.
**Role**: `admin` = `badac_admin`, `encoder` = `encoder`, `readonly` =
`badac_readonly`; "any" means any authenticated role.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | public | Service banner (JSON) |
| GET | `/up` | public | Health check |
| GET | `/api/user` | any | Current user + role + MFA assurance level |
| POST | `/api/logout` | any | Records the logout audit event |
| PUT | `/api/me` | any | Update own profile (`fullName`, …) |
| POST | `/api/me/avatar` | any | Upload avatar (image, jpg/jpeg/png/webp, ≤ 4 MB) |
| GET | `/api/dashboard` | admin, readonly | Dashboard KPIs and summary data |
| GET | `/api/analytics` | admin, readonly | Analytics aggregate payload |
| GET | `/api/analytics/crime-types` | admin, readonly | Counts by crime type |
| GET | `/api/analytics/monthly` | admin, readonly | Monthly totals |
| GET | `/api/analytics/locations` | admin, readonly | Counts by location |
| GET | `/api/embed/metabase/{dashboardKey}` | admin, readonly | Signed Metabase embed URL (§9) |
| GET | `/api/incidents` | any | List/filter incidents |
| GET | `/api/incidents/map` | any | Map payload for Leaflet |
| GET | `/api/incidents/{incident}` | any | Incident detail |
| POST | `/api/incidents` | admin, encoder | Create an incident |
| PUT | `/api/incidents/{incident}` | admin, encoder¹ | Update an incident |
| PUT | `/api/incidents/{incident}/archive` | admin, encoder¹ | Archive an incident |
| GET | `/api/criminals` | admin, readonly | List criminal records |
| GET | `/api/criminals/{criminal}` | admin, readonly | Criminal profile |
| POST | `/api/criminals` | admin | Create a criminal record |
| PUT | `/api/criminals/{criminal}` | admin | Update a criminal record |
| PUT | `/api/criminals/{criminal}/archive` | admin | Archive a criminal record |
| GET | `/api/victims` | admin, readonly | List victims |
| GET | `/api/victims/{victim}` | admin, readonly | Victim profile |
| POST | `/api/victims` | admin | Create a victim record |
| PUT | `/api/victims/{victim}` | admin | Update a victim record |
| PUT | `/api/victims/{victim}/archive` | admin | Archive a victim record |
| GET | `/api/notifications` | any | Notification list |
| PUT | `/api/notifications/{notification}/read` | any | Mark one as read |
| PUT | `/api/notifications/read-all` | any | Mark all as read |
| GET | `/api/settings` | admin | Read business configuration |
| PUT | `/api/settings` | admin | Update business configuration |
| GET | `/api/users` | admin | List accounts |
| GET | `/api/users/{user}` | admin | Account detail |
| PUT | `/api/users/{user}` | admin | Update an account (`role` is not mass-assignable) |
| PUT | `/api/users/{user}/status` | admin | Activate/deactivate (self-lockout guarded) |
| POST | `/api/users/{user}/two-factor/disable` | admin | Force-remove the target's Supabase MFA factors |
| GET | `/api/audit-logs` | admin | Audit trail |
| GET | `/api/sync-logs` | admin | Synchronization log |

¹ Encoders may only update/archive incidents they personally encoded.

### Common status codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Created |
| 401 | Missing, invalid or expired Supabase token; or no matching active local account |
| 403 | Authenticated but role or record ownership forbids the action |
| 404 | Record not found, or unknown Metabase `dashboardKey` |
| 422 | Validation failed (FormRequest) |
| 503 | Metabase embedding is not configured |

Mutating endpoints write an `audit_logs` row (user, action, module,
description, IP).

---

## 9. Metabase Integration

Implemented by `MetabaseEmbedController` + `MetabaseEmbedService`, configured
in `config/metabase.php`.

### Dashboard selection

`GET /api/embed/metabase/{dashboardKey}` accepts exactly three keys —
`crime`, `analytics`, `trends`. Anything else returns **404**. Each key maps
to a numeric Metabase dashboard ID supplied by environment variable:

| Key | Environment variable | Frontend module |
|---|---|---|
| `crime` | `METABASE_DASHBOARD_ID_CRIME` | Crime Reporting Dashboard |
| `analytics` | `METABASE_DASHBOARD_ID_ANALYTICS` | Statistical Analysis |
| `trends` | `METABASE_DASHBOARD_ID_TRENDS` | Trend and Pattern Detection |

IDs are left `null` by default, so a misconfiguration fails loudly (**503**,
logged as `Metabase embed misconfigured`) rather than silently embedding the
wrong dashboard.

### Signed embedding

`MetabaseEmbedService::embedUrlFor()` builds and signs an **HS256** JWT with
`METABASE_EMBEDDING_SECRET_KEY`:

```php
[
  'resource' => ['dashboard' => (int) $dashboardId],
  'params'   => (object) $params,     // (object) keeps an empty set as {} not []
  'exp'      => now()->addSeconds(config('metabase.token_ttl', 600))->timestamp,
]
```

The returned URL is:

```
{METABASE_SITE_URL}/embed/dashboard/{jwt}#{appearance}&hide_parameters={slugs}
```

The token expires after `token_ttl` (**600 seconds**), after which the
frontend requests a fresh URL. The secret key itself is never returned,
logged, or sent to the browser.

### How filters are passed

The frontend sends its filter state as query parameters;
`buildLockedParams()` translates them into Metabase parameter slugs:

| Frontend query parameter | Metabase parameter slug |
|---|---|
| `dateFrom` + `dateTo` | `date_range` |
| `crimeType` | `crime_type` |
| `sitio` | `sitio` |
| `status` | `status` |
| `category` | `category` |

The distinction matters: the React FilterBar uses **camelCase** names that
mean something to the application, while Metabase parameters use **snake_case
slugs** defined inside each dashboard. This mapping is the only place the two
naming schemes meet — changing a slug in Metabase requires changing it here.

### Date-range handling

`dateFrom` and `dateTo` collapse into a **single** Metabase parameter of the
form `from~to`, which is what a Metabase date field filter expects. The
parameter is only sent when at least one of the two is present, and a missing
side is left empty (`2026-01-01~`, `~2026-01-31`).

Empty filters are **omitted entirely** rather than sent as empty strings, so a
cleared filter means "no filtering, show everything".

### Hidden parameters and appearance

`hidden_parameters` and `appearance` in `config/metabase.php` are appended to
the URL's **hash fragment**. This is presentation only — the fragment is read
by Metabase's embed page in the browser and never affects the signed token or
any filter value.

`hide_parameters` matters because the Analytics and Trends dashboards publish
their parameters as *Editable*, which is what allows a cleared React filter to
mean "show everything". The side effect is that Metabase renders its own
filter widgets; listing the slugs hides them, keeping the React FilterBar the
single filter UI.

> **The embedding secret must remain private.** It signs every embed token —
> anyone holding it can mint a URL for any dashboard. It belongs only in this
> backend's environment, never in a `VITE_*` variable, the frontend bundle, a
> log line, or an API response.

---

## 10. CORS

Configured in `config/cors.php`:

| Setting | Value |
|---|---|
| `paths` | `api/*` |
| `allowed_methods` | `*` |
| `allowed_origins` | `FRONTEND_URL` merged with `CORS_ALLOWED_ORIGINS` (comma-separated), de-duplicated, empties filtered out |
| `allowed_headers` | `*` |
| `supports_credentials` | `false` |

No origin is hardcoded. `FRONTEND_URL` defaults to `http://localhost:5173`
(the Vite dev server) when unset, which is what makes local development work
out of the box.

**Local development** — the default is usually sufficient; set `FRONTEND_URL`
if you serve the SPA on a different port.

**Production** — set `FRONTEND_URL` to the deployed frontend origin. Use
`CORS_ALLOWED_ORIGINS` to add more (for example a preview deployment). Origins
must include the scheme and no trailing slash.

`supports_credentials` is `false` on purpose: the API authenticates with a
Bearer token, so the browser never needs to send cookies cross-origin.

---

## 11. Docker / Production Deployment

### The image (`backend/Dockerfile`)

Based on `php:8.2-fpm-alpine`, it installs **nginx** plus `gettext` (for
`envsubst`), the PostgreSQL/image/zip/mbstring extensions, and Composer, then:

- runs `composer install --no-dev` and `composer dump-autoload --optimize`
- copies the nginx template, the php-fpm pool override and the entrypoint
- makes `storage` and `bootstrap/cache` writable by `www-data`
- `EXPOSE 9000` — informational only; Render overrides the listening port
  via `$PORT`

Two deliberate design decisions are documented in the Dockerfile itself:

1. **nginx sits in front of php-fpm.** php-fpm speaks FastCGI, not HTTP, so
   running it alone means nothing can answer a browser or a platform health
   check. `docker/php-fpm-pool.conf` moves php-fpm to `127.0.0.1:9001` so
   nginx can own the public port.
2. **Config caching does not happen at build time.** A build has no
   environment, so caching there would bake `null` into every value — and a
   cached config file *wins* over `env()` at runtime. Caching moved to the
   entrypoint.

### Start-up (`docker/entrypoint.sh`)

1. Default `PORT` to `9000` when the platform does not inject one.
2. Render `nginx.conf.template` → `default.conf` with `envsubst`.
3. **Only when `APP_ENV=production`**: `config:clear`, `config:cache`, then
   `route:cache` (non-fatal). The guard is a safety rule, not an
   optimisation — `docker-compose` bind-mounts the working tree, and a cached
   config contains every resolved secret in plaintext.
4. `php artisan storage:link` (non-fatal) for avatar uploads.
5. Start `php-fpm -D`, then `nginx -g 'daemon off;'` in the foreground.

### Render

The service is deployed from this Dockerfile. Render injects `PORT`; all other
variables from §6 must be set in the Render dashboard. There is **no
`render.yaml` in this repository** — the service is configured through
Render's UI. Set `APP_ENV=production` and `APP_DEBUG=false`, and point the
health check at `/up`.

`AppServiceProvider::boot()` calls `URL::forceScheme('https')` when
`APP_ENV=production`, so generated URLs stay HTTPS behind Render's proxy.

### Local Docker

`docker-compose.yml` at the repository root builds this image, bind-mounts
`./backend`, reads `backend/.env`, and maps port `9000`. Supabase is *not*
containerized — it is a hosted database, so point `DB_*` at your Supabase
project.

---

## 12. Testing

```bash
php artisan test          # or: ./vendor/bin/phpunit
```

**Current result: 74 passed (140 assertions).**

Seven feature test classes under `tests/Feature/`:

| Test class | Covers |
|---|---|
| `BadacReadonlyTest` | Read-only role boundaries |
| `CriminalRecordTest` | Criminal CRUD and archiving |
| `IncidentTest` | Incident CRUD, ownership, map payload |
| `NotificationTest` | Notification list and read flags |
| `SupabaseTokenValidationTest` | JWT verification and user resolution |
| `UserManagementTest` | Account administration |
| `VictimTest` | Victim records and case relationships |

### Test environment

`phpunit.xml` pins the environment so tests never touch a real database:
`DB_CONNECTION=sqlite`, `DB_DATABASE=:memory:`, `CACHE_STORE=array`,
`QUEUE_CONNECTION=sync`, `SESSION_DRIVER=array`, `MAIL_MAILER=array`.

It also defines a throwaway `SUPABASE_URL` and `SUPABASE_JWT_SECRET` so the
validator's HS256 fallback path can be exercised **without network access to a
live JWKS endpoint**. These are non-production placeholder values that exist
only to make signature verification testable — they are not credentials and
grant access to nothing.

### Generated artifacts that must not be committed

`backend/.gitignore` already excludes both:

- **`bootstrap/cache/config.php`** — written by `php artisan config:cache`
  with every `env()` value already resolved, meaning `DB_PASSWORD`,
  `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and
  `METABASE_EMBEDDING_SECRET_KEY` appear in it in **plaintext**. It is
  regenerated on demand, so nothing is lost by ignoring it.
- **`.phpunit.result.cache`** — PHPUnit's per-machine result cache, rewritten
  on every run.

### Code style

```bash
./vendor/bin/pint --test     # check
./vendor/bin/pint            # apply
```

CI runs the check step (non-blocking) before the test suite.

---

## 13. Health Check

`GET /up` is registered by Laravel via `withRouting(health: '/up')` in
`bootstrap/app.php`. It boots the framework and returns a success response,
which makes it a genuine "is the app able to serve traffic" probe rather than
a static file.

Use it for:

- **Render's health check** — the platform restarts the service if it stops
  responding.
- **Verifying a deployment** — a response here means nginx, php-fpm and the
  Laravel bootstrap are all working, independently of database credentials.
- **Keeping a free-tier instance warm**, if you poll it externally.

`GET /` is separate: it returns a small JSON banner with the app name and
status, useful for confirming you have reached the right service.

---

## 14. Troubleshooting

### CORS errors in the browser

*"No 'Access-Control-Allow-Origin' header"* — the calling origin is not in the
allow-list. Confirm `FRONTEND_URL` (and `CORS_ALLOWED_ORIGINS` if used) match
the browser's origin **exactly**: scheme included, no trailing slash. In
production, re-check the value in the Render dashboard, then redeploy so the
config cache is rebuilt.

### Changes to `.env` have no effect

A stale config cache almost always explains this. `bootstrap/cache/config.php`
overrides `env()` entirely. Run `php artisan config:clear` locally; on Render,
redeploy so the entrypoint rebuilds the cache from the injected environment.

### Missing environment variables

- Missing `APP_KEY` → the app fails to boot. Run `php artisan key:generate`.
- Missing `SUPABASE_URL` → every authenticated request fails; the validator
  raises `SUPABASE_URL is not configured.`
- Missing `METABASE_*` → `GET /api/embed/metabase/{key}` returns **503** with
  `Analytics dashboard is not configured yet.`; the real reason is in the log
  as `Metabase embed misconfigured`.

### Database connection problems

Check `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` and
`DB_SSLMODE=require`. Supabase connections go through the connection pooler
and require SSL. Verify the `pdo_pgsql` extension is present —
`php artisan about` reports the active database driver.

### Supabase authentication problems (401)

Every one of these produces a 401:

- The token expired — the frontend must refresh it.
- `iss` does not match `{SUPABASE_URL}/auth/v1` — usually the wrong project.
- `aud` is not `authenticated`.
- JWKS is unreachable **and** no `SUPABASE_JWT_SECRET` fallback is configured.
- **No matching local account.** The commonest cause in practice: the Supabase
  user exists but there is no `users` row with that email, the email is not
  verified, or the account has `is_active = false`. This backend never creates
  accounts.

Verification failures are logged with a reason, which is the fastest way to
tell these apart.

### Metabase embedding problems

- **503** → one of the five `METABASE_*` variables is missing.
- **404** → `dashboardKey` is not `crime`, `analytics` or `trends`.
- **Iframe loads but shows an error** → the signed token is fine but Metabase
  rejected it: confirm static embedding is enabled, the dashboard is published
  for embedding, and `METABASE_EMBEDDING_SECRET_KEY` matches the current
  secret in Metabase.
- **Iframe blank / connection refused** → `METABASE_SITE_URL` must be
  reachable **from the browser**, not from Render. The backend never contacts
  Metabase.
- **Filters ignored** → a parameter slug in Metabase no longer matches the
  mapping in `buildLockedParams()`.

### Laravel cache / config issues

```bash
php artisan config:clear
php artisan route:clear
php artisan cache:clear
php artisan view:clear
```

### Render deployment issues

- **Health check failing** → confirm the check targets `/up` and that nothing
  overrides `PORT`; nginx binds whatever Render injects.
- **Everything 500s right after deploy** → usually a config cache built
  against a missing variable. Check the build/start logs for the
  `[entrypoint]` lines, which report the port and whether the cache was built.
- **Cold starts** → a free-tier instance sleeps when idle; the first request
  after sleep is slow. That is the platform, not the application.
- **php-fpm errors are visible in the log stream** because
  `catch_workers_output` is enabled in `docker/php-fpm-pool.conf`.

---

## 15. Security Notes

- **Never commit `.env`.** Only `.env.example`, containing placeholders, is
  tracked. `.env` is git-ignored, and the nginx config additionally denies
  requests for dotfiles.
- **Never commit `bootstrap/cache/config.php`.** It contains every resolved
  secret in plaintext. It is git-ignored — keep it that way, and never run
  `config:cache` on a bind-mounted working tree.
- **Never expose the Supabase service-role key.** `SUPABASE_SERVICE_ROLE_KEY`
  bypasses row-level security and can administer any account. It is used by
  exactly one code path — `SupabaseAdminService`, for admin-forced MFA factor
  removal — and must never appear in a `VITE_*` variable, the frontend bundle,
  an API response, or a log line. It is a different value from
  `SUPABASE_JWT_SECRET`.
- **Never expose the Metabase embedding secret.**
  `METABASE_EMBEDDING_SECRET_KEY` signs every embed token; anyone holding it
  can mint a URL for any dashboard. It stays server-side only.
- **Never expose the database password.** `DB_PASSWORD` belongs in the
  environment, never in code, documentation, or a commit.
- **Supply production values only through environment variables** — the Render
  dashboard for this API, the Vercel dashboard for the frontend. Rotate any
  credential that has ever been committed, pasted into an issue, or shared in
  a chat; rotation is the only real remedy once a secret has left its
  environment.
- **This backend never handles a password.** The legacy `users.password`
  column is nullable, unused for authentication, excluded from `$fillable`,
  and hidden from serialization.
- **Authorization is enforced server-side.** Hiding a link in the React UI is
  not authorization — `EnsureRole` and the controller ownership checks are.
- **Seeded data is fictional** and scoped to Barangay 178, North Caloocan.
  Never commit real personal data, real user emails, access tokens or JWTs to
  this repository.
