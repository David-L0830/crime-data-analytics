import { api } from './api';

export const criminalService = {
  // Checkpoint 9, Group C — GET /criminals and GET /criminals/{id} now also
  // accept an optional Supabase Bearer token (see backend/routes/api.php),
  // same additive pattern as settingsService.get(): omitting `token`
  // preserves the exact existing cookie-only call shape DataContext already
  // relies on. Not wired to a live token yet, same reason as
  // settingsService. `get()` has no live caller today (verified via grep —
  // CriminalProfile.jsx reads from useData()'s already-loaded `criminals`,
  // not from this function).
  // Checkpoint 12, Group F — create()/update() now also accept an optional
  // Supabase Bearer token, same additive pattern as list()/get() above.
  // Neither has a live caller today (see routes/api.php's Checkpoint 12
  // comment) so this changes zero live behavior; added for parity with the
  // newly-migrated POST/PUT /criminals routes, same rationale as get()
  // before it.
  list: (token) => api.get('/criminals', token ? { token } : undefined),
  get: (id, token) =>
    api.get(`/criminals/${id}`, token ? { token } : undefined),
  create: (data, token) =>
    api.post('/criminals', data, token ? { token } : undefined),
  update: (id, data, token) =>
    api.put(`/criminals/${id}`, data, token ? { token } : undefined),
  // PUT /criminals/{id}/archive — mirrors victimService.archive(). Sets
  // status to 'Archived' server-side (CriminalController::archive()).
  // No caller yet; DataContext/CriminalRecords wiring is a separate step.
  archive: (id, token) =>
    api.put(`/criminals/${id}/archive`, {}, token ? { token } : undefined),
};
