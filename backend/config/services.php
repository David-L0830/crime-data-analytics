<?php

return [

    // Third-party service credentials. Never hardcode real values here —
    // everything is pulled from the environment (see .env.example) so
    // secrets never end up in source control.
    //
    // Final auth migration — Google sign-in is Supabase's own OAuth
    // provider now (configured in the Supabase dashboard, not here) — see
    // AUTH_MIGRATION_STATUS.md. This backend has no Google client
    // secret/Socialite integration to configure.

];
