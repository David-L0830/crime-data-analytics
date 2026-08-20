# BADAC / Crime Data Analytics — Project Memory & Continuation Context

> **Source basis for this document.** This memory was synthesized from three inputs, in this priority order (per your instructions): (1) direct inspection of the actual project source code, as read by a prior Claude session during a README-rewrite task (`Crime_Data_Analytics.zip`, ~221 files); (2) historical project documents captured inside that same ZIP (`PROGRESS.md`, `TODO.md`, the prior `README.md`, `backend/README.md`) which record checkpoint-by-checkpoint history from earlier sessions; (3) this account's own prior memory of the project, used only as a secondary cross-check. Where these conflicted, the source code (most recent, most authoritative) wins, and the conflict is noted rather than silently resolved.
>
> **Important scope caveat.** The exported conversation history you provided contained **one conversation**, whose actual substance was a single "inspect the repo and rewrite the README" task — not a full multi-session chat log. That means the checkpoint narrative below (Section 15) is reconstructed from `PROGRESS.md`/`TODO.md` files that a *previous* session had already written into the repository, plus this account's own prior memory — not from reading dozens of individual past conversations turn-by-turn. Where a checkpoint's outcome could not be verified from the current code, it's marked accordingly.
>
> Status legend used throughout: **CONFIRMED** (verified in current source code) · **IMPLEMENTED** · **PARTIALLY IMPLEMENTED** · **PLANNED** · **BLOCKED** · **REJECTED** · **UNKNOWN / NOT VERIFIED**.

---

## 1. Project Identity

- **Project/system name:** CDARS — **Crime Data Analytics and Reporting System**, publicly branded as **"BADAC Crime Analytics"** / **"BADAC Analytics"**. Repository name seen in one upload: `crime-data-analytics` (GitHub, user `David-L0830`); the ZIP's internal folder name is `Crime Data Analytics`.
- **Purpose:** An internal tool for Barangay 178 (North Caloocan)'s **Barangay Anti-Drug Abuse Council (BADAC)** to record, investigate, and analyze local crime incidents.
- **Problem being solved:** Crime data collection was previously manual/paper-based, making it hard to spot hotspots, track case status, or produce barangay-level crime statistics on demand.
- **Intended users — three internal staff account types (CONFIRMED from `EnsureRole`/`constants.js`/routes):**
  - **Administrator** (`role = badac_admin`) — full access.
  - **Encoder** (`role = encoder`) — records incidents; restricted to own records.
  - **BADAC** (`role = badac_readonly`) — read-only reviewer.
- **Main goals:** single system of record for incidents (replacing paper); a cross-linked criminal/victim register; barangay-level statistics without manual spreadsheet work; server-side (not just UI) access control per role; an audit trail; identity managed by a third-party provider (Supabase Auth) rather than the app owning its own password store.
- **Key terminology (preserve as-is):**
  - **CDARS** = Crime Data Analytics and Reporting System (the formal/full name).
  - **BADAC** = Barangay Anti-Drug Abuse Council (the org this serves) — also used as the name of the read-only user role.
  - **"Archive, never delete"** — the project's standing data-retention pattern; incidents/victims are soft-archived (`status = 'Archived'`), never SQL-`DELETE`d.
  - **"Checkpoint N"** — the project's session/task-tracking convention, used throughout `TODO.md`/`PROGRESS.md`/code comments to mark a discrete unit of work.
  - **AAL / `aal2`** — Supabase's Authenticator Assurance Level claim, used for MFA step-up (see Section 7).
- **This document supersedes conflicting older session notes** where the source code disagreed with them — see Section 16 for the specific reconciliation, most importantly the Laravel version and the `.github/` CI claim.

---

## 2. Technology Stack

*(CONFIRMED from `package.json`, `backend/composer.json`, Dockerfiles, `turbo.json`.)*

| Technology | Role |
|---|---|
| **React 19 + Vite 8** | Frontend SPA framework and dev/build tooling |
| **react-router-dom v7** | Client-side routing, lazy-loaded route components |
| **Chart.js v4** | Dashboard / Analytics / Trends charts |
| **Leaflet 1.9 + leaflet.markercluster + leaflet.heat** | Crime Mapping page (clustering, heatmap) |
| **lucide-react** | Icon system (`src/components/icons.jsx`) |
| **@supabase/supabase-js v2** | Browser-side client that talks to Supabase Auth directly |
| **Laravel 12 / PHP ^8.2** | Backend — stateless REST API |
| **firebase/php-jwt ^7.1** | Verifies Supabase-issued JWTs server-side (JWKS + HS256 fallback) |
| **PostgreSQL (via Eloquent)** | Persistent storage — Supabase-hosted in production, local Postgres possible in dev |
| **Supabase Auth** | Sole identity provider (email/password, Google OAuth, optional MFA) — no Laravel session cookies, no Sanctum |
| **PHPUnit ^11** (`php artisan test`) | Backend feature tests, run against in-memory SQLite |
| **oxlint** (frontend) / **Laravel Pint** (backend) | Linting |
| **Docker** (`Dockerfile.frontend`, `backend/Dockerfile`, `docker-compose.yml`) | nginx-served static frontend build + php-fpm backend |
| **Turborepo** (`turbo.json`) | Runs each workspace's own dev/build/lint/test scripts |
| Frontend automated tests | **UNKNOWN/none found** — no JS test runner or test files exist anywhere in `src/` or `package.json devDependencies` |
| CI/CD (GitHub Actions) | **Described in docs, but not present in this ZIP** — see Section 13 |

---

## 3. Complete System Architecture

```
BADAC Staff (Administrator / Encoder / BADAC)
        |
        v  HTTPS
React + Vite SPA (src/)
        |
        |-- supabase-js sign-in / session --> Supabase Auth (email/password, Google OAuth, MFA)
        |
        |-- REST calls, Authorization: Bearer <token> --> Laravel 12 REST API (backend/)
                                                                |
                                                    'supabase' auth guard
                                                    (SupabaseTokenValidator)
                                                                |
                                        verifies JWT via JWKS (or HS256 fallback) against Supabase
                                        maps verified claims -> local `users` row
                                                                |
                                                          Eloquent ORM
                                                                |
                                                  PostgreSQL (Supabase-hosted or local)

Laravel backend also calls the Supabase **Admin API** (service-role key,
backend-only) — but only for one action: force-removing another user's
MFA factor.
```

**Key architectural fact (CONFIRMED):** the frontend never talks to PostgreSQL directly, and the Laravel backend never issues its own session cookie or checks a password — **Supabase Auth is the sole identity provider**; Laravel's only job on the auth side is verifying the JWT Supabase already issued.

**Figure source files:** `src/lib/supabaseClient.js`, `src/services/api.js`, `backend/app/Providers/AppServiceProvider.php`, `backend/app/Services/SupabaseTokenValidator.php`, `backend/app/Services/SupabaseAdminService.php`, `backend/routes/api.php`.

---

## 4. Frontend

**Framework:** React 19 + Vite 8, no CSS framework (two hand-written CSS files).

**Project layout (CONFIRMED):**

```
src/
├── pages/            One component per route
├── components/        landing/, layout/, ui/, charts/, incidents/, legal/, settings/, support/
├── context/            AuthContext, DataContext, ThemeContext, ToastContext
├── hooks/              useAuth, useData, useTheme, useToast, useDebounce, useSupabaseSession
├── services/           One file per REST resource (incidentService.js, criminalService.js, ...)
├── routes/             AppRoutes.jsx, ProtectedRoute.jsx
├── layouts/            MainLayout.jsx (sidebar + header shell)
├── lib/supabaseClient.js   Configured Supabase JS client
├── utils/               constants.js, helpers.js, chartInsights.js, mockData.js
└── styles/               global.css, landing.css
```

