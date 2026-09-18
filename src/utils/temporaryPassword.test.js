import { describe, expect, it, vi } from 'vitest';
import {
  GENERATED_PASSWORD_LENGTH,
  GENERATOR_ALPHABET,
  TEMPORARY_PASSWORD_MAX_BYTES,
  byteLength,
  copyToClipboard,
  generateTemporaryPassword,
  maskPassword,
  temporaryCredentialLabel,
  validateTemporaryPassword,
} from './temporaryPassword';

// Behavioural tests of the real functions, using the real Web Crypto API that
// Node provides (globalThis.crypto) unless a test injects a stand-in.

describe('generateTemporaryPassword', () => {
  it('produces a password of the requested length from the safe alphabet', () => {
    const value = generateTemporaryPassword();
    expect(value).toHaveLength(GENERATED_PASSWORD_LENGTH);
    for (const ch of value) expect(GENERATOR_ALPHABET).toContain(ch);
    // No easily-confused characters.
    expect(value).not.toMatch(/[Il1O0]/);
  });

  it('always includes every character class', () => {
    for (let i = 0; i < 300; i += 1) {
      const value = generateTemporaryPassword();
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[2-9]/);
      expect(value).toMatch(/[!@#$%&*?\-_+=]/);
    }
  });

  it('always satisfies the same rules the server enforces', () => {
    for (let i = 0; i < 1000; i += 1) {
      const value = generateTemporaryPassword();
      expect(validateTemporaryPassword(value, { username: 'encoder01', email: 'e@example.com' })).toBeNull();
      expect(byteLength(value)).toBeLessThanOrEqual(TEMPORARY_PASSWORD_MAX_BYTES);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(500);
  });

  it('draws its randomness from getRandomValues', () => {
    const spy = vi.fn((buffer) => globalThis.crypto.getRandomValues(buffer));
    generateTemporaryPassword({ crypto: { getRandomValues: spy } });
    expect(spy).toHaveBeenCalled();
  });

  it('refuses to generate without a secure random source instead of falling back', () => {
    expect(() => generateTemporaryPassword({ crypto: {} })).toThrow(/secure random/);
  });

  it('never goes below the minimum length even if asked to', () => {
    expect(generateTemporaryPassword({ length: 3 }).length).toBeGreaterThanOrEqual(8);
  });
});

describe('validateTemporaryPassword', () => {
  const ctx = { username: 'Encoder01', email: 'Encoder01@Example.com' };

  it.each([
    ['empty', ''],
    ['not a string', null],
    ['only spaces', '          '],
    ['too short', 'Ab3#xyz'],
    ['over 72 bytes', `${'Lp9#'.repeat(18)}Z`],
    ['over 72 bytes in accented characters', 'ñÑ'.repeat(19)],
    ['the username, any case', 'ENCODER01'],
    ['the email, any case', 'encoder01@example.com'],
  ])('rejects %s', (_label, value) => {
    const message = validateTemporaryPassword(value, ctx);
    expect(message).toEqual(expect.any(String));
    if (typeof value === 'string' && value.trim() !== '') {
      expect(message).not.toContain(value);
    }
  });

  it('accepts the boundary values', () => {
    expect(validateTemporaryPassword('Ab3#xyzQ', ctx)).toBeNull();
    expect(validateTemporaryPassword('Lp9#'.repeat(18), ctx)).toBeNull();
  });
});

describe('copyToClipboard', () => {
  it('writes the text and reports success', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await expect(copyToClipboard('Tmp-Pass-2026', clipboard)).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('Tmp-Pass-2026');
  });

  it('reports failure without throwing when the clipboard refuses or is missing', async () => {
    const refusing = { writeText: vi.fn().mockRejectedValue(new Error('denied')) };
    await expect(copyToClipboard('x', refusing)).resolves.toBe(false);
    await expect(copyToClipboard('x', {})).resolves.toBe(false);
  });
});

describe('temporaryCredentialLabel', () => {
  it('labels pending and expired, and nothing otherwise', () => {
    expect(temporaryCredentialLabel({ temporaryCredentialStatus: 'pending' })).toBe('Temporary Password Pending');
    expect(temporaryCredentialLabel({ temporaryCredentialStatus: 'expired' })).toBe('Temporary Password Expired');
    expect(temporaryCredentialLabel({ temporaryCredentialStatus: null })).toBeNull();
    // A non-administrator's payload has no field at all.
    expect(temporaryCredentialLabel({})).toBeNull();
    expect(temporaryCredentialLabel(null)).toBeNull();
  });
});

describe('maskPassword', () => {
  it('masks every character and reveals nothing', () => {
    expect(maskPassword('Tmp-Pass-2026')).toBe('•'.repeat(13));
    expect(maskPassword('Tmp-Pass-2026')).not.toMatch(/[A-Za-z0-9]/);
    expect(maskPassword(undefined)).toBe('');
  });
});
