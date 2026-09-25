import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Forced password change after a temporary password — frontend guards.
 *
 * SOURCE-LEVEL regression guards, like authMfaGate.test.js: the Vitest
 * environment is `node` with no DOM, so rendering and focus cannot be observed
 * here. The authoritative enforcement is server-side and is tested for real in
 * backend/tests/Feature/PasswordChangeEnforcementTest.php (every gated route is
 * called directly). These guards pin the frontend shape that keeps the screen
 * consistent with it; the behavioural proof is a browser pass.
 */

const here = dirname(fileURLToPath(import.meta.url));
// Line endings normalised: some sources are CRLF on disk, and the body slicing
// below keys on "\n" boundaries, which must match exactly.
const read = (...p) =>
  readFileSync(join(here, ...p), 'utf8').replace(/\r\n/g, '\n');
const auth = read('AuthContext.jsx');
const login = read('..', 'pages', 'Login.jsx');
const api = read('..', 'services', 'api.js');
const authService = read('..', 'services', 'authService.js');

const body = (source, start, end) => {
  const from = source.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to === -1 ? source.length : to);
};

describe('every admission path goes through the password-change gate', () => {
  const admit = body(
    auth,
    'const admitServerUser = useCallback',
    'const resolveSupabaseSession',
  );

  it('checks reauthentication, then the owed change, before ever setting a user', () => {
    const reauth = admit.indexOf('user.reauthenticationRequired === true');
    const change = admit.indexOf('user.passwordChangeRequired === true');
    const signIn = admit.indexOf('setCurrentUser(user)');
    expect(reauth).toBeGreaterThan(-1);
    expect(change).toBeGreaterThan(reauth);
    expect(signIn).toBeGreaterThan(change);
  });

  it('keeps currentUser null while a change is owed', () => {
    const changeBranch = admit.slice(
      admit.indexOf('user.passwordChangeRequired === true'),
      admit.indexOf('setCurrentUser(user)'),
    );
    expect(changeBranch).toContain('setCurrentUser(null)');
    expect(changeBranch).toContain('setPendingPasswordChange({');
  });

  it('is the only place a server-confirmed user is admitted', () => {
    // The sign-in resolver, the TOTP challenge and the email-code step all
    // delegate; none of them sets the user on its own any more.
    expect(auth.match(/setCurrentUser\(user\)/g)).toHaveLength(1);
    expect(auth.match(/admitServerUser\(user\)/g).length).toBeGreaterThanOrEqual(3);
  });

  it('clears the pending change on every sign-out path', () => {
    for (const start of [
      "if (event === 'SIGNED_OUT')",
      'const cancelMfaChallenge = useCallback',
      'const logout = useCallback',
      'const signOutDueToSessionIssue = useCallback',
    ]) {
      expect(body(auth, start, '}, [')).toContain('setPendingPasswordChange(null)');
    }
  });
});

describe('the change itself', () => {
  const change = body(auth, 'const changePassword = useCallback', '\n  );\n');

  it('posts to the backend endpoint, never directly to Supabase', () => {
    expect(authService).toContain("api.post('/me/password', data)");
    expect(change).toContain('authService.changePassword({');
    expect(change).not.toContain('updateUser(');
  });

  it('signs out after a successful change instead of continuing the session', () => {
    const success = change.slice(change.lastIndexOf('try {'));
    expect(success).toContain('authService.logout()');
    expect(success).toContain('supabase.auth.signOut()');
    expect(success).toContain('setCurrentUser(null)');
  });

  it('routes an expired temporary password to its own state', () => {
    expect(change).toContain('err.flags?.temporaryPasswordExpired');
    expect(change).toContain('setPendingPasswordChange({ expired: true })');
  });

  it('never logs anything', () => {
    expect(change).not.toMatch(/console\./);
    expect(login).not.toMatch(/console\./);
  });
});

describe('Login change-password step', () => {
  it('replaces the sign-in form rather than rendering alongside it', () => {
    const step = login.indexOf(') : pendingPasswordChange ? (');
    const signInForm = login.indexOf('onSubmit={handleSubmit}');
    expect(step).toBeGreaterThan(login.indexOf(') : pendingEmailMfa ? ('));
    expect(signInForm).toBeGreaterThan(step);
  });

  it('explains the requirement and handles the expired state', () => {
    expect(login).toMatch(
      /Your temporary password must be changed before you can\s+continue\./,
    );
    expect(login).toContain('pendingPasswordChange.expired');
  });

  it('never treats a pending change as signed in', () => {
    expect(login.match(/result\.passwordChangeRequired/g).length).toBeGreaterThanOrEqual(4);
  });

  it('clears the typed passwords after every attempt and when the step ends', () => {
    const handler = body(login, 'const handleChangePassword = async', '\n  };\n');
    const afterCall = handler.slice(handler.indexOf('await changePassword('));
    expect(afterCall).toContain("setCurrentTempPassword('')");
    expect(afterCall).toContain("setNewPassword('')");
    expect(afterCall).toContain("setConfirmNewPassword('')");
    expect(login).toContain('if (!pendingPasswordChange) {');
  });

  it('uses password inputs with the right autocomplete hints', () => {
    expect(login).toContain('autoComplete="current-password"');
    expect(login.match(/autoComplete="new-password"/g).length).toBeGreaterThanOrEqual(2);
  });
});

describe('API error flags', () => {
  it('copies only named boolean flags from a refusal', () => {
    expect(api).toContain("if (payload?.[name] === true) flags[name] = true;");
    for (const flag of [
      'passwordChangeRequired',
      'temporaryPasswordExpired',
      'reauthenticationRequired',
      'passwordUpdateFailed',
    ]) {
      expect(api).toContain(`'${flag}'`);
    }
  });
});
