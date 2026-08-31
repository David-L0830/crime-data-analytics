import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: the login flow must not sign somebody in before their
 * second factor has been verified.
 *
 * WHAT THIS TEST DOES AND DOES NOT PROVE
 * --------------------------------------
 * This is a SOURCE-LEVEL guard, matching the existing suite's approach (see
 * components/incidents/incidentModalFocus.test.js for the same rationale).
 * Vitest runs here in a Node environment with no DOM (see vitest.config.js),
 * so React state transitions cannot be observed, and adding jsdom would mean
 * new dependencies and a config change.
 *
 * What it pins is the structural shape of the gate, because the way this
 * feature regresses is structural: somebody calls setCurrentUser() straight
 * off a fresh access token, the way loginWithEmail did before, and the
 * challenge silently stops happening for everyone. Nothing about the app
 * looks broken when that happens — non-enrolled accounts, which are most of
 * them, behave identically.
 *
 * The BEHAVIOURAL proof lives on the backend, where it belongs and where it
 * is actually enforceable: backend/tests/Feature/MfaEnforcementTest.php
 * asserts that an aal1 session belonging to an account with a verified factor
 * is refused by every protected route, in both directions, and that no route
 * can quietly opt out of that gate. Even if every assertion in this file were
 * defeated, such a session would render a shell that can load no data.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(here, relative), 'utf8');

const authContext = read('AuthContext.jsx');
const login = read('../pages/Login.jsx');

describe('AuthContext MFA gate', () => {
  it('routes every access token through one resolver rather than setting the user directly', () => {
    // The three entry points that turn a Supabase session into an app
    // session. Each must hand off to resolveSupabaseSession, which is the
    // only function permitted to decide between "signed in" and "owes a
    // code". A new entry point that calls setCurrentUser itself is exactly
    // the regression this catches.
    const handoffs = authContext.match(
      /resolveSupabaseSession\(accessToken\)/g,
    );
    expect(
      handoffs,
      'login, OAuth return, and mount resync must all use it',
    ).toHaveLength(3);
  });

  it('consults the assurance level before the user is ever set', () => {
    const resolverStart = authContext.indexOf('const resolveSupabaseSession');
    expect(resolverStart).toBeGreaterThan(-1);

    const resolverBody = authContext.slice(resolverStart);
    const assuranceCheck = resolverBody.indexOf('totpFactorOwedBySession()');
    const firstUserSet = resolverBody.indexOf('setCurrentUser');

    expect(assuranceCheck).toBeGreaterThan(-1);
    expect(firstUserSet).toBeGreaterThan(-1);
    expect(
      assuranceCheck,
      'the assurance check must run before anything sets currentUser',
    ).toBeLessThan(firstUserSet);
  });

  it('treats the server response as final when it says a factor is owed', () => {
    // The client-side check exists to avoid a round trip, not to be the
    // authority. If the backend reports mfaRequired the challenge is shown
    // regardless of what supabase-js said a moment earlier.
    expect(authContext).toContain('if (user.mfaRequired)');
  });

  it('requires a verified aal2 session from the server before completing a challenge', () => {
    // Never "challengeAndVerify resolved, therefore signed in". The backend's
    // view of the verified `aal` claim is re-read and must agree.
    expect(authContext).toContain(
      "user.authAssuranceLevel !== 'aal2' || user.mfaRequired",
    );
  });

  it('ends the Supabase session when a challenge is abandoned', () => {
    // Clearing React state alone would leave a live aal1 session that the
    // mount-time resync would pick up again on the next page load.
    const cancelStart = authContext.indexOf('const cancelMfaChallenge');
    expect(cancelStart).toBeGreaterThan(-1);
    expect(authContext.slice(cancelStart, cancelStart + 400)).toContain(
      'supabase.auth.signOut()',
    );
  });

  it('keeps the pending challenge out of browser storage', () => {
    // A factor id is not a secret, but persisting any part of a half-finished
    // authentication invites it being treated as one, and the TOTP secret
    // must never be anywhere near this app in the first place.
    //
    // Asserted against the CODE with comments stripped. Both words appear
    // legitimately in this file's prose — describing where supabase-js keeps
    // the session, and stating that the pending challenge is deliberately
    // kept out of both — and a sentence ending in "never localStorage."
    // defeats any pattern that tries to tell code from prose by punctuation.
    const code = authContext
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/(?:local|session)Storage/);
  });
});

describe('Admin-required MFA enrolment', () => {
  it('routes a required-but-not-enrolled account to enrolment, not into the app', () => {
    // The account owes a factor it does not have yet. currentUser must stay
    // null — that is what keeps ProtectedRoute from rendering anything — and
    // the enrolment state is what Login branches on.
    const start = authContext.indexOf('if (user.mfaRequired)');
    expect(start).toBeGreaterThan(-1);

    const branch = authContext.slice(start, start + 900);
    expect(branch).toContain('setCurrentUser(null)');
    expect(branch).toContain('setPendingMfaEnrollment(true)');
  });

  it('verifies a freshly enrolled factor through the same server-confirmed path', () => {
    // Enrolment must not be its own trust path. Login passes the new factor's
    // id to verifyMfaChallenge, which still re-reads GET /user and requires a
    // real aal2 before anyone is signed in.
    expect(authContext).toContain('async (code, factorIdOverride) => {');
    expect(login).toContain('verifyMfaChallenge(code, enrollData.id)');
  });

  it('never sends the enrolment secret anywhere', () => {
    // The QR code and secret come from Supabase to this browser and stop
    // there. Nothing may post them to this application's backend — an
    // administrator requiring MFA must never be able to learn them.
    const code = login
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/userService\.[a-zA-Z]+\([^)]*secret/);
    expect(code).not.toMatch(/api\.(post|put)\([^)]*secret/);
  });

  it('clears enrolment state when the challenge is abandoned', () => {
    const cancelStart = authContext.indexOf('const cancelMfaChallenge');
    expect(authContext.slice(cancelStart, cancelStart + 400)).toContain(
      'setPendingMfaEnrollment(false)',
    );
  });
});

describe('Login challenge step', () => {
  it('renders the challenge instead of the password form, not alongside it', () => {
    // One three-way branch — enrolment, challenge, password — not extra markup
    // layered onto the password form. There must be no state in which a
    // half-authenticated session is looking at something that starts a second
    // sign-in.
    expect(login).toContain('{pendingMfaEnrollment ? (');
    expect(login).toContain(') : pendingMfa ? (');
  });

  it('does not treat a successful password submit as being signed in', () => {
    expect(login).toContain('if (result.mfaRequired)');
    // The welcome toast must sit after that early return, so it cannot fire
    // for a session that still owes a code.
    expect(login.indexOf('if (result.mfaRequired)')).toBeLessThan(
      login.indexOf('showToast(`Welcome back'),
    );
  });
});
