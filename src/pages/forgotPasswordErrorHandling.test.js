import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: a Supabase error returned (not thrown) from
 * resetPasswordForEmail — e.g. a 429 rate-limit — must not be treated as a
 * successful send.
 *
 * Source-level guard, matching this suite's existing approach (see
 * context/authMfaGate.test.js for the same rationale): vitest here runs in a
 * Node environment with no DOM, so this pins the structural shape of the
 * fix rather than mounting the component.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'ForgotPassword.jsx'), 'utf8');

describe('ForgotPassword error handling', () => {
  it('destructures the returned error from resetPasswordForEmail', () => {
    expect(source).toMatch(
      /const\s*\{\s*error:\s*resetError\s*\}\s*=\s*await supabase\.auth\.resetPasswordForEmail/,
    );
  });

  it('throws the returned error so it is not silently ignored', () => {
    expect(source).toContain('if (resetError) throw resetError;');
  });

  it('only calls setSent(true) after the error check, not before', () => {
    const errorCheckAt = source.indexOf('if (resetError) throw resetError;');
    const setSentAt = source.indexOf('setSent(true);');
    expect(errorCheckAt).toBeGreaterThan(-1);
    expect(setSentAt).toBeGreaterThan(-1);
    expect(errorCheckAt).toBeLessThan(setSentAt);
  });

  it('still uses window.location.origin + /reset-password as the redirect', () => {
    expect(source).toContain(
      '{ redirectTo: `${window.location.origin}/reset-password` }',
    );
  });

  it('shows a generic failure message and never renders the raw Supabase error', () => {
    const catchAt = source.indexOf('} catch {');
    expect(catchAt).toBeGreaterThan(-1);
    const catchBlock = source.slice(catchAt, source.indexOf('} finally', catchAt));
    expect(catchBlock).toContain(
      "setError('Something went wrong. Please try again.');",
    );
    // No interpolation of the caught error into UI state.
    expect(catchBlock).not.toMatch(/setError\(.*\berror\b[^)]*\)/i);
  });
});
