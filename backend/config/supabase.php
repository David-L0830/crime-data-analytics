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

    // How long to cache the fetched JWKS key set before re-fetching.
    'jwks_cache_ttl' => 3600,

];
