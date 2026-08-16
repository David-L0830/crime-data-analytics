<?php

return [
    'driver' => env('SESSION_DRIVER', 'database'),
    'lifetime' => (int) env('SESSION_LIFETIME', 120),
    'expire_on_close' => false,
    'encrypt' => false,
    'files' => storage_path('framework/sessions'),
    'connection' => env('SESSION_CONNECTION'),
    'table' => 'sessions',
    'store' => env('SESSION_STORE'),
    'lottery' => [2, 100],
    'cookie' => env('SESSION_COOKIE', 'badac_cdars_session'),
    'path' => '/',
    'domain' => env('SESSION_DOMAIN'),
    'secure' => env('SESSION_SECURE_COOKIE'),
    'http_only' => true,
    // This session config is Laravel's default web-session scaffolding —
    // routes/web.php serves only a stateless JSON health check, and every
    // real route in this app is under routes/api.php, authenticated via
    // Supabase JWT Bearer tokens (see routes/api.php), not this cookie
    // session. Nothing in this application actually depends on it.
    'same_site' => env('SESSION_SAME_SITE', 'lax'),
    'partitioned' => false,
];
