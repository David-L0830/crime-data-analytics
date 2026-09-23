<?php

namespace App\Services\Audit;

/**
 * Signs requests to service-audit. An independent implementation of the scheme
 * service-audit verifies (services/audit/src/Signature.php):
 *
 *   canonical = "{timestamp}\n{METHOD}\n{path?query}\n{sha256(body) hex}"
 *   signature = hex(HMAC-SHA256(canonical, AUDIT_SERVICE_SECRET))
 *
 * Both test suites assert the same fixed test vector, which is what proves the
 * two implementations agree without either depending on the other's code.
 */
final class AuditSignature
{
    public static function sign(string $secret, string $timestamp, string $method, string $pathWithQuery, string $body): string
    {
        $canonical = $timestamp."\n".strtoupper($method)."\n".$pathWithQuery."\n".hash('sha256', $body);

        return hash_hmac('sha256', $canonical, $secret);
    }
}
