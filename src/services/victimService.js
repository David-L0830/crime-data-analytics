import { api } from './api';

export const victimService = {
  // Victim Information feature — same additive optional-`token` shape as
  // criminalService/residentService, so this drops into DataContext's
  // existing fetch pattern unchanged.
  list: (token) => api.get('/victims', token ? { token } : undefined),
  get: (id, token) => api.get(`/victims/${id}`, token ? { token } : undefined),
  create: (data, token) =>
    api.post('/victims', data, token ? { token } : undefined),
  update: (id, data, token) =>
    api.put(`/victims/${id}`, data, token ? { token } : undefined),
  // Checkpoint 20 — replaces remove() (DELETE /victims/{id}, which
  // physically deleted the row). archive() calls the new
  // PUT /victims/{id}/archive endpoint, which sets status to 'Archived'.
  // No frontend page calls this yet (VictimRecords.jsx/VictimProfile.jsx
  // have never had a delete button — verified via grep), but the service
  // method now exists and points at a real, working backend endpoint for
  // whenever that UI is built.
  archive: (id, token) =>
    api.put(`/victims/${id}/archive`, {}, token ? { token } : undefined),
};
