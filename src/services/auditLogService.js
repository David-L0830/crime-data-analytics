import { api } from './api';

export const auditLogService = {
  // Checkpoint 10, Group D — GET /audit-logs now also accepts an optional
  // Supabase Bearer token (see backend/routes/api.php), same additive
  // pattern as settingsService.get()/notificationService.list(): omitting
  // `token` preserves the exact existing cookie-only call shape
  // DataContext already relies on. Not wired to a live token yet, same
  // reason as every other service in this pattern.
  list: (token) => api.get('/audit-logs', token ? { token } : undefined),

  // Records that a report was exported, mirroring
  // userService.logPasswordReset(): the export itself happens in the browser,
  // so the trail is written by a separate call afterwards.
  //
  // Call this ONLY after exportWorkbook() has returned true, so the audit
  // trail never claims an export that did not happen. `report` is one of the
  // keys AuditLogController::REPORTS accepts — the description is built
  // server-side from that key rather than sent from here, so the browser
  // cannot write free text into the audit record.
  //
  // Deliberately NOT awaited for its result by callers, and its own failure is
  // swallowed by logExport() below: a completed download must never be
  // reported to the user as a failure because a follow-up bookkeeping call did
  // not land. The server logs the write failure on its side.
  //
  // `meta` is OPTIONAL scope information about the run — { rowCount,
  // periodFrom, periodTo, filtersSummary } — which the server records as
  // report execution history (report_runs). Reporting is a process inside the
  // modules, not a module of its own, so that history has no page: it is
  // backend data. Omitting `meta` is valid and unchanged in behaviour; every
  // existing call site does exactly that, and the run is still recorded, just
  // without its scope. Never send report CONTENT here — only counts and the
  // filters already shown on screen.
  logExport: (report, meta = undefined) =>
    api
      .post('/report-export-audit', { report, ...clampMeta(meta) })
      .catch(() => {}),
};

// filters_summary is a varchar(500) and the endpoint validates it as one, so an
// over-long summary would fail validation — and because the audit row and the
// run row are written together, that 422 would cost BOTH. The audit trail has
// recorded exports since long before this metadata existed and must not become
// losable because of it, so the summary is trimmed to fit rather than allowed
// to reject the request.
//
// 500 is not reachable by any summary these pages build today; this exists so
// it stays unreachable when a crime type or sitio is named at length in System
// Settings. The ellipsis marks the text as shortened, so a truncated line is
// never read as the whole filter state.
const SUMMARY_LIMIT = 500;

function clampMeta(meta) {
  if (!meta) return {};

  const summary = meta.filtersSummary;
  if (typeof summary !== 'string' || summary.length <= SUMMARY_LIMIT) {
    return meta;
  }

  return {
    ...meta,
    filtersSummary: `${summary.slice(0, SUMMARY_LIMIT - 1)}…`,
  };
}
