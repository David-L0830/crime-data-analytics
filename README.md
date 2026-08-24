# Crime Data Analytics & Reporting System

A crime data analytics and reporting platform for **Barangay 178, North Caloocan**. It combines a React single-page application, a Laravel REST API, a Supabase PostgreSQL database, and embedded Metabase dashboards behind a single set of user-facing filters.

---

## Overview

The system gives barangay staff (BADAC administrators, encoders, and read-only users) a single place to record incidents, review statistics, and analyse crime trends.

Analytics are produced in two complementary ways, and the distinction matters when reading this document:

| Layer | Produces | Runs |
|---|---|---|
| **React** | KPI cards, dashboard tables, Chart.js visuals, CSV/PDF export | In the browser, over records already loaded from the API |
| **Metabase** | Embedded chart dashboards | In Metabase, querying PostgreSQL directly |

Both layers are driven by the **same React FilterBar**. The React filter state is the single user-facing source of truth; Metabase's own filter widgets are hidden in the embed.

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

```
React (Vite SPA)
  └─ FilterBar → page filter state → baseFilters
       ├─ filterRecords()  ──────────────→ React KPI cards, tables, Chart.js
       └─ MetabaseDashboard component
            └─ GET /api/embed/metabase/{dashboardKey}   (Laravel, authenticated)
                 └─ MetabaseEmbedController::buildLockedParams()
                      └─ MetabaseEmbedService  → signed HS256 JWT
                           └─ <iframe> → Metabase dashboard → PostgreSQL
```

Supabase issues the user's access token; Laravel validates it (`auth:supabase`) and enforces roles before returning any signed embed URL.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, React Router 7 |
| Charts (React) | Chart.js 4 |
| Mapping | Leaflet 1.9 + markercluster + heat |
| Icons | lucide-react |
| Backend | Laravel 12, PHP 8.2 |
| JWT signing | firebase/php-jwt 7 |
| Database | Supabase (PostgreSQL) |
| BI / Embedding | Metabase **OSS** v0.63.x |
| Auth | Supabase Auth (JWT) |
| Lint | oxlint |

---

## Dashboard Pages

| Route | Page | React analytics | Metabase embed |
|---|---|---|---|
| `/dashboard` | Crime Reporting Dashboard | 10 KPI cards + 4 tables | Dashboard 2 |
| `/analytics` | Statistical Analysis | Stat boxes, statistical measures, crosstab | Dashboard 3 |
| `/trends` | Trend and Pattern Detection | Hotspot panel, trend alerts | Dashboard 4 |
| `/incident-feed` | Incident Feed | — | — |
| `/mapping` | Crime Mapping (Leaflet) | — | — |
| `/criminal-records` | Criminal & Victim Records | — | — |
| `/audit-logs` | Audit Logs | — | — |
| `/user-management` | User Management | — | — |
| `/settings` | Settings | — | — |

---

## Crime Reporting Dashboard

Page order on `/dashboard`:

1. Print header and welcome banner
2. **FilterBar** — From, To, Crime Type, Category, Sitio, Status
3. Print-only "filters applied" summary
4. **KPI section** — a primary row of 4 and an "Additional Statistics" row of 6
5. **Embedded Metabase Dashboard 2**
6. Chart summary modal (drill-down)
7. **Table grid** — four tables in a 2-column layout
8. Export bar — Export PDF, Export Excel (CSV), Print Report

The record set feeding every React KPI and table is built once:

```js
filtered = filterRecords(
  records.filter(r => r.status !== 'Archived'),
  { dateFrom, dateTo, crimeType, category, sitio, status }
)
```

**Archived incidents are excluded before any filter is applied**, so no React KPI or table on this page counts them.

---

## KPI Metrics

All ten cards are calculated **in React**, not by Metabase.

| # | KPI | Formula (current code) | Source |
|---|---|---|---|
| 1 | Total Incidents | `filtered.length` | incidents |
| 2 | Solved Cases | count where status ∈ `SOLVED_STATUSES` = `['Solved','Closed']` | incidents |
| 3 | Pending Cases | count where status ∈ `PENDING_STATUSES` = `['Open','Under Investigation']` | incidents |
| 4 | Resolution Rate | `(solved / total) * 100`, 1 decimal, `0` when total is 0 | incidents |
| 5 | Active Investigations | count where `status === 'Under Investigation'` | incidents |
| 6 | Crime Rate / 1K | `(total / settings.population) * 1000`, 2 decimals; `0` if population unset | incidents + settings |
| 7 | Today's Incidents | count where `r.date === today()` | incidents |
| 8 | This Month | count where `r.date` starts with `today().slice(0,7)` | incidents |
| 9 | Today Imported | `getTodayImportedCount()` | **sync_logs** |
| 10 | Month Imported | `getThisMonthImportedCount()` | **sync_logs** |

