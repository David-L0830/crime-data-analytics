<?php

// Backs App\Services\MetabaseEmbedService (added in the next step), which
// signs Metabase's embedding JWT server-side. Same pattern as
// config/supabase.php: this file only ever reads from env(), and nothing
// here is ever returned in an API response or sent to the frontend.

return [

    // Base URL of your Metabase instance (self-hosted server or Metabase
    // Cloud), no trailing slash — e.g. https://metabase.yourdomain.com
    'site_url' => env('METABASE_SITE_URL'),

    // Embedding secret key from Metabase Admin -> Embedding -> Static
    // embedding. This signs every embed JWT. NEVER log it, NEVER return
    // it in a response, NEVER reference it from anywhere but this backend.
    'secret_key' => env('METABASE_EMBEDDING_SECRET_KEY'),

    // How long a signed embed URL stays valid, in seconds, before the
    // iframe needs a fresh token. 10 minutes is Metabase's own doc default.
    'token_ttl' => 600,

    // Metabase dashboard IDs — filled in once the three dashboards exist
    // in Metabase (Step 4+ of the plan). Each is the numeric ID Metabase
    // assigns a dashboard, visible in its URL (e.g. .../dashboard/12-...).
    // Left null until then so a misconfigured lookup fails loudly instead
    // of silently embedding the wrong dashboard.
    'dashboards' => [
        'crime' => env('METABASE_DASHBOARD_ID_CRIME'),
        'analytics' => env('METABASE_DASHBOARD_ID_ANALYTICS'),
        'trends' => env('METABASE_DASHBOARD_ID_TRENDS'),
        'crime_summary' => env('METABASE_DASHBOARD_ID_CRIME_SUMMARY'),
    ],

];