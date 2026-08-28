// Supabase Auth client — final auth migration: Supabase Auth is the only
// authentication system this app has (see AUTH_MIGRATION_STATUS.md).
// src/services/authService.js and src/context/AuthContext.jsx both import
// this single, shared, already-configured client rather than each
// instantiating their own.
//
// Sessions live in sessionStorage, not localStorage, so closing the tab or
// window ends the session — see the SESSION LIFETIME note further down.
//
// Only the publishable (public) key belongs here. The secret/service-role key
// must NEVER be used in frontend code — it stays server-side only (backend
// .env, used only by App\Services\SupabaseAdminService).
//
// This reads the NEW-style publishable key (sb_publishable_...). The project's
// legacy JWT-based anon key was permanently disabled when Supabase's JWT
// signing keys were adopted, so VITE_SUPABASE_ANON_KEY no longer exists.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Don't throw at module-load time if these are unset — the client CAN be
// constructed once a Supabase project's credentials are supplied, but
// nothing calls a real method on it until then. Every caller that needs a
// live Supabase session checks `isSupabaseConfigured` first and fails
// predictably instead of hitting a cryptic client error.
export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set — ' +
      'sign-in will not work until they are configured (see .env.example).',
  );
}

// ---------------------------------------------------------------------------
// SESSION LIFETIME — the session ends when the tab is closed
// ---------------------------------------------------------------------------
// Requirement: closing the application must mean signing in again on return.
//
// The obvious implementation — sign out from a `beforeunload` handler — is the
// wrong one, and not for style reasons. `beforeunload` does not distinguish a
// closed tab from a reload, a navigation, or a redirect back from Supabase's
// own OAuth flow, so it signs people out mid-session; it does not fire at all
// when a tab is discarded, when the browser is force-quit, or on mobile
// Safari; and the sign-out request it starts is routinely cancelled as the
// page tears down, which leaves the token in storage anyway. It is unreliable
// in both directions.
//
// The reliable mechanism is WHERE the session is stored. sessionStorage is
// scoped to the browsing context: the browser itself discards it when the tab
// or window is closed, with no code of ours involved and nothing to fail. A
// reload or an in-app navigation keeps it, which is exactly the boundary
// asked for.
//
// What this changes, all of it intended:
//   - Close the tab (or the whole browser) and return -> the login page.
//   - Reload, use the back button, navigate around the SPA -> still signed in.
//   - Open the app in a SECOND tab -> that tab starts signed out and needs its
//     own sign-in. Sessions no longer follow the browser profile; they follow
//     the window the person is working in.
//
// Known limits, both browser behaviour rather than choices made here:
//   - "Continue where you left off" / session-restore on relaunch, and
//     duplicating a tab, can copy sessionStorage into the restored context, so
//     that particular path may come back still signed in.
//   - A tab left open indefinitely stays signed in; this policy is about
//     closing the application, not idleness. The Supabase access token still
//     expires and refreshes on its own schedule, and the backend re-verifies
//     every token on every request regardless (see SupabaseTokenValidator).
//
// Everything else is untouched: supabase-js still owns the session, still
// refreshes the token, still parses an OAuth return out of the URL, and
// AuthContext/ProtectedRoute/api.js are unchanged.
const memoryStorage = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
})();

// Reading window.sessionStorage can THROW, not merely return null, when a
// browser is configured to block site data. Falling back to an in-memory store
// keeps sign-in working for that session rather than breaking the whole app on
// a storage-permission error.
function sessionScopedStorage() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return memoryStorage;
    }
    const probe = '__cdars_storage_probe__';
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return memoryStorage;
  }
}

// Anyone signed in before this change still has a token sitting in
// localStorage under the old key. It is now unreachable — supabase-js reads
// only the storage configured below — so leaving it there would be a valid
// access token at rest that nothing can ever use or expire out of the UI.
// Clearing it on load is both the sign-out those users are due and basic
// hygiene for a system holding crime records.
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem('cdars_supabase_auth');
  }
} catch {
  /* storage blocked — nothing to clean up, and nothing that can be read either */
}

// createClient() does not itself make a network call, so it is safe to
// construct even with placeholder/empty strings — it just means any method
// called on it later (signInWithPassword, getSession, etc.) will fail until
// real credentials are supplied. We pass empty-string fallbacks rather than
// skipping creation entirely so every caller can rely on `supabase` always
// being a real client instance (never null/undefined) and gate on
// `isSupabaseConfigured` instead of null-checking `supabase` everywhere.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabasePublishableKey || 'placeholder-publishable-key',
  {
    auth: {
      // Per-tab storage — see the note above. This single line is what makes
      // closing the application require a fresh sign-in.
      storage: sessionScopedStorage(),
      storageKey: 'cdars_supabase_auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
);
