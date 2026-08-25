import { api } from './api';

export const notificationService = {
  // Checkpoint 8, Group B — GET /notifications now also accepts an optional
  // Supabase Bearer token (see routes/api.php), same additive pattern as
  // settingsService.get()/analyticsService.dashboard(): omitting `token`
  // preserves the exact existing cookie-only call shape DataContext already
  // relies on. Not wired to a live token yet, same reason as settingsService.
  // Checkpoint 12, Group F — markRead()/markAllRead() now also accept an
  // optional Supabase Bearer token, same additive pattern as list() above.
  // Not wired to a live token yet, same reason as list().
  list: (token) => api.get('/notifications', token ? { token } : undefined),
  markRead: (id, token) =>
    api.put(
      `/notifications/${id}/read`,
      undefined,
      token ? { token } : undefined,
    ),
  // title is optional — scopes the bulk mark-as-read to notifications with
  // that exact title (e.g. 'Hotspot Alert') instead of the whole inbox.
  markAllRead: (title, token) =>
    api.put(
      `/notifications/read-all${title ? `?title=${encodeURIComponent(title)}` : ''}`,
      undefined,
      token ? { token } : undefined,
    ),
};
