<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Mailer
    |--------------------------------------------------------------------------
    |
    | This project didn't ship a config/mail.php before Phase 4 because
    | nothing sent email yet. Defaults to the `log` driver so password-reset
    | emails are visible in storage/logs/laravel.log out of the box — set
    | MAIL_MAILER=smtp (or ses/postmark/resend) and the MAIL_HOST/PORT/
    | USERNAME/PASSWORD variables in .env for real delivery.
    |
    */

    'default' => env('MAIL_MAILER', 'log'),

    'mailers' => [

        'smtp' => [
            'transport' => 'smtp',
            'scheme' => env('MAIL_SCHEME'),
            'url' => env('MAIL_URL'),
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => env('MAIL_PORT', 2525),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'timeout' => null,
            'local_domain' => env('MAIL_EHLO_DOMAIN', parse_url(env('APP_URL', 'http://localhost'), PHP_URL_HOST)),
        ],

        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],

        'array' => [
            'transport' => 'array',
        ],

        'failover' => [
            'transport' => 'failover',
            'mailers' => ['smtp', 'log'],
            'retry_after' => 60,
        ],

        'roundrobin' => [
            'transport' => 'roundrobin',
            'mailers' => ['smtp', 'log'],
            'retry_after' => 60,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Global "From" Address
    |--------------------------------------------------------------------------
    */

    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'no-reply@barangay178.gov.ph'),
        'name' => env('MAIL_FROM_NAME', 'BADAC Analytics'),
    ],

];
