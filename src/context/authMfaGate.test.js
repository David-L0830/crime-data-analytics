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

    const branch = authContext.slice(start, start + 2200);
    expect(branch).toContain('setCurrentUser(null)');
    // Enrolment is still forced — the value is truthy in both cases — but it
    // now carries WHY, so the screen can stop guessing. See the
    // "Enrolment message attribution" block below.
    expect(branch).toMatch(/setPendingMfaEnrollment\(\s*\n?\s*user\.mfaRequiredByAdmin === true/);
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

// ---------------------------------------------------------------------------
// Regression guard for the 2026-09-03 production incident.
//
// A rejected Supabase service-role credential made every security-state lookup
// throw. UserResource fails CLOSED for mfaRequired (true) and SOFT for
// mfaRequiredByAdmin (false), so GET /user returned the pair that means
// "status unknown" — and the login screen rendered a hardcoded sentence
// telling the person their ADMINISTRATOR had required two-factor
// authentication. That was false for every account it was shown to: not one of
// them had app_metadata.mfa_required set. An Encoder was pushed into enrolling
// on the strength of a policy that did not exist.
//
// Enforcement stayed correct throughout and must not be weakened here. What
// these tests pin is that the UI cannot again ASSERT a cause it has not
// established.
// ---------------------------------------------------------------------------
describe('Enrolment message attribution', () => {
  it('distinguishes an administrator requirement from an unverifiable status', () => {
    // The two reasons must be separate values, decided from the one field that
    // actually carries an administrator's intent.
    expect(authContext).toContain("'admin_required'");
    expect(authContext).toContain("'status_unknown'");
    expect(authContext).toContain('user.mfaRequiredByAdmin === true');
  });

  it('only claims an administrator required MFA when that is established', () => {
    // The literal claim must sit behind an explicit admin_required check.
    const claim = 'Your administrator requires two-factor authentication';
    const claimAt = login.indexOf(claim);
    expect(claimAt, 'the admin-required wording should still exist').toBeGreaterThan(-1);

    const guardAt = login.indexOf(
      "pendingMfaEnrollment === 'admin_required'",
    );
    expect(guardAt, 'the claim must be guarded').toBeGreaterThan(-1);
    expect(
      guardAt,
      'the guard must come before the sentence it guards',
    ).toBeLessThan(claimAt);
  });

  it('never renders the administrator claim unconditionally', () => {
    // The exact defect: the sentence used to sit directly under
    // `{pendingMfaEnrollment ? (` with nothing distinguishing the two reasons,
    // so it was shown for BOTH. If that shape ever returns, the guard above
    // would still pass while the claim was once again unconditional.
    const branchAt = login.indexOf('{pendingMfaEnrollment ? (');
    const claimAt = login.indexOf(
      'Your administrator requires two-factor authentication',
    );
    const guardAt = login.indexOf("pendingMfaEnrollment === 'admin_required'");

    expect(branchAt).toBeGreaterThan(-1);
    expect(
      guardAt > branchAt && guardAt < claimAt,
      'the admin claim must be nested inside a reason check, not the bare enrolment branch',
    ).toBe(true);
  });

  it('tells the person the status could not be verified in the unknown case', () => {
    // The honest alternative must actually exist — a guard with no second
    // branch would just hide the message and leave a blank explanation.
    expect(login).toMatch(/could not verify this account/i);
  });

  it('still blocks sign-in for both reasons', () => {
    // The whole point is that only the WORDING changes. Both reasons must keep
    // clearing currentUser and holding the person on the enrolment screen.
    //
    // Bounded to the mfaRequired branch itself — it ends at its own return —
    // so this cannot accidentally read the success path that follows, which
    // legitimately calls setCurrentUser(user).
    const start = authContext.indexOf('if (user.mfaRequired)');
    const end = authContext.indexOf('mfaEnrollmentRequired: true', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const branch = authContext.slice(start, end);
    expect(branch).toContain('setCurrentUser(null)');
    expect(branch).not.toContain('setCurrentUser(user)');
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