Notes:

- KPIs 1–8 use `filtered`, so they respond to all six filters and exclude Archived records.
- **KPIs 9 and 10 are synchronisation metrics.** They sum `recordsReceived` from `sync_logs` entries with status `completed` since the start of today / the current month, and are **deliberately unaffected by the incident filters**.
- Population is read from `settings.population` — it is never hard-coded.
- Layout split: primary row = Total Incidents, Solved Cases, Pending Cases, Resolution Rate. The other six render under "Additional Statistics".
- Every card links to a drill-down (`/incident-feed`, `/analytics`, or `/audit-logs`) carrying the current filters.

---

## Dashboard Tables

All four are rendered in React from the same `filtered` set.

| Table | Grouping / sort | Limit | Columns |
|---|---|---|---|
| **Recent Incidents** | `date` desc, tie-break `time` desc | 8 | Case #, Type, Date, Sitio, Status |
| **Hotspot Locations** | count by `sitio\|street`, count desc | 8 | Location, Sitio, Incidents |
| **Repeat Offenders** | count by `suspectName` where a suspect is recorded, **only counts > 1**, desc | 8 | Suspect, Incidents |
| **Recently Synchronized** | rows having `synced_at`, sorted by `synced_at` desc | 5 | Case #, Type, Date, Synced |

> **Accuracy note:** *Recently Synchronized* lists **incident records that carry a `synced_at` timestamp** — it reads from `filtered`, so it **does** respond to the incident filters. It is not a `sync_logs` table. Only KPIs 9 and 10 read `sync_logs`.

`Synced` is formatted with `toLocaleString('en-PH')`; `Date` uses the shared `formatDate` helper. Empty results render the shared `Table` component's empty state.

---

## Filtering System

Filter fields are namespaced per page, then flattened into a common `baseFilters` object.

| Page | Prefix | Fields |
|---|---|---|
| Dashboard | `dash-` | dateFrom, dateTo, crimeType, **category**, sitio, status |
| Statistical Analysis | `ana-` | dateFrom, dateTo, **category**, crimeType, sitio, status |
| Trend Detection | `tr-` | dateFrom, dateTo, crimeType, sitio, status |

> Trend Detection has **no Category filter**, and Metabase Dashboard 4 correspondingly declares no `category` parameter.

`baseFilters` is sent as query parameters to the Laravel embed endpoint, which converts them into Metabase dashboard parameters in `buildLockedParams()`:

| App filter | Metabase parameter | Notes |
|---|---|---|
| `dateFrom` + `dateTo` | `date_range` | Collapsed into a single `from~to` value |
| `crimeType` | `crime_type` | |
| `sitio` | `sitio` | |
| `status` | `status` | |
| `category` | `category` | Dashboards 2 and 3 only |

Behaviour rules:

- Date comparison is plain `YYYY-MM-DD` string comparison — inclusive on both ends, no timezone conversion.
- A one-sided range is supported: `from~` means "on or after", `~to` means "on or before".
- **Empty filters are omitted entirely.** With nothing selected the JWT carries an empty parameter **object** `{}` (not an array), which Metabase requires.
- The same values feed `filterRecords()` for all React-side content, so both layers always agree.

---

## Metabase Integration

The browser never sees the Metabase embedding secret. The flow is:

1. `MetabaseDashboard` calls `metabaseService.embedUrl(dashboardKey, filters)`
2. → `GET /api/embed/metabase/{dashboardKey}` (requires a valid Supabase token and an allowed role)
3. `MetabaseEmbedController` validates the key against `['crime','analytics','trends']` and builds the parameter map
4. `MetabaseEmbedService` signs an **HS256 JWT** with `METABASE_EMBEDDING_SECRET_KEY` and returns only the finished URL
5. React renders that URL in an `<iframe>` inside the app's own `.card` wrapper

