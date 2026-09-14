// How an account's second factor is described in the administrator UI.
//
// WHY THIS EXISTS
//
// The admin screens originally had one source of truth for "does this account
// have a second factor": UserResource.twoFactorEnabled, which reports whether
// SUPABASE holds a verified authenticator factor. That was the whole story
// until email OTP MFA arrived. An account with users.mfa_method = 'email_otp'
// has no Supabase factor, so every one of those screens described it as having
// no second factor — a row badged "Not enrolled", a Security panel warning
// that an administrator had none — while the backend was in fact demanding an
// emailed code on every single sign-in and refusing the account without one.
// The UI was telling administrators the opposite of what enforcement did.
//
// `mfaMethod` is already on the user payload (UserResource), so nothing new is
// needed from the API to say this accurately; these helpers just make every
// screen read it the same way.
//
// WHAT THIS IS NOT
//
// It is presentation only. `users.mfa_method = 'email_otp'` means email MFA is
// mandatory, and that invariant lives in the backend (EmailMfaService and
// EnsureSupabaseAal2). Nothing here can enable, disable or relax it, and no
// administrator action in this UI can either.

export const MFA_METHOD_EMAIL_OTP = 'email_otp';

/** Is this account configured for email one-time-code MFA? */
export function usesEmailOtpMfa(user) {
  return user?.mfaMethod === MFA_METHOD_EMAIL_OTP;
}

/**
 * Does this account have a second factor at all?
 *
 * True for an enrolled authenticator OR for email OTP. Used wherever the UI
 * previously asked `twoFactorEnabled` alone and would otherwise count an
 * email-MFA account as unprotected.
 */
export function hasSecondFactor(user) {
  return usesEmailOtpMfa(user) || Boolean(user?.twoFactorEnabled);
}

/**
 * The badge text for the account's second factor.
 *
 * Email OTP is reported as such rather than as "Enrolled": it is a different
 * factor from an authenticator app and must never be shown as one. It also
 * takes precedence over a verified authenticator factor, because for these
 * accounts the emailed code is required at every sign-in whether or not an
 * authenticator also exists — badging such an account "Enrolled" would hide
 * the mandatory requirement behind the optional one.
 */
export function mfaStatusLabel(user) {
  if (usesEmailOtpMfa(user)) {
    return 'Email OTP';
  }

  return user?.twoFactorEnabled ? 'Enrolled' : 'Not enrolled';
}

/** The longer explanation shown beside the badge where there is room for it. */
export function mfaStatusDescription(user) {
  if (usesEmailOtpMfa(user)) {
    return user?.twoFactorEnabled
      ? 'A one-time code is emailed at every sign-in. An authenticator factor is also enrolled, and both are required.'
      : 'A one-time code is emailed at every sign-in.';
  }

  return user?.twoFactorEnabled
    ? 'An authenticator factor is enrolled with Supabase.'
    : 'No authenticator factor is enrolled.';
}

/**
 * The sentence appended to an authenticator-administration result so it cannot
 * be read as "this account no longer has MFA".
 *
 * "Clear 2FA" and "Cancel 2FA Requirement" act on the AUTHENTICATOR — they
 * remove a Supabase factor and the Supabase-side requirement flag. For an
 * email_otp account neither touches the email requirement, which is driven by
 * users.mfa_method and stays mandatory. Saying "two-factor authentication is
 * no longer required" there would be false, and an administrator acting on it
 * would believe they had removed a protection that is still in force.
 *
 * Returns an empty string for every other account, so their existing messages
 * are unchanged.
 */
export function emailMfaRemainsNotice(user) {
  return usesEmailOtpMfa(user)
    ? ' Email OTP verification is still required for this account.'
    : '';
}
