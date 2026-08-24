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
    ],

    // Parameter widgets to hide inside the embedded iframe, per dashboard key.
    //
    // This is presentation only. It is appended to the embed URL's hash
    // fragment, which Metabase's embed page reads client-side; the signed JWT
    // (and therefore every filter value) sits in the URL path and is untouched.
    // Filtering behaviour is identical with or without this setting.
    //
    // Analytics and Trends publish their parameters as "Editable", which is
    // what lets a cleared React filter mean "no filtering". The side effect is
    // that Metabase also renders its own filter controls, duplicating the app's
    // React FilterBar — the single source of truth for filtering. Listing the
    // slugs here hides those duplicate controls.
    //
    // Slugs listed for a dashboard that does not declare them are simply
    // ignored, so this stays safe if a parameter is added or removed later.
    'hidden_parameters' => [
        'crime' => ['date_range', 'crime_type', 'sitio', 'status', 'category'],
        'analytics' => ['date_range', 'crime_type', 'sitio', 'status', 'category'],
        'trends' => ['date_range', 'crime_type', 'sitio', 'status'],
    ],

    // Appearance options for the embed URL's hash fragment, per dashboard key.
    //
    // Presentation only, exactly like 'hidden_parameters' above: the fragment
    // is read by Metabase's embed page in the browser and never reaches the
    // query, so the signed token and every filter value are untouched.
    //
    // The React `.card` wrapper around the iframe already draws the border,
    // the rounded corners and the heading, so Metabase's own border and title
    // are switched off to avoid doubling them up, and the background is made
    // transparent so the chart area inherits the app's --bg-card in both
    // light and dark themes.
    //
    // Values are emitted in the order listed. Keys are passed through as-is,
    // so this stays usable for any other documented embed appearance option.
    'appearance' => [
        'crime' => ['bordered' => 'false', 'titled' => 'false', 'theme' => 'transparent'],
        'analytics' => ['bordered' => 'false', 'titled' => 'false', 'theme' => 'transparent'],
        'trends' => ['bordered' => 'false', 'titled' => 'false', 'theme' => 'transparent'],
    ],

];