Token payload shape:

```json
{ "resource": { "dashboard": 2 },
  "params":   { "date_range": "2025-01-01~2025-03-31", "crime_type": "Theft" },
  "exp":      1234567890 }
```

Tokens are short-lived (`token_ttl`, default 600 seconds) and are re-fetched whenever the dashboard key or the filters change.

---

## Metabase Dashboards

| Key | Dashboard | ID | Parameters declared |
|---|---|---|---|
| `crime` | Crime Dashboard | **2** | date_range, crime_type, sitio, status, category |
| `analytics` | Statistical Analysis | **3** | date_range, crime_type, sitio, status, category |
| `trends` | Trend Detection | **4** | date_range, crime_type, sitio, status |

IDs come from `METABASE_DASHBOARD_ID_CRIME`, `_ANALYTICS`, and `_TRENDS` in `backend/.env` and are resolved through `backend/config/metabase.php`.

Cards per dashboard:

- **Dashboard 2** — Crime by Type, Crime by Category, Crime by Sitio, Crime by Status, Monthly Incident Trend
- **Dashboard 3** — Crime Type Distribution, Crime Category Distribution, Victim Gender, Victim Age Groups, Crime by Sitio, Crime by Status
- **Dashboard 4** — Monthly Incident Trend, Crime Trend by Type, Weekly Incident Trend, Daily Incident Pattern, Hourly Incident Pattern, Crime by Sitio Trend

---

## Metabase Visualization & Theming

### Embed appearance

Appearance is configured per dashboard key in `backend/config/metabase.php` and appended to the embed URL's **hash fragment**, which Metabase reads client-side. It never reaches the query, so filtering is unaffected.

```
#bordered=false&titled=false&theme=transparent&hide_parameters=<slugs>
```

| Option | Value | Reason |
|---|---|---|
| `bordered` | `false` | The React `.card` wrapper already draws the border |
| `titled` | `false` | The React `<h3>` already provides the heading |
| `theme` | `transparent` | Chart area inherits the app's `--bg-card` in both themes |
| `hide_parameters` | all declared slugs | Prevents a duplicate Metabase filter UI |

### Chart palette

Charts use the application palette from `src/utils/constants.js`, extended conservatively with two existing theme tokens where a chart needs more than four colours:

| Colour | Role |
|---|---|
| `#2E8B47` | Accent green — primary / single-series |
| `#FF8A3D` | Orange |
| `#0EA5E9` | Info blue |
| `#C0392B` | Red |
| `#6366F1` | Indigo (extension) |
| `#94A3B8` | Slate (extension) |

### Per-question configuration

| Question | Type | Visualization configuration |
|---|---|---|
| Crime by Type | bar | single `count` series → `#2E8B47` |
| Crime by Sitio | bar | single `count` series → `#2E8B47` |
| Crime by Status | bar | single `count` series → `#2E8B47` (see note) |
| Monthly Incident Trend | line | single `count` series → `#2E8B47` |
| Victim Age Groups | bar | single `count` series → `#2E8B47` |
| Weekly Incident Trend | line | single `count` series → `#2E8B47` |
| Daily Incident Pattern | bar | single `count` series → `#2E8B47` |
| Hourly Incident Pattern | bar | single `incident_count` series → `#2E8B47` |
| Crime by Category | pie | `pie.colors` per category |
| Crime Category Distribution | pie | `pie.colors` per category (same mapping) |
| Crime Type Distribution | pie | `pie.colors` across 12 crime types |
| Victim Gender | pie | Male `#2E8B47`, Female `#FF8A3D` |
| **Crime Trend by Type** | line | **`graph.dimensions: ["incident_date","crime_type"]`** + 12 per-series colours |
| **Crime by Sitio Trend** | line | **`graph.dimensions: ["incident_date","sitio"]`** + 7 per-series colours |

> **Not just colours.** *Crime Trend by Type* and *Crime by Sitio Trend* also required a **series-breakout dimension fix**. Their queries return a breakout column (`crime_type` / `sitio`), but the visualization listed only `incident_date` as a dimension — Metabase ignores a returned column present in neither `graph.dimensions` nor `graph.metrics`, so both rendered as a single default-blue series. Adding the second dimension is what makes them true multi-series charts.

