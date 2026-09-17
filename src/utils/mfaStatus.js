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

// A value the Create User form SENDS, never one the API returns: an
// Authenticator App account is stored as users.mfa_method = NULL plus the
// Supabase requirement flag (see UserController::store). The backend validates
// the choice; these options only describe it.
export const MFA_METHOD_AUTHENTICATOR_APP = 'authenticator_app';

export const MFA_METHOD_OPTIONS = [
  {
    value: MFA_METHOD_EMAIL_OTP,
    label: 'Email OTP',
    description:
      'A six-digit code is emailed to the account address at every sign-in.',
  },
  {
    value: MFA_METHOD_AUTHENTICATOR_APP,
    label: 'Authenticator App',
    description:
      'The person sets up an authenticator app at first sign-in and enters its code at every sign-in after that.',
  },
];

/** Is this account configured for email one-time-code MFA? */
export function usesEmailOtpMfa(user) {
  return user?.mfaMethod === MFA_METHOD_EMAIL_OTP;
}

/**
 * Is the authenticator this account's only second factor?
 *
 * True for every account not configured for email OTP. For those accounts the
 * backend refuses to lift the authenticator requirement and turns "clear the
 * factor" into a reset that requires enrolling a new one, so the UI offers
 * exactly those actions and no others.
 */
export function usesAuthenticatorAppMfa(user) {
  return Boolean(user) && !usesEmailOtpMfa(user);
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
//
// An authenticator account is reported by what Supabase actually holds:
//   'Authenticator App'  a verified factor is enrolled
//   'Pending Enrollment' an authenticator is required but none is enrolled yet
//                        (a new Authenticator App account, or one whose
//                        authenticator was reset)
//   'Not enrolled'       neither — an older account created before an MFA
//                        method had to be chosen
//
// mfaRequiredByAdmin fails SOFT to false on the server when Supabase cannot be
// reached, so during an outage a pending account can briefly read
// 'Not enrolled'. That is a label only; enforcement fails closed.
export function mfaStatusLabel(user) {
  if (usesEmailOtpMfa(user)) {
    return 'Email OTP';
  }

  if (user?.twoFactorEnabled) return 'Authenticator App';
  if (user?.mfaRequiredByAdmin) return 'Pending Enrollment';
  return 'Not enrolled';
}

/** The longer explanation shown beside the badge where there is room for it. */
export function mfaStatusDescription(user) {
  if (usesEmailOtpMfa(user)) {
    return user?.twoFactorEnabled
      ? 'A one-time code is emailed at every sign-in. An authenticator factor is also enrolled, and both are required.'
      : 'A one-time code is emailed at every sign-in.';
  }

  if (user?.twoFactorEnabled) {
    return 'An authenticator app is enrolled with Supabase and required at every sign-in.';
  }

  return user?.mfaRequiredByAdmin
    ? 'An authenticator app is required. It will be set up at the next sign-in, and the account cannot be used until it is.'
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
