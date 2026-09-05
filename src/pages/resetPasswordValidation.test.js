import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: ResetPassword's client-side minimum-length check is a
 * single named constant, not a magic number duplicated between the
 * validation logic and the placeholder text. When the Supabase Auth
 * minimum password length policy (Authentication -> Policies) is finally
 * configured, this constant is the only frontend value that needs to
 * change to stay in sync.
 *
 * Source-level guard, matching this suite's existing approach (see
 * forgotPasswordErrorHandling.test.js and context/authMfaGate.test.js for
 * the same rationale): vitest runs in a Node environment with no DOM here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'ResetPassword.jsx'), 'utf8');

describe('ResetPassword client-side length gate', () => {
  it('defines one named constant for the minimum length instead of a magic number', () => {
    expect(source).toMatch(/const MIN_PASSWORD_LENGTH = \d+;/);
  });

  it('rejects passwords shorter than the constant before the mismatch check or the update call', () => {
    const submitStart = source.indexOf('const handleSubmit');
    const lengthCheckAt = source.indexOf(
      'password.length < MIN_PASSWORD_LENGTH',
      submitStart,
    );
    const mismatchCheckAt = source.indexOf(
      'password !== confirmPassword',
      submitStart,
    );
    const updateCallAt = source.indexOf(
      'supabase.auth.updateUser',
      submitStart,
    );

    expect(lengthCheckAt).toBeGreaterThan(-1);
    expect(mismatchCheckAt).toBeGreaterThan(-1);
    expect(updateCallAt).toBeGreaterThan(-1);
    expect(lengthCheckAt).toBeLessThan(mismatchCheckAt);
    expect(mismatchCheckAt).toBeLessThan(updateCallAt);
  });

  it('returns early on a too-short password instead of falling through to submission', () => {
    const checkAt = source.indexOf(
      'if (password.length < MIN_PASSWORD_LENGTH)',
    );
    expect(checkAt).toBeGreaterThan(-1);
    const block = source.slice(checkAt, checkAt + 200);
    expect(block).toContain('return;');
  });

  it('a password meeting the minimum is not blocked by the length check', () => {
    // The check is strictly "<", so a password whose length equals the
    // constant must fall through to the next check rather than being
    // rejected here.
    expect(source).toContain('password.length < MIN_PASSWORD_LENGTH');
    expect(source).not.toContain('password.length <= MIN_PASSWORD_LENGTH');
  });

  it('the placeholder and the error message both derive from the same constant', () => {
    expect(source).toContain(
      'placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}',
    );
    expect(source).toContain(
      '`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`',
    );
  });

  it('never logs the password value or interpolates it into an error message', () => {
    expect(source).not.toMatch(/console\.\w+\([^)]*password/i);
    expect(source).not.toMatch(/setError\(`[^`]*\$\{(?:confirm)?[Pp]assword\}/);
  });

  it('leaves the server-authoritative weak-password handling untouched, not replaced with guessed rules', () => {
    expect(source).toContain('isAuthWeakPasswordError(error)');
    expect(source).toContain("error.reasons?.includes('pwned')");
  });
});

describe('ResetPassword flow preserved', () => {
  it('does not construct its own redirect URL — that stays solely in ForgotPassword.jsx', () => {
    expect(source).not.toContain('redirectTo');
  });

  it('still waits for a PASSWORD_RECOVERY session before rendering the form', () => {
    expect(source).toContain("event === 'PASSWORD_RECOVERY'");
  });

  it('still signs out and redirects to /login after a successful reset', () => {
    expect(source).toContain('supabase.auth.signOut()');
    expect(source).toContain("navigate('/login', { replace: true })");
  });
});
