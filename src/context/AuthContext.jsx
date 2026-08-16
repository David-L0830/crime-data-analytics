import { createContext, useCallback, useEffect, useState } from 'react';
import { ROLES, PERMISSIONS } from '../utils/constants';
import { authService } from '../services/authService';
import { ApiError } from '../services/api';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

export const AuthContext = createContext(null);

// Final auth migration — Supabase Auth is the ONLY authentication system
// this app has (see AUTH_MIGRATION_STATUS.md). There is no more Laravel
// Sanctum session cookie, no username/password login() against this
// backend, and no separate "which provider authenticated this session"
// bookkeeping — every session is a Supabase session. "Remember me" is
// gone too: Supabase's own client already persists the session in
// localStorage across reloads (see supabaseClient.js), so there's nothing
// left for this app to remember on top of that.
//
// Two-factor authentication (Supabase MFA / aal2 step-up) has been removed
// from the sign-in flow — a successful Supabase authentication (email/
// password, Google, or an already-persisted session on mount) now always
// resolves straight to a signed-in user. A user MAY still have a verified
// Supabase TOTP factor from before this change (see
// components/settings/TwoFactorSelfService.jsx, which still lets someone
// optionally manage one), but nothing in this app checks its `aal` claim
// anymore — the backend no longer requires aal2 on any route either (see
// backend/routes/api.php).
//
// On mount, the only question is "does a Supabase session already exist"
// (supabase.auth.getSession()) — if so, resolve it into a local user via
// finishSupabaseLogin, same as every other place a Supabase access token
// gets turned into a local user (email/password login, Google OAuth).
export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  // Set only when a fresh Google sign-in authenticates with Supabase but
  // resolves to no local Laravel account. Login.jsx surfaces this the same
  // way it surfaces any other sign-in error.
  const [authInitError, setAuthInitError] = useState('');
  // Checkpoint 38 — cache-busting for the avatar image. The backend may
  // return the exact same avatarUrl string after a re-upload (e.g. if it
  // overwrites the file in place rather than generating a new filename per
  // upload), in which case a plain <img src={avatarUrl}> would keep showing
  // the browser's cached copy of the old image even though currentUser has
  // been updated. bumpAvatarVersion() is called right after a successful
  // upload (see ProfileSettingsModal) and its value is appended as a query
  // param wherever avatarUrl is rendered (see avatarSrc below), forcing a
  // fresh fetch regardless of what the backend's URL looks like.
  const [avatarVersion, setAvatarVersion] = useState(0);
  const bumpAvatarVersion = useCallback(() => setAvatarVersion((v) => v + 1), []);
  const avatarSrc = useCallback(
    (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}v=${avatarVersion}` : url),
    [avatarVersion]
  );

  // Shared by loginWithEmail, the Google onAuthStateChange listener below,
  // AND the mount-time resync effect right after this — every place a
  // Supabase access token gets resolved into a local user converges here.
  const finishSupabaseLogin = useCallback(async (accessToken) => {
    const user = await authService.currentUserViaSupabaseToken(accessToken);
    setCurrentUser(user);
    return { success: true, user };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isSupabaseConfigured) {
        if (!cancelled) setInitializing(false);
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (accessToken && !cancelled) {
          await finishSupabaseLogin(accessToken);
        }
      } catch {
        /* Supabase session invalid/expired or no matching Laravel user — stay logged out */
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Google OAuth via Supabase. signInWithOAuth() below is a full browser
  // redirect (Login -> Supabase -> Google -> Supabase -> back to this
  // app), not a call with a synchronous result, so unlike loginWithEmail
  // there is nothing to resolve at the call site. The actual login is
  // finished here, in an onAuthStateChange listener, once supabase-js's
  // own detectSessionInUrl (see supabaseClient.js) parses the returned
  // session on the app's next mount.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' || session?.user?.app_metadata?.provider !== 'google') return;

      const accessToken = session.access_token;
      if (!accessToken) return;

      finishSupabaseLogin(accessToken)
        .then(() => {
          setAuthInitError('');
        })
        .catch(async (err) => {
          // A successful Google-via-Supabase login does NOT by itself
          // authorize access. Never auto-create a Laravel account; don't
          // leave a dangling Supabase session behind for an account this
          // app doesn't know.
          await supabase.auth.signOut().catch(() => {});
          setAuthInitError(
            err instanceof ApiError && err.status === 401
              ? 'No BADAC Analytics account is linked to that Google account. Contact your Administrator.'
              : 'Unable to sign in right now. Please try again.'
          );
        });
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginWithEmail = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Sign-in is not configured. Please contact your Administrator.' };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Supabase's own message is safe to show as-is for invalid-credential
      // cases (it does not confirm/deny account existence); anything else
      // (network, config) gets a generic message instead of leaking detail.
      const message =
        error.status === 400 || error.status === 401 ? 'Invalid email or password.' : 'Unable to sign in right now. Please try again.';
      return { success: false, error: message };
    }

    const accessToken = data.session?.access_token;
    if (!accessToken) {
      return { success: false, error: 'Unable to sign in right now. Please try again.' };
    }

    try {
      // Resolves straight to { success, user } — MFA step-up is no longer
      // part of this flow.
      return await finishSupabaseLogin(accessToken);
    } catch (err) {
      // Supabase authenticated the person, but no Laravel account is
      // linked (SupabaseTokenValidator never auto-creates one). Don't
      // leave a dangling Supabase session behind for an account that
      // isn't authorized in this application.
      await supabase.auth.signOut().catch(() => {});
      const message =
        err instanceof ApiError && err.status === 401
          ? 'This email is not registered in BADAC Analytics. Contact your Administrator.'
          : 'Unable to sign in right now. Please try again.';
      return { success: false, error: message };
    }
  }, [finishSupabaseLogin]);

  const loginWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Google sign-in is not configured.' };
    }

    setAuthInitError('');

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Land back on the login page — the SIGNED_IN listener above and
        // the mount-time session check both already know how to pick up a
        // Supabase session from there, exactly like a page refresh does
        // for an email/password login.
        redirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      return { success: false, error: 'Unable to start Google sign-in. Please try again.' };
    }

    // Success here just means the redirect to Google was initiated.
    return { success: true, redirecting: true };
  }, []);

  const logout = useCallback(async () => {
    // Best-effort audit-log write while the token is still valid, then end
    // the Supabase session — the actual sign-out.
    try {
      await authService.logout();
    } catch {
      /* token already invalid/expired — nothing to log, still sign out below */
    } finally {
      await supabase.auth.signOut().catch(() => {});
      setCurrentUser(null);
      setAuthInitError('');
    }
  }, []);

  // Used by DataContext when a protected API call comes back 401 while
  // currentUser is set — i.e. the session that got us into the app is no
  // longer good enough (expired, or the JWT's aal dropped back to aal1
  // some other way). currentUser must never stay set once the backend has
  // told us its assurance level is insufficient — leaving it set would
  // strand the user on a dashboard that can't load any protected data,
  // showing the same error on every request. Same steps as logout(), but
  // surfaces `message` on the login screen instead of clearing it, so the
  // person understands why they were signed out.
  const signOutDueToSessionIssue = useCallback(async (message) => {
    try {
      await authService.logout();
    } catch {
      /* token already invalid/expired — nothing to log, still sign out below */
    } finally {
      await supabase.auth.signOut().catch(() => {});
      setCurrentUser(null);
      setAuthInitError(message);
    }
  }, []);

  // Sidebar Profile Settings. Lets ProfileSettingsModal (name edit / avatar
  // upload) push the updated UserResource it gets back from
  // authService.updateProfile()/uploadAvatar() straight into currentUser,
  // the same object every other part of the app (Sidebar, Header, etc.)
  // already reads from — no separate "profile" piece of state to keep in
  // sync.
  const updateCurrentUser = useCallback((patch) => {
    setCurrentUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const hasAccess = useCallback(
    (module) => {
      if (!currentUser) return false;
      const role = ROLES[currentUser.role];
      return Boolean(role && role.modules.includes(module));
    },
    [currentUser]
  );

  const can = useCallback(
    (permission) => {
      if (!currentUser) return false;
      const perms = PERMISSIONS[currentUser.role] || [];
      return perms.includes(permission);
    },
    [currentUser]
  );

  const value = {
    currentUser,
    initializing,
    loginWithEmail,
    loginWithGoogle,
    authInitError,
    logout,
    signOutDueToSessionIssue,
    updateCurrentUser,
    hasAccess,
    can,
    role: currentUser ? ROLES[currentUser.role] : null,
    avatarSrc,
    bumpAvatarVersion,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
