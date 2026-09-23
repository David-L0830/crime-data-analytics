<?php

// Where audit events go (App\Services\Audit\AuditStore).
//
//   database — the audit_logs table in this application's own database. The
//              default, and what every hosted environment and the test suite
//              use: behaviour there is exactly what it was before
//              service-audit existed.
//   service  — the isolated audit microservice (services/audit), reached over
//              signed HTTP. Set only by the local docker-compose stack.
//
// In `service` mode nothing is written to audit_logs, and the existing history
// in that table is NOT copied into the service.

return [

    'driver' => env('AUDIT_DRIVER', 'database'),

    'service' => [
        // e.g. http://service-audit:8080 inside the compose network.
        'url' => env('AUDIT_SERVICE_URL'),

        // Shared HMAC key; must equal service-audit's AUDIT_SERVICE_SECRET.
        // Never logged and never sent — only signatures made with it are.
        'secret' => env('AUDIT_SERVICE_SECRET'),

        // Seconds to wait for the service. Reads (the proxied Audit Logs page)
        // are on a user's request path, so this stays short.
        'timeout' => (int) env('AUDIT_SERVICE_TIMEOUT', 5),

        // The queue delivery jobs go on. The compose worker consumes it.
        'queue' => env('AUDIT_QUEUE', 'audit'),
    ],

];
