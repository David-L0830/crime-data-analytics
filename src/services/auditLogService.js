import { api } from './api';

export const auditLogService = {
  // Checkpoint 10, Group D — GET /audit-logs now also accepts an optional
  // Supabase Bearer token (see backend/routes/api.php), same additive
  // pattern as settingsService.get()/notificationService.list(): omitting
  // `token` preserves the exact existing cookie-only call shape
  // DataContext already relies on. Not wired to a live token yet, same
  // reason as every other service in this pattern.
  list: (token) => api.get('/audit-logs', token ? { token } : undefined),
};
