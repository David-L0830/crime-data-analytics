import { api } from './api';

// Email one-time-code MFA, for accounts an administrator explicitly configured
// with the 'email_otp' method (see backend EmailMfaService).
//
// Unlike supabaseMfaService.js this DOES go through the Laravel API, because
// the second factor is this backend's own: it sends the code, checks it, and
// records the result against the signed Supabase session_id of the token
// api.js attaches. Neither call takes an email address or account id — the
// server acts only on the caller's own session.
//
// Nothing here is a security boundary. A successful verify() does not sign
// anybody in on its own; AuthContext re-reads GET /user and only proceeds when
// the server reports that no second factor is still owed.
export const emailMfaService = {
  // Resolves { message, expiresInSeconds }. Rejects with ApiError — 429 when
  // a code was sent too recently.
  sendCode: () => api.post('/mfa/email/send'),

  // Resolves { verified: true }. Rejects with ApiError 422 for any wrong,
  // expired, reused or locked-out code (deliberately indistinguishable).
  verifyCode: (code) => api.post('/mfa/email/verify', { code }),
};
