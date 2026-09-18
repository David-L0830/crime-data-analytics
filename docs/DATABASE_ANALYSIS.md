# Database Analysis

Evidence for Section 6 checklist item **6.4 Index Optimization**
("Frequently used fields are indexed.").

This document is the result of a repository audit that compared the indexes
Laravel's migrations actually create against how the application (backend
controllers/services/models, and the React frontend's request patterns)
actually queries each table. It reflects the schema as implemented after
Section 6 Phase 2, which added three indexes based on that audit
(`incidents.category`, `incident_victim.victim_id`,
`criminal_incident.incident_id`).

**Scope note.** "Frequently used fields are indexed" is not the same claim
as "every column is indexed." Many columns below are deliberately left
unindexed because nothing in the codebase queries them as a filter — indexing
them would add write overhead for no read benefit. Each table section below
distinguishes indexed-because-queried fields from intentionally unindexed
ones, and flags the one class of field (leading/two-sided wildcard search)
that a standard B-tree index cannot help regardless of whether one exists.

---

## incidents

| Column | Index | Non-unique/Unique | Why |
|---|---|---|---|
| `incident_code` | implicit | Unique | Human-facing code lookup / create-time uniqueness check |
| `case_number` | implicit | Unique | Human-facing case lookup / create-time uniqueness check |
| `sitio` | `incidents_sitio_index` | Non-unique | Filter (`IncidentController::index`, `ReportGenerator`), GROUP BY (`AnalyticsController::locations()`, `DashboardController`) |
| `crime_type` | `incidents_crime_type_index` | Non-unique | Filter + GROUP BY (`AnalyticsController::crimeTypes()`, `DashboardController`) |
| `status` | `incidents_status_index` | Non-unique | Filter — used on nearly every incident query in the app (dashboard, analytics `baseQuery()`, index, map) |
| `incident_date` | `incidents_incident_date_index` | Non-unique | Date filter (exact and range) + the primary sort key everywhere incidents are listed |
| `category` | `incidents_category_index` (added `2026_09_13_000001`) | Non-unique | Filter in `IncidentController::index()` and `ReportGenerator::incidentRows()`; previously unindexed, confirmed via repository audit and now corrected |

**`reported_by` does not currently have a dedicated index.** Repository
analysis (a full grep of every backend usage of `reported_by`) found it is
never used as a query WHERE-clause filter — the only two use sites are
`Incident::reporter()` (a `belongsTo` relationship definition) and a
row-level equality check in `IncidentController`
(`$incident->reported_by !== $user->id`) performed against an
already-loaded single Eloquent model, not a database query condition.
Because it is a foreign key, PostgreSQL does not create an implicit index
for it (unlike MySQL), and none was added — an index here would carry write
cost with no corresponding read benefit under current usage.

**Wildcard search fields.** `IncidentController::index()`'s `?q=` search
runs `ILIKE '%term%'` against `case_number`, `street`, `reporting_officer`,
`crime_type`, and `sitio`. A leading-wildcard `ILIKE` cannot use a standard
B-tree index — the indexes on `crime_type` and `sitio` above help their
*exact-match* filter/GROUP BY usage, but do nothing for the wildcard search
clauses that also touch those same columns. See `PERFORMANCE_REPORT.md` for
the search-optimization assessment.

---

## criminals

| Column | Index | Non-unique/Unique | Why |
|---|---|---|---|
| `criminal_code` | implicit | Unique | Human-facing code lookup / create-time uniqueness check |
| `full_name` | `criminals_full_name_index` | Non-unique | Sort key (`CriminalController::index()`); also one of the wildcard `ILIKE` search columns (see below — the index does not help that usage) |
| `status` | `criminals_status_index` | Non-unique | Filter (`CriminalController::index()`) |

`related_incident_id` (legacy single-incident link, superseded by the
`criminal_incident` junction) is a foreign key with no dedicated index. It
is not queried as a filter anywhere in the current codebase — the supported
many-to-many path is `criminal_incident`, covered separately below.

**Wildcard search fields.** `full_name`, `alias`, `criminal_code`, and
`related_case_number` are all searched with leading-wildcard `ILIKE`; a
B-tree index does not serve that pattern regardless of whether one exists
on the column.

---

## victims

| Column | Index | Non-unique/Unique | Why |
|---|---|---|---|
| `victim_code` | implicit | Unique | Human-facing code lookup / create-time uniqueness check |
| `full_name` | `victims_full_name_index` | Non-unique | Sort/lookup; also one of the wildcard `ILIKE` search columns (see below) |

