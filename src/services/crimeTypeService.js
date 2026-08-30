import { api } from './api';

// Configurable crime types and their map colours.
//
// GET is readable by every authenticated role — the incident form, the
// FilterBar and the Crime Mapping legend all need it. POST/PUT are
// Administrator-only, enforced by the backend's role: middleware (see
// backend/routes/api.php), not by which buttons the UI renders.
export const crimeTypeService = {
  list: (token) => api.get('/crime-types', token ? { token } : undefined),
  create: (data, token) =>
    api.post('/crime-types', data, token ? { token } : undefined),
  update: (id, data, token) =>
    api.put(`/crime-types/${id}`, data, token ? { token } : undefined),
};
