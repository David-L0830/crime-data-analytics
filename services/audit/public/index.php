<?php

declare(strict_types=1);

use AuditService\App;
use AuditService\PdoEventStore;

require __DIR__.'/../src/bootstrap.php';

// Front controller for `php -S` (see Dockerfile). Reads configuration from
// the environment, adapts the PHP request to App::handle(), writes JSON.

$respond = function (int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
};

$secret = (string) getenv('AUDIT_SERVICE_SECRET');

try {
    $pdo = new PDO(
        (string) getenv('AUDIT_DB_DSN'),
        (string) getenv('AUDIT_DB_USER'),
        (string) getenv('AUDIT_DB_PASSWORD'),
        [PDO::ATTR_TIMEOUT => 5],
    );
} catch (Throwable $e) {
    error_log('service-audit: database connection failed: '.get_class($e));
    $respond(503, ['message' => 'The audit database is unavailable.']);

    return;
}

$headers = [];
foreach ($_SERVER as $key => $value) {
    if (str_starts_with($key, 'HTTP_')) {
        $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = (string) $value;
    }
}

[$status, $payload] = (new App(new PdoEventStore($pdo), $secret))->handle(
    (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
    (string) ($_SERVER['REQUEST_URI'] ?? '/'),
    $headers,
    (string) file_get_contents('php://input'),
    time(),
);

$respond($status, $payload);
