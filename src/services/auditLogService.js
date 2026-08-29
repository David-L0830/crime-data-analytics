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
  logExport: (report) =>
    api.post('/report-export-audit', { report }).catch(() => {}),
};
