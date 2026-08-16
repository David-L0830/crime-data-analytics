import { api } from './api';

export const incidentService = {
  // Checkpoint 9, Group C — GET /incidents, GET /incidents/map, and
  // GET /incidents/{id} now also accept an optional Supabase Bearer token
  // (see backend/routes/api.php), same additive pattern as
  // settingsService.get()/notificationService.list(): omitting `token`
  // preserves the exact existing cookie-only call shape DataContext already
  // relies on. Not wired to a live token yet — AuthContext doesn't
  // currently expose the active Supabase access token to DataContext — so
  // this remains callable correctly without changing any live behavior
  // today. `map()` and `get()` have no live caller today (verified via
  // grep — Mapping.jsx and IncidentFeed.jsx both read incidents from
  // useData()'s already-loaded `records`, not from these functions), same
  // as Group A's analytics functions.
  // Checkpoint 12, Group F — create()/update()/remove() now also accept an
  // optional Supabase Bearer token, same additive pattern as list()/map()/
  // get() above: omitting `token` preserves the exact existing cookie-only
  // call shape DataContext already relies on for all three. Not wired to a
  // live token yet, same reason as list()/map()/get().
  list: (token) => api.get('/incidents', token ? { token } : undefined),
  map: (token) => api.get('/incidents/map', token ? { token } : undefined),
  get: (id, token) => api.get(`/incidents/${id}`, token ? { token } : undefined),
  create: (data, token) => api.post('/incidents', data, token ? { token } : undefined),
  update: (id, data, token) => api.put(`/incidents/${id}`, data, token ? { token } : undefined),
  // Checkpoint 20 — replaces remove() (DELETE /incidents/{id}, which
  // physically deleted the row). archive() calls the new
  // PUT /incidents/{id}/archive endpoint, which sets status to 'Archived'
  // and never removes the database row.
  archive: (id, token) => api.put(`/incidents/${id}/archive`, {}, token ? { token } : undefined),
};
