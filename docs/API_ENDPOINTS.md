# API Endpoints

The official API reference for **Crime Data Analytics / BADAC CDARS** — the Laravel 12 backend serving the React frontend for Barangay 178, North Caloocan.

Generated from the current source code and verified against `php artisan route:list` (45 routes) and the live production API.

| | |
|---|---|
| **Production base URL** | `https://crime-data-analytics-backend.onrender.com` |
| **Local development** | `http://localhost:8000` (`php artisan serve`) |
| **API prefix** | `/api` |
| **Authentication** | Supabase access token as `Authorization: Bearer <token>` |
| **Response format** | JSON |
| **Health check** | `GET /up` |

**Response format.** Every `/api/*` route returns JSON. Errors are forced to JSON (never Laravel's HTML error pages) by an exception handler that applies to `api/*` requests and to any request sending `Accept: application/json`.

**CORS.** `/api/*` routes send CORS headers for origins configured through the environment. `supports_credentials` is `false` — the API is Bearer-token only and uses no cookies. See [CORS](#cors).

---

## Table of Contents

1. [Endpoint Summary Table](#endpoint-summary-table)
2. [Authentication](#authentication)
3. [Roles](#roles)
4. [Error Format](#error-format)
5. [Health Check](#health-check)
6. [Authentication / User](#authentication--user)
7. [Profile](#profile)
8. [Incidents](#incidents)
9. [Analytics](#analytics)
10. [Dashboard](#dashboard)
11. [Metabase Embedding](#metabase-embedding)
12. [Criminals](#criminals)
13. [Victims](#victims)
14. [Notifications](#notifications)
15. [Administration](#administration)
16. [Synchronization](#synchronization)
17. [Filtering](#filtering)
18. [Example Requests](#example-requests)
19. [Frontend → API Flow](#frontend--api-flow)
20. [Database Relationships](#database-relationships)
21. [CORS](#cors)
22. [Deployment](#deployment)
23. [API Testing](#api-testing)
24. [Security Notes](#security-notes)

---

## Endpoint Summary Table

Populated from `php artisan route:list`. **47 API routes**, plus two application routes.

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/` | Public | API name / status banner |
| GET | `/up` | Public | Health check (used by Render) |
| GET | `/api/user` | Authenticated | Current user profile |
| POST | `/api/logout` | Authenticated | Record a logout audit event |
| PUT | `/api/me` | Authenticated | Update own display name |
| POST | `/api/me/avatar` | Authenticated | Upload own profile picture |
| GET | `/api/incidents` | Authenticated | List incidents (filterable) |
| GET | `/api/incidents/map` | Authenticated | Geocoded incidents for the map |
| GET | `/api/incidents/{incident}` | Authenticated | Single incident |
| POST | `/api/incidents` | admin, encoder | Create an incident |
| PUT | `/api/incidents/{incident}` | admin, encoder | Update an incident |
| PUT | `/api/incidents/{incident}/archive` | admin, encoder | Archive an incident |
| GET | `/api/dashboard` | admin, readonly | Dashboard summary statistics |
| GET | `/api/analytics` | admin, readonly | Totals by category / status / sitio |
| GET | `/api/analytics/crime-types` | admin, readonly | Counts per crime type |
| GET | `/api/analytics/monthly` | admin, readonly | Counts per month |
| GET | `/api/analytics/locations` | admin, readonly | Counts per sitio |
| GET | `/api/embed/metabase/{dashboardKey}` | admin, readonly | Signed Metabase embed URL |
| GET | `/api/criminals` | admin, readonly | List criminal records |
| GET | `/api/criminals/{criminal}` | admin, readonly | Single criminal record |
| POST | `/api/criminals` | admin | Create a criminal record |
| PUT | `/api/criminals/{criminal}` | admin | Update a criminal record |
| PUT | `/api/criminals/{criminal}/archive` | admin | Archive a criminal record |
| GET | `/api/victims` | admin, readonly | List victims |
| GET | `/api/victims/{victim}` | admin, readonly | Single victim |
| POST | `/api/victims` | admin | Create a victim |
| PUT | `/api/victims/{victim}` | admin | Update a victim |
| PUT | `/api/victims/{victim}/archive` | admin | Archive a victim |
| GET | `/api/notifications` | Authenticated | List notifications |
| PUT | `/api/notifications/read-all` | Authenticated | Mark all as read |
| PUT | `/api/notifications/{notification}/read` | Authenticated | Mark one as read |
| GET | `/api/settings` | admin | Read barangay settings |
| PUT | `/api/settings` | admin | Update barangay settings |
| GET | `/api/crime-types` | Authenticated | List crime types and their map colours |
| POST | `/api/crime-types` | admin | Add a crime type (colour assigned automatically) |
| PUT | `/api/crime-types/{crimeType}` | admin | Rename, recolour or enable/disable a crime type |
| GET | `/api/users` | admin | List user accounts |
| GET | `/api/users/{user}` | admin | Single user account |
| PUT | `/api/users/{user}` | admin | Update account details |
| PUT | `/api/users/{user}/status` | admin | Activate / deactivate an account |
| POST | `/api/users` | admin | Create an account (Supabase Auth + local row) |
| GET | `/api/users/{user}/activity` | admin | One account's own audit trail |
| POST | `/api/users/{user}/password-reset-audit` | admin | Record that a reset email was sent |
| POST | `/api/users/{user}/two-factor/disable` | admin | Remove another user's MFA factors |
| GET | `/api/role-permissions` | admin | Role/module access, read from route middleware |
| GET | `/api/audit-logs` | admin | Recent audit trail (max 200) |
| GET | `/api/sync-logs` | admin | Data import history |

> `storage/{path}` also appears in the route list. It is Laravel's built-in symlinked file server for uploaded avatars, not an API endpoint.
>
> `_ignition/*` routes come from `spatie/laravel-ignition`, a **`require-dev`** package. The production image is built with `composer install --no-dev`, so those routes **do not exist in production**.

---

## Authentication

Supabase Auth is the only authentication system. Laravel has **no login endpoint**, handles no passwords, and issues no session cookie — it is a stateless Bearer-token API.

```text
Frontend
   ↓
Supabase Auth
   ↓
Supabase access token
   ↓
Authorization: Bearer <token>
   ↓
Laravel API
   ↓
JWKS-based JWT verification
   ↓
Authenticated endpoint
```

**How it works**

1. The React frontend signs the user in **directly against Supabase**, using the public publishable key. Laravel never sees the password.
2. Supabase returns a short-lived **access token** — a JWT signed with ES256.
3. The frontend attaches it to every API call: `Authorization: Bearer <token>`.
4. The `auth:supabase` guard resolves the token via `App\Services\SupabaseTokenValidator`, which:
   - fetches the project's **JWKS** (public keys) from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached for one hour;
   - verifies the signature against those public keys;
   - checks `aud` = `authenticated` and `iss` = `{SUPABASE_URL}/auth/v1`;
   - maps the token's `sub` claim to an **existing** local user row.
5. Accounts are **never auto-created**. A Supabase user with no matching, active local account is rejected with `401`.

**Required headers for authenticated routes**

```http
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
Accept: application/json
```

> No JWT secret, signing key, or credential appears in this document. Verification uses **public** keys published by Supabase.

---

## Roles

Enforced by the `role:` middleware (`App\Http\Middleware\EnsureRole`).

| Constant | Value | Typical access |
|---|---|---|
| `ROLE_BADAC_ADMIN` | `badac_admin` | Full access, including administration |
| `ROLE_BADAC_READONLY` | `badac_readonly` | Read access to analytics, records, dashboards |
| `ROLE_ENCODER` | `encoder` | Creates and edits incidents |

Throughout this document, "admin" = `badac_admin`, "readonly" = `badac_readonly`, "encoder" = `encoder`.

**Additional record-level rule.** On `PUT /api/incidents/{incident}` and `PUT /api/incidents/{incident}/archive`, an **encoder may only modify incidents they personally created** (`reported_by`). Administrators are unrestricted.

---

## Error Format

Verified against the live production API.

| Status | Body |
|---|---|
| `401 Unauthorized` | `{"message": "Unauthenticated."}` |
| `403 Forbidden` | `{"message": "Forbidden — insufficient role."}` |
| `404 Not Found` | `{"message": "The route api/... could not be found."}` |
| `422 Unprocessable Entity` | `{"message": "...", "errors": {"field": ["reason"]}}` |

Validation failures follow Laravel's standard shape:

```json
{
  "message": "The case number field is required.",
  "errors": {
    "caseNumber": ["The case number field is required."]
  }
}
```

---

## Health Check

### GET `/up`

**Purpose** — Laravel's built-in health route. Confirms the application boots and can serve a request.

**Authentication** — **Public.** Not under `/api`, so it is not covered by the CORS policy and needs no token.

**Response** — `200 OK`, an HTML page (not JSON).

**Deployment role** — **Render uses this as the service health check path.** A non-200 here marks the deployment unhealthy.

```bash
curl -i https://crime-data-analytics-backend.onrender.com/up
```

### GET `/`

**Purpose** — a simple identification banner.

**Authentication** — Public.

**Response** — `200 OK`

```json
{
  "name": "BADAC CDARS API",
  "status": "ok",
  "message": "BADAC CDARS API — see /api for endpoints."
}
```

---

## Authentication / User

### GET `/api/user`

**Purpose** — returns the authenticated user's profile. The frontend calls this immediately after Supabase sign-in to resolve the Supabase identity into a local account; **login does not complete until this succeeds.**

**Authentication** — Authenticated (any role).

**Request** — no parameters.

**Response** — `200 OK`

```json
{
  "data": {
    "id": "1",
    "username": "example.user",
    "fullName": "Example User",
    "email": "user@example.com",
    "role": "badac_readonly",
    "roleLabel": "BADAC Read-Only",
    "isActive": true,
    "avatar": "E",
    "avatarUrl": null,
    "twoFactorEnabled": false,
    "authAssuranceLevel": "aal1"
  }
}
```

`authAssuranceLevel` reflects the token's `aal` claim — `aal1` for password-only, `aal2` once a second factor is completed.

**Status codes** — `200`, `401`

### POST `/api/logout`

**Purpose** — records a `LOGOUT` audit event. **It does not invalidate the token** — the Supabase session is ended client-side by `supabase.auth.signOut()`.

**Authentication** — Authenticated.

**Response** — `200 OK`

```json
{ "message": "Logged out." }
```

**Status codes** — `200`, `401`

---

## Profile

Self-service only — these always act on the caller's own account.

### PUT `/api/me`

**Purpose** — updates the signed-in user's display name.

**Authentication** — Authenticated.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `fullName` | string | **yes** | `max:255` |

**Response** — `200 OK`, a `UserResource` (same shape as `GET /api/user`).

**Status codes** — `200`, `401`, `422`

### POST `/api/me/avatar`

**Purpose** — uploads the signed-in user's profile picture.

**Authentication** — Authenticated.

**Request** — `multipart/form-data`

| Field | Type | Required | Rules |
|---|---|---|---|
| `avatar` | file | **yes** | image; `jpg,jpeg,png,webp`; `max:4096` KB |

Stored on the `public` disk as `avatars/{userId}.{ext}`.

**Response** — `200 OK`, a `UserResource` with `avatarUrl` populated.

**Status codes** — `200`, `401`, `422`

> Uploaded avatars are written to the container filesystem, which Render discards on redeploy.

---

## Incidents

The core resource. `IncidentResource` returns **camelCase** keys, while database columns are snake_case.

### GET `/api/incidents`

**Purpose** — lists incidents, newest first (`incident_date` desc, then `id` desc).

**Authentication** — Authenticated (any role).

**Query parameters** — all optional; omitted parameters apply no filter.

| Parameter | Matches |
|---|---|
| `sitio` | exact `sitio` |
| `status` | exact `status` |
| `crimeType` | exact `crime_type` |
| `category` | exact `category` |
| `date` | exact `incident_date` |
| `dateFrom` | `incident_date >=` |
| `dateTo` | `incident_date <=` |
| `search` | case-insensitive partial match across `case_number`, `street`, `reporting_officer`, `crime_type`, `sitio` |

> This endpoint returns archived incidents too. Filtering them out is done client-side; the analytics endpoints exclude them server-side.

**Response** — `200 OK`

```json
{
  "data": [
    {
      "id": "1",
      "incidentId": "INC-00001",
      "caseNumber": "CASE-2025-0001",
      "crimeType": "Theft",
      "category": "Property Crime",
      "date": "2025-03-14",
      "time": "14:30",
      "street": "Example Street",
      "sitio": "Sitio 3",
      "latitude": 14.7500,
      "longitude": 121.0500,
      "victimName": "Example Victim",
      "victimAge": 30,
      "victimGender": "Female",
      "suspectName": "Example Suspect",
      "suspectAge": 25,
      "reportingOfficer": "Officer Example",
      "investigatingOfficer": "Officer Example",
      "badgeNumber": "12345",
      "unit": "Example Unit",
      "status": "Under Investigation",
      "priority": "Medium",
      "description": "Example description.",
      "evidence": "Example evidence reference",
      "reportedBy": "1",
      "synced_at": "2025-03-14T09:00:00+00:00"
    }
  ]
}
```

**Status codes** — `200`, `401`

### GET `/api/incidents/map`

**Purpose** — a lightweight payload for the map view. Returns only incidents that **have coordinates** and are **not archived**.

**Authentication** — Authenticated.

**Response** — `200 OK`, a plain array (no `data` wrapper):

```json
[
  {
    "id": "1",
    "latitude": 14.75,
    "longitude": 121.05,
    "crimeType": "Theft",
    "date": "2025-03-14",
    "location": "Example Street",
    "sitio": "Sitio 3",
    "status": "Under Investigation"
  }
]
```

**Status codes** — `200`, `401`

### GET `/api/incidents/{incident}`

**Purpose** — a single incident by numeric ID.

**Authentication** — Authenticated.

**Path parameters** — `incident` — the incident's numeric `id`.

**Response** — `200 OK`, a single `IncidentResource` wrapped in `data`.

**Status codes** — `200`, `401`, `404`

### POST `/api/incidents`

**Purpose** — creates an incident. `incident_code` is generated automatically (`INC-00001` style) and `reported_by` is set to the caller.

**Authentication** — **admin** or **encoder**.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `caseNumber` | string | **yes** | `max:50`, unique in `incidents.case_number` |
| `crimeType` | string | **yes** | `max:100` |
| `date` | date | **yes** | valid date |
| `sitio` | string | **yes** | `max:100` |
| `category` | string | no | `max:100` |
| `time` | string | no | `H:i` (e.g. `14:30`) |
| `street` | string | no | `max:255` |
| `latitude` | numeric | no | between `-90` and `90` |
| `longitude` | numeric | no | between `-180` and `180` |
| `victimName` | string | no | `max:150` |
| `victimAge` | integer | no | `0`–`120` |
| `victimGender` | string | no | `max:20` |
| `suspectName` | string | no | `max:150` |
| `suspectAge` | integer | no | `0`–`120` |
| `reportingOfficer` | string | no | `max:100` |
| `investigatingOfficer` | string | no | `max:100` |
| `badgeNumber` | string | no | `max:50` |
| `unit` | string | no | `max:100` |
| `status` | string | no | `max:50` |
| `priority` | string | no | `max:50` |
| `description` | string | no | — |
| `evidence` | string | no | `max:255` |

**Response** — `201 Created`, the new `IncidentResource`.

**Status codes** — `201`, `401`, `403`, `422`

A duplicate case number returns `422` with the message *"Case number already exists."*

### PUT `/api/incidents/{incident}`

**Purpose** — updates an incident.

**Authentication** — **admin** or **encoder**. An encoder may only update incidents where `reported_by` matches their own ID; otherwise `403` with *"Encoders may only update incidents they personally encoded."*

**Request body** — same fields as `POST`, applied as changes.

**Response** — `200 OK`, the updated `IncidentResource`.

**Status codes** — `200`, `401`, `403`, `404`, `422`

### PUT `/api/incidents/{incident}/archive`

**Purpose** — archives an incident by setting `status = 'Archived'`. **The row is never deleted.** Archived incidents are excluded from every statistic.

**Authentication** — **admin** or **encoder**, with the same ownership restriction (`403`: *"Encoders may only archive incidents they personally encoded."*).

**Response** — `200 OK`, the updated `IncidentResource`.

**Status codes** — `200`, `401`, `403`, `404`

---

## Analytics

All four endpoints exclude `status = 'Archived'` at the database level.

### GET `/api/analytics`

**Purpose** — headline totals plus counts grouped three ways.

**Authentication** — **admin** or **readonly**.

**Response** — `200 OK`

```json
{
  "total": 120,
  "byCategory": { "Property Crime": 40, "Violent Crime": 30 },
  "byStatus": { "Open": 42, "Under Investigation": 36 },
  "bySitio": { "Sitio 3": 26, "Sitio 2": 21 }
}
```

### GET `/api/analytics/crime-types`

**Purpose** — incident count per crime type, highest first.

**Authentication** — **admin** or **readonly**.

**Response** — `200 OK`

```json
[ { "crime_type": "Theft", "total": 20 } ]
```

### GET `/api/analytics/monthly`

**Purpose** — incident count per calendar month, ascending. Uses PostgreSQL `to_char(incident_date, 'YYYY-MM')`.

**Authentication** — **admin** or **readonly**.

**Response** — `200 OK`

```json
[ { "month": "2025-01", "total": 8 } ]
```

### GET `/api/analytics/locations`

**Purpose** — incident count per sitio, highest first.

**Authentication** — **admin** or **readonly**.

**Response** — `200 OK`

```json
[ { "sitio": "Sitio 3", "total": 26 } ]
```

**Status codes (all four)** — `200`, `401`, `403`

---

## Dashboard

### GET `/api/dashboard`

**Purpose** — a single aggregate payload for the dashboard summary. Excludes archived incidents.

**Authentication** — **admin** or **readonly**.

**Response** — `200 OK`

```json
{
  "totalIncidents": 120,
  "openIncidents": 42,
  "underInvestigation": 36,
  "solvedIncidents": 20,
  "totalCriminalRecords": 15,
  "hotspotCount": 4,
  "byCrimeType": { "Theft": 20 },
  "bySitio": { "Sitio 3": 26 },
  "recentIncidents": [
    {
      "id": "1",
      "caseNumber": "CASE-2025-0001",
      "crimeType": "Theft",
      "date": "2025-03-14",
      "sitio": "Sitio 3",
      "status": "Under Investigation"
    }
  ],
  "lastSync": { "id": 1, "status": "completed", "records_received": 25, "source": "example-source" },
  "settings": { "barangay": "Barangay 178", "population": 15000, "threshold": 5, "hotspot_threshold": 3 }
}
```

`hotspotCount` counts sitios whose incident total meets or exceeds `settings.hotspot_threshold`.

**Status codes** — `200`, `401`, `403`

---

## Metabase Embedding

### GET `/api/embed/metabase/{dashboardKey}`

**Purpose** — returns a **short-lived signed URL** for an embedded Metabase dashboard. The frontend puts this straight into an `<iframe src>`.

**Authentication** — **admin** or **readonly**.

**Path parameters**

| `dashboardKey` | Metabase dashboard | ID |
|---|---|---|
| `crime` | Crime Dashboard | 2 |
| `analytics` | Crime Analytics | 3 |
| `trends` | Crime Trends | 4 |

Any other value returns `404`.

**Query parameters** — filter values to lock into the signed token. All optional; empty values are omitted entirely.

| Query parameter | Metabase parameter | Notes |
|---|---|---|
| `dateFrom`, `dateTo` | `date_range` | Combined into a single `from~to` string |
| `crimeType` | `crime_type` | |
| `sitio` | `sitio` | |
| `status` | `status` | |
| `category` | `category` | Used by the Analytics dashboard |

**How the URL is generated** — `App\Services\MetabaseEmbedService`:

1. Builds a payload `{ resource: { dashboard: <id> }, params: { …locked filters… }, exp: now + 10 minutes }`.
2. Signs it with **HS256** using the server-side embedding secret.
3. Appends display options to the URL fragment — `bordered=false`, `titled=false`, `theme=transparent`, plus `hide_parameters=…` so Metabase's own filter widgets stay hidden and the React FilterBar remains the only filter interface.

```text
{METABASE_SITE_URL}/embed/dashboard/{signed-token}#bordered=false&titled=false&theme=transparent&hide_parameters=...
```

> **The signing secret never reaches the browser.** It is read only on the backend, and the frontend receives nothing but the finished URL string. This document does not contain the secret, and it must never appear in frontend code or a `VITE_*` variable.

**Response** — `200 OK`

```json
{ "url": "https://<metabase-host>/embed/dashboard/<signed-token>#bordered=false&titled=false&theme=transparent" }
```

**Status codes**

| Code | Meaning |
|---|---|
| `200` | Signed URL returned |
| `401` | Not authenticated |
| `403` | Role not permitted |
| `404` | Unknown `dashboardKey` — `{"message": "Unknown dashboard."}` |
| `503` | Metabase not configured — `{"message": "Analytics dashboard is not configured yet."}` |

A `503` means `METABASE_SITE_URL`, the embedding secret, or the dashboard ID is missing from the backend environment.

> **Demo dependency.** Metabase currently runs on a local computer published through a temporary Cloudflare tunnel. Laravel only builds the URL string — it never calls Metabase — but the **browser** must be able to reach that host for charts to render.

---

## Criminals

### GET `/api/criminals`

**Purpose** — lists criminal records.

**Authentication** — **admin** or **readonly**.

**Query parameters**

| Parameter | Matches |
|---|---|
| `status` | exact `status` |
| `search` | partial match on `full_name` and related fields, including linked incidents' `case_number` |

**Response** — `200 OK`, a collection of criminal records.

**Status codes** — `200`, `401`, `403`

### GET `/api/criminals/{criminal}`

**Purpose** — one criminal record with its related incidents and victim information grouped by case.

**Authentication** — **admin** or **readonly**.

**Status codes** — `200`, `401`, `403`, `404`

### POST `/api/criminals` · PUT `/api/criminals/{criminal}`

**Purpose** — create or update a criminal record. Fields are validated by `StoreCriminalRequest` / `UpdateCriminalRequest`.

**Authentication** — **admin** only.

**Status codes** — `201` / `200`, `401`, `403`, `404`, `422`

### PUT `/api/criminals/{criminal}/archive`

**Purpose** — sets `status = 'Archived'`. The row is not deleted.

**Authentication** — **admin** only.

**Status codes** — `200`, `401`, `403`, `404`

---

## Victims

### GET `/api/victims`

**Purpose** — lists victims. Supports a `search` query parameter.

**Authentication** — **admin** or **readonly**.

### GET `/api/victims/{victim}`

**Purpose** — one victim with related cases. A victim may belong to multiple incidents.

**Authentication** — **admin** or **readonly**.

### POST `/api/victims` · PUT `/api/victims/{victim}`

**Purpose** — create or update a victim, optionally attaching it to a case. Validated by `StoreVictimRequest` / `UpdateVictimRequest`. New victims default to `Active`.

**Authentication** — **admin** only.

### PUT `/api/victims/{victim}/archive`

**Purpose** — sets `status = 'Archived'`; the row is retained.

**Authentication** — **admin** only.

**Status codes** — `200`/`201`, `401`, `403`, `404`, `422`

---

## Notifications

### GET `/api/notifications`

**Purpose** — lists in-app notifications, newest first. Notifications titled *"Backup Reminder"* are excluded.

Two scoping rules apply, both relative to the authenticated caller:

- **Audience.** A notification may name the roles it is for (`app_notifications.audience_roles`). A notification with no audience reaches every role; one addressed to specific roles is omitted for everybody else. Incident announcements have no audience; the *"New Criminal Record"* / *"New Victim Record"* announcements are addressed to **admin** and **badac** only, since Encoder has no Records access.
- **Read state is per-user.** `read` answers *"has this user read it"*, resolved from the `notification_reads` table, not from a shared column. One account marking a notification read has no effect on another account's unread count. The legacy `app_notifications.read` column is still honoured as a global "read by everyone" flag so notifications dismissed before per-user tracking existed do not reappear.

**Authentication** — Authenticated.

**Response** — `200 OK`

```json
{
  "data": [
    {
      "id": "1",
      "title": "Example Notification",
      "message": "Example message text.",
      "type": "info",
      "read": false,
      "timestamp": "2025-03-14T09:00:00+00:00"
    }
  ]
}
```

### PUT `/api/notifications/{notification}/read`

**Purpose** — marks one notification as read **for the calling user**. Idempotent: calling it twice is not an error. Returns the updated notification.

**Authentication** — Authenticated.

### PUT `/api/notifications/read-all`

**Purpose** — marks every notification currently unread **for the calling user** as read. An optional `title` query parameter limits this to notifications with that exact title. Notifications outside the caller's role audience are never touched.

**Authentication** — Authenticated.

**Response** — `200 OK`

```json
{ "message": "Notifications marked as read." }
```

**Status codes** — `200`, `401`, `404`

---

## Administration

All routes in this group require the **admin** role.

### GET `/api/settings` · PUT `/api/settings`

**Purpose** — read or update the single barangay settings row.

**Request body for `PUT`** — every field optional (`sometimes`):

| Field | Type | Rules |
|---|---|---|
| `barangay` | string | `max:150` |
| `population` | integer | `min:0` — denominator for the Crime Rate / 1K KPI |
| `threshold` | integer | `min:0` |
| `hotspotThreshold` | integer | `min:0` — maps to `hotspot_threshold` |
| `categories` | array | list of crime categories |

**Response** — `200 OK`, the settings row.

**Status codes** — `200`, `401`, `403`, `422`

### GET `/api/crime-types`

**Purpose** — the configurable crime-type vocabulary and the map colour bound to each type. This drives the incident form's Crime Type list, every crime-type filter, and the Crime Mapping legend and marker colours.

**Authentication** — Authenticated (**every** role, unlike the rest of this section — the read is not administrative, it is the vocabulary the app is built from).

**Response** — `200 OK`

```json
{
  "data": [
    { "id": "3", "name": "Assault", "color": "#2563EB", "isActive": true },
    { "id": "1", "name": "Theft", "color": "#EA580C", "isActive": true }
  ]
}
```

### POST `/api/crime-types`

**Purpose** — add a crime type. **`color` is optional**: when omitted the server assigns one from a curated palette, skipping every colour already in use, and falling back to a colour derived deterministically from the name once the palette is exhausted. The assigned colour is stored on the row and never recomputed, so it stays stable across refreshes, sessions, users and machines. Adding a crime type never alters an existing one's colour.

**Authentication** — **admin**.

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, `max:100`, unique |
| `color` | string | optional, `#RRGGBB` |
| `isActive` | boolean | optional, defaults `true` |

**Response** — `201 Created`, the crime type. Writes an `audit_logs` row.

**Status codes** — `201`, `401`, `403`, `422`

### PUT `/api/crime-types/{crimeType}`

**Purpose** — rename, recolour, or enable/disable a crime type. Disabling removes it from the pickers for new records; incidents that already use it keep their crime type and its colour on the map.

**Authentication** — **admin**.

**Response** — `200 OK`, the crime type. Writes an `audit_logs` row naming the before/after colour when the colour changed.

**Status codes** — `200`, `401`, `403`, `422`

### GET `/api/users` · GET `/api/users/{user}`

**Purpose** — list or read user accounts. Returns `UserResource` objects.

`UserResource` includes `createdAt` and `lastLoginAt`, both ISO-8601 or `null`.
`lastLoginAt` is **derived from the audit trail** — the newest `LOGIN` row for
that account (written by `AuthController::recordLoginIfFreshSignIn()`), loaded
as a single `withMax` aggregate rather than one query per row. There is no
`users.last_login` column and no second write path; `null` means the account
has no `LOGIN` row, which the UI renders as *Never*.

### POST `/api/users`

**Purpose** — administrator-provisioned account creation. Writes **both**
halves of an account or neither: the Supabase Auth identity (via the Admin API
with the service-role key, server-side only) and the local `users` row. A local
row on its own could never authenticate.

**Failure is symmetric in both directions**, which matters because the two
systems cannot share a transaction:

- If Supabase refuses, the database transaction rolls back and no local row
  survives.
- If Supabase succeeds but the local row then cannot be saved or committed, the
  newly created Supabase Auth user is **deleted again** before the error is
  returned. Without that compensation the address would be permanently taken in
  Supabase Auth while no local account existed, so every retry would fail with
  *"already registered"* and the administrator would have no way forward. (Such
  an orphan would not be a privilege risk — with no local row,
  `SupabaseTokenValidator` rejects its tokens and it can never sign in — but it
  would be an unrecoverable dead end.)

Validated by `StoreUserRequest`.

| Field | Type | Required |
|---|---|---|
| `fullName` | string, max 150 | **yes** |
| `username` | string, max 50, unique | **yes** |
| `email` | string, valid email, unique | **yes** |
| `role` | `badac_admin` \| `encoder` \| `badac_readonly` | **yes** |
| `isActive` | boolean (default `true`) | no |

**No password field exists, and none can.** Supabase Auth owns every
credential; the account is provisioned with a random value that is never
returned, logged, or stored, and the new user sets their own password from the
Supabase recovery email the administrator sends afterwards.

`role` **is** accepted here, unlike `PUT /api/users/{user}` — choosing the role
of an account that does not exist yet is provisioning; changing the role of a
live account is privilege escalation, and remains unsupported.

**Response** — `201 Created`, the new `UserResource`. Writes a `CREATE` audit row.

**Status codes**

| Code | Condition |
|---|---|
| `201` | Created in both systems |
| `401` | No valid Supabase access token |
| `403` | Caller is authenticated but is not an administrator |
| `422` | Validation failed, the email already exists in Supabase Auth, the Admin API refused, or `SUPABASE_SERVICE_ROLE_KEY` is not configured |
| `500` | A genuine server fault (e.g. the database). Deliberately **not** flattened into a `422`, so it is logged and reported as the fault it is rather than as bad input from the administrator. Any Supabase account created during the attempt is removed first. |

### GET `/api/users/{user}/activity`

**Purpose** — the selected account's own audit trail, for the User Activity
view. Returns `AuditLogResource` objects.

**Bounded by design** — hard-capped at the **50 most recent** rows, newest
first. The cap is in the query, not the UI, so the endpoint can never return an
unbounded history however long an account has been in use.

`AuditLogResource` exposes `id`, `timestamp`, `performedBy`, `role`, `action`,
`targetType` and `details`. It deliberately does **not** expose
`audit_logs.ip_address`, so this endpoint reveals nothing about an account
beyond the audited actions the Audit Logs module already shows an
administrator.

This reuses `audit_logs` — there is no second activity store. Scoping happens
in the query, not in the browser, because `GET /api/audit-logs` returns only
the 200 most recent rows system-wide and a quiet account's history would
otherwise disappear behind a busy week of someone else's.

Reading it writes a `VIEW` audit row: inspecting another person's activity is
itself an administrative act.

### POST `/api/users/{user}/password-reset-audit`

**Purpose** — records that an administrator sent this account a password-reset
email. It is named for exactly what it does: **it does not send the email** and
never touches a credential.

Supabase sends the email, requested from the browser via
`supabase.auth.resetPasswordForEmail()` — the same mechanism the public Forgot
Password page uses. The frontend calls this endpoint only after that call has
succeeded, so the trail never records a reset that did not happen. No token,
link, or password passes through this backend.

**Response** — `200 OK`, `{ "message": "Password reset recorded." }`

### PUT `/api/users/{user}`

**Purpose** — updates another account's details. Validated by `UpdateUserRequest`; accepts `fullName` and `username`.

**Response** — `200 OK`, the updated `UserResource`.

### PUT `/api/users/{user}/status`

**Purpose** — activates or deactivates an account.

**Request body**

| Field | Type | Required |
|---|---|---|
| `isActive` | boolean | **yes** |

**Guard rail** — deactivating your own account returns `422`: *"You cannot deactivate your own account."*

### POST `/api/users/{user}/two-factor/disable`

**Purpose** — the break-glass action removing another user's Supabase MFA factors ("lost my phone"). Requires `SUPABASE_SERVICE_ROLE_KEY` on the backend.

**Status codes**

| Code | Condition |
|---|---|
| `200` | Factors removed |
| `422` | The account has never signed in via Supabase, or has no MFA enabled |
| `502` | Supabase could not be reached, or the service-role key is not configured |

### GET `/api/role-permissions`

**Purpose** — which roles each module's endpoints actually admit.

This **declares nothing**. It walks Laravel's own registered route table, reads
the `role:` (`EnsureRole`) middleware attached to each route in
`routes/api.php`, and groups the result by module — so it cannot drift from
enforcement, because the middleware is its input. A route that is authenticated
but carries no `role:` middleware admits every role, which is what the absence
of `EnsureRole` means.

Per role, per module: `full` (may read and write), `view` (read only), `none`.

**Response** — `200 OK`

```json
{
  "data": {
    "roles": [{ "key": "badac_admin", "label": "Administrator" }],
    "modules": [
      {
        "id": "user-management",
        "label": "User Management",
        "access": { "badac_admin": "full", "encoder": "none", "badac_readonly": "none" },
        "endpoints": ["GET /api/users", "POST /api/users"]
      }
    ]
  }
}
```

Admin-only, deliberately: a precise map of who may reach what is reconnaissance
for anyone who should not have it. The UI that renders this grants nothing —
server-side authorization decides every request independently.

### GET `/api/audit-logs`

**Purpose** — the **200 most recent** audit entries, newest first.

**Response** — `200 OK`

```json
{
  "data": [
    {
      "id": "1",
      "timestamp": "2025-03-14T09:00:00+00:00",
      "performedBy": "Example User",
      "role": "badac_admin",
      "action": "UPDATE",
      "targetType": "incident",
      "details": "Example description of the action."
    }
  ]
}
```

**Status codes** — `200`, `401`, `403`

---

## Synchronization

### GET `/api/sync-logs`

**Purpose** — the history of data-import runs, newest first. Feeds the "Today Imported" / "Month Imported" KPI cards.

**Authentication** — **admin** only.

**Response** — `200 OK`, a plain array:

```json
[
  {
    "id": "1",
    "timestamp": "2025-03-14T09:00:00+00:00",
    "status": "completed",
    "recordsReceived": 25,
    "source": "example-source"
  }
]
```

**Status codes** — `200`, `401`, `403`

---

## Filtering

There are **two distinct filter contracts**, and their parameter names differ. The frontend's filter labels are not identical to either.

### 1. Incident list filters (`GET /api/incidents`)

Sent as **camelCase query parameters**, read directly by `IncidentController::index`:

```
?dateFrom=2025-03-01&dateTo=2025-06-30&crimeType=Theft&sitio=Sitio+3&status=Solved
```

| UI filter | Query parameter | Applied as |
|---|---|---|
| Date Range (From) | `dateFrom` | `incident_date >=` |
| Date Range (To) | `dateTo` | `incident_date <=` |
| Crime Type | `crimeType` | `crime_type =` |
| Sitio | `sitio` | `sitio =` |
| Status | `status` | `status =` |
| Category | `category` | `category =` |
| — | `date` | exact date |
| — | `search` | partial text match |

### 2. Metabase embed filters (`GET /api/embed/metabase/{key}`)

Sent as the **same camelCase query parameters**, then translated by `MetabaseEmbedController::buildLockedParams()` into **snake_case Metabase parameter slugs**:

| Query parameter | → Metabase slug | Transformation |
|---|---|---|
| `dateFrom` + `dateTo` | `date_range` | Joined as `"{from}~{to}"` |
| `crimeType` | `crime_type` | passed through |
| `sitio` | `sitio` | passed through |
| `status` | `status` | passed through |
| `category` | `category` | passed through |

### Cleared filters mean "show everything"

An empty or missing value is **omitted entirely** from the request. It is never sent as an empty string, which would filter for blank values and return nothing. On the Laravel side:

- `IncidentController` guards every filter with `$request->filled(...)`.
- `buildLockedParams()` skips any value that is `null` or `''`, and casts the result with `(object)` so an empty set serialises as `{}` rather than `[]`.

---

## Example Requests

Replace `<SUPABASE_ACCESS_TOKEN>` with a real token obtained from Supabase at runtime. **Never commit a real token.**

**Health check — no authentication**

```bash
curl -i https://crime-data-analytics-backend.onrender.com/up
```

**Authenticated request — current user**

```bash
curl -X GET "https://crime-data-analytics-backend.onrender.com/api/user" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Accept: application/json"
```

**Filtered incident list**

```bash
curl -X GET "https://crime-data-analytics-backend.onrender.com/api/incidents?dateFrom=2025-03-01&dateTo=2025-06-30&sitio=Sitio%203&status=Solved" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Accept: application/json"
```

**Metabase embed URL with filters**

```bash
curl -X GET "https://crime-data-analytics-backend.onrender.com/api/embed/metabase/trends?dateFrom=2025-01-01&dateTo=2025-11-30&crimeType=Theft" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Accept: application/json"
```

**Create an incident**

```bash
curl -X POST "https://crime-data-analytics-backend.onrender.com/api/incidents" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{
        "caseNumber": "CASE-2025-0999",
        "crimeType": "Theft",
        "date": "2025-03-14",
        "sitio": "Sitio 3",
        "category": "Property Crime",
        "time": "14:30",
        "status": "Open"
      }'
```

**Check a CORS preflight**

```bash
curl -X OPTIONS "https://crime-data-analytics-backend.onrender.com/api/user" \
  -H "Origin: https://crime-data-analytics-ebon.vercel.app" \
  -H "Access-Control-Request-Method: GET" -i
```

---

## Frontend → API Flow

```text
React/Vite
   ↓
API service  (src/services/api.js)
   ↓
VITE_API_URL
   ↓
Laravel API on Render
   ↓
Supabase PostgreSQL
```

**Where authentication is inserted.** Every service module goes through the single client in `src/services/api.js` — there are no raw `fetch()` calls in pages or components. Before each request that client calls `supabase.auth.getSession()` and attaches the current access token:

```
Authorization: Bearer <token>
Accept: application/json
```

Callers never handle tokens themselves. `credentials: 'include'` is deliberately **not** used — there is no cookie, and a Bearer token is not sent automatically by the browser, so no CSRF protection is required.

**Error classification.** The client turns responses into a typed `ApiError` so callers can react accurately:

| Type | Trigger |
|---|---|
| `network` | `fetch()` threw — the server was never reached (status `0`) |
| `mfa_required` | `401` with `mfaRequired: true` |
| `unauthenticated` | `401` |
| `forbidden` | `403` |
| `not_found` | `404` |
| `validation` | `422` |
| `server` | `5xx` |

`VITE_API_URL` must include the `/api` suffix — the client appends endpoint paths directly to it.

---

## Database Relationships

```text
GET /api/incidents            GET /api/analytics/*         GET /api/sync-logs
        ↓                             ↓                            ↓
     Laravel                       Laravel                      Laravel
        ↓                             ↓                            ↓
Supabase PostgreSQL          Supabase PostgreSQL          Supabase PostgreSQL
        ↓                             ↓                            ↓
   incidents table            incidents table              sync_logs table
                              (status != 'Archived')
```

| Endpoint group | Tables read / written |
|---|---|
| `/api/incidents/*` | `incidents` (read/write); writes `audit_logs` on create, update, archive |
| `/api/analytics/*` | `incidents` (read, archived excluded) |
| `/api/dashboard` | `incidents`, `criminals`, `sync_logs`, `settings` (read) |
| `/api/criminals/*` | `criminals`, plus related incidents; writes `audit_logs` |
| `/api/victims/*` | `victims`, `incident_victim` pivot; writes `audit_logs` |
| `/api/users/*`, `/api/me` | `users` (read/write); writes `audit_logs` |
| `/api/settings` | `settings` (read/write); writes `audit_logs` |
| `/api/audit-logs` | `audit_logs` (read, with the related user) |
| `/api/sync-logs` | `sync_logs` (read) |
| `/api/notifications/*` | `app_notifications` (read), `notification_reads` (read/write) |
| `/api/crime-types` | `crime_types` (read/write); writes `audit_logs` |
| `/api/embed/metabase/*` | **No database access** — signs a URL only |

**Archiving, not deleting.** Incidents, criminals, and victims are archived by setting `status = 'Archived'`. Rows are retained for audit purposes and excluded from statistics.

---

## CORS

Configured in `backend/config/cors.php` and applied to `api/*` only.

```php
'paths' => ['api/*'],
'allowed_methods' => ['*'],
'allowed_origins' => array_values(array_unique(array_filter(array_merge(
    [env('FRONTEND_URL', 'http://localhost:5173')],
    array_map('trim', explode(',', env('CORS_ALLOWED_ORIGINS', '')))
)))),
'allowed_headers' => ['*'],
'supports_credentials' => false,
```

**Why CORS is required.** The frontend is served from Vercel and the API from Render — different origins. Without matching CORS headers the browser blocks every API response, even when the request itself succeeded.

| Environment | Origin |
|---|---|
| **Production** | `https://crime-data-analytics-ebon.vercel.app` |
| **Local development** | `http://localhost:5173` (the `env()` default) |

**Notes**

- Origins come **entirely from the environment**; no deployment URL is hardcoded.
- Multiple origins may be supplied as a comma-separated list in `CORS_ALLOWED_ORIGINS`.
- `supports_credentials` is `false` — the API uses Bearer tokens, not cookies.
- Use the **stable production alias**. Vercel issues a unique per-deployment URL for every build; those change on every push and are not in the allow-list, producing a CORS mismatch.
- `/up` is not under `/api`, so it carries no CORS headers — by design, since it is never called cross-origin.

---

## Deployment

```text
Vercel
  ↓
React frontend
  ↓
Render
  ↓
Laravel API
  ↓
Supabase PostgreSQL
```

| | |
|---|---|
| **Production API base URL** | `https://crime-data-analytics-backend.onrender.com` |
| **Render service** | `crime-data-analytics-backend` (Docker, Singapore, free tier) |
| **Image** | `backend/Dockerfile` — nginx + php-fpm |
| **Health check path** | `/up` |

**`PORT` is supplied automatically by Render** and read by the container entrypoint. Do not set it manually.

**Runtime configuration.** Render environment variables are read at container start. The entrypoint rebuilds Laravel's configuration cache from the live environment on every boot, so editing a variable and letting Render restart is enough — no rebuild required.

**`VITE_API_URL` is a build-time variable.** Vite inlines `VITE_*` values into the JavaScript bundle when the site is built; they are not read at runtime.

> **Changing `VITE_API_URL` in Vercel has no effect until you redeploy.** If the frontend appears to call the wrong API host, redeploy before investigating anything else.

---

## API Testing

**List every route (source of truth)**

```bash
cd backend
php artisan route:list
php artisan route:list --path=up          # filter to one path
php artisan route:list --json             # machine-readable
```

**Health check in a browser** — open `https://crime-data-analytics-backend.onrender.com/up`. A `200` with an HTML page means the service is up.

**Unauthenticated check** — confirms the API is reachable and auth is enforced:

```bash
curl -i "https://crime-data-analytics-backend.onrender.com/api/user" -H "Accept: application/json"
# expect: 401 {"message":"Unauthenticated."}
```

**Authenticated check** — obtain an access token from the browser after signing in (DevTools → Application → Local Storage → `cdars_supabase_auth`), then:

```bash
curl -i "https://crime-data-analytics-backend.onrender.com/api/user" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" -H "Accept: application/json"
```

**Checking status codes only**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://crime-data-analytics-backend.onrender.com/up
```

**Automated test suite** — 74 tests, in-memory SQLite:

```bash
cd backend
php artisan test
php artisan test --filter=IncidentTest
```

**Laravel logs**

```bash
tail -n 50 backend/storage/logs/laravel.log     # local
```

In production, use Render's log stream. On a healthy boot it shows four `[entrypoint]` lines, including *"building config cache from runtime environment"*.

> A `401` on a request you believe is authenticated usually means an **expired token** — Supabase access tokens are short-lived. Sign in again to obtain a fresh one.

---

## Security Notes

**Never commit any of the following to GitHub:**

- `.env` files (they are git-ignored — keep it that way)
- Database passwords
- Supabase **service-role** keys
- JWT secrets
- Metabase embedding secrets
- `APP_KEY`
- Real access tokens

**Use placeholder tokens in documentation.** Every example in this file uses `<SUPABASE_ACCESS_TOKEN>`. No real token, key, password, or user record appears anywhere in this document.

**The Supabase publishable key is different.** It is designed for browser use and is compiled into the frontend bundle, where anyone can read it. It identifies the project without granting privileges — access is enforced by Supabase Auth and row-level security. This does **not** make it exempt from Supabase's security rules, and it must never be confused with the secret/service-role key, which must stay server-side.

**JWT verification uses public keys.** The backend verifies Supabase tokens against the project's published JWKS endpoint. `SUPABASE_JWT_SECRET` is intentionally left empty: the legacy shared secret was revoked, and a blank value disables that older verification path entirely so a leaked legacy secret could not be used to forge tokens.

**Generated files can contain secrets.** `bootstrap/cache/config.php` holds every resolved configuration value in plaintext, including credentials. It is git-ignored and must never be committed.

**If a secret is exposed**, treat it as compromised: rotate it at the source, then update every consumer. Rotating the database password, for example, requires updating `backend/.env`, Render, **and** Metabase's own database connection.

---

*Generated from the current source code and verified against `php artisan route:list` and the live production API.*
