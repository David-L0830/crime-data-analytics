<?php

declare(strict_types=1);

// Dependency-free: a three-line autoloader for the AuditService namespace
// instead of Composer, so the image is PHP plus pdo_pgsql and nothing else.
spl_autoload_register(function (string $class): void {
    $prefix = 'AuditService\\';
    if (str_starts_with($class, $prefix)) {
        require __DIR__.'/'.substr($class, strlen($prefix)).'.php';
    }
});
