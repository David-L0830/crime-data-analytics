import { api } from './api';

// Automated reports (Reporting System checklist, "Scheduled Reports").
//
// Every endpoint here is administrator-only server-side — see the
// role:badac_admin group in backend/routes/api.php. The Scheduled Reports page
// that calls this service is itself administrator-only, but that is a convenience,
// not the boundary: a non-administrator who called these directly is refused
// by the middleware before the controller runs.
//
// Nothing in this module downloads a report. A schedule's output is an e-mail
// attachment addressed to the recipients an administrator configured; there is
// deliberately no endpoint that hands report content back over HTTP, so no URL
// exists here that could be shared, bookmarked or leaked.
export const reportScheduleService = {
  list: () => api.get('/report-schedules'),

  create: (data) => api.post('/report-schedules', data),

  update: (id, data) => api.put(`/report-schedules/${id}`, data),

  remove: (id) => api.delete(`/report-schedules/${id}`),

  // Runs the schedule immediately, through the identical code path the
  // hourly scheduler uses — same generator, same message, same log row, only
  // `trigger` differs. Resolves with { log, schedule }; a failed SEND still
  // resolves, with log.status === 'failed', because the request itself
  // succeeded and the outcome is what the caller needs to show.
  run: (id) => api.post(`/report-schedules/${id}/run`),

  // The "Email Logs" evidence: what ran, for whom, when, and whether it
  // arrived. Capped server-side.
  logs: () => api.get('/report-email-logs'),
};
