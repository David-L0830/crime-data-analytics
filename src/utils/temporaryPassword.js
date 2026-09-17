// Administrator-issued temporary passwords — generation and client-side checks.
//
// Pure functions, kept free of React so every rule is unit tested directly
// (src/utils/temporaryPassword.test.js). The UI (TemporaryPasswordInput,
// ReissueTemporaryPasswordModal, CreateUserModal) only calls into these.
//
// Nothing here stores, logs, or transmits a password. The server remains the
// authority: StoreUserRequest / UserController::issueTemporaryPassword apply the
// same rules (App\Rules\AcceptablePassword) and Supabase Auth applies its own
// policy on top.

// Mirrors User::TEMPORARY_PASSWORD_MIN_LENGTH and ::TEMPORARY_PASSWORD_MAX_BYTES.
export const TEMPORARY_PASSWORD_MIN_LENGTH = 8;
export const TEMPORARY_PASSWORD_MAX_BYTES = 72;

// Matches User::TEMPORARY_PASSWORD_TTL_HOURS; display only — the real expiry
// always comes back from the server as temporaryCredentialExpiresAt.
export const TEMPORARY_PASSWORD_TTL_HOURS = 72;

export const GENERATED_PASSWORD_LENGTH = 16;

// Characters that are easy to confuse when read aloud or copied by hand
// (I, l, 1, O, 0) are left out: the administrator has to hand this to a person.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?-_+=';
export const GENERATOR_ALPHABET = UPPER + LOWER + DIGITS + SYMBOLS;
const CLASSES = [UPPER, LOWER, DIGITS, SYMBOLS];

function secureCrypto(cryptoImpl) {
  const impl = cryptoImpl ?? globalThis.crypto;
  if (!impl || typeof impl.getRandomValues !== 'function') {
    // Deliberately no Math.random() fallback: a predictable temporary password
    // is worse than no generator at all.
    throw new Error('A secure random number generator is not available.');
  }
  return impl;
}

// An unbiased integer in [0, max): rejection sampling over 32-bit values, so
// no character is more likely than another.
function randomIndex(max, cryptoImpl) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    cryptoImpl.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

/**
 * A random temporary password from the browser's CSPRNG.
 *
 * Always contains at least one upper-case letter, lower-case letter, digit and
 * symbol, is ASCII (so its byte length equals its length, well under 72), and
 * is shuffled so the guaranteed characters are not in predictable positions.
 */
export function generateTemporaryPassword({
  length = GENERATED_PASSWORD_LENGTH,
  crypto: cryptoImpl,
} = {}) {
  const rng = secureCrypto(cryptoImpl);
  const size = Math.max(length, CLASSES.length, TEMPORARY_PASSWORD_MIN_LENGTH);

  const chars = CLASSES.map((set) => set[randomIndex(set.length, rng)]);
  while (chars.length < size) {
    chars.push(GENERATOR_ALPHABET[randomIndex(GENERATOR_ALPHABET.length, rng)]);
  }

  // Fisher–Yates with the same unbiased source.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1, rng);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

export function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

/**
 * The first problem with a temporary password, or null when it is acceptable.
 * Messages are fixed sentences and never contain the value.
 */
export function validateTemporaryPassword(value, { username, email } = {}) {
  if (typeof value !== 'string' || value === '') {
    return 'Enter or generate a temporary password.';
  }
  if (value.trim() === '') {
    return 'The temporary password cannot be only spaces.';
  }
  if (value.length < TEMPORARY_PASSWORD_MIN_LENGTH) {
    return `The temporary password must be at least ${TEMPORARY_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (byteLength(value) > TEMPORARY_PASSWORD_MAX_BYTES) {
    return `The temporary password must be at most ${TEMPORARY_PASSWORD_MAX_BYTES} characters (fewer if it uses accented or non-Latin characters).`;
  }

  const comparable = value.trim().toLowerCase();
  if (username && comparable === String(username).trim().toLowerCase()) {
    return 'The temporary password cannot be the same as the username.';
  }
  if (email && comparable === String(email).trim().toLowerCase()) {
    return 'The temporary password cannot be the same as the email address.';
  }
  return null;
}

/**
 * Copies text to the clipboard. Resolves true on success, false otherwise —
 * never throws, and never reports the text itself anywhere.
 */
export async function copyToClipboard(text, clipboard) {
  const target =
    clipboard ??
    (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  if (!target || typeof target.writeText !== 'function') return false;
  try {
    await target.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The User Management badge text for an account's temporary-credential state,
 * or null when nothing is outstanding. Reads only the administrator-only
 * `temporaryCredentialStatus` field; there is no password to read.
 */
export function temporaryCredentialLabel(user) {
  if (user?.temporaryCredentialStatus === 'pending') return 'Temporary Password Pending';
  if (user?.temporaryCredentialStatus === 'expired') return 'Temporary Password Expired';
  return null;
}

/** A same-length mask, so the field shows that something is there. */
export function maskPassword(value) {
  return '•'.repeat(typeof value === 'string' ? value.length : 0);
}
