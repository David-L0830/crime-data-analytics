import { api } from './api';

// Final auth migration — login, logout-of-Supabase, Google OAuth, password
// reset, and MFA challenge/verify are no longer part of this service at
// all: they go straight from the browser to Supabase via supabase-js (see
// src/lib/supabaseClient.js and src/context/AuthContext.jsx), never through
// this Laravel API. This file now only wraps the two things that
// genuinely are this backend's job: resolving an already-verified Supabase
// session into this app's local user/profile record, and self-service
// profile edits.
export const authService = {
  logout: () => api.post('/logout'),
  // Resolves GET /api/user through the 'supabase' guard (see
  // routes/api.php) using the caller's current Supabase access token
  // (api.js attaches it automatically — see that file). Returns the
  // existing local User — never creates one — or rejects (ApiError) if the
  // Supabase account has no matching Laravel account, per the
  // "no auto-create" invariant in SupabaseTokenValidator.
  currentUser: () => api.get('/user'),
  // Same endpoint, but with an explicit token — used right after a fresh
  // sign-in/MFA verification, before relying on the Supabase client's
  // in-memory session to have settled.
  currentUserViaSupabaseToken: (accessToken) => api.get('/user', { token: accessToken }),
  // Sidebar Profile Settings ("⋮" menu). Self-service only: these always
  // act on the signed-in caller's own account (see ProfileController) —
  // there is no {id} parameter because there is no "edit someone else's
  // profile" path here, unlike userService's admin-only update().
  updateProfile: (data) => api.put('/me', data),
  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post('/me/avatar', formData);
  },
};
