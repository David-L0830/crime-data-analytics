import { createContext, useCallback, useEffect, useState } from 'react';
import { ROLES, PERMISSIONS } from '../utils/constants';
import { authService } from '../services/authService';
import { supabaseMfaService } from '../services/supabaseMfaService';
import { ApiError } from '../services/api';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

export const AuthContext = createContext(null);

// Final auth migration — Supabase Auth is the ONLY authentication system
// this app has (see AUTH_MIGRATION_STATUS.md). There is no more Laravel
// Sanctum session cookie, no username/password login() against this
// backend, and no separate "which provider authenticated this session"
// bookkeeping — every session is a Supabase session. "Remember me" is
// gone too, and deliberately so: the Supabase client persists the session in
// sessionStorage (see supabaseClient.js), which survives a reload but is
// discarded by the browser when the tab or window is closed. Returning to the
// application after closing it therefore requires signing in again — that is
// the intended policy, not a bug, and there is nothing left for this app to
// "remember" on top of it.
//
// TWO-FACTOR AUTHENTICATION IS ENFORCED AT SIGN-IN.
//
// Authenticating a password is not the same as being signed in. Every path
// that produces a Supabase session — email/password, Google, and an
// already-persisted session found on mount — funnels through
// resolveSupabaseSession() below, which decides between two outcomes:
//
//   * the session is good enough        -> currentUser is set, the app opens
//   * a second factor is still owed     -> currentUser stays NULL and
//                                          pendingMfa is set, which is what
//                                          makes Login.jsx render the TOTP
//                                          challenge instead of the app
//
// currentUser staying null is the whole mechanism: ProtectedRoute already
// redirects a null currentUser to /login, so nothing about routing, RBAC or
// any page had to change to make a half-authenticated session unable to reach
// the application.
//
// WHAT THIS IS NOT: it is not "a React variable says MFA is on". Two
// independent checks have to agree before the app opens, and neither of them
// is a boolean this app invented:
//
//   1. supabase-js's own getAuthenticatorAssuranceLevel(), read from the
//      session's signed JWT. Cheap, and it is what avoids a pointless round
//      trip for the common case.
//   2. The backend's answer on GET /user (`mfaRequired`), computed from the
//      cryptographically verified `aal` claim and Supabase's own record of
//      the account's factors. The SERVER WINS: if it says a factor is owed,
//      the challenge is shown even when check 1 said otherwise.
//
// And neither check is load-bearing on its own, because the real gate is
// server-side and unconditional: every protected route requires a completed
// second factor for an enrolled account (EnsureSupabaseAal2 — see
// backend/routes/api.php). Tampering with anything in this file gets an
// attacker a rendered shell that can load no data.
//
// pendingMfa lives in React state and nowhere else — never sessionStorage,
// never localStorage. It holds a factor id, which is not a secret and not the
// TOTP secret; the secret never leaves Supabase and the authenticator app.
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
  const bumpAvatarVersion = useCallback(
    () => setAvatarVersion((v) => v + 1),
    [],
  );
  const avatarSrc = useCallback(
    (url) =>
      url ? `${url}${url.includes('?') ? '&' : '?'}v=${avatarVersion}` : url,
    [avatarVersion],
  );

  // Set when a Supabase session exists but still owes a second factor:
  // { factorId }. Login.jsx renders the TOTP challenge whenever this is
  // non-null. React state only — deliberately never persisted, so closing the
  // tab mid-challenge leaves nothing behind.
  const [pendingMfa, setPendingMfa] = useState(null);
  // Set when an administrator has required a second factor of this account
  // and it has not enrolled one yet. There is nothing to challenge, so the
  // only way forward is enrolment — Login.jsx renders the QR/secret step.
  // currentUser stays null throughout, exactly as it does for a challenge,
  // so nothing protected renders either way.
  const [pendingMfaEnrollment, setPendingMfaEnrollment] = useState(false);

  // Does this session still owe a TOTP challenge?
  //
  // Returns the verified TOTP factor to challenge, or null for "nothing owed".
  //
  // WHY THIS DOES NOT USE getAuthenticatorAssuranceLevel()'s `nextLevel`
  // --------------------------------------------------------------------
  // That would be the obvious call, and Supabase's own example uses it, but
  // called without a JWT argument it performs NO NETWORK REQUEST: it derives
  // `nextLevel` from `session.user.factors` on the session object sitting in
  // storage. Whether the sign-in response populated that array is not
  // something this app controls, and if it did not, `nextLevel` comes back
  // 'aal1' for somebody who is demonstrably enrolled — a silent, total failure
  // of the gate that looks identical to "this user has no MFA".
  //
  // The two halves are therefore taken from the two places that can actually
  // be trusted for them:
  //
  //   * currentLevel — decoded from the session's access token. This is the
  //     signed `aal` claim, the same value the backend verifies, so it needs
  //     no network call to be authoritative.
  //   * whether a verified factor exists — listFactors(), which goes through
  //     getUser() and really does ask Supabase. Slower, and worth it: this is
  //     the half that decides whether anybody is challenged at all.
  //
  // Throws if either half cannot be established. Callers treat that as "cannot
  // safely sign this person in", never as "no MFA needed" — reading an
  // unanswerable question as a negative is how a second factor silently stops
  // applying.
  const totpFactorOwedBySession = useCallback(async () => {
    const { currentLevel } = await supabaseMfaService.getAssuranceLevel();

    // Already stepped up. Nothing to ask for, and no reason to spend a round
    // trip finding that out.
    if (currentLevel === 'aal2') return null;

    const factors = await supabaseMfaService.listFactors();

    // null here means "no verified factor", i.e. genuinely not enrolled — the
    // ordinary case for most accounts, and not an error.
    return supabaseMfaService.selectActiveTotpFactor(factors);
  }, []);

  // THE single place a Supabase access token becomes either a signed-in user
  // or a pending challenge. Every entry point converges here: email/password
  // login, the Google OAuth return, and the mount-time session resync.
  //
  // Order matters. The client-side assurance check runs first because it is
  // nearly free and short-circuits the common enrolled-user case without a
  // round trip. GET /user is then still consulted, and its `mfaRequired`
  // overrides a client-side "all clear" — see this file's header for why the
  // server is the one that decides.
  const resolveSupabaseSession = useCallback(
    async (accessToken) => {
      const factor = await totpFactorOwedBySession();
      if (factor) {
        setCurrentUser(null);
        setPendingMfaEnrollment(false);
        setPendingMfa({ factorId: factor.id });
        return { success: true, mfaRequired: true };
      }

      const user = await authService.currentUserViaSupabaseToken(accessToken);

      if (user.mfaRequired) {
        // A second factor is owed, and the authoritative listFactors() lookup
        // above found none to challenge — so this account has been REQUIRED to
        // use MFA by an administrator and has not enrolled yet. It is not
        // signed in: it is put through enrolment first, and reaches aal2 by
        // verifying the factor it creates.
        //
        // The backend also reports mfaRequired when it could not determine the
        // account's status at all, and routing that here is deliberate rather
        // than a conflation. Enrolment talks to the same Supabase that just
        // could not be reached, so it fails too and nobody gets in — the
        // fail-closed outcome — whereas admitting them would not.
        setCurrentUser(null);
        setPendingMfa(null);
        setPendingMfaEnrollment(true);
        return { success: true, mfaEnrollmentRequired: true };
      }

      setPendingMfa(null);
      setPendingMfaEnrollment(false);
      setCurrentUser(user);
      return { success: true, user };
    },
    [totpFactorOwedBySession],
  );

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
          // Restoring a persisted session takes exactly the same route as a
          // fresh sign-in, which is what stops a reload from being a way
          // around the challenge: the stored session is aal1 until the TOTP
          // code is verified, and resolveSupabaseSession will say so again.
          await resolveSupabaseSession(accessToken);
        }
      } catch {
        /* Supabase session invalid/expired, no matching Laravel user, or the
           assurance level could not be established — stay logged out */
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
      // Any Supabase sign-out, from anywhere, clears a pending challenge.
      //
      // Not redundant with the three places that already clear it themselves:
      // ResetPassword.jsx ends its recovery session directly through
      // supabase-js and never touches AuthContext, so without this a person
      // who reset their password would land on /login looking at a TOTP
      // challenge for a factor id belonging to a session that no longer
      // exists — a form that cannot succeed and gives no clue why.
      if (event === 'SIGNED_OUT') {
        setPendingMfa(null);
        setPendingMfaEnrollment(false);
        setCurrentUser(null);
        return;
      }

      if (
        event !== 'SIGNED_IN' ||
        session?.user?.app_metadata?.provider !== 'google'
      )
        return;

      const accessToken = session.access_token;
      if (!accessToken) return;

      // Same gate as email/password: a Google sign-in that lands on an
      // MFA-enrolled account is NOT finished, it is halfway.
      resolveSupabaseSession(accessToken)
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
            err?.code === 'mfa_factor_missing'
              ? err.message
              : err instanceof ApiError && err.status === 401
                ? 'No BADAC Analytics account is linked to that Google account. Contact your Administrator.'
                : 'Unable to sign in right now. Please try again.',
          );
        });
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginWithEmail = useCallback(
    async (email, password) => {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          error:
            'Sign-in is not configured. Please contact your Administrator.',
        };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Supabase's own message is safe to show as-is for invalid-credential
        // cases (it does not confirm/deny account existence); anything else
        // (network, config) gets a generic message instead of leaking detail.
        const message =
          error.status === 400 || error.status === 401
            ? 'Invalid email or password.'
            : 'Unable to sign in right now. Please try again.';
        return { success: false, error: message };
      }

      const accessToken = data.session?.access_token;
      if (!accessToken) {
        return {
          success: false,
          error: 'Unable to sign in right now. Please try again.',
        };
      }

      try {
        // Resolves to EITHER { success, user } (signed in) or
        // { success, mfaRequired } (a TOTP challenge is owed and pendingMfa
        // is now set). A `success` here does not on its own mean the person
        // is in — Login.jsx branches on mfaRequired.
        return await resolveSupabaseSession(accessToken);
      } catch (err) {
        // Supabase authenticated the person, but no Laravel account is
        // linked (SupabaseTokenValidator never auto-creates one). Don't
        // leave a dangling Supabase session behind for an account that
        // isn't authorized in this application.
        await supabase.auth.signOut().catch(() => {});
        const message =
          err?.code === 'mfa_factor_missing'
            ? err.message
            : err instanceof ApiError && err.status === 401
              ? 'This email is not registered in BADAC Analytics. Contact your Administrator.'
              : 'Unable to sign in right now. Please try again.';
        return { success: false, error: message };
      }
    },
    [resolveSupabaseSession],
  );

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
      return {
        success: false,
        error: 'Unable to start Google sign-in. Please try again.',
      };
    }

    // Success here just means the redirect to Google was initiated.
    return { success: true, redirecting: true };
  }, []);

  // Completes the step-up challenge shown by Login.jsx.
  //
  // challengeAndVerify() is Supabase's own combined challenge + verify call —
  // it is Supabase, not this app, that checks the code, and on success
  // supabase-js swaps the session for an aal2 one. The TOTP secret is never
  // seen, stored or transmitted here.
  //
  // Verification is then confirmed against the BACKEND before anyone is let
  // in: GET /user must come back with authAssuranceLevel 'aal2' and no
  // outstanding mfaRequired. That check reads the server's view of a
  // cryptographically verified JWT claim, so a client that lied about the
  // first step still does not get a user object out of this function.
  const verifyMfaChallenge = useCallback(
    async (code, factorIdOverride) => {
      const factorId = factorIdOverride ?? pendingMfa?.factorId;
      if (!factorId) {
        return {
          success: false,
          error: 'This verification session has expired. Please sign in again.',
        };
      }

      try {
        await supabaseMfaService.challengeAndVerify(
          factorId,
          String(code).trim(),
        );

        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          return {
            success: false,
            error:
              'Your session ended during verification. Please sign in again.',
          };
        }

        const user = await authService.currentUserViaSupabaseToken(accessToken);
        if (user.authAssuranceLevel !== 'aal2' || user.mfaRequired) {
          return {
            success: false,
            error: 'Verification did not complete. Please try again.',
          };
        }

        setPendingMfa(null);
        setPendingMfaEnrollment(false);
        setCurrentUser(user);
        return { success: true, user };
      } catch (err) {
        // Supabase distinguishes a wrong code from an expired challenge, and
        // both are things the person can act on, so its own message is kept
        // where there is one. Anything else stays generic.
        return {
          success: false,
          error:
            err?.message ||
            'That code is invalid or has expired. Please try again.',
        };
      }
    },
    [pendingMfa],
  );

  // Begins TOTP enrolment for an account an administrator has required MFA
  // of. Returns what the screen needs to draw — { id, totp: { qr_code, secret,
  // uri } } — straight from Supabase.
  //
  // Runs at aal1 on purpose, and Supabase permits exactly that for an account
  // with no verified factor: it is the only way such a session can ever reach
  // aal2, since there is nothing yet to challenge. The secret is created by
  // Supabase and shown only to the person enrolling; it never reaches this
  // application's backend, and no administrator can see it.
  //
  // Clears an abandoned unverified factor from an earlier attempt first, the
  // same housekeeping the self-service panel does.
  const startMfaEnrollment = useCallback(async () => {
    const factors = await supabaseMfaService.listFactors();
    const stale = (factors?.all ?? []).find((f) => f.status === 'unverified');
    if (stale) await supabaseMfaService.unenroll(stale.id).catch(() => {});

    return supabaseMfaService.enroll();
  }, []);

  // Abandoning the challenge. This must actually END the Supabase session
  // rather than only clearing React state: an aal1 session left alive would
  // be picked up again by the mount-time resync on the next page load. The
  // POST /logout audit write is deliberately skipped — no sign-in ever
  // completed, so there is no session to record the end of.
  const cancelMfaChallenge = useCallback(async () => {
    await supabase.auth.signOut().catch(() => {});
    setPendingMfa(null);
    setPendingMfaEnrollment(false);
    setCurrentUser(null);
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
      setPendingMfa(null);
      setPendingMfaEnrollment(false);
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
      setPendingMfa(null);
      setPendingMfaEnrollment(false);
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
    [currentUser],
  );

  const can = useCallback(
    (permission) => {
      if (!currentUser) return false;
      const perms = PERMISSIONS[currentUser.role] || [];
      return perms.includes(permission);
    },
    [currentUser],
  );

  const value = {
    currentUser,
    initializing,
    loginWithEmail,
    loginWithGoogle,
    // Non-null means a verified authenticator factor exists for this session
    // and its code has not been entered yet. currentUser is null while this
    // is set, so nothing protected renders.
    pendingMfa,
    // True when MFA is required of this account but nothing is enrolled yet,
    // so the way forward is enrolment rather than a challenge.
    pendingMfaEnrollment,
    startMfaEnrollment,
    verifyMfaChallenge,
    cancelMfaChallenge,
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
