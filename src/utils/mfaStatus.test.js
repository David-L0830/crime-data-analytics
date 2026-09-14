import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  emailMfaRemainsNotice,
  hasSecondFactor,
  mfaStatusDescription,
  mfaStatusLabel,
  usesEmailOtpMfa,
} from './mfaStatus';

/**
 * D1/D2 — the administrator UI must describe an account's second factor the
 * way the backend actually enforces it.
 *
 * The regression these guard against was not a crash, it was a lie: an account
 * with users.mfa_method = 'email_otp' is refused entry without an emailed code
 * on every sign-in, and the admin screens described it as having no second
 * factor — a "Not enrolled" badge, a Security panel warning that an
 * administrator was unprotected, and a "two-factor authentication is no longer
 * required" toast after an action that had not changed the email requirement
 * at all. An administrator reading those would believe a protected account was
 * exposed, or that they had switched a protection off when they had not.
 *
 * Vitest runs in a Node environment with no DOM (see vitest.config.js), so the
 * derivation is tested directly and the wiring is pinned at source level
 * below — the same split the existing authMfaGate.test.js uses.
 */

const emailOtpUser = { mfaMethod: 'email_otp', twoFactorEnabled: false };
const emailOtpWithFactor = { mfaMethod: 'email_otp', twoFactorEnabled: true };
const totpUser = { mfaMethod: null, twoFactorEnabled: true };
const noMfaUser = { mfaMethod: null, twoFactorEnabled: false };
const adminRequiredNotEnrolled = {
  mfaMethod: null,
  twoFactorEnabled: false,
  mfaRequiredByAdmin: true,
};

describe('MFA status derivation', () => {
  it('reports an email OTP account as email OTP, never as unprotected', () => {
    expect(mfaStatusLabel(emailOtpUser)).toBe('Email OTP');
    expect(hasSecondFactor(emailOtpUser)).toBe(true);
    expect(usesEmailOtpMfa(emailOtpUser)).toBe(true);

    // The specific wording the old UI used for these accounts.
    expect(mfaStatusLabel(emailOtpUser)).not.toBe('Not enrolled');
    expect(mfaStatusDescription(emailOtpUser)).not.toMatch(/no authenticator/i);
  });

  it('never labels email OTP as an authenticator factor', () => {
    expect(mfaStatusLabel(emailOtpUser)).not.toBe('Enrolled');
    expect(mfaStatusDescription(emailOtpUser)).toMatch(/emailed at every sign-in/i);
  });

  // Both are required for such an account, so showing only the authenticator
  // would hide the mandatory one behind the optional one.
  it('does not let an enrolled authenticator conceal the email requirement', () => {
    expect(mfaStatusLabel(emailOtpWithFactor)).toBe('Email OTP');
    expect(hasSecondFactor(emailOtpWithFactor)).toBe(true);
    expect(mfaStatusDescription(emailOtpWithFactor)).toMatch(/both are required/i);
  });

  it('leaves TOTP accounts exactly as they were', () => {
    expect(mfaStatusLabel(totpUser)).toBe('Enrolled');
    expect(hasSecondFactor(totpUser)).toBe(true);
    expect(usesEmailOtpMfa(totpUser)).toBe(false);
    expect(mfaStatusDescription(totpUser)).toBe(
      'An authenticator factor is enrolled with Supabase.',
    );
  });

  it('leaves accounts with no MFA exactly as they were', () => {
    expect(mfaStatusLabel(noMfaUser)).toBe('Not enrolled');
    expect(hasSecondFactor(noMfaUser)).toBe(false);
    expect(mfaStatusDescription(noMfaUser)).toBe(
      'No authenticator factor is enrolled.',
    );
  });

  // An admin-imposed requirement is not an enrolled factor, and this change
  // deliberately does not start claiming it is one.
  it('leaves the admin-required-but-not-enrolled state unchanged', () => {
    expect(mfaStatusLabel(adminRequiredNotEnrolled)).toBe('Not enrolled');
    expect(hasSecondFactor(adminRequiredNotEnrolled)).toBe(false);
  });

  it('treats a missing or partial user object as having no second factor', () => {
    expect(hasSecondFactor(undefined)).toBe(false);
    expect(hasSecondFactor({})).toBe(false);
    expect(mfaStatusLabel(undefined)).toBe('Not enrolled');
    expect(usesEmailOtpMfa(undefined)).toBe(false);
  });
});

describe('Authenticator-administration messaging (D2)', () => {
  it('states that email MFA survives the action, for email OTP accounts only', () => {
    expect(emailMfaRemainsNotice(emailOtpUser)).toMatch(/still required/i);
    expect(emailMfaRemainsNotice(emailOtpWithFactor)).toMatch(/still required/i);

    // Every other account keeps its original message untouched.
    expect(emailMfaRemainsNotice(totpUser)).toBe('');
    expect(emailMfaRemainsNotice(noMfaUser)).toBe('');
    expect(emailMfaRemainsNotice(adminRequiredNotEnrolled)).toBe('');
    expect(emailMfaRemainsNotice(undefined)).toBe('');
  });
});

// Source-level: the derivation above is worthless if a screen goes back to
// reading twoFactorEnabled directly.
describe('Admin screens use the shared derivation', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (relative) => readFileSync(join(here, relative), 'utf8');

  const userManagement = read('../pages/UserManagement.jsx');
  const securitySummary = read('../components/users/SecuritySummary.jsx');
  const userDetails = read('../components/users/UserDetailsModal.jsx');

  it('badges the 2FA column from the whole row, not the boolean alone', () => {
    expect(userManagement).toContain('mfaStatusLabel(row)');
    expect(userManagement).not.toMatch(
      /render:\s*\(v\)\s*=>\s*\(?\s*<Badge status=\{v \? 'Enrolled' : 'Not enrolled'\}/,
    );
  });

  it('filters on the second factor rather than the authenticator flag', () => {
    expect(userManagement).toContain("twoFactorFilter === 'enabled' && !hasSecondFactor(user)");
    expect(userManagement).toContain("twoFactorFilter === 'disabled' && hasSecondFactor(user)");
  });

  it('does not warn that an email-MFA account has no second factor', () => {
    expect(securitySummary).toContain('!hasSecondFactor(u)');
    expect(securitySummary).not.toContain('!u.twoFactorEnabled');
  });

  it('describes the factor in the details modal from the shared helper', () => {
    expect(userDetails).toContain('mfaStatusDescription(user)');
    expect(userDetails).toContain('hasSecondFactor(user)');
  });

  it('never tells an administrator that MFA was switched off for an email OTP account', () => {
    // The cancel toast must be branched, and the unconditional claim gone.
    expect(userManagement).toContain('usesEmailOtpMfa(user)');
    expect(userManagement).toContain('emailMfaRemainsNotice(user)');

    const code = userManagement
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const cancelClaim =
      "'Two-factor authentication is no longer required for this account.'";
    const claimAt = code.indexOf(cancelClaim);
    expect(claimAt, 'the original wording should still serve non-email accounts').toBeGreaterThan(-1);

    // ...but only inside the branch that excludes email_otp accounts.
    const branchAt = code.indexOf('usesEmailOtpMfa(user)');
    expect(branchAt).toBeGreaterThan(-1);
    expect(branchAt).toBeLessThan(claimAt);
  });
});
