import { describe, expect, it, vi } from 'vitest';
import {
  RESEND_COOLDOWN_MS,
  classifyEmailMfaSend,
  createEmailMfaAutoSend,
  resendSecondsRemaining,
} from './emailMfaAutoSend';

/**
 * Behavioural tests for the automatic first send of the email MFA step.
 *
 * Vitest runs in Node here (no DOM — see vitest.config.js), so React itself
 * cannot be rendered. What CAN be exercised for real is the guard both effects
 * share. The harness below replays the exact effect bodies from the app:
 *
 *   Login.jsx         if (!pendingEmailMfa) return;
 *                     emailMfaAutoSend.trigger(() => sendEmailCode(...))
 *   AuthContext.jsx   if (!pendingEmailMfa) emailMfaAutoSend.reset();
 *
 * and drives them through the sequences React produces: re-renders,
 * StrictMode's mount → unmount → mount, a real remount, and a new episode.
 * authMfaGate.test.js pins that the app's effects really have these bodies.
 */
function harness() {
  const guard = createEmailMfaAutoSend();
  const send = vi.fn(() => Promise.resolve({ success: true, expiresInSeconds: 300 }));

  const loginEffect = (pendingEmailMfa) => {
    if (!pendingEmailMfa) return;
    guard.trigger(send);
  };
  const providerEffect = (pendingEmailMfa) => {
    if (!pendingEmailMfa) guard.reset();
  };
  // React runs child effects before parent effects in one commit.
  const commit = (pendingEmailMfa) => {
    loginEffect(pendingEmailMfa);
    providerEffect(pendingEmailMfa);
  };

  return { guard, send, loginEffect, providerEffect, commit };
}

describe('email MFA automatic send — once per episode', () => {
  it('sends exactly one code when the email step is reached', () => {
    const { send, commit } = harness();
    commit(false);
    commit(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send again on re-renders while the step is showing', () => {
    const { send, commit } = harness();
    commit(true);
    // Even if the effect body re-ran on every render, not only on a
    // pendingEmailMfa change, the guard holds.
    for (let i = 0; i < 10; i += 1) commit(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send twice under StrictMode double effect invocation', () => {
    const { send, loginEffect, providerEffect } = harness();
    // mount effects, simulated unmount (no cleanup body), mount effects again
    loginEffect(true);
    providerEffect(true);
    loginEffect(true);
    providerEffect(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send again when the login page remounts during the same step', () => {
    const { send, commit, loginEffect } = harness();
    commit(true);
    // A fresh Login instance: its own refs and state are new, the guard is not.
    loginEffect(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends a fresh code the next time the step is reached after it ended', () => {
    const { send, commit } = harness();
    commit(true); // first sign-in reaches the step
    commit(false); // verified, cancelled or signed out — provider resets
    commit(true); // next sign-in
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never sends while the step is not showing', () => {
    const { send, commit } = harness();
    commit(false);
    commit(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns the send result the first time and null afterwards', async () => {
    const guard = createEmailMfaAutoSend();
    const send = vi.fn(() => Promise.resolve({ success: true }));
    await expect(guard.trigger(send)).resolves.toEqual({ success: true });
    expect(guard.trigger(send)).toBeNull();
    expect(guard.claimed).toBe(true);
    guard.reset();
    expect(guard.claimed).toBe(false);
  });

  it('keeps separate guards independent', () => {
    const a = createEmailMfaAutoSend();
    const b = createEmailMfaAutoSend();
    const send = vi.fn();
    a.trigger(send);
    b.trigger(send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('email MFA send result classification', () => {
  const sent = { success: true, expiresInSeconds: 300 };
  const throttled = {
    success: false,
    rateLimited: true,
    error: 'A code was sent recently. Please wait a minute before requesting another.',
  };
  const unavailable = {
    success: false,
    rateLimited: false,
    error: 'The verification code could not be sent. Please try again.',
  };
  const sessionEnded = {
    success: false,
    rateLimited: false,
    error: 'Your session has ended. Please sign in again.',
  };

  it('treats a new code as sent, automatic or manual', () => {
    expect(classifyEmailMfaSend(sent, { automatic: true })).toBe('sent');
    expect(classifyEmailMfaSend(sent, { automatic: false })).toBe('sent');
  });

  it('treats HTTP 429 on the automatic send as a code already sent', () => {
    expect(classifyEmailMfaSend(throttled, { automatic: true })).toBe('already_sent');
  });

  it('keeps HTTP 429 on a manual resend as the existing please-wait failure', () => {
    expect(classifyEmailMfaSend(throttled, { automatic: false })).toBe('failed');
  });

  it('never hides a real failure behind "already sent"', () => {
    for (const automatic of [true, false]) {
      expect(classifyEmailMfaSend(unavailable, { automatic })).toBe('failed');
      expect(classifyEmailMfaSend(sessionEnded, { automatic })).toBe('failed');
      expect(classifyEmailMfaSend(undefined, { automatic })).toBe('failed');
    }
  });
});

describe('email MFA resend countdown', () => {
  it('matches the server one-code-a-minute send limit', () => {
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });

  it('counts down from 60 seconds after a send', () => {
    const sentAt = 1_000_000;
    const resendAt = sentAt + RESEND_COOLDOWN_MS;
    expect(resendSecondsRemaining(resendAt, sentAt)).toBe(60);
    expect(resendSecondsRemaining(resendAt, sentAt + 999)).toBe(60);
    expect(resendSecondsRemaining(resendAt, sentAt + 1_000)).toBe(59);
    expect(resendSecondsRemaining(resendAt, sentAt + 59_001)).toBe(1);
  });

  it('reaches zero when the cooldown ends and never goes negative', () => {
    const resendAt = 2_000_000;
    expect(resendSecondsRemaining(resendAt, resendAt)).toBe(0);
    expect(resendSecondsRemaining(resendAt, resendAt + 5_000)).toBe(0);
  });

  it('offers resend immediately when no cooldown was started', () => {
    expect(resendSecondsRemaining(0, Date.now())).toBe(0);
  });
});
