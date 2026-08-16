# BADAC Crime Analytics — CDARS

Barangay 178 (North Caloocan) Crime Data Analytics and Reporting System.

React + Vite frontend, backed by a Laravel REST API and PostgreSQL/Supabase.

```
React + Vite  --REST API-->  Laravel  --Supabase JWT-->  BADAC Administrator
                                 |
                                 v
                          Eloquent ORM
                                 |
                                 v
                     PostgreSQL / Supabase
```

Authentication is Supabase Auth only (email/password, Google via Supabase's
own OAuth provider, and Supabase MFA) — the Laravel backend never issues a
session cookie or a Sanctum token; it verifies each request's Supabase JWT
via `App\Services\SupabaseTokenValidator`. See `AUTH_MIGRATION_STATUS.md`
and `backend/README.md` for details.

## Project structure

```
badac-crime-analytics/  (this repo)
├── src/            React + Vite frontend (unchanged pages/components/routes/
│                   CSS design system — see below)
├── backend/         Laravel REST API (new)
│   ├── app/          Models, Http/Controllers/Api, Http/Requests, Http/Resources
│   ├── database/      migrations, seeders, factories
│   ├── routes/api.php
│   └── README.md      backend-specific setup/docs
├── package.json     frontend (Vite) package manifest
└── .env.example      VITE_API_URL for the frontend
```

The existing frontend structure, pages, sidebar, charts, mapping, dark mode,
and CSS design system are all preserved as-is. The only frontend changes were
wiring `AuthContext`/`DataContext` to the new `src/services/*.js` API layer
instead of local mock data, and removing the retired demo accounts.

## Installation

### 1. Backend (Laravel API)

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
# edit .env — set DB_* to your local Postgres or Supabase credentials
php artisan migrate --seed
php artisan serve
```

API now running at `http://localhost:8000/api`.

### 2. Frontend (React + Vite)

```bash
cp .env.example .env      # from repo root — sets VITE_API_URL
npm install
npm run dev
```

Frontend now running at `http://localhost:5173`.

## Accounts

The old `superadmin` / `chairperson` / `analyst` / `viewer` demo accounts
have been **removed**. There are currently three accounts, seeded by
`backend/database/seeders/UserSeeder.php`:

| Username  | Email                          | Role          |
| --------- | ------------------------------- | ------------- |
| `admin`   | `paranjohnpaul15@gmail.com`     | Administrator |
| `encoder` | `luizaperez31@gmail.com`        | Encoder       |
| `Badac`   | `gfranco11@gmail.com`           | BADAC         |

Authentication is handled entirely by **Supabase Auth**. Passwords for
these accounts are configured directly in Supabase Auth (Supabase
Dashboard → Authentication → Users), not in this repository. The Laravel
`users` table (seeded above) stores application/profile information and
roles only — it does not store authentication passwords, and no password
is ever committed to this repository or to Git.

## Architecture

```
React Login
   |
   v
Supabase Auth (+ Supabase MFA)
   |
   v
Supabase access token  ->  Authorization: Bearer <token>
   |
   v
Laravel Supabase JWT middleware (auth:supabase)
   |
   v
Dashboard / Incidents / Residents / Mapping / Analytics /
Trends / Criminal Records / Audit Logs / Notifications
   |
   v
REST API (Laravel)  ->  Eloquent  ->  PostgreSQL / Supabase
```

See `backend/README.md` for the full endpoint list, environment variables,
and testing instructions.

## CI/CD and security

GitHub Actions (`.github/workflows/ci.yml`) lints and builds the frontend,
runs the Laravel test suite, and validates both Docker images on every
push/PR to `main`. Snyk scans JS, PHP, and Docker dependencies in the same
workflow. See [`docs/CI_CD_AND_SECURITY.md`](docs/CI_CD_AND_SECURITY.md)
for the full breakdown and the `SNYK_TOKEN` secret required to enable it.

## Notable libraries

- **react-router-dom** — client-side routing, lazy-loaded route components
- **chart.js** — dashboard/analytics/trends charts
- **leaflet**, **leaflet.markercluster**, **leaflet.heat** — Crime Mapping page
- **Laravel 12** — stateless REST API, authenticated via Supabase JWTs (no Sanctum, no session cookies)
- **PostgreSQL / Supabase** — persistent storage via Eloquent
