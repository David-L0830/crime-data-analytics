import { api } from './api';

export const settingsService = {
  // Checkpoint 8, Group B — GET /settings now also accepts an optional
  // Supabase Bearer token (see routes/api.php), same additive pattern as
  // analyticsService.dashboard(): omitting `token` preserves the exact
  // existing cookie-only call shape DataContext already relies on. Not
  // wired to a live token yet — AuthContext doesn't currently expose the
  // active Supabase access token to DataContext — so this remains callable
  // correctly without changing any live behavior today.
  // Checkpoint 12, Group F — update() now also accepts an optional Supabase
  // Bearer token, same additive pattern as get() above: omitting `token`
  // preserves the exact existing cookie-only call shape Settings.jsx already
  // relies on. Not wired to a live token yet, same reason as get().
  get: (token) => api.get('/settings', token ? { token } : undefined),
  update: (data, token) => api.put('/settings', data, token ? { token } : undefined),
};
