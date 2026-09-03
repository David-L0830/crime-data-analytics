# PROGRESS LOG

> **Reconciliation note — 2026-08-30.** The entries below are a historical
> record of one earlier session and are kept as written. Two of its statements
> are no longer true and should not be acted on:
>
> - _"Backend PHPUnit suite: **not run** — no PHP interpreter available in this
>   sandbox"_ and the matching next action _"Get PHP available somewhere and run
>   the backend test suite for real."_ PHP 8.3 is available and the suite runs:
>   **274 passed (1008 assertions)** against the in-memory SQLite database
>   configured in `backend/phpunit.xml`. It also runs in CI (`.github/workflows/ci.yml`).
> - The frontend now has a Vitest suite that did not exist when this log was
>   written — **67 passed**, covering the analytics helpers — and it runs in CI
>   as well.
>
> The browser-verification gaps this log flags (items 2, 4, 6, and next action 4)
> **are still open**: no session since has had a browser available, so the login
> page, collapsed sidebar, profile menu, KPI tooltips, avatar upload and section
> layout remain verified by code review and a successful build only.
>
> **Also stale:** row 1 of the task table below reads _"no route enforces
> AAL2, `EnsureSupabaseAal2` is unwired (kept intentionally for possible
> future use)"_. That was accurate when written but no longer is. The current
> implementation enforces adaptive AAL2/MFA on every protected route except
> the two documented exemptions (`GET /api/user`, `POST /api/logout`) — see
> `AUTH_MIGRATION_STATUS.md` for the current, authoritative description.

## Task-by-task status

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Remove 2FA from login flow | **Done** | Verified in a later session: no route enforces AAL2, `EnsureSupabaseAal2` is unwired (kept intentionally for possible future use), Login.jsx/AuthContext.jsx MFA screens removed. See AUTH_MIGRATION_STATUS.md. |
| 2 | Login page scrollbar | **Partially addressed** | Root-caused to the unstyled `type="email"` input; fixed. Not visually re-verified in a browser. |
| 3 | "Enter your email" positioning | **Done** | Root cause: CSS selector didn't include `input[type="email"]`. Fixed, build-verified. |
| 4 | Collapsed sidebar icon spacing/scroll | **Checked, no bug found** | Computed worst-case height fits without scrolling in current code. |
| 5 | Three-dot profile menu clipped | **Done** | Root cause: `.user-info` had `overflow: hidden`, clipping the dropdown. Fixed. |
| 6 | Profile image upload | **Checked, appears already implemented** | Not end-to-end tested (no live backend in this sandbox). |
| 7 | FROM/TO → single date filter (Dashboard) | **Done** | |
| 8 | Single-date filter applied everywhere | **Done** | Analytics, Trends, IncidentFeed, Mapping, AuditLogs, shared `filterRecords()` helper, backend `IncidentController`. |
| 9 | Dashboard card tooltip overlap | **Done** | Root cause: native `title` attribute + custom CSS tooltip firing simultaneously, plus `overflow: hidden` clipping. Rebuilt as a dedicated info-icon tooltip. |
| 10 | Tooltip fix applied everywhere | **Done** | Confirmed via grep this was the only instance of the pattern in the codebase. |
| 11 | Bottom dashboard sections — remove internal scroll, horizontal layout | **Done** | Horizontal 4-across layout already existed; removed the `max-height`/`overflow-y:auto` that was causing the internal scrollbar. |
| 12 | Audit Logs removed from BADAC | **Done** | Frontend RBAC constant + backend route middleware + updated test + updated stale doc comments. **Flagging**: reverses a previously deliberate, documented, tested design decision (see CHECKPOINT.md) — worth a sanity check with the requirements owner. |
| 13 | Build/tests run, errors fixed | **Partially done** | Frontend: `vite build` succeeded after fixing a missing native binding. Backend: no PHP interpreter available in this sandbox; PHP files reviewed manually, not executed. |
| 14 | Checkpoint/progress files | **Done** | This file and CHECKPOINT.md. |

## Tests performed
- `node node_modules/vite/bin/vite.js build` → **PASS** (1930 modules, no errors)
- `npm install @rolldown/binding-linux-x64-gnu --no-save` → needed to fix a sandbox-only native-binding gap before the build would run at all
- Manual brace-balance / syntax review of every edited `.jsx`/`.js`/`.php` file
- Backend PHPUnit suite: **not run** — no PHP interpreter in this sandbox, and PHP package registries aren't network-reachable from here

## Known issues / risks carried forward
- ~~2FA removal is completely undone~~ — superseded: confirmed complete in a later session. See AUTH_MIGRATION_STATUS.md.
- The BADAC Audit Logs removal reverses a previously well-documented, deliberate, tested design. Get explicit confirmation this is really wanted before shipping it.
- Backend PHP changes are untested by an actual test runner. Run `composer install && vendor/bin/phpunit` in an environment with PHP before merging.
- Collapsed-sidebar spacing and profile image upload were reviewed by reading code only, not by running the app in a browser — if either is still visibly broken, that means the bug is somewhere I didn't spot (get exact repro steps/viewport size next time).

## Next actions for a future session
1. Get an explicit decision from the user on 2FA removal — proceed or leave as-is.
2. If proceeding with 2FA removal: read `AuthContext.jsx`, `useAuth.js`, `authService.js`, `supabaseMfaService.js`, and the backend's `SupabaseMfaTest.php` in full first, since Login.jsx alone has 3 conditional render branches tied to MFA state.
3. Get PHP available somewhere and run the backend test suite for real.
4. Visually verify in an actual browser: login page scrollbar, collapsed sidebar, three-dot menu, KPI tooltip position, dashboard section layout at a few breakpoints — I could only verify these via code review + a successful production build in this sandbox, not a rendered page.
