# Metabase Integration — Setup & Testing

This documents the Metabase BI integration added to the Dashboard, Analytics,
and Trends pages. Read this before touching Metabase or the `.env` files.

## 1. Architecture (what actually got built)

```
Supabase PostgreSQL
        |
     Metabase  (already connected, per your setup)
        |
Metabase Questions -> Metabase Dashboards (3x, you create these)
        |
GET /api/metabase/embed-url?dashboard=...&dateFrom=...&sitio=...   <- Laravel
        | (signs a short-lived JWT server-side, using firebase/php-jwt,
        |  already a project dependency — no new package installed)
        v
  { "url": "https://<metabase>/embed/dashboard/<signed-jwt>#..." }
        |
React <MetabaseDashboard dashboardKey="..." filters={...} />
        |
   <iframe src={url}>   <- Dashboard.jsx / Analytics.jsx / Trends.jsx
```

Key design decision: **the Metabase embedding secret key never reaches the
browser.** The frontend calls the existing Laravel API (same
`auth:supabase` + role-restricted pattern as `/dashboard` and `/analytics`),
and only receives the finished, already-signed iframe URL. This is why no
`VITE_METABASE_*` variables were added to the frontend — they aren't needed,
and adding one would mean putting Metabase config in browser-visible code
for no reason.

## 2. What you need to do in Metabase

Create three dashboards. Use whatever questions/visualizations you like —
the lists below (from your spec) are a starting point, not a requirement:

| Our key             | Suggested title    | Suggested contents |
|---------------------|---------------------|---------------------|
| `crime-dashboard`   | Crime Dashboard      | Total Incidents, Resolved/Pending, Crime by Type, Crime by Sitio, Monthly Trend, Incident Status |
| `crime-analytics`   | Crime Analytics      | Crime Distribution, Crime by Gender, Crime by Age Group, Crime by Sitio, Crime Status, Type Comparison |
| `crime-trends`      | Crime Trends         | Monthly/Yearly Trends, Trends by Category, Trends by Location, Daily/Hourly patterns |

Build these questions against your **actual** Supabase schema (whatever
table/columns hold `crimeType`, `sitio`, `status`, `category`, `victimGender`,
`victimAge`, `date`/`time` — check your Supabase table, don't guess).

### 2a. Enable embedding + get the secret key

Metabase Admin → **Settings → Embedding** → turn on **Static embedding**
(this app uses signed/static embedding, not the newer "interactive"
embedding — it needs no extra Metabase license tier and matches "secure
embedded-dashboard approach, no unnecessary admin functionality exposed").
Copy the **Embedding secret key** shown there — this is
`METABASE_EMBEDDING_SECRET_KEY` below.

For **each** of the 3 dashboards: open it → the "..." menu →
**Embed this dashboard** → toggle it on. Note the numeric **Dashboard ID**
(visible in the dashboard's own URL, e.g. `.../dashboard/7-crime-dashboard`
→ ID is `7`).

### 2b. Add dashboard parameters (so React filters actually filter Metabase)

For each dashboard, add a **Dashboard filter** (Metabase's UI: "Add a
filter") for whichever of these your dashboard's questions use, and give it
**exactly** this parameter slug (Metabase auto-generates a slug from the
filter's field mapping — check it under the filter's settings and rename if
needed):

| Slug          | Type in Metabase          | Maps to (our side)              |
|---------------|----------------------------|----------------------------------|
| `date_range`  | Date filter (range)        | FilterBar's From/To              |
| `crime_type`  | Field filter (Category/text) | FilterBar's Crime Type field   |
| `sitio`       | Field filter (Category/text) | FilterBar's Sitio field        |
| `status`      | Field filter (Category/text) | Dashboard page's Status field  |
| `category`    | Field filter (Category/text) | Analytics page's Category field|

A dashboard only needs the filters relevant to its own questions — sending
an extra slug a given dashboard doesn't define is harmless (Metabase
ignores it), so the backend always sends the full set it has values for.

These become **locked** parameters (baked into the signed embed URL, not
editable by the viewer) — see `app/Http/Controllers/Api/MetabaseController.php`.

## 3. Environment variables (backend `.env` — NOT frontend)

Already appended (blank) to `backend/.env` and documented in
`backend/.env.example`:

```env
METABASE_SITE_URL=
METABASE_EMBEDDING_SECRET_KEY=
METABASE_DASHBOARD_CRIME_ID=
METABASE_DASHBOARD_ANALYTICS_ID=
METABASE_DASHBOARD_TRENDS_ID=
```

Fill these in once you've completed step 2. No real secrets have been
written anywhere by this change — the values above are blank in both files.

## 4. Testing checklist

1. **Supabase has the data** — open Table Editor in Supabase, confirm rows
   exist in the crime records table.
2. **Metabase can query it** — in Metabase, open one of your new questions
   and confirm it returns rows (not an error).
3. **Dashboards work standalone** — open each dashboard directly in
   Metabase (logged in) and confirm the visuals render.
4. **Backend config check** —
   ```bash
   cd backend
   php artisan route:list | grep metabase
   # GET|HEAD  api/metabase/embed-url  Api\MetabaseController@embedUrl
   ```
   Then, once `.env` is filled in, hit the endpoint directly (with a valid
   Supabase session cookie/token) and confirm it returns
   `{ "url": "https://.../embed/dashboard/...#..." }` — a `503` means an
   env var is still missing, a `422` means an unknown `dashboard` key.
5. **React can embed it** — run `npm run dev` (or `npm run build`, already
   verified to succeed in this change), log in, open Dashboard/Analytics/
   Trends and confirm the Metabase card loads (not stuck on the spinner or
   an error card).
6. **Filters work** — set a Sitio/date filter on the page's FilterBar and
   click Apply; the Metabase iframe should reload (a new signed URL is
   requested automatically) and reflect the filtered data, **provided**
   you've added the matching dashboard filter in Metabase per §2b. If a
   dashboard has no matching filter defined yet, the locked param is simply
   ignored by Metabase (harmless, but the dashboard won't visibly narrow).

## 5. Rollback

If you ever need to go back to the old Chart.js visuals temporarily, the
change is isolated to: `Dashboard.jsx`, `Analytics.jsx`, `Trends.jsx` (each
had one `<div className="chart-grid">...</div>` block + a
`<ChartSummaryModal>` replaced by one `<MetabaseDashboard>` call), plus the
three new files (`MetabaseDashboard.jsx`, `metabaseService.js`,
`MetabaseController.php`, `config/metabase.php`) and one new route. Nothing
about auth, CRUD, sidebar, navigation, or the database was touched.