> **Crime by Status** is a single-series bar chart. Metabase OSS colours bar charts per *series*, not per category, so semantic per-status colours are not available without changing the chart type. It uses the accent green instead.

---

## Backend / API

Laravel 12 REST API under `/api`. All analytics and embed routes require `auth:supabase` plus a role check.

| Endpoint | Purpose |
|---|---|
| `GET /user` | Current authenticated user |
| `GET /dashboard` | Dashboard aggregate data |
| `GET /analytics`, `/analytics/crime-types`, `/analytics/monthly`, `/analytics/locations` | Analytics aggregates |
| `GET /embed/metabase/{dashboardKey}` | **Signed Metabase embed URL** |
| `GET/POST/PUT /incidents`, `/incidents/{id}`, `/incidents/map` | Incident CRUD + map data |
| `GET/POST/PUT /criminals`, `/victims` | Records management |
| `GET /sync-logs` | Synchronisation history |
| `GET /audit-logs` | Audit trail |
| `GET/PUT /users`, `/settings`, `/notifications`, `/me` | Administration |

Key backend files:

```
backend/app/Http/Controllers/Api/MetabaseEmbedController.php   parameter mapping
backend/app/Services/MetabaseEmbedService.php                  JWT signing + URL
backend/config/metabase.php                                    IDs, appearance, hidden params
backend/config/supabase.php                                    Supabase token validation
backend/routes/api.php                                         routes + role middleware
```

---

## Database

Supabase-hosted PostgreSQL. Tables used by the analytics layer include:

| Table | Role |
|---|---|
| `incidents` | Core records — `crime_type`, `category`, `sitio`, `street`, `status`, `incident_date`, `incident_time`, `suspect_name`, victim fields, `synced_at` |
| `sync_logs` | Synchronisation history — `records_received`, `status`, timestamps |
| `settings` | Business configuration including `population` |
| `users`, `criminals`, `victims`, `audit_logs`, `notifications` | Supporting tables |

`status = 'Archived'` marks soft-deleted incidents; archiving updates the row rather than deleting it.

---

## Authentication & JWT Embedding

Two independent JWT mechanisms:

| Purpose | Secret | Where used |
|---|---|---|
| User authentication | `SUPABASE_JWT_SECRET` | Validating Supabase access tokens on every API request |
| Metabase embedding | `METABASE_EMBEDDING_SECRET_KEY` | Signing embed tokens in `MetabaseEmbedService` |

Rules enforced by the current implementation:

- Neither secret is ever exposed to the frontend or placed in a `VITE_*` variable.
- The embed endpoint is role-restricted to Administrator and BADAC read-only.
- The frontend only ever receives the finished URL string.

Roles: **BADAC Administrator** (full access), **Encoder** (data collection), **BADAC** (read-only).

---

## Project Structure

```
├── src/                          React application
│   ├── pages/                    Dashboard, Analytics, Trends, ...
│   ├── components/
│   │   ├── MetabaseDashboard.jsx Signed-iframe embed component
│   │   ├── ui/                   FilterBar, KpiCard, Table, Card, Modal
│   │   └── charts/               Chart.js wrappers + print summaries
│   ├── context/                  Auth, Data, Theme, Toast providers
│   ├── services/                 API wrappers (metabaseService, incidentService, ...)
│   ├── utils/                    helpers.js (filterRecords), constants.js (COLORS)
│   └── styles/                   global.css — theme tokens
├── backend/                      Laravel API
│   ├── app/Http/Controllers/Api/
│   ├── app/Services/
│   ├── config/                   metabase.php, supabase.php, ...
│   └── routes/api.php
├── docs/                         CI/CD and security notes
└── package.json
```

---

## Environment Configuration

Never commit real credentials. `.env` files are git-ignored.

**Frontend — `.env`** (see `.env.example`)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Laravel API base URL |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |

**Backend — `backend/.env`** (see `backend/.env.example`)

