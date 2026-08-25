// Supabase Auth client — final auth migration: Supabase Auth is the only
// authentication system this app has (see AUTH_MIGRATION_STATUS.md).
// src/services/authService.js and src/context/AuthContext.jsx both import
// this single, shared, already-configured client rather than each
// instantiating their own.
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
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set — ' +
      'sign-in will not work until they are configured (see .env.example).'
  );
}

// createClient() does not itself make a network call, so it is safe to
// construct even with placeholder/empty strings — it just means any method
// called on it later (signInWithPassword, getSession, etc.) will fail until
// real credentials are supplied. We pass empty-string fallbacks rather than
// skipping creation entirely so every caller can rely on `supabase` always
// being a real client instance (never null/undefined) and gate on
// `isSupabaseConfigured` instead of null-checking `supabase` everywhere.
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabasePublishableKey || 'placeholder-publishable-key', {
  auth: {
    // Persist the Supabase session in localStorage under its own key.
    storageKey: 'cdars_supabase_auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
