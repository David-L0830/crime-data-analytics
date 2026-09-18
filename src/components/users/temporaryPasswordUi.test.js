import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Temporary-password UI (Phase 3) — SOURCE-LEVEL wiring guards.
 *
 * The Vitest environment is `node` with no DOM, so these React components
 * cannot be rendered or clicked here. Every rule that CAN be exercised directly
 * is, in src/utils/temporaryPassword.test.js (generation, validation, copy,
 * masking, status label) and src/services/apiCredentialState.test.js (the
 * mid-session signal). What remains below pins the component wiring those
 * tests cannot reach; the behavioural proof is a browser pass.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), 'utf8');

const createModal = read('CreateUserModal.jsx');
const reissueModal = read('ReissueTemporaryPasswordModal.jsx');
const oneTime = read('OneTimeCredentialModal.jsx');
const input = read('TemporaryPasswordInput.jsx');
const page = read('..', '..', 'pages', 'UserManagement.jsx');
const service = read('..', '..', 'services', 'userService.js');
const auth = read('..', '..', 'context', 'AuthContext.jsx');
const login = read('..', '..', 'pages', 'Login.jsx');

const newUiFiles = { createModal, reissueModal, oneTime, input };

const between = (source, start, end) => {
  const from = source.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to === -1 ? source.length : to);
};

describe('the password never leaves component memory', () => {
  it.each(Object.entries(newUiFiles))('%s uses no storage, console, URL or analytics', (_name, source) => {
    expect(source).not.toMatch(/localStorage|sessionStorage|console\.|URLSearchParams|window\.location|gtag|analytics/);
  });

  it('the create form clears the password on success and on close', () => {
    const reset = between(createModal, 'const reset = () => {', '\n  };');
    expect(reset).toContain("setTemporaryPassword('')");
    expect(between(createModal, 'const close = () => {', '\n  };')).toContain('reset()');
    expect(between(createModal, 'const handleSubmit = async', '\n  };\n')).toContain('else reset()');
  });

  it('the create form sends the password only when one was entered, untrimmed', () => {
    const submit = between(createModal, 'const handleSubmit = async', '\n  };\n');
    expect(submit).toContain("if (temporaryPassword !== '') payload.temporaryPassword = temporaryPassword;");
    expect(submit).not.toContain('temporaryPassword.trim()');
  });

  it('the reissue dialog clears the password on close and on success', () => {
    expect(between(reissueModal, 'const close = () => {', '\n  };')).toContain("setPassword('')");
    const confirm = between(reissueModal, 'const confirm = async', '\n  };\n');
    expect(confirm.indexOf("setPassword('')")).toBeLessThan(confirm.indexOf('onIssued('));
    expect(reissueModal).toContain("if (!user) {\n      setPassword('');");
  });

  it('the one-time display is cleared by closing it', () => {
    expect(page).toContain('onClose={() => setOneTimeCredential(null)}');
    // Always starts masked for a new credential.
    expect(oneTime).toContain('setVisible(false);');
    expect(oneTime).toContain('maskPassword(credential?.password)');
  });
});

describe('create account flow', () => {
  const handleCreate = between(page, 'const handleCreate = async', 'const handleSaveEdit');

  it('shows the password once and skips the setup email on the temporary-password path', () => {
    const tempBranch = handleCreate.indexOf('if (payload.temporaryPassword) {');
    const emailSend = handleCreate.indexOf('await sendPasswordEmail(created)');
    expect(tempBranch).toBeGreaterThan(-1);
    expect(emailSend).toBeGreaterThan(tempBranch);

    const branch = handleCreate.slice(tempBranch, emailSend);
    expect(branch).toContain('setOneTimeCredential({');
    expect(branch).toContain('password: payload.temporaryPassword');
    expect(branch).toContain('expiresAt: created.temporaryCredentialExpiresAt');
    expect(branch).toContain('return undefined;');
  });

  it('keeps the original setup-email path when no temporary password is given', () => {
    expect(handleCreate).toContain('await sendPasswordEmail(created)');
  });
});

describe('one-time display', () => {
  it('labels the password, shows the expiry, and warns it will not be shown again', () => {
    expect(oneTime).toContain('Temporary Password');
    expect(oneTime).toContain('Expires:');
    expect(oneTime).toContain('This password will not be shown again after this window is closed.');
    expect(oneTime).toContain('copyToClipboard(');
  });

  it('never fetches the password from the server', () => {
    expect(oneTime).not.toMatch(/userService|api\.|fetch\(/);
  });
});

describe('reissue', () => {
  it('posts only the password to the route of the chosen account', () => {
    expect(service).toContain('api.post(`/users/${id}/temporary-password`, { temporaryPassword })');
  });

  it('is an administrator row action that cannot target yourself or an inactive account', () => {
    const item = between(page, "key: 'temporary-password'", "onSelect: () => setReissueUser(user)");
    expect(item).toContain("label: 'Reissue Temporary Password'");
    expect(item).toContain('disabled: isSelf || !user.isActive');
    // The row menu only exists in the administrator branch of the page.
    expect(page.indexOf('if (!isAdmin) {')).toBeLessThan(page.indexOf('const rowMenu = (user) =>'));
  });

  it('confirms before reissuing and explains the consequence', () => {
    expect(reissueModal).toContain('ConfirmActionModal');
    expect(reissueModal).toContain('title="Reissue Temporary Password"');
    expect(reissueModal).toMatch(/replaces any temporary password issued before/);
  });

  it('generates with the secure generator and validates before submitting', () => {
    expect(reissueModal).toContain('generateTemporaryPassword()');
    const confirm = between(reissueModal, 'const confirm = async', '\n  };\n');
    expect(confirm.indexOf('validateTemporaryPassword(')).toBeLessThan(
      confirm.indexOf('userService.issueTemporaryPassword('),
    );
  });
});

describe('status and shared input', () => {
  it('shows a state badge from the administrator-only status field', () => {
    expect(page).toContain('temporaryCredentialLabel(row)');
  });

  it('offers show/hide, generate and copy on the input', () => {
    expect(input).toContain("type={visible ? 'text' : 'password'}");
    expect(input).toContain('generateTemporaryPassword()');
    expect(input).toContain('copyToClipboard(value)');
    expect(input).toContain('autoComplete="new-password"');
  });
});

describe('mid-session and expiry', () => {
  it('re-runs the existing resolver when a credential-state refusal is announced', () => {
    const listener = between(auth, 'const credentialResyncInFlight = useRef(false);', '// Sidebar Profile Settings');
    expect(listener).toContain('window.addEventListener(CREDENTIAL_STATE_EVENT');
    expect(listener).toContain('await resolveSupabaseSession(accessToken)');
    // No second change-password mechanism.
    expect(listener).not.toContain('changePassword');
    expect(listener).not.toContain('/me/password');
  });

  it('tells an expired account to contact the Administrator', () => {
    expect(login).toMatch(
      /Your temporary password has expired\. Please contact your\s+Administrator for a new temporary password\./,
    );
  });
});
