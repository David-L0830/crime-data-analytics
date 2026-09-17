import { api } from './api';

// Reports module (automated report schedules).
//
// Reads (list, logs) are open to the Administrator and BADAC Read-Only; the
// server withholds recipient addresses and raw delivery errors from every
// non-administrator, so a Read-Only response carries `recipientCount` and the
// bare status only. Every other call here is role:badac_admin on the server.
// There is no delete: a schedule is archived and can be restored.
export const reportScheduleService = {
  // Active (non-archived) schedules by default; archived ones when asked.
  list: ({ archived = false } = {}) =>
    api.get(archived ? '/report-schedules?archived=1' : '/report-schedules'),

  create: (data) => api.post('/report-schedules', data),

  update: (id, data) => api.put(`/report-schedules/${id}`, data),

  // Non-destructive. Keeps the row, its pause state and its delivery history;
  // an archived schedule is never sent until it is restored.
  archive: (id) => api.put(`/report-schedules/${id}/archive`),

  // Clears the archive only. A schedule archived while paused comes back
  // paused.
  restore: (id) => api.put(`/report-schedules/${id}/restore`),

  // Runs the schedule immediately, through the identical code path the
  // hourly scheduler uses — same generator, same message, same log row, only
  // `trigger` differs. Resolves with { log, schedule }; a failed SEND still
  // resolves, with log.status === 'failed', because the request itself
  // succeeded and the outcome is what the caller needs to show.
  run: (id) => api.post(`/report-schedules/${id}/run`),

  // The delivery log: what ran, when, and whether it arrived. Capped
  // server-side.
  logs: () => api.get('/report-email-logs'),
};
