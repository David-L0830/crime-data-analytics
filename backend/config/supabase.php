<?php

// Checkpoint 3 of the incremental Sanctum -> Supabase Auth migration
// (see TODO.md / HANDOFF.md). This config backs
// App\Services\SupabaseTokenValidator and the 'supabase' auth guard
// registered in AppServiceProvider::boot(). Nothing reads this file yet
// outside that validator — no existing route is protected by it until
// Checkpoint 4.

return [

    // Project URL, e.g. https://xxxxxxxxxxxx.supabase.co — used both to
    // derive the JWKS endpoint (for the current RS256/ES256 "JWT signing
    // keys" model) and to check the token's `iss` claim.
    'url' => env('SUPABASE_URL'),

    'project_id' => env('SUPABASE_PROJECT_ID'),

    // Legacy HS256 shared secret (Project Settings -> API -> JWT Secret).
    // Older Supabase projects sign access tokens with this instead of an
    // asymmetric JWKS key pair. Optional: only used as a fallback verification
    // path when set AND JWKS verification isn't applicable. Never set this to
    // the service-role key — it is a distinct value.
    'jwt_secret' => env('SUPABASE_JWT_SECRET'),

    // Supabase access tokens are always issued with this audience.
    'audience' => 'authenticated',

    // Final auth migration — used ONLY by App\Services\SupabaseAdminService,
    // to remove another user's MFA factor(s) on an admin's behalf (see
    // UserController::disableTwoFactor). This is the single reason this
    // backend holds a service-role key at all. NEVER read this from
    // anywhere but this backend's own .env; NEVER return it, log it, or
    // forward it in any API response; NEVER put it in a VITE_* variable or
    // anywhere the frontend can reach.
    'service_role_key' => env('SUPABASE_SERVICE_ROLE_KEY'),

    // Supabase Storage bucket holding profile pictures. See
    // App\Services\SupabaseStorageService for the full rationale; in short,
    // Render's container filesystem is ephemeral, so the `public` local disk
    // loses every uploaded avatar on the next deploy or restart.
    //
    // The bucket must exist and must be PUBLIC — the avatar is rendered by an
    // ordinary <img src>, which cannot renew an expiring signed URL.
    //
    // Left UNSET by default on purpose. When it is empty, ProfileController
    // falls back to the local `public` disk, so a developer with no Supabase
    // project (and the existing test suite) keeps working exactly as before.
    // Only a deployment that has created the bucket should set it.
    'avatar_bucket' => env('SUPABASE_AVATAR_BUCKET'),

    // How long to cache the fetched JWKS key set before re-fetching.
    'jwks_cache_ttl' => 3600,

    // How long to cache "does this account have a VERIFIED MFA factor?"
    // (see SupabaseAdminService::hasVerifiedFactor, read on every protected
    // request by the EnsureSupabaseAal2 middleware).
    //
    // The number is a staleness budget, not a performance knob. Too long and
    // an account whose factor was just removed stays locked out of an aal1
    // session for that whole window; too short and every request pays a round
    // trip to Supabase's Admin API. Sixty seconds collapses the burst of
    // parallel requests a single page load fires into one lookup while keeping
    // the worst-case lockout under a minute. Explicit invalidation covers the
    // one case this application can actually observe -- an administrator
    // clearing someone's factors (see UserController::disableTwoFactor).
    //
    // Note an already-aal2 session never reaches this lookup at all: the
    // middleware short-circuits before it. The cost is paid only by sessions
    // that have NOT completed a second factor.
    'mfa_status_cache_ttl' => 60,

    // Email one-time-code MFA, for accounts explicitly configured with
    // users.mfa_method = 'email_otp' (see EmailMfaService).
    //
    //   code_ttl_seconds     - how long a sent code can be entered.
    //   max_attempts         - wrong entries allowed against one code before
    //                          it is dead and a new one must be sent.
    //   verified_ttl_seconds - absolute ceiling on how long one session's
    //                          verification counts. The Supabase session
    //                          itself is also re-checked with GoTrue on every
    //                          use, so sign-out or revocation ends it sooner.
    //
    // max_attempts is PER CODE and is reset when a new code is sent, so on its
    // own it never bounded the total number of guesses — resending simply
    // bought five more. The two cumulative settings below are that bound
    // (audit finding M1). They are per user, survive resends and sign-outs,
    // and are enforced in EmailMfaService::verifyCode():
    //
    //   max_failures_per_window - wrong codes an account may submit in one
    //                             window before verification is refused
    //                             outright, correct codes included.
    //   failure_window_seconds  - how long that budget takes to recover. The
    //                             window is rolling and self-healing: waiting
    //                             it out is the recovery path, which is why
    //                             this is not a permanent lockout counter.
    //
    // Ten an hour leaves ample room for genuine mistyping (two full codes'
    // worth and then some) while capping an attacker who already holds the
    // password at ten guesses an hour against a one-in-a-million code, no
    // matter how often they resend.
    'email_mfa' => [
        'code_ttl_seconds' => 300,
        'max_attempts' => 5,
        'verified_ttl_seconds' => 43200,
        'max_failures_per_window' => 10,
        'failure_window_seconds' => 3600,
    ],

];
