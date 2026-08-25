import { supabase } from '../lib/supabaseClient';

// Checkpoint 6 — Supabase MFA (TOTP) coexistence.
//
// Every function here talks directly to Supabase over the browser's own
// already-authenticated session (anon key + the user's access token) —
// never through this app's Laravel backend, and never using a service-role
// key. That's a deliberate architecture choice, not an oversight: this
// backend has never held a service-role key (see backend/.env.example),
// and Supabase's enroll/challenge/verify/listFactors/unenroll APIs are
// designed to be called exactly this way — no admin/service credential is
// needed for a user to manage their own factors. Laravel's only role in
// MFA is reading the verified `aal` claim off the JWT it receives
// afterward (see SupabaseTokenValidator / UserResource.authAssuranceLevel)
// — it never participates in enrollment or challenge/verify itself.
//
// IMPORTANT — none of this is a security boundary. getAssuranceLevel() in
// particular exists for UI ROUTING ONLY (which screen the login flow
// should show next) — the actual authorization decision for any protected
// resource is made server-side, from the cryptographically verified JWT
// `aal` claim (see EnsureSupabaseAal2), never from a client-side read like
// this one. See HANDOFF_CHECKPOINT_6.md.
export const supabaseMfaService = {
  // Existing (verified) factors for the current session's user. Used to
  // drive UI — e.g. "you already have an authenticator set up" — and, at
  // login time, to decide whether to prompt for a step-up challenge.
  // NOTE: per Supabase's documented listFactors() response shape, `data.all`
  // includes every factor regardless of status ('verified' | 'unverified');
  // `data.totp` is already pre-filtered to verified TOTP factors only — see
  // selectActiveTotpFactor() below, which re-checks `status` explicitly
  // anyway rather than assuming that pre-filtering, as defense-in-depth
  // against a documented-but-unverified assumption.
  listFactors: async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return data; // { all: Factor[], totp: Factor[], phone: Factor[] }
  },

  // Starts enrolling a new TOTP factor and returns everything needed to
  // render a QR code / manual-entry secret. The factor is NOT active yet —
  // confirmEnrollment() below must succeed first (proving the person
  // actually has it in an authenticator app), entirely via Supabase's own
  // API.
  enroll: async () => {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    });
    if (error) throw error;
    return data; // { id, totp: { qr_code, secret, uri } }
  },

  // Completes enrollment (or a login-time step-up) in one call — combines
  // Supabase's challenge + verify steps. On success the current session is
  // promoted to aal2 and this returns the refreshed session.
  challengeAndVerify: async (factorId, code) => {
    const { data, error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (error) throw error;
    return data;
  },

  unenroll: async (factorId) => {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
  },

  // UI-routing helper only (see file header). { currentLevel, nextLevel }:
  // nextLevel !== currentLevel means a verified factor exists and this
  // session hasn't completed it yet — that's the signal AuthContext uses
  // to show a step-up challenge instead of treating login as finished.
  getAssuranceLevel: async () => {
    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  },

  // Checkpoint 6B — Part 3. Picks the TOTP factor a challenge/step-up
  // should actually use, given a listFactors() result. Deliberately does
  // NOT just take factors.totp[0] without scrutiny: even though Supabase's
  // documented response shape already pre-filters `data.totp` to verified
  // factors only, this re-checks `status === 'verified'` explicitly rather
  // than silently trusting that pre-filtering, and picks the most recently
  // updated one if more than one verified factor exists (e.g. a user who
  // re-enrolled after losing a device) instead of an arbitrary index.
  // Returns null if no verified TOTP factor exists — callers must handle
  // that (it means "nothing to challenge", not an error).
  selectActiveTotpFactor: (factors) => {
    const candidates = (factors?.totp ?? []).filter(
      (f) => f.status === 'verified',
    );
    if (candidates.length === 0) return null;
    return candidates.reduce(
      (latest, f) =>
        !latest || new Date(f.updated_at) > new Date(latest.updated_at)
          ? f
          : latest,
      null,
    );
  },
};