| Variable | Purpose |
|---|---|
| `APP_KEY`, `APP_URL`, `APP_TIMEZONE` | Laravel core |
| `DB_*` | PostgreSQL connection |
| `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth |
| `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL` | CORS |
| `METABASE_SITE_URL` | Metabase base URL, no trailing slash |
| `METABASE_EMBEDDING_SECRET_KEY` | Static-embedding secret — **backend only** |
| `METABASE_DASHBOARD_ID_CRIME` | Crime dashboard ID |
| `METABASE_DASHBOARD_ID_ANALYTICS` | Statistical Analysis dashboard ID |
| `METABASE_DASHBOARD_ID_TRENDS` | Trend Detection dashboard ID |

> The four `METABASE_*` variables are **not yet present in `backend/.env.example`** — add them manually when setting up a new environment.

---

## Installation

```bash
git clone https://github.com/David-L0830/crime-data-analytics.git
cd crime-data-analytics

# Frontend
npm install
cp .env.example .env          # then fill in values

# Backend
cd backend
composer install
cp .env.example .env          # then fill in values, including the METABASE_* keys
php artisan key:generate
```

**Metabase setup** — install Metabase OSS, connect it to the same PostgreSQL database, then for each dashboard enable *Static embedding* and publish it. Copy the embedding secret key into `METABASE_EMBEDDING_SECRET_KEY` and the dashboard IDs into the three `METABASE_DASHBOARD_ID_*` variables.

---

## Development

```bash
npm run dev                              # Vite dev server (default :5173)
cd backend && php artisan serve          # Laravel API (default :8000)
```

Metabase runs separately on its own port (`METABASE_SITE_URL`).

---

## Build

```bash
npm run build       # production bundle into dist/
npm run preview     # preview the built bundle
npm run lint        # oxlint
```

---

## Testing / Verification

There is no automated test suite in this repository. Verification is done with the build, the linter, PHP syntax checks, and manual checks against the database.

```bash
npm run build
npm run lint
php -l backend/app/Services/MetabaseEmbedService.php
php -l backend/app/Http/Controllers/Api/MetabaseEmbedController.php
```

When changing filter or embed behaviour, confirm that a filter actually changes the underlying result rather than only returning HTTP 200 — a dashboard can return a successful response while silently ignoring or blanking a parameter.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Analytics dashboard is not configured yet.` (503) | A `METABASE_DASHBOARD_ID_*` variable is missing |
| `Unknown dashboard.` (404) | `dashboardKey` is not one of `crime` / `analytics` / `trends` |
| `Embedding is not enabled for this object.` | Static embedding was never published for that dashboard |
| `You must specify a value for :<slug> in the JWT.` | The parameter is **Locked**; locked parameters require a value on every request and reject `null` |
| `Unknown parameter :<slug>.` | A parameter was sent that the dashboard does not declare |
| A card renders but ignores a filter | The dashboard parameter is not mapped to that card |
| A card returns zero rows under any filter | A slug mismatch, or a mapping targeting the wrong column |
| Chart shows one default-blue series instead of many | The breakout column is missing from `graph.dimensions` |
| Metabase filter widgets visible in the embed | `hide_parameters` missing for that dashboard key |

After changing embed appearance, hard-refresh — the previous embed URL may be cached.

---

## Known Limitations

**Metabase OSS (no Enterprise whitelabeling)**

- Metabase typography is fixed (Lato) and **does not match** the application's Manrope/Inter type.
- Axis labels, gridlines, tick marks, legends, tooltips, and the loading state keep Metabase's own styling — they cannot be themed in OSS.
- No custom application colours, logo, or loading text.
- Embedded charts do not follow the application's dark-mode toggle; the theme is fixed at URL-generation time.

**Functional**

- *Crime by Status* cannot show semantic per-status colours while it remains a single-series bar chart.
- **Dashboard 2's `sitio` parameter currently returns no rows.** The parameter is declared and mapped, but filtering by Sitio yields 0 on Dashboard 2 while Dashboards 3 and 4 return the expected result — the mapping appears to target the wrong column and needs correcting in the Metabase UI. React-side Sitio filtering is unaffected.
- Trend Detection has no Category filter by design.
- No automated test suite.

---

## Git / GitHub Workflow

```bash
git status
git diff
npm run build
git add -A
git diff --cached
git commit -m "Describe the change"
git push
```

Guidelines used in this repository:

- Never commit `.env` files, secrets, tokens, or credentials — they are git-ignored.
- Verify the build before committing.
- Keep changes to filtering, embedding, and data logic separate from presentation-only changes.
- Metabase dashboards, questions, parameters, and mappings live **inside Metabase**, not in this repository — schema or parameter changes there must be applied through the Metabase UI and are not captured by git.
