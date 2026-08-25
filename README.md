# Crime Data Analytics & Reporting System

A crime data analytics and reporting platform for **Barangay 178, North Caloocan**. It combines a React single-page application, a Laravel REST API, a Supabase PostgreSQL database, and embedded Metabase dashboards behind a single set of user-facing filters.

**Live production URLs**

| Component | URL |
|---|---|
| Frontend (Vercel) | `https://crime-data-analytics-ebon.vercel.app` |
| Backend API (Render) | `https://crime-data-analytics-backend.onrender.com` |
| Health check | `https://crime-data-analytics-backend.onrender.com/up` |

> **Demo dependency.** Metabase runs on a **local computer** and is exposed through a **temporary Cloudflare tunnel**. Embedded charts only work while that computer is switched on, online, and running the tunnel. See [Metabase & the Cloudflare Tunnel](#metabase--the-cloudflare-tunnel).

---

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [System Architecture](#system-architecture)
4. [Technology Stack](#technology-stack)
5. [Authentication Flow](#authentication-flow)
6. [Database](#database)
7. [Metabase & the Cloudflare Tunnel](#metabase--the-cloudflare-tunnel)
8. [Dashboard Pages](#dashboard-pages)
9. [Filtering System](#filtering-system)
10. [KPI Cards](#kpi-cards)
11. [Dashboard Tables](#dashboard-tables)
12. [Metabase Visualization State](#metabase-visualization-state)
13. [Backend / API](#backend--api)
14. [Environment Configuration](#environment-configuration)
15. [Deployment Guide](#deployment-guide)
16. [Local Development Guide](#local-development-guide)
17. [Verification Checklist](#verification-checklist)
18. [Troubleshooting](#troubleshooting)
19. [Security](#security)
20. [Known Limitations](#known-limitations)
21. [Project Structure](#project-structure)
22. [Git / GitHub Workflow](#git--github-workflow)

---

## Overview

The system gives barangay staff (BADAC administrators, encoders, and read-only users) a single place to record incidents, review statistics, and analyse crime trends.

Analytics are produced in two complementary ways, and the distinction matters when reading this document:

| Layer | Produces | Runs |
|---|---|---|
| **React** | KPI cards, dashboard tables, Chart.js visuals, CSV/PDF export | In the browser, over records already loaded from the API |
| **Metabase** | Embedded chart dashboards | In Metabase, querying PostgreSQL directly |

Both layers are driven by the **same React FilterBar**. The React filter state is the single user-facing source of truth; Metabase's own filter widgets are hidden inside the embed.

---

## Key Features

- Incident recording, mapping, and audit logging
- Role-based access control (Administrator / Encoder / BADAC read-only)
- Crime Reporting Dashboard with 10 KPI cards and 4 tables computed in React
- Embedded Metabase dashboards for Crime, Statistical Analysis, and Trend Detection
- One shared filter bar per module driving both React and Metabase content
- Server-signed JWT embedding — the Metabase secret never reaches the browser
- Light and dark application themes
- Print/PDF export with a self-describing "filters applied" summary

---

## System Architecture

Four independent services. Each is deployed and configured separately.

```
                    ┌──────────────────────────────────┐
   Browser ────────▶│  Vercel  (React + Vite, static)  │
                    │  crime-data-analytics-ebon       │
                    └───────┬──────────────────┬───────┘
                            │                  │
              Bearer JWT    │                  │  direct sign-in
              over HTTPS    │                  │  (publishable key)
                            ▼                  ▼
        ┌───────────────────────────┐   ┌──────────────────────┐
        │  Render (Docker)          │   │  Supabase Auth       │
        │  Laravel 12 API           │   │  issues ES256 JWTs   │
        │  ...backend.onrender.com  │   └──────────┬───────────┘
        └────┬──────────────────┬───┘              │
             │                  │                  │ JWKS public keys
             │ SQL              │ signs embed URL  │ (verification)
             ▼                  ▼                  │
   ┌────────────────────┐  ┌──────────────────────┴──────────┐
   │ Supabase           │  │ Metabase (LOCAL computer)       │
   │ PostgreSQL         │◀─┤ reached via Cloudflare tunnel   │
   │ incidents, etc.    │  │ ⚠ temporary / demo only         │
   └────────────────────┘  └─────────────────────────────────┘
```

**Two things worth noting about this diagram:**

1. The browser talks to **Supabase directly** for sign-in, and to **Laravel** for everything else. Laravel never sees a password.
2. The **browser**, not Render, loads the Metabase iframe. Laravel only builds and signs the URL string — it never makes an HTTP request to Metabase. This is why Render does not need network access to the local computer.

---

## Technology Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Frontend | React | 19 |
| Build tool | Vite | 8 |
| Routing | react-router-dom | 7 (client-side; needs SPA rewrite) |
| Charts (React) | Chart.js | 4 |
| Maps | Leaflet + markercluster + heat | — |
| Frontend host | Vercel | Free / Hobby tier |
| Backend | Laravel | 12 (PHP 8.2) |
| Web server | nginx + php-fpm | inside the Docker image |
| Backend host | Render | Free tier, Docker runtime, Singapore region |
| Database | Supabase PostgreSQL | via connection pooler, SSL required |
| Auth | Supabase Auth | ES256 / JWKS signing keys |
| BI / charts | Metabase OSS | v0.63.14, local Docker, H2 application database |
| Tunnel | Cloudflare quick tunnel | ⚠ temporary, see below |

---

## Authentication Flow

Supabase Auth is the **only** authentication system. Laravel has no login route, no password handling, and no session cookie — it is a stateless Bearer-token API.

```
1. User submits email + password on the React login page
        │
        ▼
2. Browser → Supabase Auth  (POST /auth/v1/token?grant_type=password)
   Sent with the PUBLISHABLE key (VITE_SUPABASE_PUBLISHABLE_KEY)
        │
        ▼
3. Supabase returns an access token (a JWT signed with ES256)
        │
        ▼
4. Browser → Laravel  (GET /api/user)
   Header:  Authorization: Bearer <access token>
        │
        ▼
5. Laravel verifies the token via JWKS:
     • fetches {SUPABASE_URL}/auth/v1/.well-known/jwks.json  (cached 1 hour)
     • verifies the signature against the published public keys
     • checks  aud = "authenticated"  and  iss = {SUPABASE_URL}/auth/v1
        │
        ▼
6. Laravel maps the token's `sub` claim to an EXISTING local user row.
   It never creates accounts — every user is admin-provisioned.
        │
        ▼
7. Login completes and the dashboard loads.
```

**Terms explained**

- **JWT** — a signed token proving who the user is. It can be verified without contacting the issuer.
- **JWKS** — "JSON Web Key Set": a public URL publishing the public halves of the signing keys. Laravel uses these to verify signatures.
- **Publishable key** — the public, browser-safe Supabase API key (`sb_publishable_…`). It identifies the project; it does **not** grant privileges by itself. It replaced the older "anon key", which was permanently disabled when the project migrated to JWT signing keys.

**Important:** because step 4 is required for login to complete, **the Laravel API must be reachable or sign-in fails**, even when Supabase authentication itself succeeds.

The legacy shared-secret verification path (`SUPABASE_JWT_SECRET`) is intentionally left **empty**. The legacy secret was revoked during the migration to JWKS; leaving the variable blank disables the fallback entirely, which is the desired state.

---

## Database

**Supabase PostgreSQL**, reached through the connection pooler with `sslmode=require`. Laravel and Metabase both connect to this same database, using **separate credential configurations**.

### Key tables

| Table | Role |
|---|---|
| `incidents` | The core record. One row per reported crime incident. Holds `incident_code`, `case_number`, `crime_type`, `category`, `incident_date`, `incident_time`, location (`street`, `sitio`, `latitude`, `longitude`), victim and suspect fields, officer/unit fields, `status`, `priority`, `description`, `evidence`, and `synced_at`. Every KPI, table, and Metabase chart reads from here. |
| `sync_logs` | An audit trail of data-import runs. Columns: `status`, `records_received`, `source`, `created_at`. Feeds the "Today Imported" / "Month Imported" KPI cards. |
| `settings` | A single configuration row for the barangay: `barangay`, `population`, `threshold`, `hotspot_threshold`, `categories`. `population` is the denominator for the Crime Rate / 1K KPI. |

Supporting tables include `users`, `criminals`, `victims`, `incident_victim`, `audit_logs`, `app_notifications`, plus Laravel's own `sessions`, `cache`, and `jobs`.

**Archiving, not deleting.** Records are archived by setting `status = 'Archived'` rather than being removed. Every statistic excludes archived rows.

---

## Metabase & the Cloudflare Tunnel

> ⚠️ **This is the most fragile part of the system and is explicitly a development/demo arrangement, not production infrastructure.**

### How it is set up

Metabase OSS v0.63.14 runs in Docker **on a local computer**:

- Application database: an **H2 file** in the Docker volume `metabase-data`, mounted at `/metabase.db`. This single file holds every dashboard, question, visualization setting, series colour, parameter mapping, and the embedding secret. **Back it up before changing anything in Metabase.**
- Data source: the **same Supabase PostgreSQL database** the Laravel API uses, configured separately inside Metabase under *Admin → Databases*.

### How the deployed site reaches it

A **Cloudflare quick tunnel** publishes `http://localhost:3000` at a public `https://<random>.trycloudflare.com` address. That address is stored in the Render environment variable `METABASE_SITE_URL`, and Laravel puts it into the signed embed URL that the browser loads.

```
Browser (Vercel page)
   │  iframe src = https://<random>.trycloudflare.com/embed/dashboard/<signed JWT>#...
   ▼
Cloudflare quick tunnel  ──▶  cloudflared process  ──▶  localhost:3000 (Metabase)
```

### Why this is temporary

| Limitation | Consequence |
|---|---|
| Quick tunnels get a **new random hostname every restart** | `METABASE_SITE_URL` must be updated in Render and the charts break until it is |
| The tunnel dies with the `cloudflared` process | Closing the terminal, sleeping, or rebooting takes the charts offline |
| The host computer must stay awake and online | Charts fail during the demo if the laptop sleeps |
| No uptime guarantee | Cloudflare may drop an anonymous tunnel at any time |

A permanent deployment would host Metabase on a server with a stable hostname (a named Cloudflare tunnel with a domain, or a cloud host), carrying the H2 file across so dashboard IDs and questions are preserved.

### Re-pointing after the tunnel restarts

1. Start it again: `cloudflared tunnel --url http://localhost:3000` and copy the new hostname.
2. Metabase → **Admin → Settings → Site URL** → paste the new hostname.
3. Render → **Environment** → update `METABASE_SITE_URL`.

Render restarts the service automatically, and the container entrypoint rebuilds the configuration cache from the new environment — **no rebuild or redeploy is needed**.

### How Laravel signs the embed URL

`App\Services\MetabaseEmbedService` builds a short-lived JSON Web Token:

```
payload = { resource: { dashboard: <id> }, params: { …locked filter values… }, exp: now + 10 min }
token   = HS256(payload, METABASE_EMBEDDING_SECRET_KEY)
url     = {METABASE_SITE_URL}/embed/dashboard/{token}#bordered=false&titled=false&theme=transparent&hide_parameters=…
```

The signing secret is read **only** on the backend and is never sent to the browser. The frontend calls `GET /api/embed/metabase/{key}` and receives only the finished URL.

### Dashboard IDs

| Key | Dashboard | ID |
|---|---|---|
| `crime` | Crime Dashboard | **2** |
| `analytics` | Crime Analytics | **3** |
| `trends` | Crime Trends | **4** |

These IDs live inside the Metabase H2 file. Recreating Metabase from scratch would assign different IDs and break the embed.

---

## Dashboard Pages

| Page | Route | Metabase dashboard | Filter prefix |
|---|---|---|---|
| Crime Reporting Dashboard | `/dashboard` | 2 (`crime`) | `dash-` |
| Statistical Analysis | `/analytics` | 3 (`analytics`) | `ana-` |
| Trend & Pattern Detection | `/trends` | 4 (`trends`) | `tr-` |

Each page renders its own KPI/table/chart content in React **and** an embedded Metabase dashboard below it, both driven by the same filter bar.

---

## Filtering System

### Available filters

| Filter | Dashboard | Analytics | Trends |
|---|---|---|---|
| Date Range (From / To) | ✅ | ✅ | ✅ |
| Crime Type | ✅ | ✅ | ✅ |
| Sitio | ✅ | ✅ | ✅ |
| Status | ✅ | ✅ | ✅ |
| Category | ✅ | ✅ | ✗ (by design) |

### How React and Metabase filters are connected

Each page namespaces its filter state with a prefix (`dash-`, `ana-`, `tr-`) and then flattens it to a shared shape before sending it onward:

```
React FilterBar
   │  filters['dash-sitio'] = "Sitio 3"
   ▼
baseFilters  { dateFrom, dateTo, crimeType, sitio, status, category }
   │                                    │
   │ React side                         │ Metabase side
   ▼                                    ▼
filterRecords()                  GET /api/embed/metabase/{key}?sitio=Sitio+3
(client-side, drives                     │
 KPIs, tables, Chart.js)                 ▼
                              MetabaseEmbedController::buildLockedParams()
                                 • dateFrom + dateTo → date_range "from~to"
                                 • crimeType → crime_type, sitio → sitio,
                                   status → status, category → category
                                         │
                                         ▼
                              signed embed URL → iframe reloads
```

**Cleared filters mean "show everything."** An empty value is omitted entirely from the parameters sent to Metabase — it is never sent as an empty string, which would filter for blank values and return nothing. This behaviour is verified as part of the checklist below.

Metabase's own filter widgets are hidden inside the iframe (`hide_parameters` in the embed URL) so the React FilterBar remains the only filtering interface a user sees.

---

## KPI Cards

Computed in React in `src/pages/Dashboard.jsx`, over records already filtered by the FilterBar. `filtered` always excludes `status = 'Archived'`.

| KPI | Formula | Meaning |
|---|---|---|
| **Total Incidents** | `filtered.length` | All non-archived incidents in the current filter range |
| **Solved Cases** | count where status ∈ `['Solved', 'Closed']` | Cases no longer being worked |
| **Pending Cases** | count where status ∈ `['Open', 'Under Investigation']` | Cases still requiring action |
| **Active Investigations** | count where `status === 'Under Investigation'` | The subset actively being investigated |
| **Resolution Rate** | `(solved / total) × 100`, 1 decimal | Percentage of cases resolved; `0` when total is 0 |
| **Crime Rate / 1K** | `(total / settings.population) × 1000`, 2 decimals | Incidents per 1,000 residents; `0` when population is unset |
| **Today's Incidents** | count where `date === today()` | Incidents recorded today |
| **This Month** | count where date starts with the current `YYYY-MM` | Incidents recorded this calendar month |

### Synchronisation KPIs

Still present in the current implementation. These read `sync_logs`, **not** `incidents`, and are deliberately **independent of the date-range filter** — they report import activity, not crime activity.

| KPI | Source |
|---|---|
| **Today Imported** | Sum of `records_received` from sync logs since midnight today |
| **Month Imported** | Sum of `records_received` from sync logs since the 1st of this month |

**Layout note:** the cards are split into a primary row (Total, Solved, Pending, Resolution Rate) and a secondary row (everything else). This is a visual grouping only — no calculation differs.

---

## Dashboard Tables

Four tables, all computed in React from the same filtered record set:

| # | Table | Contents |
|---|---|---|
| 1 | **Recent Incidents** | The 8 most recent, sorted by date then time descending |
| 2 | **Hotspots** | Top 8 sitios by incident count |
| 3 | **Repeat Suspects** | Suspects appearing more than once, top 8 by count |
| 4 | **Recently Synced** | The 5 most recent records carrying a `synced_at` timestamp |

---

## Metabase Visualization State

Verified current state. All 17 cards across the three dashboards return data.

| Question | Name | Chart type | Notes |
|---|---|---|---|
| **Q40** | Crime by Type | **Bar** | Ordinal x-axis |
| **Q44** | Crime by Status | **Bar** | Single green series |
| **Q49** | Monthly Incident Trend | **Line** | Ordinal x-axis — every month labelled |
| **Q50** | Crime Trend by Type | **Line** | 12 crime-type series, each with its own colour |
| **Q74** | Weekly Incident Trend | **Line** | Timeseries x-axis (weekly data is too dense for ordinal) |
| **Q77** | Crime by Sitio Trend | **Waterfall** | 7 Sitio series colours; Total column intentionally shown |

### Why the monthly charts use an "Ordinal" x-axis

With Metabase's default **Timeseries** scale, the renderer computes a tick interval and skips labels when they crowd — monthly charts displayed only every second month (January, March, May…). Switching `graph.x_axis.scale` to **Ordinal** makes the axis categorical, which renders one label per data point and auto-rotates them when space is tight.

Applied to **Q49, Q50, and Q77** only. Q74 stays on Timeseries deliberately: it has roughly 47 weekly points, and forcing every label would be unreadable.

### Colour palette

The project uses a fixed palette rather than Metabase's defaults — chiefly `#2E8B47` (green), plus orange, sky, red, indigo, and slate for multi-series charts. Metabase's default blue `#509EE3` should not appear anywhere; its presence indicates a series lost its configured colour.

---

## Backend / API

Laravel 12, served by **nginx + php-fpm** inside a single Docker image.

- All API routes are prefixed `/api` and protected by the `auth:supabase` guard, with role middleware (`role:…`) on top.
- `GET /up` is Laravel's built-in health route, used by Render's health check. It is **not** under `/api`, so it is not subject to CORS.
- `GET /api/embed/metabase/{key}` returns `{ "url": "…" }` — the signed Metabase embed URL. Restricted to BADAC administrator and read-only roles.

### CORS

Configured in `backend/config/cors.php`:

```php
'paths' => ['api/*'],
'allowed_origins' => array_values(array_unique(array_filter(array_merge(
    [env('FRONTEND_URL', 'http://localhost:5173')],
    array_map('trim', explode(',', env('CORS_ALLOWED_ORIGINS', '')))
)))),
'supports_credentials' => false,
```

Origins come **entirely from the environment** — no deployment URL is hardcoded. `supports_credentials` is `false` because the API is Bearer-token only, with no cookies to protect. Multiple origins may be supplied as a comma-separated list.

### Container start-up

`backend/docker/entrypoint.sh` runs on every container start and:

1. Renders the nginx config, substituting `${PORT}` (supplied by Render).
2. **Only when `APP_ENV=production`**, runs `config:clear`, `config:cache`, and `route:cache` — building the cache from the **runtime** environment.
3. Recreates the `storage:link` symlink (non-fatal if it already exists).
4. Starts php-fpm on `127.0.0.1:9001`, then nginx in the foreground.

**Why caching happens at start-up, not build time.** A Docker build has no environment variables, so caching configuration during the build would store `null` for every value — and a cached config file overrides `env()` at runtime. Building the cache at start-up means it reflects the real injected environment. The `APP_ENV` guard exists because `docker-compose` bind-mounts the source directory for local development, and a cached config file there would contain resolved secrets in the working tree.

---

## Environment Configuration

> **No secret values appear in this file, and none may be committed to Git.** See [Security](#security).

### Frontend (Vercel, and local `.env`)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Laravel API base URL, **including the `/api` suffix** |
| `VITE_SUPABASE_URL` | Supabase project URL (`https://<project-ref>.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public Supabase key (`sb_publishable_…`) |

All three are **build-time** values — see [Deployment Guide](#deployment-guide).

### Backend (Render, and local `backend/.env`)

| Variable | Purpose |
|---|---|
| `APP_ENV` | `production` on Render, `local` for development. Gates config caching. |
| `APP_DEBUG` | Must be `false` in production — debug pages leak environment values |
| `APP_KEY` | Laravel encryption key |
| `APP_URL` | Public backend URL |
| `APP_TIMEZONE` | `Asia/Manila` |
| `LOG_LEVEL` | `error` in production |
| `FRONTEND_URL` | Vercel origin — drives CORS |
| `CORS_ALLOWED_ORIGINS` | Additional allowed origins, comma-separated |
| `DB_CONNECTION` … `DB_SSLMODE` | Supabase PostgreSQL connection (pooler host, `require`) |
| `SESSION_*`, `CACHE_STORE`, `QUEUE_CONNECTION` | Framework settings |
| `SUPABASE_URL` | Used for JWKS discovery **and** the token issuer check — required |
| `SUPABASE_PROJECT_ID` | Project reference |
| `SUPABASE_JWT_SECRET` | **Intentionally empty** — legacy path disabled, JWKS is used |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional; only enables the admin "reset another user's 2FA" action |
| `METABASE_SITE_URL` | Public Metabase URL (currently the Cloudflare tunnel) |
| `METABASE_EMBEDDING_SECRET_KEY` | Signs embed JWTs — backend only, never in a `VITE_*` variable |
| `METABASE_DASHBOARD_ID_CRIME/ANALYTICS/TRENDS` | `2` / `3` / `4` |
| `MAIL_*` | Defaults to the `log` driver; no auth flow sends mail from Laravel |

**`PORT` must not be set manually.** Render injects it automatically and the entrypoint reads it. Adding it by hand breaks the nginx binding.

---

## Deployment Guide

```
Vercel  ──▶  Render  ──▶  Supabase
                          
Browser ──▶  Cloudflare tunnel ──▶ local Metabase ──▶ Supabase
```

### 1. Frontend → Vercel

- Source: the GitHub repository, branch `main`
- `vercel.json` declares framework (`vite`), build command (`npm run build`), output directory (`dist`), and the SPA rewrite
- The **SPA rewrite** (`/(.*)` → `/index.html`) is required because routing is client-side — without it, opening `/dashboard` directly returns 404
- Set the three `VITE_*` variables for **Production, Preview, and Development**

### 2. Backend → Render

| Setting | Value |
|---|---|
| Service type | Web Service |
| Name | `crime-data-analytics-backend` |
| Runtime | **Docker** |
| Root directory | `backend` |
| Dockerfile path | `./Dockerfile` |
| Branch | `main` |
| Region | Singapore |
| Health check path | `/up` |
| Build / start command | *(leave empty — the Dockerfile's `CMD` runs the entrypoint)* |

Add the backend variables through Render's **Environment** tab. Do not add `PORT`.

### 3. How Vite environment variables work

Vite **inlines** `VITE_*` values into the JavaScript bundle when the site is built. They are not read at runtime.

> **Therefore: changing a `VITE_*` variable in Vercel does nothing until you redeploy.** This is the single most common deployment mistake on this project.

Two consequences:
- Anything in a `VITE_*` variable is publicly readable in the shipped bundle. Only public values belong there.
- After updating `VITE_API_URL`, trigger a new deployment.

### 4. How Render environment variables work

Render variables are **runtime** values, read by the container entrypoint on every start. Editing one restarts the service, and the entrypoint rebuilds the config cache from the new values — no rebuild required.

### 5. CORS for the production origin

Set `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` on Render to the exact Vercel origin — scheme included, **no trailing slash, no path**:

```
https://crime-data-analytics-ebon.vercel.app
```

Use the **stable production alias**. Vercel also issues a unique per-deployment URL for every build; those change on every push and are not in the allow-list.

### Deployment order

Because the two hosts reference each other, deploy in this order:

1. Push to `main`
2. Deploy the frontend to Vercel (a placeholder API URL is fine initially)
3. Note the production Vercel URL
4. Deploy the backend to Render, setting `FRONTEND_URL` / `CORS_ALLOWED_ORIGINS` to that URL
5. Set `VITE_API_URL` in Vercel to the Render URL **+ `/api`**, then **redeploy Vercel**
6. Add the Vercel origin to Supabase → Authentication → URL Configuration
7. Start the Cloudflare tunnel and set `METABASE_SITE_URL` in Render

---

## Local Development Guide

### Prerequisites

- Node.js 22+
- PHP 8.2+ with `pdo_pgsql`
- Composer 2
- Docker Desktop (for Metabase)
- A Supabase project

### Frontend

```bash
npm install
cp .env.example .env        # then fill in the three VITE_* values
npm run dev                 # http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint` (oxlint).

> Vite reads `.env` **at start-up**. After editing it, restart the dev server.

### Backend

```bash
cd backend
composer install
cp .env.example .env        # then fill in DB, Supabase and Metabase values
php artisan key:generate
php artisan migrate         # only on a fresh database
php artisan serve           # http://localhost:8000
```

Useful commands:

```bash
php artisan route:list --path=up   # confirm the health route
php artisan config:clear           # after editing .env
php artisan view:clear             # clear compiled Blade caches
php artisan test                   # 74 tests, in-memory SQLite
```

> If `.env` changes seem to have no effect, a stale configuration cache is the usual cause. Run `php artisan config:clear`.

### Metabase

```bash
docker start metabase              # existing container, http://localhost:3000
```

Metabase stores everything in the `metabase-data` Docker volume. **Back it up before making changes:**

```bash
docker stop metabase
docker run --rm -v metabase-data:/data -v "<backup-dir>":/backup \
  alpine tar czf /backup/metabase-h2-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
docker start metabase
```

Metabase must be stopped during the copy — H2 database files can be corrupted if copied while open. Metabase serves HTTP 503 for the first ~30 seconds after starting.

### Docker Compose (optional)

`docker-compose.yml` builds the frontend and backend containers for local use. It is **not** used for production deployment; Vercel and Render build from the repository directly.

### Supabase

Add `http://localhost:5173/login` and `/reset-password` to Supabase → Authentication → URL Configuration, or local sign-in will be rejected.

---

## Verification Checklist

Run through this before a demo. Starred items are worth re-checking on the day.

### Infrastructure

- [ ] ★ Vercel frontend loads at `https://crime-data-analytics-ebon.vercel.app`
- [ ] Deep links (`/dashboard`, `/analytics`, `/trends`) load directly — confirms the SPA rewrite
- [ ] ★ `GET /up` on Render returns **200**
- [ ] ★ Production API is reachable from the browser
- [ ] ★ Supabase project is **active**, not paused
- [ ] ★ Cloudflare tunnel responds and matches `METABASE_SITE_URL` in Render

### Authentication

- [ ] ★ Login succeeds with a real account
- [ ] Supabase returns 200 on the token request
- [ ] `GET /api/user` returns the user after authentication
- [ ] No CORS errors in the browser console
- [ ] CORS preflight from the production Vercel origin returns the **matching** `Access-Control-Allow-Origin`

### Data & dashboards

- [ ] ★ KPI cards show real figures, not zeros or blanks
- [ ] All four dashboard tables populate
- [ ] ★ All three Metabase dashboards render — no "not available right now" card
- [ ] **17 / 17** Metabase cards return data
- [ ] Dashboard IDs are still 2 / 3 / 4

### Filters

- [ ] ★ Date Range narrows both charts and tables
- [ ] Crime Type, Sitio, and Status each filter correctly
- [ ] Category filters on the Analytics page
- [ ] ★ **Clearing every filter restores the full dataset**

### Visualization types

- [ ] Q40 Bar · Q44 Bar · Q49 Line · Q50 Line · Q74 Line · Q77 Waterfall
- [ ] Q50 shows 12 series; Q77 shows 7 Sitio colours
- [ ] Metabase's default blue `#509EE3` appears nowhere

### Security

- [ ] ★ No secrets committed — `git status` clean, no `.env` tracked

---

## Troubleshooting

### "Sign-in is not configured. Please contact your Administrator."

**Symptom** — the message appears immediately; no network request to Supabase.
**Cause** — `isSupabaseConfigured` is false, meaning `VITE_SUPABASE_URL` **or** `VITE_SUPABASE_PUBLISHABLE_KEY` was missing at build time.
**Fix** — confirm both are set in Vercel for the right environment, then **redeploy**. Verify by checking the deployed bundle contains the real project URL rather than `placeholder.supabase.co`.

### "Invalid email or password" when the password is correct

**Symptom** — Supabase returns 401.
**Cause** — usually the **API key**, not the credentials. Legacy `anon` keys are permanently disabled once a project migrates to JWT signing keys. The frontend maps any 400/401 to this message, so a disabled key looks like a wrong password.
**Fix** — use the new publishable key (`sb_publishable_…`) in `VITE_SUPABASE_PUBLISHABLE_KEY`, then redeploy.

### "Unable to sign in right now. Please try again."

**Symptom** — Supabase authentication returns 200, then `GET /api/user` fails.
**Cause** — the frontend cannot reach the Laravel API. Most often `VITE_API_URL` is unset and falling back to `http://localhost:8000/api`, which is blocked as mixed content and points at the *viewer's* machine.
**Fix** — set `VITE_API_URL` to the Render URL **+ `/api`** and redeploy. Confirm the bundle contains `onrender.com` and not `localhost:8000`.

### CORS error on `/api/user`

**Symptom** — DevTools shows a CORS failure; the response carries an `Access-Control-Allow-Origin` that does not match the page origin.
**Cause** — you are browsing a **per-deployment** Vercel URL (`…-<hash>-<team>.vercel.app`) rather than the production alias. Only the alias is in the allow-list.
**Fix** — use `https://crime-data-analytics-ebon.vercel.app`. Chasing per-deployment URLs is futile: the hash changes on every push.

### Vercel environment variable "not applying"

**Symptom** — a variable is set in Vercel, but the deployed site behaves as if it were missing.
**Cause** — either the variable is not enabled for the environment being built, or the site was not rebuilt after the change.
**Fix** — tick **Production, Preview, and Development**, then redeploy. `VITE_*` values are compiled in; saving alone changes nothing.

### Render `/up` returns 404

**Symptom** — the deploy shows healthy logs, but the health URL 404s.
**Cause** — almost always **timing**. Render's edge returns a plain 404 for an `onrender.com` hostname until the first deploy is routed, and during cold starts.
**Fix** — wait and retry. If it persists, confirm the health check path is `/up` and that the logs show all four `[entrypoint]` lines. A genuine nginx misconfiguration would produce nginx's own 404 page rather than Laravel's.

### Laravel config cache serving stale values

**Symptom** — an environment change has no effect.
**Cause** — a cached config file overrides `env()`.
**Fix** — locally, `php artisan config:clear`. On Render, simply restart: the entrypoint rebuilds the cache from the current environment on every start.

### Metabase charts fail with "password authentication failed"

**Symptom** — every Metabase card errors with `unable-to-acquire-connection`. Repeated failures may escalate to `ECIRCUITBREAKER … too many authentication failures`.
**Cause** — the Supabase database password was rotated. **Metabase stores its own copy of the credentials**, separate from `backend/.env`.
**Fix** — Metabase → **Admin → Databases** → the PostgreSQL connection → update the password → Save. Rotating that password requires updating **three** places: `backend/.env`, Metabase's connection, and Render's `DB_PASSWORD`. If the circuit breaker has tripped, allow a few minutes before retrying.

### Rotating the Metabase embedding secret

**When** — if the secret is ever exposed.
**How** — Metabase → **Admin → Settings → Embedding → Static embedding** → regenerate, then update `METABASE_EMBEDDING_SECRET_KEY` in `backend/.env` and Render.
**Effect** — existing signed URLs stop working immediately, which is harmless given the 10-minute token lifetime. Dashboards, questions, visualization settings, and colours are **not** affected.
**Afterwards** — take a fresh H2 backup; older archives contain the previous secret.

### Charts stop loading but KPIs and tables still work

**Cause** — the Cloudflare tunnel died or changed hostname. Laravel is fine; only the iframe target is unreachable.
**Fix** — restart the tunnel and re-point `METABASE_SITE_URL` (see [Metabase & the Cloudflare Tunnel](#metabase--the-cloudflare-tunnel)).

### A Metabase chart shows the wrong visualization type

**Symptom** — a chart appears as Area or Bar when it should be Line, or months are skipped on the x-axis.
**Cause** — the chart type was changed accidentally in the Metabase UI. The type picker sits beside the Axes panel, and switching it preserves dimensions, metrics, and colours — so only the display type changes and it is easy to miss.
**Fix** — open the question, set the correct type from the [visualization table](#metabase-visualization-state), confirm the x-axis Scale is unchanged, and save. If months are being skipped, the Scale is `timeseries` and should be `ordinal`.

### Files appearing under `backend/storage/framework/views`

**Symptom** — unfamiliar `.php` files with hashed names keep showing in `git status`; editors may flag them.
**Cause** — these are **Laravel-generated compiled Blade caches**, not source files. They are regenerated automatically.
**Fix** — never edit them by hand. Clear them with `php artisan view:clear`. The directory carries a `.gitignore` (`*` plus `!.gitignore`) so its contents are ignored while the directory itself stays in the repository — Laravel errors with "Please provide a valid cache path" if the directory is missing.

---

## Security

**Secrets must never be committed to GitHub.** `.env` files are git-ignored and must stay that way.

### What lives where

| Secret | Where it belongs | Never |
|---|---|---|
| Database password | `backend/.env`, Render, Metabase's own connection | In the repo or any `VITE_*` variable |
| `APP_KEY` | `backend/.env`, Render | In the repo |
| `METABASE_EMBEDDING_SECRET_KEY` | `backend/.env`, Render | In the browser or any `VITE_*` variable |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env`, Render (optional) | **Absolutely never** in frontend code |
| `SUPABASE_JWT_SECRET` | Intentionally empty | — |
| Supabase **publishable** key | `.env`, Vercel — public by design | Confusing it with the secret key |

### Why the publishable key is different

`VITE_*` values are compiled into the JavaScript bundle and are readable by anyone who opens the site. The publishable key is designed for that: it identifies the project without granting privileges. Row-level security and Supabase Auth enforce access. **Never** put a service-role key, database password, or embedding secret in a `VITE_*` variable.

### Supabase JWT verification

The backend verifies access tokens against the project's **JWKS** endpoint using the published ES256 public keys. `SUPABASE_JWT_SECRET` is deliberately blank: the legacy shared secret was revoked, and leaving the variable empty disables the older verification path entirely, so a leaked legacy secret could not be used to forge tokens.

### If a secret is exposed

1. Treat it as compromised — rotate it, do not merely remove it from view.
2. Rotate at the source (Supabase dashboard, Metabase admin, `php artisan key:generate`).
3. Update every consumer: `backend/.env`, Render, and — for the database password — Metabase's connection.
4. Remember that rotating the database password breaks Metabase until its connection is updated too.

### Handling environment files

- Never paste a full `.env` into a chat, an issue, or a third-party tool.
- Never commit generated files that contain resolved secrets. `bootstrap/cache/config.php` holds every value in plaintext and is git-ignored for this reason.
- Prefer typing values directly into the Vercel and Render dashboards.

---

## Known Limitations

### Demo/pre-oral dependencies

- **Metabase runs on a local computer behind a temporary Cloudflare tunnel.** Charts require that machine to be awake, online, and running `cloudflared`. The hostname changes whenever the tunnel restarts.
- **Render's free tier idles out** after roughly 15 minutes and takes ~50 seconds to wake. Load the site a few minutes before presenting.
- **Supabase free projects pause after about 7 days of inactivity.** Open the app at least twice a week, and check the day before a demo.
- **Uploaded avatars do not survive redeploys** — they are written to a container filesystem that Render discards on each deploy.

### Metabase OSS (no Enterprise whitelabeling)

- Metabase typography is fixed (Lato) and **does not match** the application's Manrope/Inter type.
- Axis labels, gridlines, tick marks, legends, tooltips, and the loading state keep Metabase's own styling — they cannot be themed in OSS.
- No custom application colours, logo, or loading text.
- Embedded charts do not follow the application's dark-mode toggle; the theme is fixed at URL-generation time.

### Functional

- *Crime by Status* cannot show semantic per-status colours while it remains a single-series bar chart.
- **Dashboard 2's `sitio` parameter returns no rows.** The parameter is declared and mapped, but on Dashboard 2 it targets the same field as `crime_type`, so filtering by Sitio yields 0 there while Dashboards 3 and 4 behave correctly. Needs correcting in the Metabase UI. React-side Sitio filtering is unaffected.
- Trend Detection has no Category filter by design.
- Metabase's waterfall chart type officially supports a single dimension; Q77 supplies two. This is an accepted, intentional configuration.

---

## Project Structure

```
.
├── src/                        React application
│   ├── components/             UI, layout, charts, MetabaseDashboard
│   ├── context/                Auth, Data, Theme, Toast providers
│   ├── lib/supabaseClient.js   Supabase client (publishable key)
│   ├── pages/                  Dashboard, Analytics, Trends, Records, …
│   ├── services/               api.js + one module per API area
│   └── utils/                  helpers, constants, chart insights
├── backend/                    Laravel 12 API
│   ├── app/
│   │   ├── Http/Controllers/Api/   including MetabaseEmbedController
│   │   ├── Http/Middleware/        EnsureRole, EnsureSupabaseAal2, audit log
│   │   └── Services/               MetabaseEmbedService, SupabaseTokenValidator
│   ├── config/                 cors.php, metabase.php, supabase.php, …
│   ├── docker/                 nginx template, php-fpm pool, entrypoint.sh
│   ├── routes/api.php          all API routes
│   └── Dockerfile              nginx + php-fpm image used by Render
├── docs/                       supplementary documentation
├── vercel.json                 Vercel build + SPA rewrite
├── docker-compose.yml          local containers (not used in production)
└── README.md
```

---

## Git / GitHub Workflow

```bash
git status
git diff
npm run build          # verify the build before committing
git add -A
git diff --cached
git commit -m "Describe the change"
git push
```

Guidelines used in this repository:

- **Never commit `.env` files, secrets, tokens, or credentials** — they are git-ignored.
- Verify the build before committing.
- Keep changes to filtering, embedding, and data logic separate from presentation-only changes.
- Metabase dashboards, questions, parameters, and mappings live **inside Metabase**, not in this repository — changes there must be made through the Metabase UI and are not captured by git.
- Laravel-generated files (compiled Blade views, config caches) must not be committed.
