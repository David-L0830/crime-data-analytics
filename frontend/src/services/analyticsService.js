import { api } from './api';

export const analyticsService = {
  // Checkpoint 6B, Part 6 — /dashboard now also accepts a Supabase Bearer
  // token (see routes/api.php); `token` is optional and additive, exactly
  // like authService.currentUserViaSupabaseToken's own pattern — omitting
  // it preserves the existing cookie-only call shape unchanged. No current
  // page calls this yet (Dashboard.jsx computes its KPIs client-side) —
  // this makes it callable correctly whenever one does.
  dashboard: (token) => api.get('/dashboard', token ? { token } : undefined),
  // Checkpoint 7A, Group A — same additive pattern as dashboard() above:
  // /analytics* now also accepts an optional Supabase Bearer token (see
  // routes/api.php). `token` is optional; omitting it preserves the exact
  // existing cookie-only call shape every caller already relies on. As
  // with dashboard(), no page currently calls these at all (Analytics.jsx
  // and Trends.jsx compute their figures client-side from useData()) — this
  // makes them callable correctly whenever one does, without changing any
  // live behavior today.
  overview: (token) => api.get('/analytics', token ? { token } : undefined),
  crimeTypes: (token) =>
    api.get('/analytics/crime-types', token ? { token } : undefined),
  monthly: (token) =>
    api.get('/analytics/monthly', token ? { token } : undefined),
  locations: (token) =>
    api.get('/analytics/locations', token ? { token } : undefined),
};
