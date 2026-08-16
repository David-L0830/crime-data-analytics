<?php

return [

    'paths' => ['api/*'],

    'allowed_methods' => ['*'],

    // Never hardcoded — driven entirely by FRONTEND_URL / CORS_ALLOWED_ORIGINS
    // so dev (http://localhost:5173) and production domains both work.
    'allowed_origins' => array_filter(array_merge(
        [env('FRONTEND_URL', 'http://localhost:5173')],
        explode(',', env('CORS_ALLOWED_ORIGINS', ''))
    )),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    // Final auth migration — this API is Bearer-token-only now (no more
    // Sanctum SPA session cookie / XSRF-TOKEN), so the browser no longer
    // needs to send credentials (cookies) on cross-origin requests. See
    // AUTH_MIGRATION_STATUS.md and src/services/api.js.
    'supports_credentials' => false,

];
