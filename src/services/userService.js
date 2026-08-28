import { api } from './api';

// Admin User Management (Phase 4). Every call here hits a badac_admin-only
// route (see backend routes/api.php) — the server returns 403 for an
// Encoder regardless of what this file does, so there's no separate
// "am I allowed" check needed on the frontend beyond hiding the nav link.
//
// Checkpoint 10, Group D — GET /users and GET /users/{id} now also accept
// an optional Supabase Bearer token (see backend/routes/api.php), same
// additive pattern as auditLogService.list()/syncLogService.list():
// omitting `token` preserves the exact existing cookie-only call shape
// UserManagement.jsx already relies on. Not wired to a live token yet,
// same reason as every other service in this pattern. `get()` is added
// here for parity with the newly-migrated GET /users/{id} route even
// though it has no live caller today (verified via grep — UserManagement.jsx
// only ever calls list()/update()/setActive()/disableTwoFactor()); same
// low-risk rationale as incidentService.get()/map() before it.
// Checkpoint 11, Group E — update()/setActive()/disableTwoFactor() now also
// accept an optional Supabase Bearer token (see backend/routes/api.php),
// same additive pattern as list()/get() before them (Checkpoint 10, Group
// D): omitting `token` preserves the exact existing cookie-only call shape
// UserManagement.jsx already relies on for all three. Not wired to a live
// token yet, same reason as every other service in this pattern —
// AuthContext still doesn't expose the active Supabase access token to
// DataContext/UserManagement.jsx.
export const userService = {
  list: (token) => api.get('/users', token ? { token } : undefined),
  get: (id, token) => api.get(`/users/${id}`, token ? { token } : undefined),
  update: (id, data, token) =>
    api.put(`/users/${id}`, data, token ? { token } : undefined),
  setActive: (id, isActive, token) =>
    api.put(`/users/${id}/status`, { isActive }, token ? { token } : undefined),
  // Phase 4 — Feature #4. Admin break-glass: clears a user's 2FA entirely
  // (see UserController::disableTwoFactor) — only reachable for badac_admin.
  disableTwoFactor: (id, token) =>
    api.post(
      `/users/${id}/two-factor/disable`,
      undefined,
      token ? { token } : undefined,
    ),

  // Account Administration — administrator-provisioned account creation.
  //
  // The payload carries no password and never could: creating the Supabase
  // Auth identity needs the service-role key, which lives only in the
  // backend's environment (see App\Services\SupabaseAdminService). This
  // sends identity and role; the backend writes both systems or neither.
  create: (data) => api.post('/users', data),

  // One account's own audit trail (GET /users/{id}/activity). Scoped
  // server-side by user_id — this is the existing audit_logs data, not a
  // second activity store, and not the global feed filtered in the browser.
  activity: (id) => api.get(`/users/${id}/activity`),

  // Records that a password-reset email was sent to this account. It does
  // NOT send the email: Supabase does, requested directly from the browser
  // by supabase.auth.resetPasswordForEmail() (the same call the public
  // Forgot Password page makes). Call this only after that has succeeded,
  // so the audit trail never claims a reset that did not happen.
  logPasswordReset: (id) => api.post(`/users/${id}/password-reset-audit`),
};
