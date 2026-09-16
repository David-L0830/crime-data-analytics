// Automatic first send for the email MFA step (see Login.jsx).
//
// Pure, DOM-free helpers so the send-once rule can be tested in this suite's
// Node environment. Nothing here sends mail or is a security boundary: the
// server decides whether a code is owed, who receives it, and how often one
// may be sent (EmailMfaController + the 'email-mfa-send' throttle).

// Mirrors the server's one-code-a-minute send limit so the resend button is
// not offered while the server would refuse it anyway.
export const RESEND_COOLDOWN_MS = 60_000;

export function resendSecondsRemaining(resendAt, now) {
  return Math.max(0, Math.ceil((resendAt - now) / 1000));
}

// One automatic send per email MFA episode.
//
// An episode starts when the email step is reached and ends when it is left
// (verified, cancelled, or signed out) — the caller calls reset() then. The
// guard lives OUTSIDE the component on purpose: a ref would survive
// StrictMode's effect double-invocation, but not a real remount of the login
// page while AuthContext still reports the email step, which would otherwise
// send a second code and replace the one already on its way.
//
// A full page reload does start a new episode. That send reaches the server's
// throttle if the earlier code was recent, and classifyEmailMfaSend() reads
// that 429 as "already sent" rather than as a failure.
export function createEmailMfaAutoSend() {
  let claimed = false;

  return {
    // Calls send() only for the first trigger of an episode; returns its
    // result, or null when this episode already sent.
    trigger(send) {
      if (claimed) return null;
      claimed = true;
      return send();
    },
    reset() {
      claimed = false;
    },
    get claimed() {
      return claimed;
    },
  };
}

export const emailMfaAutoSend = createEmailMfaAutoSend();

// Reads AuthContext.sendEmailMfaCode's result.
//
//   'sent'          a new code was issued
//   'already_sent'  refused by the send throttle on the AUTOMATIC send — a
//                   code was issued moments ago (e.g. before a reload) and is
//                   still valid, so this is not an error for the person
//   'failed'        anything else, including a 429 on a MANUAL resend, which
//                   keeps its existing "please wait" message
export function classifyEmailMfaSend(result, { automatic }) {
  if (result?.success) return 'sent';
  if (automatic && result?.rateLimited) return 'already_sent';
  return 'failed';
}
