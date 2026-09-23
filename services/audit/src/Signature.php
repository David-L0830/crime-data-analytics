<?php

declare(strict_types=1);

namespace AuditService;

/**
 * Request signing shared with the core app (App\Services\Audit\AuditSignature,
 * an independent implementation of the same scheme).
 *
 *   canonical = "{timestamp}\n{METHOD}\n{path?query}\n{sha256(body) hex}"
 *   signature = hex(HMAC-SHA256(canonical, AUDIT_SERVICE_SECRET))
 *
 * Sent as X-Audit-Timestamp and X-Audit-Signature. Covering the method, the
 * exact path and query, and a hash of the body means a captured signature is
 * good for that one request only; the timestamp window bounds replay of even
 * that request to five minutes. Reads are signed as well as writes, because
 * the audit trail is itself sensitive.
 */
final class Signature
{
    public const MAX_SKEW_SECONDS = 300;

    public static function canonical(string $timestamp, string $method, string $pathWithQuery, string $body): string
    {
        return $timestamp."\n".strtoupper($method)."\n".$pathWithQuery."\n".hash('sha256', $body);
    }

    public static function sign(string $secret, string $timestamp, string $method, string $pathWithQuery, string $body): string
    {
        return hash_hmac('sha256', self::canonical($timestamp, $method, $pathWithQuery, $body), $secret);
    }

    /**
     * Fails closed: no secret configured, a missing or malformed header, a
     * timestamp outside the window, or a mismatch all return false.
     */
    public static function verify(
        string $secret,
        ?string $timestamp,
        ?string $signature,
        string $method,
        string $pathWithQuery,
        string $body,
        int $now,
    ): bool {
        if ($secret === '' || $timestamp === null || $signature === null) {
            return false;
        }

        if (! ctype_digit($timestamp) || abs($now - (int) $timestamp) > self::MAX_SKEW_SECONDS) {
            return false;
        }

        return hash_equals(self::sign($secret, $timestamp, $method, $pathWithQuery, $body), strtolower($signature));
    }
}