`victims` has no `status`-column index need beyond what already exists —
`VictimController::index()` does not expose a status filter (unlike
Incident/Criminal).

**Wildcard search fields.** `full_name`, `alias`, and `victim_code` are
searched with leading-wildcard `ILIKE`; not B-tree-optimizable.

---

## incident_victim

| Index | Columns | Type | Purpose |
|---|---|---|---|
| `incident_victim_incident_id_victim_id_unique` | `(incident_id, victim_id)` | Unique composite (pre-existing) | Prevents duplicate (case, victim) pairings; serves lookups filtering on the leading column, `incident_id` |
| `incident_victim_victim_id_index` | `victim_id` | Non-unique (added `2026_09_13_000002`) | Serves the reverse direction |

**Why the second index is necessary.** A composite index only serves
queries whose filter starts with its leading column — the unique index
above helps a query that filters on `incident_id`, but PostgreSQL cannot use
it to efficiently satisfy a `victim_id`-only predicate. `Victim`'s
`relatedIncidents()` relationship does exactly that: every
`VictimController::index()`/`show()` call eager-loads it, generating
`SELECT * FROM incident_victim WHERE victim_id IN (...)`. Without a
dedicated `victim_id` index, PostgreSQL has no efficient access path for
that query as the table grows. The new index is additive — the composite
unique index was not modified, dropped, or replaced.

---

## criminal_incident

| Index | Columns | Type | Purpose |
|---|---|---|---|
| `criminal_incident_criminal_id_incident_id_unique` | `(criminal_id, incident_id)` | Unique composite (pre-existing) | Prevents duplicate (criminal, case) pairings; serves lookups filtering on the leading column, `criminal_id` |
| `criminal_incident_incident_id_index` | `incident_id` | Non-unique (added `2026_09_13_000003`) | Serves the reverse direction |

**Why the second index is necessary.** Same reasoning as `incident_victim`
above, mirrored: `Incident`'s `relatedCriminals()` relationship generates
`SELECT * FROM criminal_incident WHERE incident_id IN (...)`, which the
composite unique index (leading on `criminal_id`) cannot efficiently serve.
This path is exercised transitively — `VictimController` eager-loads
`relatedIncidents.relatedCriminals`, which triggers exactly this query for
the set of incidents linked to the victims being listed. The new index is
additive — the composite unique index was not modified, dropped, or
replaced.

---

## Other tables (indexed as needed, not exhaustively re-audited here)

| Table | Index | Purpose |
|---|---|---|
| `incident_evidence` | `incident_id` (+ unique `(incident_id, evidence_code)`) | `hasMany` lookup by case |
| `audit_logs` | `action`, `created_at` | Sort + the two columns most commonly filtered |
| `notification_reads` | `user_id` (+ unique `(app_notification_id, user_id)`) | Per-user read-state lookup |
| `report_schedules` | `(is_active, frequency)` composite | Hourly dispatcher scan (`ScheduledReportDispatcher`) |
| `report_email_logs` | `(report_key, status)` composite, `generated_at` | Sort + reporting filters |
| `crime_types` | `name` (unique) | Lookup/validation |
| `app_notifications` | none beyond the primary key | Table is expected to stay small (system-wide announcements); not re-evaluated in this pass — see `PERFORMANCE_REPORT.md` for the unrelated unbounded-query note on this table |

`audit_logs.user_id` (a foreign key, no dedicated index) is used as a query
filter in one place — `AuthController`'s login-dedup check
(`where('user_id', ...)->where('action','LOGIN')->where('created_at','>=', ...)`)
— identified during the Phase 2 audit but **not implemented**, since only
`incidents.category`, `incident_victim.victim_id`, and
`criminal_incident.incident_id` were approved for Section 6 Phase 2. It
remains an open, lower-priority item for a future phase.

---

## Method

This inventory was produced by reading every migration under
`backend/database/migrations/` directly (not inferred from model
annotations) and cross-referencing each resulting index against the actual
query-building code in `backend/app/Http/Controllers/Api/`,
`backend/app/Services/`, and `backend/app/Models/` — specifically every
`->where(...)`, `->whereIn(...)`, `->orderBy(...)`, `->groupBy(...)`, and
Eloquent relationship definition that is eager-loaded in a list context.
Frontend request patterns (`src/services/*.js`, `src/context/DataContext.jsx`)
were also checked to confirm which filters actually reach the backend as
query parameters. No production Supabase query plan (`EXPLAIN`/`EXPLAIN
ANALYZE`) was collected for this document — see `PERFORMANCE_REPORT.md`,
Section 6, for what would still be required to confirm the PostgreSQL query
planner actually selects these indexes at production data volumes.
