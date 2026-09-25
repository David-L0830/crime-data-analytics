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
    // The four entry points that turn a Supabase session into an app
    // session. Each must hand off to resolveSupabaseSession, which is the
    // only function permitted to decide between "signed in" and "owes a
    // code". A new entry point that calls setCurrentUser itself is exactly
    // the regression this catches. The fourth is the mid-session resync that
    // answers a credential-state refusal (a reissued temporary password).
    const handoffs = authContext.match(
      /resolveSupabaseSession\(accessToken\)/g,
    );
    expect(
      handoffs,
      'login, OAuth return, mount resync and credential-state resync must all use it',
    ).toHaveLength(4);
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

// ---------------------------------------------------------------------------
// Email one-time-code MFA. Same source-level caveat as the rest of this file:
// the enforceable proof is backend/tests/Feature/EmailMfaTest.php. These pin
// the structural shape that would silently let an email-MFA session in.
// ---------------------------------------------------------------------------
describe('Email MFA gate', () => {
  const emailService = read('../services/emailMfaService.js');

  it('routes a session owing email MFA to the code step with no user set', () => {
    const start = authContext.indexOf(
      "if (user.mfaRequired && user.mfaMethod === 'email_otp')",
    );
    expect(start).toBeGreaterThan(-1);

    const branch = authContext.slice(start, start + 400);
    expect(branch).toContain('setCurrentUser(null)');
    expect(branch).toContain('setPendingEmailMfa(true)');

    // Decided before the enrolment branch, so an email-configured account is
    // never sent to authenticator setup instead.
    expect(start).toBeLessThan(authContext.indexOf('if (user.mfaRequired)'));
  });

  it('requires the server to report no factor owed before completing email verification', () => {
    const start = authContext.indexOf('const verifyEmailMfaCode');
    expect(start).toBeGreaterThan(-1);

    const body = authContext.slice(start, authContext.indexOf('const startMfaEnrollment'));
    const serverCheck = body.indexOf('user.mfaRequired !== false');
    // Sign-in now goes through admitServerUser (the shared last step that also
    // applies the forced-password-change gate); the server check must still
    // come first.
    const signIn = body.indexOf('admitServerUser(user)');
    expect(serverCheck).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(-1);
    expect(serverCheck).toBeLessThan(signIn);
  });

  it('clears email MFA state when the challenge is abandoned', () => {
    const cancelStart = authContext.indexOf('const cancelMfaChallenge');
    expect(authContext.slice(cancelStart, cancelStart + 400)).toContain(
      'setPendingEmailMfa(false)',
    );
  });

  it('renders the email step instead of the password form', () => {
    expect(login).toContain(') : pendingEmailMfa ? (');
    expect(login).toContain('verifyEmailMfaCode(code)');
  });

  it('never tells the server which account or address to send a code to', () => {
    const code = emailService
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("api.post('/mfa/email/send')");
    expect(code).toContain("api.post('/mfa/email/verify', { code })");
    expect(code).not.toMatch(/email\s*:|userId|user_id|session/i);
  });
});

