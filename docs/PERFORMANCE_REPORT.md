# Performance Report

Evidence for Section 6 checklist item **6.5 Query Performance**
("SQL queries execute efficiently.").

This report documents what was actually reviewed and verified in the
repository as of Section 6 Phase 2, and is explicit about what has **not**
been measured. See `DATABASE_ANALYSIS.md` for the index inventory (6.4).

## 1. Scope

The review covered the real query paths used by the application:

- Incident queries (`IncidentController`, listing, map, search, mint-code
  checks, hotspot count)
- Criminal queries (`CriminalController`, listing, search, nested eager
  loads)
- Victim queries (`VictimController`, listing, search, nested eager loads)
- Dashboard queries (`DashboardController`)
- Analytics queries (`AnalyticsController`)
- Audit logs (`AuditLogController`, plus the login-dedup check in
  `AuthController`)
- Notifications (`NotificationController`, `AppNotification` model scopes)
- Scheduled reports (`ReportScheduleController`, `ScheduledReportDispatcher`)
- Section 5 reporting queries (`ReportGenerator`)

## 2. N+1 Query Review

**N+1 was NOT found in the reviewed active code paths.** Every relationship
access in the controllers/services above is either eager-loaded before
iteration (`->with(...)`, including correctly nested loads such as
`relatedIncidents.victims` and `relatedIncidents.relatedCriminals`), or is a
single-record `->load()`/`->fresh()->load()` call after a create, update,
archive, or restore — never a loop that queries per row.

One theoretical, not-currently-exercised risk was noted:
`AppNotification::isReadBy()` falls back to a live per-notification query if
called on a model where the `reads` relation was not preloaded. The only
call site reviewed (`NotificationController::index()`) always eager-loads
`reads` first, so this does not produce N+1 in the code as it exists today.

This finding describes the code paths that were reviewed. It is not a proof
that no N+1 pattern can ever be introduced by future code — it is a
statement about the current state of the reviewed files.

## 3. Analytics Query Optimization

**Previous behavior.** `AnalyticsController::index()` retrieved every
non-archived incident into PHP (`Incident::where('status','!=','Archived')->get()`,
an unbounded `SELECT *`) and then performed three separate
`Collection::countBy()` passes in PHP (`category`, `status`, `sitio`), plus a
PHP `Collection::count()` for the total — after the entire filtered table
had already been transferred and hydrated.

**Implemented improvement.** PostgreSQL now performs the aggregation:

- `COUNT(*)` for `total`
- `SELECT category, COUNT(*) ... GROUP BY category` for `byCategory`
- `SELECT status, COUNT(*) ... GROUP BY status` for `byStatus`
- `SELECT sitio, COUNT(*) ... GROUP BY sitio` for `bySitio`

Each grouped query is reduced to a `{value: count}` map via
`->pluck('total', '<column>')`, matching the same aggregation style already
used elsewhere in the same codebase (`DashboardController::index()`'s
`bySitio`/`byCrimeType`).

**API contract preserved.** The endpoint (`GET /api/analytics`), HTTP
method, authorization, and response keys (`total`, `byCategory`, `byStatus`,
`bySitio`) are unchanged. Archived incidents remain excluded via the same
`baseQuery()` filter, untouched by this change. The edge case where a NULL
group value collapses to an empty-string (`""`) key — a side effect of PHP's
null-to-`''` array-key coercion, present in both the old `countBy()`
implementation and the new `pluck()` implementation — was verified to behave
identically before and after, via `tests/Feature/AnalyticsTest.php`.

## 4. Pagination Assessment

- **Incident listing is currently unpaginated.**
- **Criminal listing is currently unpaginated.**
- **Victim listing is currently unpaginated.**

This is a known architectural characteristic of the application, not a
defect introduced by Section 6 Phase 2. The React `DataContext` fetches each
of these collections in full on mount (confirmed: no service in
`src/services/*.js` passes a page/per-page parameter to any list endpoint)
and every page filters/paginates that in-memory copy client-side via the
FilterBar. Introducing server-side pagination would require a coordinated
change across the API contract, `DataContext`, every FilterBar consumer, and
any client-side chart aggregation — it is deferred rather than attempted
here, consistent with the Section 6 Phase 2 approval scope.

- **`/incidents/map` intentionally remains unpaginated** — the Crime
  Mapping view needs the complete set of geolocated, non-archived points to
  render the map; pagination would break that view rather than improve it.
- **Notifications currently have no pagination or row cap** —
  `NotificationController::index()` returns every notification visible to
  the caller's role, unbounded. This was identified during the Phase 2
  audit and was **not changed** in Phase 2 (only the four approved index/
  analytics changes were implemented); it remains open for a future phase.

## 5. Search Performance

Current wildcard search usage:

- `ILIKE '%term%'` — `IncidentController` (`case_number`, `street`,
  `reporting_officer`, `crime_type`, `sitio`), `CriminalController`
  (`full_name`, `alias`, `criminal_code`, `related_case_number`, plus a
  subquery on `incidents.case_number`), `VictimController` (`full_name`,
  `alias`, `victim_code`, plus the same subquery pattern).
- `LIKE '%,role,%'` — `AppNotification::scopeForRole()`, a two-sided
  wildcard used to test comma-delimited role membership in
  `audience_roles`.

