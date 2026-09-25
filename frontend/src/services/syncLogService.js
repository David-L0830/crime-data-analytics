import { api } from './api';

export const syncLogService = {
  // Checkpoint 10, Group D — GET /sync-logs now also accepts an optional
  // Supabase Bearer token (see backend/routes/api.php), same additive
  // pattern as auditLogService.list()/settingsService.get(): omitting
  // `token` preserves the exact existing cookie-only call shape
  // DataContext already relies on. Not wired to a live token yet, same
  // reason as every other service in this pattern.
  list: (token) => api.get('/sync-logs', token ? { token } : undefined),
};