// ---------------------------------------------------------------------------
// Email MFA automatic first send. The send-once guard itself is exercised
// behaviourally in src/utils/emailMfaAutoSend.test.js; these pin that the app
// is wired to it, and that no second sending path was introduced.
// ---------------------------------------------------------------------------
describe('Email MFA automatic send wiring', () => {
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const loginCode = stripComments(login);
  const authCode = stripComments(authContext);

  it('sends automatically through the shared guard when the email step is reached', () => {
    expect(loginCode).toMatch(
      /useEffect\(\(\) => \{\s*if \(!pendingEmailMfa\) return;\s*emailMfaAutoSend\.trigger\(\(\) => sendEmailCode\(\{ automatic: true \}\)\);\s*\}, \[pendingEmailMfa\]\);/,
    );
  });

  it('resets the guard from the always-mounted provider when the step ends', () => {
    expect(authCode).toMatch(
      /useEffect\(\(\) => \{\s*if \(!pendingEmailMfa\) emailMfaAutoSend\.reset\(\);\s*\}, \[pendingEmailMfa\]\);/,
    );
  });

  it('keeps the manual resend outside the guard and on the button', () => {
    expect(loginCode).toContain(
      'const handleSendEmailCode = () => sendEmailCode({ automatic: false });',
    );
    expect(loginCode).toContain('onClick={handleSendEmailCode}');
    expect(loginCode).toContain("'Resend code'");
    expect(loginCode).toContain('resendSeconds > 0');
  });

  it('reuses the one existing send path rather than adding another', () => {
    // Login reaches the backend only through AuthContext.sendEmailMfaCode,
    // exactly once, and never talks to the API or the service directly.
    expect(loginCode.match(/sendEmailMfaCode\(\)/g)).toHaveLength(1);
    expect(loginCode).not.toMatch(/emailMfaService|\bapi\.(post|get)\(/);
    expect(authCode.match(/emailMfaService\.sendCode\(\)/g)).toHaveLength(1);
  });

  it('only reports "already sent" for a throttled send, as flagged by AuthContext', () => {
    expect(authCode).toContain(
      'rateLimited: err instanceof ApiError && err.status === 429',
    );
    expect(loginCode).toContain('classifyEmailMfaSend(result, { automatic })');
  });
});

// ---------------------------------------------------------------------------
// TOTP → email handoff for an email_otp account that also holds a verified
// authenticator. Both factors stay required — the enforceable proof is
// EmailMfaTest::test_an_email_otp_account_with_a_verified_factor_needs_both_
// the_email_code_and_aal2. These pin that the frontend moves on to the email
// step instead of dead-ending, and that the move signs nobody in.
// ---------------------------------------------------------------------------
describe('TOTP to email MFA handoff', () => {
  const start = authContext.indexOf('const verifyMfaChallenge');
  const body = authContext.slice(
    start,
    authContext.indexOf('const sendEmailMfaCode'),
  );
  const handoffAt = body.indexOf("user.authAssuranceLevel === 'aal2' &&");
  const refusalAt = body.indexOf(
    "user.authAssuranceLevel !== 'aal2' || user.mfaRequired",
  );
  // Admission goes through admitServerUser, the shared last step that also
  // applies the forced-password-change gate.
  const signInAt = body.indexOf('admitServerUser(user)');

  it('hands off only once the server confirms aal2 and an emailed code is still owed', () => {
    expect(start).toBeGreaterThan(-1);
    expect(handoffAt).toBeGreaterThan(-1);
    const condition = body.slice(handoffAt, body.indexOf(') {', handoffAt));
    expect(condition).toContain("user.authAssuranceLevel === 'aal2'");
    expect(condition).toContain('user.mfaRequired === true');
    expect(condition).toContain("user.mfaMethod === 'email_otp'");
  });

  it('signs nobody in on the handoff', () => {
    const branch = body.slice(handoffAt, body.indexOf('return', handoffAt));
    expect(branch).toContain('setCurrentUser(null)');
    expect(branch).toContain('setPendingMfa(null)');
    expect(branch).toContain('setPendingEmailMfa(true)');
    expect(branch).not.toContain('setCurrentUser(user)');
  });

  it('keeps the original refusal in front of every sign-in from a TOTP verification', () => {
    expect(refusalAt).toBeGreaterThan(handoffAt);
    expect(signInAt).toBeGreaterThan(refusalAt);
  });

  it('still challenges an aal1 session for TOTP before it can reach the email step', () => {
    const resolver = authContext.slice(
      authContext.indexOf('const resolveSupabaseSession'),
    );
    expect(resolver.indexOf('totpFactorOwedBySession()')).toBeLessThan(
      resolver.indexOf("user.mfaMethod === 'email_otp'"),
    );
  });

  it('lets the Login handlers stop before the welcome toast on a handoff', () => {
    for (const handler of ['const handleVerify', 'const handleEnrollVerify']) {
      const at = login.indexOf(handler);
      const handlerBody = login.slice(at, login.indexOf('};', at));
      // The handoff condition now also stops on a forced password change.
      const handoff = handlerBody.search(
        /result\.success &&\s*\(result\.mfaRequired \|\| result\.passwordChangeRequired\)/,
      );
      expect(handoff, handler).toBeGreaterThan(-1);
      expect(handoff, handler).toBeLessThan(handlerBody.indexOf('showToast(`Welcome back'));
    }
  });

  it('renders the email step once the TOTP challenge is cleared', () => {
    expect(login.indexOf(') : pendingMfa ? (')).toBeLessThan(
      login.indexOf(') : pendingEmailMfa ? ('),
    );
  });
});