**Pages (CONFIRMED — one component per route):** `Landing.jsx`, `Login.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `Dashboard.jsx`, `IncidentFeed.jsx`, `Mapping.jsx`, `Analytics.jsx`, `Trends.jsx`, `Records.jsx` (chooser page), `CriminalRecords.jsx`, `CriminalProfile.jsx`, `VictimRecords.jsx`, `VictimProfile.jsx`, `AuditLogs.jsx`, `UserManagement.jsx`, `Settings.jsx`, `NotFound.jsx`.

**Key UI primitives (`src/components/ui/`):** `Card`, `Button`, `Modal`, `Table`, `Badge`, `FilterBar`, `KpiCard`, `PrintReport`.

**Charts (`src/components/charts/`):** `ChartCard`, `ChartSummaryModal`, `ChartPrintSummary`.

**Layout (`src/components/layout/`):** `Sidebar.jsx`, `Header.jsx`, `ProfileSettingsModal.jsx`.

**Navigation / RBAC on the frontend:** `Sidebar.jsx` renders items from `NAV_ITEMS` in `src/utils/constants.js`, filtered by `ROLES[role].modules`. `ProtectedRoute.jsx` enforces the same list at the routing layer (`hasAccess(moduleId)`), and `AppRoutes.jsx` wraps every authenticated page in it. **This is explicitly a UX convenience only — the real enforcement is server-side** (Section 7).

**State management:**
- `AuthContext` — current user, `loginWithEmail`/`loginWithGoogle`/`logout`, `hasAccess(module)`, `can(permission)`.
- `DataContext` — fetches every resource (`incidents`, `criminals`, `victims`, `auditLogs`, `notifications`, `syncLogs`, `settings`) once on login via `Promise.allSettled` — **deliberately not `Promise.all`**, so a role-restricted 403 on one endpoint (e.g. `badac_readonly` hitting `GET /settings`) doesn't blank the entire dashboard. This was a fixed bug — see Section 12 (Checkpoint 18).
- `ThemeContext` — dark/light mode, persisted via `useTheme.js`.
- `ToastContext` — toast notifications.

**Styling:** `src/styles/global.css` (app shell + components) and `src/styles/landing.css` (public landing page only), no CSS framework. Color tokens centralized in `COLORS` inside `src/utils/constants.js`.

**Important utility files:** `src/utils/constants.js` (roles, permissions, nav items, sitio/street/crime-type lookup data — the frontend's RBAC source of truth, mirrored server-side), `src/utils/helpers.js`, `src/utils/chartInsights.js`.

---

## 5. Backend

**Framework:** Laravel 12, PHP ^8.2, stateless REST API (no session cookies).

**Controllers (`backend/app/Http/Controllers/Api/`) — CONFIRMED:**

| Controller | Responsibility |
|---|---|
| `AuthController` | Current-user lookup, logout audit entry |
| `DashboardController` | Aggregates KPIs for the Dashboard in one call |
| `IncidentController` | Full incident CRUD + map payload + archive; Encoder ownership check on `update()` |
| `CriminalController` | Criminal register CRUD + case linking (`criminal_incident` pivot) |
| `VictimController` | Victim register CRUD + case linking (`incident_victim` pivot) + archive |
| `AnalyticsController` | Aggregate stats for Analytics/Trends |
| `AuditLogController` | Read-only audit log listing (latest 200) |
| `NotificationController` | System-wide notification listing + mark-read |
| `SettingController` | Single-row system settings |
| `SyncLogController` | Read-only sync-status history for the Dashboard widget |
| `UserController` | Admin account management + force MFA-factor removal |
| `ProfileController` | Caller's own name/avatar only |

**Middleware (`backend/app/Http/Middleware/`):**
- `EnsureRole` (`role:role1,role2`) — the real RBAC enforcement; 403 if the user's role isn't listed.
- `EnsureSupabaseAal2` (alias `supabase.mfa`) — checks the token's Supabase `aal` claim equals `aal2`. **Exists but is not attached to any route in the current `routes/api.php`** (see Section 7).
- `LogAuditAction` — a named pass-through placeholder; controllers currently write `AuditLog::create()` rows directly instead of routing through this middleware.

**Services (`backend/app/Services/`):** `SupabaseTokenValidator` (JWT verification + user resolution), `SupabaseAdminService` (uses the Supabase service-role key, backend-only, solely for admin-forced MFA-factor removal).

**Form Requests (`backend/app/Http/Requests/`):** `Store`/`Update` validators for Incident, Criminal, Victim, User. Notable: `StoreIncidentRequest` requires unique `caseNumber`, `crimeType`, `date`, `sitio`, and validates lat/long ranges. `UpdateUserRequest` deliberately excludes `email` and `role` from what it accepts — documented in the file's own comments as preventing both data desync with Supabase-authoritative email and a privilege-escalation surface.

**Business logic worth knowing (CONFIRMED):**
- **Encoder ownership check** — `IncidentController::update()` returns 403 if an Encoder tries to update an incident they didn't personally create (`reported_by !== $user->id`). Administrators are unrestricted.
- **Archive, never delete** — no controller performs a physical `DELETE` on an incident or victim; both use `PUT .../archive`, which sets `status = 'Archived'`. Analytics and the map endpoint both already exclude archived incidents.
- **Criminal records have no archive endpoint at all** — asymmetry with incidents/victims (see Section 12, Known Problems).
- **Self-lockout guard** — `UserController::updateStatus()` refuses to let an admin deactivate their own account.
- **Never auto-registers a user** — `SupabaseTokenValidator` only ever links a verified Supabase identity to an *existing* `users` row; it never creates a new account.

---

## 6. Database

**Technology:** PostgreSQL via Eloquent — Supabase-hosted in production, local Postgres possible in dev.

### Business / application entities (CONFIRMED)

| Table | Purpose | Important fields | Relationships |
|---|---|---|---|
| `incidents` | Crime case records | `incident_code`, `case_number` (both unique), `crime_type`, `category`, `incident_date`, `sitio`, `latitude`/`longitude`, `status`, `priority`, `reported_by` | belongs to `users` (`reported_by`); many-to-many with `criminals` via `criminal_incident`; many-to-many with `victims` via `incident_victim` |
| `criminals` | Criminal register | `criminal_code` (unique), `full_name` (NOT unique — duplicate-name handling noted in the migration comment), `status`, `charges` (JSON), structured physical-description fields, `related_incident_id` (legacy single-case link) | many-to-many with `incidents` via `criminal_incident` (current model); legacy `belongsTo` on `related_incident_id` kept for backward compatibility |
| `victims` | Victim register | `victim_code` (unique), `full_name`, `status` | many-to-many with `incidents` via `incident_victim` |
| `criminal_incident` | Pivot: criminal ↔ case | — | unique on `(criminal_id, incident_id)` |
| `incident_victim` | Pivot: case ↔ victim | — | unique on `(incident_id, victim_id)` |
| `users` | Application accounts | `username`, `email` (both unique), `role`, `is_active`, `supabase_user_id` (unique, links to Supabase Auth identity), `google_id` (legacy), `avatar_path`, `password` (nullable, unused legacy) | has many `incidents` (as reporter); has many `audit_logs` |
| `audit_logs` | Change trail | `user_id`, `action`, `module`, `target_type`, `description`, `ip_address` | belongs to `users` (nullable — a deleted/unknown actor shows as "System") |
| `app_notifications` | System-wide alerts | `title`, `message`, `type`, `read` | none — **intentionally global, not per-user** (documented in the model's own comment) |
| `settings` | Single-row system config | `barangay`, `population`, `threshold`, `hotspot_threshold`, `categories` (JSON) | none — always row `id = 1`, accessed via `Setting::current()` |
| `sync_logs` | Sync-status history feeding the Dashboard widget | `status`, `records_received`, `source` | none |

### Orphaned table (exists in DB layer, no API/UI)

| Table | Purpose | Status |
|---|---|---|
| `residents` | A resident registry (first/last name, DOB, sitio, etc.) | Table, `Resident` model, `ResidentSeeder`, `ResidentFactory` all exist and are seeded by `DatabaseSeeder` — but **no `ResidentController`, no `/residents` route, no frontend page**. Comments in `constants.js`/`AppRoutes.jsx` describe this as a deliberate historical removal ("Checkpoint 28") where the database layer was never cleaned up afterward. |

### Framework/internal tables (not business data)

`password_reset_tokens`, `sessions`, `cache`, `cache_locks`, `jobs`, `failed_jobs`, `personal_access_tokens` (this last one **dropped** by the `2025_02_01_000001` migration during the Sanctum-removal cleanup — kept in migration history for reference only). None of these are read/written by this project's own controllers/services.

### Entity relationship diagram

```
USERS ||--o{ INCIDENTS : reports
USERS ||--o{ AUDIT_LOGS : performs
INCIDENTS }o--o{ CRIMINALS : "criminal_incident"
INCIDENTS }o--o{ VICTIMS : "incident_victim"
CRIMINALS ||--o| INCIDENTS : "related_incident_id (legacy)"
```

A criminal is **never** linked to a victim directly — only indirectly, through a shared case (an `incidents` row). This is a deliberate modeling decision, documented in the `2025_01_01_000017_create_victims_table.php` migration comment.

**Figure source:** `backend/database/migrations/2025_01_01_000010*.php` through `2025_01_01_000018*.php`, `backend/app/Models/*.php`.

### Database decisions worth preserving

- **users.password kept, nullable, unused** — retained rather than dropped so already-migrated rows aren't destructively altered; no route reads it (per the `2025_02_01_000001_final_auth_migration_drop_sanctum_tokens_and_nullify_password` migration's own comment).
- **Notifications are global, not per-user** — `app_notifications` has no `user_id` column; marking one read marks it read for every signed-in account. Documented as intentional in `AppNotification.php`.
- **Supabase configuration:** server-side env vars `SUPABASE_URL`, `SUPABASE_PROJECT_ID`, `SUPABASE_JWT_SECRET` (only for legacy HS256 Supabase projects), `SUPABASE_SERVICE_ROLE_KEY` (backend-only, never in frontend). Frontend-side (`VITE_*`, safe to expose): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## 7. Authentication and Security

*(Flagged by your instructions as extremely important — preserved in full detail.)*

### Authentication flow (CONFIRMED from source)

```
User submits email/password, or clicks "Continue with Google"
        |
        v
Supabase Auth
        |  success
        v
Supabase issues a JWT access token (RS256/ES256, or legacy HS256)
        |
        v
Frontend attaches it as `Authorization: Bearer <token>` on every API request
        |
        v
Laravel 'auth:supabase' guard (Auth::viaRequest)
        |
        v
SupabaseTokenValidator::resolveUser()
        |
        v
Signature valid (via JWKS, or HS256 fallback)? aud correct? iss matches?
   NO  -> 401, request never reaches the controller
   YES -> is supabase_user_id already linked to a local `users` row?
            YES -> resolved User attached to the request
            NO, but email verified & matches an existing account
                 -> link supabase_user_id to that account, then resolve
            NO match at all -> 401
        |
        v
`role:` middleware — is this user's role allowed for this route?
   NO  -> 403 Forbidden
   YES -> controller runs
```

**Figure source:** `backend/app/Services/SupabaseTokenValidator.php`, `backend/app/Providers/AppServiceProvider.php`, `backend/app/Http/Middleware/EnsureRole.php`, `backend/routes/api.php`.

### Key security facts (CONFIRMED)

- **Supabase Auth is the only authentication system.** No Laravel session cookie, no Sanctum token, no password ever checked by this backend.
- **No self-registration.** Every account is admin-provisioned in the local `users` table (`database/seeders/UserSeeder.php`) *and* must separately exist in Supabase Auth with a matching email before sign-in works. `SupabaseTokenValidator` never creates a new `User` row.
- **JWT verification** prefers Supabase's JWKS endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached for `jwks_cache_ttl` seconds), falling back to an HS256 shared secret (`SUPABASE_JWT_SECRET`) only if configured (for legacy Supabase projects). Every token is additionally checked for `aud == 'authenticated'` and a matching `iss`.
- **MFA / AAL2 is implemented but NOT currently enforced anywhere** (see Section 12's discrepancy note — this was an earlier deliberate, documented removal, tracked historically as "Checkpoint 37"). Supabase MFA enrollment/self-service still exists on the frontend (`TwoFactorSelfService.jsx`), and the backend can still read a token's `aal` claim and gate a route on it (`EnsureSupabaseAal2`) — but **no route in the current `routes/api.php` uses that middleware**, and `AuthContext.jsx`'s login flow no longer prompts for a second factor.
- **RBAC (role-based access control)** is enforced server-side by `EnsureRole` on the route, independent of what the frontend sidebar shows/hides.
- **CORS** (`backend/config/cors.php`) is driven entirely by `FRONTEND_URL` / `CORS_ALLOWED_ORIGINS` env vars, with `supports_credentials = false` — this API is Bearer-token-only, so the browser never sends cookies cross-origin and CSRF protection doesn't apply.
- **The Supabase service-role key** is used in exactly one place server-side — `SupabaseAdminService`, to let an Administrator strip another user's MFA factor(s) via `POST /users/{id}/two-factor/disable` (the "lost my phone" break-glass action). Never sent to the frontend, logged, or returned in any API response.

### Key files

`SupabaseTokenValidator.php`, `SupabaseAdminService.php`, `EnsureRole.php`, `EnsureSupabaseAal2.php`, `LogAuditAction.php`, `AppServiceProvider.php` (registers the `'supabase'` guard via `Auth::viaRequest()`), `config/auth.php`, `config/supabase.php`, `config/cors.php`.

### Security tests

`backend/tests/Feature/SupabaseTokenValidationTest.php` (replaced an earlier, larger `SupabaseMfaTest.php` at Checkpoint 38 once MFA enforcement was removed — see Section 15). Most feature tests authenticate through a genuinely signed, HS256-shared-secret test JWT (an `actingAsSupabase()` helper repeated across several test files) rather than Laravel's `actingAs()`, specifically so the real `SupabaseTokenValidator` code path is exercised, not bypassed.

### Security decisions and why (preserved from source-code comments / prior session notes)

- **Chose Supabase Auth over rolling/keeping a Laravel-only auth system** — offloads password storage/reset/MFA to a managed identity provider.
- **`UpdateUserRequest` excludes `email` and `role`** — prevents an admin edit from desyncing `users.email` from the Supabase-authoritative email, and prevents it becoming a privilege-escalation surface.
- **MFA (`aal2`) enforcement was deliberately removed** (not a bug) at what prior sessions tracked as "Checkpoint 37" — the middleware class was left in the codebase, unwired, rather than deleted, in case MFA is reintroduced later.
- **`users.password` retained (nullable, unused)** rather than dropped in the final auth-migration cleanup, specifically so already-migrated rows aren't destructively altered.


---

## 8. Current Features

### Implemented (CONFIRMED — working route + controller + frontend page where relevant)

| Feature | What it does | Who uses it |
|---|---|---|
| Landing page | Public marketing/info page; redirects a signed-in visitor to their dashboard | Everyone |
| Sign in (Supabase Auth) | Email/password + "Continue with Google" via Supabase's OAuth provider | All roles |
| Forgot / reset password | Handled entirely by Supabase Auth's own flow | All roles |
| Crime Data Collection (Incident Feed) | Create/view/edit/filter/search/archive incident reports | Admin (full), Encoder (own reports only) |
| Crime Reporting Dashboard | KPI cards, crime-type/sitio breakdown, hotspot count, recent incidents, sync status | Admin, BADAC |
| Crime Mapping | Leaflet map, clustering, heatmap | Admin, Encoder, BADAC |
| Statistical Analysis | Totals by category/status/sitio, crime-type breakdown | Admin, BADAC |
| Trend and Pattern Detection | Monthly incident counts | Admin, BADAC |
| Criminal Records | Register: create/edit (admin only), search by name/alias/ID/case number, link to one or more cases | Admin (full), BADAC (view) |
| Victim Records | Register: create/edit/archive (admin only), search, link to cases | Admin (full), BADAC (view) |
| Audit Logs | Read-only trail of CREATE/UPDATE/ARCHIVE actions | **Administrator only** |
| User Management | Admin: list/edit accounts, activate/deactivate, force-remove a lost MFA factor. Non-admin: self-service MFA panel only | Admin (full); Encoder/BADAC (self-service MFA only) |
| System Settings | Barangay name/population, incident threshold, hotspot threshold, category list — no sidebar entry, reached by URL | Administrator only |
| Notifications | System-wide (not per-user) alerts via the topbar bell | All roles |
| Profile settings | Edit own display name, upload own avatar | All roles |
| Self-service MFA | Enroll/unenroll a Supabase TOTP factor for your own account (enforcement is currently off — see Section 7) | All roles |

### Partially implemented

- **MFA / 2FA** — the mechanism (Supabase TOTP, `EnsureSupabaseAal2`, self-service UI) is fully built, but not wired to enforce on any route (see Section 7).
- **Criminal archive** — the `criminals.status` column supports an `Archived` value, but there is no archive endpoint or frontend call to set it (see Section 12).

### Planned / historically pending (per `TODO.md`, not yet done as of the last verified state)

- Verifying `docker-compose.yml` actually builds/runs end-to-end (needs an environment with Docker).
- Verifying the GitHub Actions workflows actually pass (moot until `.github/workflows/*.yml` is confirmed to exist in the real GitHub repo — see Section 12).
- `deploy.yml` — described in earlier docs as an inert placeholder needing a real deploy target.

### Removed / rejected

- **MFA enforcement on API routes** — removed intentionally (tracked historically as "Checkpoint 37"); not a bug.
- **Audit Logs access for the BADAC (`badac_readonly`) role** — removed intentionally (tracked historically as "Checkpoint 38"); this **reverses an earlier, different deliberate decision** where `badac_readonly` had full/unscoped audit-log visibility. Both decisions are documented in code comments; the most recent one (no access) is what's in the current `routes/api.php`.
- **Resident Registry module** — a full API/UI for it apparently once existed and was removed (tracked historically as "Checkpoint 28"); the database layer (table/model/seeder/factory) was left in place, unused, rather than also being removed.
- **Legacy Sanctum session auth, Laravel-native TOTP 2FA, Socialite Google OAuth** — all replaced by Supabase Auth over an incremental, checkpointed migration (see Section 15). Confirmed fully gone from the current code (no Sanctum guard, no Socialite, no local TOTP anywhere in the reviewed source).
- **`personal_access_tokens` table** — dropped in the final auth-migration cleanup migration.

---

## 9. Dashboard and Analytics

`GET /dashboard` (`DashboardController::index`) returns, in one call (CONFIRMED):

- `totalIncidents`, `openIncidents`, `underInvestigation`, `solvedIncidents` — counts over non-archived incidents.
- `totalCriminalRecords` — total row count on `criminals`.
- `hotspotCount` — number of sitios whose incident count meets/exceeds `settings.hotspot_threshold`.
- `byCrimeType`, `bySitio` — grouped counts for the Dashboard's breakdown charts.
- `recentIncidents` — 5 most recent non-archived incidents.
- `lastSync` — most recent completed row from `sync_logs`.
- `settings` — current system settings row (avoids a second request).

**Analytics page:** `GET /analytics` (overall totals by category/status/sitio) + `GET /analytics/crime-types` + `GET /analytics/locations` for breakdown charts.

**Trends page:** `GET /analytics/monthly`, which groups by `to_char(incident_date, 'YYYY-MM')` — a **PostgreSQL-specific function**. `backend/tests/TestCase.php` registers a SQLite-compatible shim of the same name purely so the (SQLite in-memory) test suite can exercise this query, without changing the production SQL.

**Filters:** Dashboard/Analytics/Trends/Mapping/AuditLogs pages all resolve to the same server-side query parameters on `IncidentController::index()`: `sitio`, `status`, `crimeType`, `category`, `date`, `dateFrom`, `dateTo`, `search`.

**Hotspot logic:** purely **count of incidents per sitio vs. a configurable threshold** (`Setting::hotspot_threshold`, editable on the Settings page) — no separate hotspot-detection algorithm or external data source.

**Key files:** `src/pages/Dashboard.jsx`, `src/pages/Analytics.jsx`, `src/pages/Trends.jsx`, `src/components/charts/*`, `backend/app/Http/Controllers/Api/DashboardController.php`, `AnalyticsController.php`.


---

## 10. Important UI/UX Decisions

### Confirmed decisions (implemented in current code)

- **Single-date filter, not FROM/TO range** — applied uniformly across Analytics, Trends, IncidentFeed, Mapping, AuditLogs, via a shared `filterRecords()` helper and the backend `IncidentController`.
- **Dashboard bottom sections use a horizontal 4-across layout**, not internal per-panel scrolling — an earlier `max-height`/`overflow-y:auto` causing an internal scrollbar was removed.
- **KPI-card tooltips are a dedicated info-icon tooltip**, not the native `title` attribute — the native attribute plus a custom CSS tooltip were firing simultaneously and overlapping, and `overflow: hidden` was separately clipping them; rebuilt as one mechanism.
- **Sidebar three-dot account menu** — `.user-info`'s `overflow: hidden` was clipping the dropdown; fixed.
- **Dark/light theme** managed via `ThemeContext`/`useTheme.js`, persisted; no CSS framework, two hand-written stylesheets, tokens centralized in `COLORS` (`constants.js`).
- **System Settings page has no sidebar entry** — reached only by direct URL, admin-only.
- **Landing page redirects an already-signed-in visitor** straight to their dashboard rather than showing the marketing page again.
- **DataContext loads all resources via `Promise.allSettled`, not `Promise.all`** — a UX decision as much as a technical one: a role-restricted 403 on one resource must not blank out every other dataset that role can legitimately see.

### Ideas discussed but not implemented / still open

- Full visual/browser re-verification of several fixes (login scrollbar, collapsed-sidebar spacing, profile image upload, KPI tooltip position, dashboard layout at various breakpoints) — these were verified by code review and a successful production build only, **not** by rendering the app in an actual browser, as of the last recorded session.
- Screenshots for a real user manual — none exist in the repo yet.

---

## 11. Testing

### Backend

- **Framework:** PHPUnit ^11, run via `php artisan test`, configured in `backend/phpunit.xml` to hit an **in-memory SQLite** database (never a real Postgres/Supabase DB).
- **Test files present (CONFIRMED from source):** `tests/Feature/BadacReadonlyTest.php`, `CriminalRecordTest.php`, `IncidentTest.php`, `NotificationTest.php`, `SupabaseTokenValidationTest.php`, `UserManagementTest.php`, `VictimTest.php`.
- Most tests authenticate through a genuinely signed HS256 test JWT (`actingAsSupabase()` helper) rather than Laravel's `actingAs()`, so the real `SupabaseTokenValidator` path is actually exercised.
- **Whether these tests currently pass is UNKNOWN / NOT VERIFIED** — no PHP runtime was available in the environment where the most recent (README-rewrite) session ran, so the suite was read, not executed. Earlier sessions logged the same limitation repeatedly (see Checkpoint history, Section 15) — `repo.packagist.org` was reported unreachable (HTTP 403) from those sandboxes, blocking `composer install`.
- **One session (per prior chat memory, not from this export) reported it *did* have a working local PHP/Composer/Postgres setup** on the user's own Windows machine and successfully ran `php artisan test`, surfacing two real bugs at that time: a malformed placeholder `APP_KEY` in `phpunit.xml`, and a `SupabaseTokenValidator` bug where a JWKS-endpoint network failure wasn't caught, so it never fell through to the HS256 shared-secret path. **Whether these two bugs are still present has not been re-verified against the current code** — flagged as open in Section 12.

### Frontend

- **No JavaScript test runner or test files exist** anywhere in `src/` or in `package.json`'s `devDependencies`. This project currently has **no automated frontend tests**.
- The only automated frontend checks are `npm run lint` (oxlint) and `npm run build` (production Vite build) — both of which **have** been actually run and passed in prior sessions (most recently: 1930/1932-module clean builds reported across different sessions).

### Test-environment limitations, explicitly separated

| Limitation | Applied to |
|---|---|
| No PHP runtime, so `php artisan test` could not run | Multiple prior Claude sandbox sessions, and the most recent README-rewrite session |
| `repo.packagist.org` unreachable (HTTP 403), blocking `composer install` | Prior Claude sandbox sessions specifically (confirmed blocked across several checkpoints) |
| A working PHP/Composer/Postgres setup existed and tests were actually run | The user's own local Windows machine, in at least one session (per prior chat memory — not directly re-confirmed in this export) |
| No PHP available at all, in some sessions | Various prior sandbox checkpoints (15, 16, 36) |

**Do not assume the backend test suite currently passes** — the most recent verified state is "read, not executed."


---

## 12. Known Problems and Bugs

| # | Problem | Cause | Affected area | Status |
|---|---|---|---|---|
| 1 | Criminal records have no archive endpoint | Asymmetric implementation — Incidents and Victims both got `PUT .../archive`, Criminals never did, even though `criminals.status` supports an `Archived` value | `CriminalController.php`, `criminalService.js` | **Open / needs attention** — not fixed as of the last verified state |
| 2 | Resident Registry is orphaned | A `residents` table/model/seeder/factory exist and are seeded, but the controller/route/frontend page were removed at some point ("Checkpoint 28") without removing the DB layer | `backend/app/Models/Resident.php`, migrations, `DatabaseSeeder` | **Open** — dead weight, not a functional bug, but a documentation/cleanup gap |
| 3 | `.github/workflows/` directory does not exist | Two docs (`docs/CI_CD_AND_SECURITY.md`, `TODO.md`) describe GitHub Actions workflows (`ci.yml`, `security.yml`, `deploy.yml`) in detail, and `TODO.md` claims they were created — but no `.github/` directory is present in the uploaded ZIP | CI/CD, Section 13 | **Unresolved discrepancy** — either the files exist only in the real GitHub repo and weren't included in this ZIP export, or the docs are aspirational/stale. **Do not assume CI is running** until confirmed directly in GitHub. |
| 4 | Several referenced handoff/checkpoint docs are missing from the ZIP | `AUTH_MIGRATION_STATUS.md`, multiple `HANDOFF_CHECKPOINT_*.md` files, `CHECKPOINT_STATUS.md`, `FINAL_REQUIREMENT_AUDIT.md` are all cited by source-code comments and `TODO.md`/`PROGRESS.md` as the authoritative history of the Supabase-auth migration, but none were included in the uploaded ZIP | Historical record only | Any claim sourced *only* from one of these missing files should be treated as unverified |
| 5 | Old `backend/README.md`'s endpoint table over-documents MFA | It marked almost every route "auth, MFA" and documented a `/residents` API that doesn't exist | Documentation only | **Fixed** — corrected in the new README (Section 9's own equivalent) |
| 6 | `SupabaseTokenValidator` JWKS-fallback bug (per prior chat memory, not re-confirmed in this export) | A JWKS-endpoint network failure isn't caught, so it never falls through to the HS256 shared-secret verification path | `SupabaseTokenValidator.php` | **UNKNOWN / needs re-verification** against current code — was found during one prior session's real local test run, not confirmed fixed |
| 7 | Malformed placeholder `APP_KEY` in `phpunit.xml` (per prior chat memory) | Same session as #6 | `backend/phpunit.xml` | **UNKNOWN / needs re-verification** |
| 8 | `Icons.FileText` / `Icons.ClipboardList` undefined-key crashes | Icons referenced in `Table.jsx`, `Dashboard.jsx`, `Analytics.jsx`, `IncidentModal.jsx` weren't present in the exported `Icons` registry object (only in `NAV_ICONS`, or not at all) | Frontend icon registry (`src/components/icons.jsx`) | **Fixed multiple times historically** (Checkpoints ~17 and earlier) — flagged in prior memory as having *regressed* once already between checkpoints, so worth a fresh grep-check before assuming it's still fixed |
| 9 | Badac dashboard showing all-zero KPIs with a "Forbidden" banner | `DataContext`'s initial load used `Promise.all` across 8 endpoints; Badac's two *expected* 403s (`/settings`, `/sync-logs`) failed the entire batch | `src/context/DataContext.jsx` | **Fixed** — switched to `Promise.allSettled` (documented in the current code's own comment; this is "Checkpoint 18") |
| 10 | "Backup Reminder" notification served unfiltered to all roles | Still seeded server-side, served unfiltered by `NotificationController::index()` | Notifications | **Fixed** (per prior chat memory — excluded in the query, removed from seeder and a dead frontend mock) |
| 11 | Composer/Packagist unreachable in Claude sandbox environments | Network egress restriction | Backend dependency install, blocking most backend runtime verification across many historical checkpoints | Recurring environment limitation, not a code bug — see Section 13 |
| 12 | Project ZIP packaging historically dropped empty Laravel skeleton dirs | Zip archiving doesn't preserve empty directories | `backend/public/` (inc. `index.php`, the actual HTTP entry point), `storage/framework/*`, `storage/logs`, `bootstrap/cache` | Packaging gap noted in prior sessions (per prior chat memory) — **UNKNOWN** whether the most recently uploaded ZIP (`Crime_Data_Analytics.zip`) has the same gap, since this wasn't specifically re-checked in the README-rewrite session |

---

## 13. Environment Limitations

| Limitation | Applies to |
|---|---|
| No PHP/Composer runtime available, so backend code can only be reviewed, not executed | Claude sandbox environments across most historical sessions, and the most recent README-rewrite session |
| `repo.packagist.org` reported unreachable (HTTP 403) | Claude sandbox environments, specifically noted at Checkpoints 15 and 16 |
| A working local PHP/Composer/PostgreSQL setup, able to actually run `php artisan test` | The developer's own local Windows machine, per prior chat memory (not re-confirmed in this export) |
| No Docker available to verify `docker-compose.yml` builds/runs | Claude sandbox environments |
| `.github/` workflow files described in docs but absent from the uploaded ZIP | Unknown whether this is a ZIP-export omission or the workflows were never actually created in GitHub — **not verified either way** |
| One later session (per prior chat memory) reported the sandbox unexpectedly *did* have network access, enabling `esbuild` and PHP 8.3 CLI installs via `apt` for syntax verification (`php -l`), contradicting earlier sessions' assumption of no network | A specific later Claude sandbox session — **do not assume this is the current/default state**; check freshly each session rather than assuming persistence |

Do not assume any specific environment limitation still holds for a *new* session — check freshly, since these have changed between sessions in the project's own history.


---

## 14. GitHub / Git Workflow

- **Repository:** `github.com/David-L0830/crime-data-analytics` (seen as the URL pasted alongside the most recent upload).
- **Branching model (recommended in the current README, no `CONTRIBUTING.md` found to document an existing one instead):**

```bash
git pull origin main
git checkout -b feature/short-description

# ... make changes ...

# Frontend
npm run lint
npm run build

# Backend
cd backend
./vendor/bin/pint --test
php artisan test
cd ..

git add .
git commit -m "Describe what changed and why"
git push origin feature/short-description
```

Then open a pull request against `main`, get it reviewed, and merge.

- **GitHub Actions / CI:** Described in `docs/CI_CD_AND_SECURITY.md` as a workflow (`ci.yml`) that lints/builds the frontend, runs the Laravel test suite, and validates Docker images on push/PR to `main`, plus a `security.yml` Snyk scan — **but no `.github/` directory exists in the uploaded ZIP**, so this could not be verified against actual repository contents (see Section 12, problem #3).
- **"Checkpoint" is the project's working unit of change**, not a formal Git concept — each checkpoint historically corresponds to one Claude session's scoped task, often delivered as a ZIP the user re-uploads to continue in the next session (rather than the assistant having direct, persistent Git access). Several sessions explicitly note the ZIP handed off between checkpoints was **partial** (missing `backend/app/`, or missing empty skeleton directories) — worth confirming a fresh ZIP/repo state at the start of a new working session rather than assuming continuity.

---

## 15. Project Checkpoints / History

*(Reconstructed from `TODO.md`/`PROGRESS.md` captured inside the project ZIP, cross-checked against prior chat memory of this same project. Numbering and descriptions are preserved as found — some checkpoints are referenced only by number in code comments without a full description being available in this export, and are marked accordingly.)*

**Early phase (per prior chat memory, not directly present in this export):**
- **Phase 3** — completed: Hotspots "Mark All as Read", encoder delete with ownership authorization, notification/read-state behavior, sidebar collapse fix, realistic fictional crime-data names.
- **Phase 4** — a 6-feature plan: #1 Admin User Management, #2 Password Reset, #3 Google OAuth, #4 TOTP 2FA, #5 Login Dark Mode, #6 Integration/security testing. Features #1–#3 were implemented; the project's own audit later found TOTP 2FA and Google OAuth already existed and were tested by the time of a stack-alignment pass (see below), so the plan effectively converged early on those two items.

**Stack-alignment / Supabase migration checkpoints (from `TODO.md`, most detailed available record):**

- **Pre-migration audit (Checkpoint 1)** — Documented the existing Sanctum/TOTP/Socialite architecture; no code changed.
- **Checkpoint 2 — Supabase client (frontend, additive only).** Added `@supabase/supabase-js`, `src/lib/supabaseClient.js`, `src/hooks/useSupabaseSession.js`. Did not touch `AuthContext.jsx`, `authService.js`, `Login.jsx`, `ProtectedRoute.jsx`, or any Laravel auth code. **IMPLEMENTED, NOT VERIFIED** at the time (no network/PHP in that sandbox).
- **Checkpoint 3 — Laravel Supabase JWT validation (additive only).** Added `firebase/php-jwt` dependency, `config/supabase.php`, the `supabase_user_id` migration, `SupabaseTokenValidator`, the `'supabase'` guard registration. Did not touch `routes/api.php` yet (deferred to Checkpoint 4) — deliberately, so the app was never left pointing routes at an auth path with no working login. **IMPLEMENTED, NOT VERIFIED.**
- **Checkpoint 4 — Migrate email/password login to Supabase.** `GET /user` moved to `auth:supabase,sanctum`; every other route stayed `auth:sanctum` only. Added `loginWithEmail()` to `AuthContext`, an additive "Sign in with email instead" option on `Login.jsx`. **IMPLEMENTED, NOT VERIFIED.**
- **Checkpoint 5 — Google OAuth via Supabase.** Added `loginWithGoogle()` and an `onAuthStateChange` listener; resolves through the same Checkpoint 3/4 guard — no backend changes needed. Legacy Google (Socialite) left fully intact alongside it. **IMPLEMENTED, NOT VERIFIED.**
- **Checkpoint 6 — TOTP/MFA migration/coexistence.** Additive Supabase MFA (TOTP) built alongside the existing Laravel/Sanctum TOTP system, fully independent; self-service enrollment UI explicitly **not** built yet at this point (deferred). **IMPLEMENTED, NOT VERIFIED.**
- **Checkpoint 7 — Attempt to remove legacy Sanctum/Socialite.** **BLOCKED.** A full dependency audit found Sanctum still the sole guard on ~24 of 26 protected routes, and Laravel TOTP/Socialite still the default path for most users. Multiple explicit stop conditions triggered; nothing legacy was actually removed at this checkpoint.
- **Checkpoint 7A — Incremental migration, Group A.** Migrated the 4 read-only admin-only `/analytics*` routes onto `auth:supabase,sanctum` + `supabase.mfa` (same pattern already used for `GET /dashboard`, referenced as an earlier "6B"). Verified these had zero live frontend callers at the time, so zero live behavior changed. ~15 routes remained PENDING across Groups B–E; 9 routes were marked INTENTIONALLY LEGACY pending later policy work. **IMPLEMENTED, NOT VERIFIED.**
- *(Groups B–G referenced in prior chat memory as continuing incrementally — e.g. "Group G: migrated POST /logout to auth:supabase,sanctum, no aal2" — through to a full cutover; the exact group-by-group breakdown beyond A is not present in this export's captured files.)*
- **Checkpoint 12 → 13 (per prior chat memory)** — continued the incremental migration; only the 2FA self-service routes remained intentionally legacy/unmigrated by this point.
- **Checkpoint 14 — Audit of the `badac_readonly` role/Header/Dashboard/sidebar changeset.** Statically verified; found the changeset genuinely implemented and backend-enforced. One inaccurate code comment found (referenced a non-existent `backend/app/Policies` dir — enforcement actually lives in the `role:` route middleware). No code changed.
- **Checkpoint 15 — Runtime verification pass (PARTIAL).** `npm install`/`npm run build`/`npm run lint` **actually runtime-verified** (clean build; lint's 86 errors confirmed all pre-existing `node_modules` noise, 0 in project `src`). Headless Chromium confirmed the production build boots and renders the login screen. Backend `composer install` still failed (Packagist unreachable). Backend PHP files re-confirmed syntactically valid (`php -l`, 0 errors); `BadacReadonlyTest.php` re-confirmed at 25 tests.
- **Checkpoint 16 — Backend dependency retry.** **STILL BLOCKED** — re-installed PHP 8.3.6/Composer 2.7.1 with required extensions; `composer install` still failed with the same `repo.packagist.org` HTTP 403. No fallback (cache, mirror, existing `vendor/`, provided artifact) existed; did not hand-resolve the dependency tree without a resolver/lockfile. No code changed.
- **Checkpoint 17 — Icons registry bugfix.** **RUNTIME VERIFIED.** Fixed a live console crash from `Icons.ClipboardList` missing from the exported `Icons` object (only in `NAV_ICONS`), plus a related `Icons.FileText` (undefined) vs. the correct `Icons.Report` used elsewhere. Verified via real `npm install` + `vite build` + compiled-bundle grep.
- **Checkpoint 18 — Badac dashboard all-zeros, corrected fix.** **RUNTIME VERIFIED build.** Real root cause identified as `DataContext.jsx`'s `Promise.all` across 8 endpoints failing the entire batch on Badac's two expected 403s; fixed by switching to `Promise.allSettled`. An earlier same-session attempt had wrongly tried loosening `GET /settings` to `badac_readonly` — reverted, since Badac having no Settings access is intentional.
- *(Checkpoint 20, referenced in `backend/README.md`'s API table as the point the incident/resident/victim archive-not-delete pattern was introduced, replacing prior `DELETE` endpoints — no fuller description captured in this export.)*
- **Checkpoint 28 (referenced only) — Resident Registry module removed from the API/frontend**, per comments in `NAV_ITEMS`/`AppRoutes.jsx`, with the database layer left behind unused. No fuller session record captured in this export.
- **Checkpoint 29 — "Final Requirement Audit."** Ran a full master checklist (A–Q, ~150 items) against the repo; real `npm install`/`npm run build`/`npx oxlint` executed (1932 modules, succeeded); PHP still unavailable, so backend stayed IMPLEMENTED/NOT VERIFIED. Found and fixed one real bug ("Backup Reminder" notification served unfiltered) plus a dead-import lint warning. Delivered `FINAL_REQUIREMENT_AUDIT.md`. Overall status: **NOT FINISHED**, solely because PHP/Laravel runtime verification remained impossible in that environment. One design limitation noted (not a bug): `badac_readonly` had intentionally full/unscoped audit-log visibility at that time, with no ownership column to scope it further.
- **Checkpoint 36 — Test-file fixes, static-only.** PHP 8.3 CLI became available for the first time in that sandbox, but `php artisan test` still couldn't run — Packagist/getcomposer.org still blocked, no `vendor/` in that checkpoint's zip. Fixes were verified with `php -l` only, not executed.
- **Checkpoint 37 — MFA/2FA login enforcement removed entirely.** Frontend MFA screens/branching removed from `Login.jsx`/`AuthContext.jsx`; the `supabase.mfa`/`EnsureSupabaseAal2` middleware removed from all route groups in `routes/api.php`. This matches an 18-section UI/auth fix spec from that session. `EnsureSupabaseAal2` the class was deliberately left in the codebase, just unwired, in case MFA is reintroduced later. **This is the checkpoint referenced by the current code's own comments as the reason MFA isn't enforced today (Section 7).**
- **Checkpoint 38 — Audit Logs restricted for BADAC (`badac_readonly`).** Removed from `ROLES.badac_readonly.modules` and from the `GET /audit-logs` role middleware — reversing the earlier Checkpoint-29-era design where that role had full audit-log visibility. Also retired `SupabaseMfaTest.php` (replaced with the smaller `SupabaseTokenValidationTest.php`), and fixed the sidebar three-dot menu clipping bug. **This checkpoint's outcome is directly visible in the current source code** (the AuditLogController route is `badac_admin` only).
- **Checkpoint 39 (same session as 38, continued) — Filter/tooltip UI fixes.** Avatar cache-busting; Dashboard's From/To filter replaced with a single Date filter; KPI-card tooltip clipping bug fixed (two separate root causes: `overflow: hidden` and a colliding `::after` pseudo-element with the card's accent bar); dashboard lower-panel table max-height adjusted. That session also discovered unexpected network access in the sandbox (contradicting all earlier sessions' assumption of none) and used it to verify JS/JSX syntax via `esbuild` and PHP syntax via a freshly-`apt`-installed PHP 8.3 CLI — the **first real syntax verification any checkpoint had been able to run**, though still not a full `php artisan test` execution.
- **Most recent captured session (README rewrite, this export's actual content) — no checkpoint number assigned.** Given a fresh, complete `Crime_Data_Analytics.zip` upload; performed a from-scratch, full-repository read (not incremental) and produced a comprehensive rewritten `README.md`, explicitly correcting several places where prior documentation (old `README.md`, `backend/README.md`, `docs/CI_CD_AND_SECURITY.md`) no longer matched the actual code (see Section 16 and the discrepancy list this document is largely built from). Did not modify any application code — README only, by design (the task's own "Code Safety Rule").

**Gaps in this history, stated plainly:** Checkpoints 8–11, 19, 21–27, 30–35 are referenced only indirectly (by number, in later checkpoints' text, or in code comments like "Checkpoint 20") without a full description surviving in either this export or prior chat memory. Treat any claim about their specific content as **UNKNOWN** rather than inferring it.


---

## 16. Important Previous Decisions

**Decision: Use Supabase Auth as the sole identity provider, replacing Laravel Sanctum + local TOTP + Socialite Google OAuth.**
- **Reason:** Offload password storage, MFA, and OAuth handling to a managed identity provider rather than the app owning them; done incrementally (Checkpoints 1–7A and beyond) specifically so the live app was never left in a broken intermediate state.
- **Affected files:** `SupabaseTokenValidator.php`, `AppServiceProvider.php`, `config/auth.php`, `config/supabase.php`, `AuthContext.jsx`, `supabaseClient.js`, `routes/api.php` (guard on every route), migrations dropping `personal_access_tokens` and nullifying `users.password`.
- **Current status:** CONFIRMED complete in the current source — no Sanctum guard, no Socialite, no local TOTP found anywhere in the reviewed code. This is the single largest architectural decision in the project's history.

**Decision: Do not auto-create user accounts from Supabase identities.**
- **Reason:** This app has no self-registration; every account must be pre-provisioned in the local `users` table.
- **Affected files:** `SupabaseTokenValidator.php`.
- **Current status:** CONFIRMED — explicit in the resolver logic and its own comments.

**Decision: Never physically DELETE an incident or victim record — archive (soft-delete via `status`) instead.**
- **Reason:** Preserve history/accountability; introduced at what prior sessions tracked as "Checkpoint 20," replacing earlier `DELETE` endpoints.
- **Affected files:** `IncidentController::archive()`, `VictimController::archive()`, `AnalyticsController::baseQuery()` and `IncidentController::map()` (both exclude archived rows).
- **Current status:** CONFIRMED, consistently applied — except Criminal records, which have no archive endpoint at all (Section 12, problem #1).

**Decision: MFA (`aal2`) enforcement removed from all API routes.**
- **Reason:** Documented as an intentional decision at "Checkpoint 37," not a bug — the middleware and self-service UI were kept, just unwired.
- **Affected files:** `routes/api.php` (removed `supabase.mfa` from every group), `AuthContext.jsx` (no longer prompts for a second factor).
- **Current status:** CONFIRMED still the case in the current code. **This directly contradicts what `backend/README.md`'s old endpoint table claims** ("auth, MFA" on almost every route) — the new README corrects this; treat the old table as stale.

**Decision: BADAC (`badac_readonly`) role does not have Audit Logs access.**
- **Reason:** "Checkpoint 38" — this reverses an earlier, different deliberate decision (from around "Checkpoint 29") where that role had full/unscoped audit-log visibility.
- **Affected files:** `constants.js` (`ROLES.badac_readonly.modules`), `routes/api.php` (`GET /audit-logs` middleware).
- **Current status:** CONFIRMED as the current behavior. Prior session notes flagged this reversal as worth a sanity check with the requirements owner — unclear whether that follow-up ever happened.

**Decision: `UpdateUserRequest` excludes `email` and `role` from what an admin can edit on another user.**
- **Reason:** Prevents desyncing `users.email` from the Supabase-authoritative email, and closes a privilege-escalation surface (an admin editing another user's role through this endpoint).
- **Affected files:** `app/Http/Requests/UpdateUserRequest.php`.
- **Current status:** CONFIRMED.

**Decision: `DataContext` fetches all resources via `Promise.allSettled`, not `Promise.all`.**
- **Reason:** A role-restricted 403 on one endpoint must not blank every other dataset that role can legitimately read (this was literally the root cause of the Checkpoint-18 all-zeros bug).
- **Affected files:** `src/context/DataContext.jsx`.
- **Current status:** CONFIRMED.

**Decision (Resident Registry): removed from API/UI, database layer left in place.**
- **Reason:** Not documented in any surviving file captured in this export — only the fact of the removal is confirmed (via `NAV_ITEMS`/`AppRoutes.jsx` comments referencing "Checkpoint 28"), not the reasoning.
- **Current status:** UNKNOWN why; CONFIRMED that it happened and that cleanup of the unused DB layer was never done.

---

## 17. Important Files

| File | Purpose | Why it matters |
|---|---|---|
| `backend/app/Services/SupabaseTokenValidator.php` | Verifies Supabase JWTs, resolves to a local `User` | The entire authentication system hinges on this one file |
| `backend/app/Services/SupabaseAdminService.php` | Uses the Supabase service-role key to force-remove a user's MFA factor | The only place the service-role key is used — security-critical |
| `backend/app/Http/Middleware/EnsureRole.php` | Server-side RBAC enforcement | The *real* authorization boundary — the frontend's role list is UX only |
| `backend/app/Http/Middleware/EnsureSupabaseAal2.php` | MFA step-up gate | Exists, works, but currently unused by any route (Checkpoint 37) |
| `backend/app/Http/Middleware/LogAuditAction.php` | Named pass-through placeholder | Controllers bypass it and write `AuditLog::create()` directly — not actually wired into the request pipeline as audit logging |
| `backend/routes/api.php` | Every API route + its guard/role middleware | The single source of truth for what's actually implemented and who can call it |
| `backend/app/Http/Controllers/Api/IncidentController.php` | Incident CRUD, map, archive, Encoder ownership check | Core business logic; largest controller |
| `backend/app/Http/Controllers/Api/DashboardController.php` | Aggregates all Dashboard KPIs in one call | Central to the Dashboard/Analytics feature set |
| `backend/app/Http/Requests/UpdateUserRequest.php` | Validates admin edits to another user | Documents *why* `email`/`role` are excluded — a security decision |
| `backend/database/migrations/` (chronological) | Full schema history | Source of truth for the ERD; also documents *why* (e.g. victim/criminal non-relationship, `users.password` retention) |
| `backend/database/seeders/UserSeeder.php` | Seeds the 3 demo accounts | Confirms usernames/roles; also documents that Supabase Auth accounts must separately exist with matching emails |
| `src/context/AuthContext.jsx` | Session state, login/logout, `hasAccess`/`can` | Frontend half of the auth system |
| `src/context/DataContext.jsx` | Fetches all resources on login via `Promise.allSettled` | Root of the Checkpoint-18 bug and its fix; central data-loading pattern |
| `src/utils/constants.js` | `ROLES`, `PERMISSIONS`, `NAV_ITEMS`, `COLORS`, sitio/crime-type lookups | The frontend's RBAC and design-token source of truth |
| `src/routes/AppRoutes.jsx`, `ProtectedRoute.jsx` | Client-side routing + route-level RBAC | UX-layer enforcement, mirrors the backend |
| `src/components/icons.jsx` | Icon registry (`Icons` object) | Repeated source of undefined-key crashes historically — check here first for icon-related bugs |
| `backend/tests/TestCase.php` | Test base class; registers a SQLite shim for Postgres's `to_char()` | Explains why Trends/Analytics tests can run at all against SQLite |
| `TODO.md`, `PROGRESS.md` (repo root) | Historical checkpoint/task log | Primary surviving source for project history — but references several *other* files that are missing from every export/upload seen so far |
| `docs/CI_CD_AND_SECURITY.md` | Describes intended CI/CD | **Cannot currently be verified** — no `.github/` directory found |


---

## 18. Capstone Documentation Context

**Already known (usable directly in formal capstone documentation):**
- System overview, purpose, intended users, main capabilities (Section 1).
- Full technology stack (Section 2).
- System architecture, with a verified diagram (Section 3).
- Complete database schema and ERD, with relationship rationale (Section 6).
- Full authentication/authorization flow, with a verified diagram (Section 7).
- Complete API endpoint list, each with its required role (Section from the README, mirrored across Sections 5/7 here).
- Dashboard/Analytics calculation logic (Section 9).
- User roles and their exact restrictions (embedded in Sections 1, 7, 9).

**Still needs to be documented / gathered:**
- Screenshots of every workflow (none exist yet — needed for a real user manual, see the README's Section 22 equivalent).
- Actual, executed backend test results (`php artisan test` output) — currently only "read, not executed."
- Confirmation of whether GitHub Actions CI actually exists and runs, directly in the GitHub repo (not just in local docs).
- Formal requirements/objectives document, if one exists outside the code (the objectives in Section 1 here were reverse-engineered from the implementation, not sourced from an external requirements doc).
- Deployment architecture for a real production environment — **not verified from the repository**; only local/Docker-Compose setup is documented.

---

## 19. Documentation Figures

| Figure | What it should show | Source material to use |
|---|---|---|
| Figure 1 — System Architecture | Frontend/backend/Supabase/DB relationship | Section 3 diagram here (already Mermaid-ready); `src/lib/supabaseClient.js`, `src/services/api.js`, `AppServiceProvider.php`, `SupabaseTokenValidator.php`, `SupabaseAdminService.php`, `routes/api.php` |
| Figure 2 — Database ERD | Business-entity relationships only (exclude framework tables) | Section 6 diagram here; migrations `2025_01_01_000010*` through `*000018*`, `app/Models/*.php` |
| Figure 3 — Authentication & Authorization Flow | Full request path from login to controller execution, including the 401/403 branches | Section 7 diagram here; `SupabaseTokenValidator.php`, `AppServiceProvider.php`, `EnsureRole.php`, `routes/api.php` |
| Figure 4 — User Navigation Flow | Landing → Login → Dashboard → each module, gated by role | `src/routes/AppRoutes.jsx`, `Sidebar.jsx`, `NAV_ITEMS` in `constants.js` — **not yet drawn**, source material exists but no diagram has been produced |
| Figure 5 — Dashboard/Analytics Data Flow | How `GET /dashboard` aggregates KPIs, and how filters propagate across Dashboard/Analytics/Trends/Mapping/AuditLogs | `DashboardController.php`, `AnalyticsController.php`, `IncidentController::index()`'s shared filter params — **not yet drawn** |
| Figure 6 — Security Architecture | Middleware chain (`auth:supabase` → `role:` → controller), plus the currently-unused `EnsureSupabaseAal2` step shown as present-but-inactive | `routes/api.php`, `EnsureRole.php`, `EnsureSupabaseAal2.php` — **not yet drawn** |
| Deployment Architecture | Production deployment topology | **Not verified from the repository** — do not invent this; only local Docker Compose (frontend on 8080, backend php-fpm on 9000, Postgres *not* containerized) is confirmed |

Figures 1–3 already exist as Mermaid diagrams in the current `README.md` (see Section 3 and Section 6/7 of this document, which reproduce them). Figures 4–6 have their source material identified but have not actually been drawn yet in any file seen so far.

---

## 20. Current Project Status

### Current state (what's working, per the most recent full source-code review)

A functioning React + Laravel application with Supabase as the sole identity provider; incident recording/editing/archiving; criminal and victim registers cross-linked to cases; a Leaflet crime map; Dashboard KPIs and Analytics/Trends charts computed live (not pre-aggregated); an audit log; admin-only user management; role-based access enforced server-side for all three roles. Frontend build (`npm run build`) and lint (`npm run lint`) have been actually run and pass. Backend code has been read in full and is believed structurally sound, but its test suite has not been executed in the most recent session.

### Recently changed (most recent verified session)

A comprehensive `README.md` rewrite, grounded directly in the source code, replacing an older README/backend-README that had drifted out of sync with the actual implementation in several specific, now-documented ways (Section 16 of this document / Section 28 of the new README). **No application code was modified in this session** — by design, per that task's own scope rule.

### Known issues (see Section 12 for full detail)

- Criminal records can't be archived (asymmetric with Incidents/Victims).
- Resident Registry database layer is orphaned (unused).
- `.github/workflows/` cannot be confirmed to exist despite being documented.
- Backend test suite pass/fail status is currently unknown (not executed in the most recent session).
- Two specific bugs reported fixed in one prior session (JWKS-fallback error handling, malformed test `APP_KEY`) have not been re-verified against the current code.

### Next recommended work

1. Add a `PUT /criminals/{id}/archive` endpoint + frontend call, matching the existing Incident/Victim pattern (Section 12, problem #1) — or explicitly decide criminals should *not* be archivable and document why.
2. Either wire up a `ResidentController`/`/residents` route/page, or remove the orphaned `residents` table/model/seeder/factory — current state (schema exists, nothing uses it) is the worst of both options for a capstone defense.
3. Get an environment with real PHP/Composer/Postgres access and actually run `php artisan test`, to get a real pass/fail baseline rather than "read, not executed."
4. Confirm directly in GitHub whether `.github/workflows/*.yml` actually exist in the real repository (as opposed to this ZIP export) — this determines whether Section 13/18's CI claims are true or aspirational.
5. Draw Figures 4–6 (Section 19) for the formal capstone documentation.
6. Capture real screenshots for a user manual — none exist yet.

### Important constraints — what must NOT be changed without explicit sign-off

- **Do not re-enable MFA/`aal2` enforcement, or remove/rewrite `EnsureSupabaseAal2`, without confirming that's actually wanted** — its removal (Checkpoint 37) was deliberate and is relied upon by the current login flow having no second-factor prompt.
- **Do not modify `SupabaseTokenValidator`, `EnsureRole`, or the guard/role chains in `routes/api.php`** without a second reviewer — these are the entire security boundary of the application.
- **Do not physically `DELETE` an incident or victim row** — the archive-not-delete pattern is load-bearing for Analytics/Mapping, which already filter out `Archived` rows.
- **Do not let an admin edit their own `role` or another user's `email`/`role` through `UpdateUserRequest`** without re-examining the privilege-escalation rationale documented in that file.
- **Do not assume the BADAC (`badac_readonly`) audit-log-access decision is final** — it has already been reversed once (Checkpoint 29 → Checkpoint 38); confirm with the requirements owner before changing it again either way.
- **Do not commit real values for `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, database passwords, or `APP_KEY`** — only `.env.example` placeholders belong in version control.


---

# QUICK CONTEXT FOR A NEW CLAUDE

> You are continuing work on an existing capstone project. Before making recommendations or changes, understand the following project context.

**Project:** CDARS (Crime Data Analytics and Reporting System), publicly branded "BADAC Crime Analytics" / "BADAC Analytics" — an internal tool for Barangay 178 (North Caloocan)'s Barangay Anti-Drug Abuse Council (BADAC) to record, investigate, and analyze crime incidents. Repo: `github.com/David-L0830/crime-data-analytics`.

**Stack:** React 19 + Vite 8 frontend (react-router-dom v7, Chart.js v4, Leaflet + markercluster + heat, @supabase/supabase-js v2, no CSS framework). Laravel 12 / PHP ^8.2 backend, stateless REST API (firebase/php-jwt for JWT verification). PostgreSQL via Eloquent, Supabase-hosted in production. **Supabase Auth is the sole identity provider** — no Laravel sessions, no Sanctum. Testing: PHPUnit ^11 backend only (no frontend tests exist). Docker + Turborepo present; GitHub Actions CI is documented but **could not be confirmed to actually exist** (no `.github/` dir in the last uploaded ZIP).

**Architecture, one line:** Browser → React SPA → (auth) Supabase Auth issues JWT → SPA sends `Authorization: Bearer <token>` to Laravel → `SupabaseTokenValidator` verifies the JWT (JWKS, HS256 fallback) and resolves it to an existing local `users` row (never auto-creates one) → `EnsureRole` middleware enforces per-route RBAC → controller → Eloquent → PostgreSQL. The Laravel backend never sees a password and never issues its own session.

**Three roles, server-side enforced:** `badac_admin` (Administrator, full access), `encoder` (Encoder, own incidents only), `badac_readonly` (BADAC, view-only, **no** Audit Logs access, no Settings, no User Management).

**Core data model:** `incidents` (the central case record) ↔ many-to-many ↔ `criminals` (via `criminal_incident`) and ↔ many-to-many ↔ `victims` (via `incident_victim`). A criminal and a victim are never linked directly — only through a shared incident, by deliberate design. `users` reports incidents and performs `audit_logs` entries. `residents` table/model exist but are **completely unused** (no controller/route/page) — orphaned since an earlier removal.

**Standing patterns — do not violate:**
- **Archive, never delete.** Incidents and Victims use `PUT .../archive` (sets `status = 'Archived'`); no controller does a physical `DELETE`. **Criminal records are the one exception — they have no archive endpoint at all** (a known gap, not yet fixed).
- **MFA (`aal2`) is fully implemented but deliberately not enforced on any route** (removed at a past "Checkpoint 37" — the middleware `EnsureSupabaseAal2` still exists, just unwired). Don't re-enable it without confirming that's actually wanted.
- **RBAC is enforced server-side (`EnsureRole` + `role:` middleware), independent of the frontend sidebar** — never treat frontend `NAV_ITEMS` filtering as real security.
- **`DataContext` uses `Promise.allSettled`, not `Promise.all`**, deliberately — a role-restricted 403 on one endpoint must not blank every other dataset. (This was the root cause of a real, fixed bug — "Checkpoint 18.")

**Known open problems:**
1. Criminals can't be archived (asymmetric with Incidents/Victims).
2. `residents` table/model/seeder/factory are orphaned dead code.
3. `.github/workflows/` CI is documented but unverified/possibly absent.
4. Backend test suite (`php artisan test`, PHPUnit ^11, in-memory SQLite) has been **read but not executed** in the most recent session — pass/fail status unknown. Frontend has **zero automated tests** — only `npm run lint`/`npm run build`, both of which do pass.
5. Two bugs reported fixed in one earlier session on a real local PHP/Postgres setup (a JWKS-fallback error-handling gap in `SupabaseTokenValidator`, and a malformed placeholder `APP_KEY` in `phpunit.xml`) have **not been re-verified** against the current codebase.

**Environment reality check:** Claude sandbox sessions on this project have repeatedly had no PHP/Composer runtime and blocked access to `repo.packagist.org` — don't assume backend commands can run; check fresh each session. `npm`/frontend builds have generally worked.

**Do not change without explicit sign-off:** `SupabaseTokenValidator.php`, `EnsureRole.php`, or the auth/role middleware chains in `routes/api.php` (the entire security boundary); the archive-not-delete pattern; `UpdateUserRequest`'s exclusion of `email`/`role` from admin-editable fields; whether `badac_readonly` has Audit Logs access (already reversed once historically — confirm before touching again).

**Most important files to read first for any change:** `backend/routes/api.php` (ground truth for what's implemented and who can call it), `backend/app/Services/SupabaseTokenValidator.php`, `backend/app/Http/Middleware/EnsureRole.php`, `src/context/AuthContext.jsx`, `src/context/DataContext.jsx`, `src/utils/constants.js` (frontend RBAC + design tokens), and the project's own `README.md` (most recently rewritten and verified directly against source — more current than `backend/README.md`, `TODO.md`, or `PROGRESS.md`, all of which contain some stale claims; see this memory document's Section 16 for the specific reconciliations).

**Historical note on documentation drift:** the previous README/backend-README over-claimed MFA enforcement on almost every route, documented a `/residents` API that doesn't exist, and referenced GitHub Actions workflow files that aren't in the repository ZIP. Treat any older doc's specific technical claim as needing a source-code check before repeating it — this project has a demonstrated pattern of docs drifting out of sync with the actual (frequently checkpoint-by-checkpoint, sandbox-limited) implementation history.
