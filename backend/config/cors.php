<?php

return [

    'paths' => ['api/*'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_values(array_unique(array_filter(array_merge(
        [
            env('FRONTEND_URL', 'http://localhost:5173'),
            'https://crime-data-analytics-n5i-bhucxhxo-david-l0830-projects.vercel.app',
        ],
        array_map('trim', explode(',', env('CORS_ALLOWED_ORIGINS', '')))
    )))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false,

];
