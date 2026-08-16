<?php

return [

    // Final auth migration — 'supabase' is the only guard this application
    // authenticates through (see AUTH_MIGRATION_STATUS.md /
    // AppServiceProvider::boot()). It is stateless (Auth::viaRequest) and
    // reads a Bearer token, never a session cookie, so this 'defaults'
    // entry only matters for the rare internal Laravel call that resolves
    // the guard implicitly (e.g. a console command) — no user-facing route
    // relies on it, since every route in routes/api.php names
    // 'auth:supabase' explicitly.
    'defaults' => [
        'guard' => 'supabase',
    ],

    'guards' => [
        'supabase' => [
            'driver' => 'supabase',
            'provider' => 'users',
        ],
    ],

    'providers' => [
        // Still needed even though nothing authenticates through it
        // directly — Auth::viaRequest()'s resolver (SupabaseTokenValidator)
        // returns an App\Models\User instance, and this entry is what lets
        // the 'users' provider name above resolve to that Eloquent model.
        'users' => [
            'driver' => 'eloquent',
            'model' => App\Models\User::class,
        ],
    ],

];