A standard B-tree index — including the indexes documented in
`DATABASE_ANALYSIS.md` on columns like `crime_type` and `sitio` — does not
optimize a leading-wildcard (`%term%`) or two-sided-wildcard (`%,role,%`)
pattern; PostgreSQL cannot use a B-tree to seek into the middle of a text
value. These searches are not currently B-tree-optimized, and no claim to
the contrary is made anywhere in this documentation set.

**At the current expected barangay-level dataset scale, no evidence
currently justifies adding PostgreSQL trigram/GIN infrastructure.** No
`pg_trgm` extension, GIN index, or full-text search was added — this
remains a documented, deferred option, not a current recommendation, absent
evidence of an actual slow-search problem at production scale.

## 6. Reporting Performance (Section 5)

Section 5 (reporting) was reviewed for regressions, but **not changed**, in
this phase:

- Report filters (`ReportGenerator::incidentRows()`) use the existing
  indexed filter fields — `crime_type`, `sitio`, `status`, and
  `incident_date` (range) — plus `category`, which is now indexed as of
  Section 6 Phase 2.
- Report sorting uses `incident_date` and `id` (`orderByDesc('incident_date')
  ->orderByDesc('id')`), matching `incidents`' existing indexed sort key.
- Scheduled-report functionality (`ScheduledReportDispatcher`,
  `report_schedules`, `report_email_logs`) was not changed in Section 6
  Phase 2.
- Broad report exports remain potentially unbounded by design —
  `incidentRows()` has no row cap, so a schedule with wide/empty filters
  pulls the full matching result set into memory to build the CSV. This is
  inherent to how the report generator works today, not a regression
  introduced here.
- No Section 5 regression was identified during this review. Section 5 code
  was not modified.

## 7. Performance Measurement Limitations

**This section states plainly what was, and was not, measured.**

The automated application test suite (`php artisan test`) runs against
SQLite in-memory, per the project's test configuration
(`backend/phpunit.xml`: `DB_CONNECTION=sqlite`, `DB_DATABASE=:memory:`).
Production runs on PostgreSQL via Supabase. Therefore, those tests verify:

- application behavior (endpoints respond correctly)
- response shape (JSON keys/structure match the documented contract)
- filtering logic (WHERE-clause conditions produce the right rows)
- aggregation correctness (`total`/`byCategory`/`byStatus`/`bySitio` values,
  including the null-key edge case, and archived-incident exclusion)
- migration behavior, where tested (see below)

They do **not** establish production PostgreSQL execution times, query
plans, or index selection behavior.

Migration verification (create → apply → inspect → roll back → inspect →
re-apply → inspect) was performed against a throwaway local SQLite file
created solely for that check, confirming the three new indexes are created
and dropped correctly and that the pre-existing composite unique indexes on
`incident_victim` and `criminal_incident` are left untouched. This is schema
_-behavior_ evidence (the migrations are well-formed and reversible), not
PostgreSQL performance evidence.

Actual PostgreSQL `EXPLAIN` / `EXPLAIN ANALYZE` measurements against the
Supabase environment were **not performed** during this phase. No
production benchmark numbers — milliseconds, throughput, CPU usage, query
planner cost/row estimates, rows-per-second, or "before vs. after" latency
improvements — are reported anywhere in this document, because none were
produced. Any such numbers would be fabricated if stated, so none are
stated.

### Verified by code/tests

- Index presence, naming, and reversibility (migration up/rollback/re-run,
  against local SQLite).
- `AnalyticsController::index()` produces the same response shape and
  values as the previous implementation, including edge cases (null group,
  zero matching rows, archived exclusion).
- No N+1 pattern in the reviewed controllers/services (static code review).
- Full backend test suite passes (414 tests / 1701 assertions at the time
  of Phase 2 verification) under the SQLite test configuration.

### Requires PostgreSQL/Supabase performance measurement

- Confirmation that the PostgreSQL query planner actually selects the three
  new indexes for the queries they target, at production data volumes.
- Actual query execution time, before/after, for the analytics endpoint and
  any other listed query path.
- Real-world impact of the unpaginated list endpoints as `incidents`,
  `criminals`, and `victims` grow over time.
- Whether wildcard search response time is currently, or will become,
  noticeable to users at production scale — the basis for any future
  `pg_trgm`/GIN decision.

## Evidence Matrix

| Checklist | Requirement | Evidence | Status |
|---|---|---|---|
| 6.4 | Frequently used fields are indexed | `DATABASE_ANALYSIS.md` + migrations `2026_09_13_000001`–`000003` + migration verification (create/apply/rollback/re-apply against local SQLite) | Implemented and verified at the repository/migration level — the three previously-missing, actively-exercised indexes now exist and are correctly reversible. Production PostgreSQL planner behavior (whether Postgres actually chooses these indexes at real data volumes) is a separate, not-yet-performed verification step. |
| 6.5 | SQL queries execute efficiently | This report + `tests/Feature/AnalyticsTest.php` + full backend suite (414 passed / 1701 assertions) | Implemented and code/test verified for the one confirmed inefficiency in scope (`AnalyticsController::index()` PHP aggregation → PostgreSQL aggregation), with no N+1 found elsewhere in the reviewed paths. Production PostgreSQL timing evidence remains separate and was not collected. Known architectural gaps (unpaginated listings, unindexed wildcard search, `audit_logs.user_id`) are documented above as deferred, not resolved. |
