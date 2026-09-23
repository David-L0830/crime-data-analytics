<?php

namespace App\Services\Audit;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The HTTP client for service-audit. Every request — reads included — is
 * signed (AuditSignature); the secret itself never leaves this process.
 *
 * Failures throw. For a delivery (append) that is what makes the queued
 * ShipAuditEvent job retry; for a read it becomes a 502 at the proxy.
 */
class AuditServiceClient
{
    /** Stores one event. A duplicate (already delivered) counts as success. */
    public function append(array $event): void
    {
        $this->send('POST', '/v1/events', json_encode($event, JSON_THROW_ON_ERROR))->throw();
    }

    /** @return array<int, array<string, mixed>> newest first */
    public function events(int $limit, ?int $actorUserId = null): array
    {
        $query = '?limit='.$limit.($actorUserId !== null ? '&actor_user_id='.$actorUserId : '');

        return (array) $this->send('GET', '/v1/events'.$query)->throw()->json('data', []);
    }

    /**
     * @param  array<int, int>  $userIds
     * @return array<string, string> user id => ISO-8601 time of the latest LOGIN
     */
    public function lastLogins(array $userIds): array
    {
        $ids = implode(',', array_map('intval', $userIds));

        return (array) $this->send('GET', '/v1/last-logins?user_ids='.$ids)->throw()->json('data', []);
    }

    private function send(string $method, string $pathWithQuery, string $body = ''): Response
    {
        $base = rtrim((string) config('audit.service.url'), '/');
        $secret = (string) config('audit.service.secret');

        if ($base === '' || $secret === '') {
            throw new RuntimeException('The audit service is not configured (AUDIT_SERVICE_URL / AUDIT_SERVICE_SECRET).');
        }

        // The query string is built by hand and sent exactly as signed: the
        // service verifies the raw request URI, so any re-encoding between
        // signing and sending would invalidate the signature.
        $timestamp = (string) time();

        $request = Http::timeout((int) config('audit.service.timeout', 5))
            ->acceptJson()
            ->withHeaders([
                'X-Audit-Timestamp' => $timestamp,
                'X-Audit-Signature' => AuditSignature::sign($secret, $timestamp, $method, $pathWithQuery, $body),
            ]);

        return $method === 'POST'
            ? $request->withBody($body, 'application/json')->post($base.$pathWithQuery)
            : $request->get($base.$pathWithQuery);
    }
}
