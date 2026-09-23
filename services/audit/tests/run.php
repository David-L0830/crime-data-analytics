<?php

declare(strict_types=1);

// service-audit test suite. Dependency-free, like the service itself:
//
//   php tests/run.php
//
// Sections 1–2 need nothing. Section 3 runs against a REAL Postgres that has
// database/01-schema.sql and 02-app-role.sh applied, and is skipped unless
// these are set:
//
//   AUDIT_TEST_DSN                    e.g. pgsql:host=127.0.0.1;port=55432;dbname=audit
//   AUDIT_TEST_OWNER_USER / _PASSWORD the table owner (POSTGRES_USER)
//   AUDIT_TEST_APP_USER / _PASSWORD   audit_writer
//
// The table is append-only, so these tests never clean up: every event they
// write uses a fresh UUID, and assertions compare counts before and after.

use AuditService\App;
use AuditService\EventStore;
use AuditService\PdoEventStore;
use AuditService\Signature;

require __DIR__.'/../src/bootstrap.php';

$passed = 0;
$failed = 0;
$skipped = 0;

function test(string $name, callable $body): void
{
    global $passed, $failed;
    try {
        $body();
        $passed++;
        echo "  PASS  {$name}\n";
    } catch (Throwable $e) {
        $failed++;
        echo "  FAIL  {$name}\n        ".$e->getMessage()."\n";
    }
}

function check(bool $condition, string $message): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}

function uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0F) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3F) | 0x80);

    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

/** Throws unless $sql fails with one of the given SQLSTATEs. */
function assertRefused(PDO $pdo, string $sql, array $sqlStates, string $label): void
{
    try {
        $pdo->exec($sql);
    } catch (PDOException $e) {
        check(in_array($e->getCode(), $sqlStates, true), "{$label}: refused with unexpected SQLSTATE {$e->getCode()}: ".$e->getMessage());

        return;
    }
    throw new RuntimeException("{$label}: the statement was NOT refused");
}

final class InMemoryEventStore implements EventStore
{
    public array $events = [];

    public function append(array $event): bool
    {
        foreach ($this->events as $existing) {
            if ($existing['event_id'] === $event['event_id']) {
                return false;
            }
        }
        $this->events[] = $event + ['id' => count($this->events) + 1];

        return true;
    }

    public function recent(int $limit, ?int $actorUserId): array
    {
        $rows = array_filter($this->events, fn ($e) => $actorUserId === null || $e['actor_user_id'] === $actorUserId);

        return array_slice(array_reverse(array_values($rows)), 0, $limit);
    }

    public function lastLogins(array $userIds): array
    {
        $out = [];
        foreach ($this->events as $e) {
            if ($e['action'] === 'LOGIN' && in_array($e['actor_user_id'], $userIds, true)) {
                $out[(string) $e['actor_user_id']] = $e['occurred_at'];
            }
        }

        return $out;
    }

    public function ping(): void {}
}

const SECRET = 'service-test-secret';

function signedHeaders(string $method, string $uri, string $body, int $now, string $secret = SECRET): array
{
    return [
        'x-audit-timestamp' => (string) $now,
        'x-audit-signature' => Signature::sign($secret, (string) $now, $method, $uri, $body),
    ];
}

function validEvent(array $overrides = []): array
{
    return array_merge([
        'event_id' => uuid(),
        'occurred_at' => gmdate('c'),
        'actor_user_id' => 7,
        'actor_name' => 'Luiza Perez',
        'actor_role' => 'encoder',
        'action' => 'CREATE',
        'module' => 'incidents',
        'target_type' => 'incident',
        'description' => 'Created case CDARS-1',
        'ip_address' => '10.0.0.5',
    ], $overrides);
}

// ---------------------------------------------------------------------------
echo "1. Request signatures\n";
// ---------------------------------------------------------------------------

test('matches the shared test vector (same value asserted in the core app)', function () {
    check(
        Signature::sign('cdars-test-vector-secret', '1700000000', 'POST', '/v1/events', '{"action":"LOGIN"}')
            === '3122a2c9d192eb7c4963d4edfd13c3a5864aa1796fbb2187bdcde76a49b654a0',
        'signature differs from the shared vector'
    );
});

test('accepts a valid signature', function () {
    $now = 1_700_000_000;
    $h = signedHeaders('POST', '/v1/events', '{}', $now);
    check(Signature::verify(SECRET, $h['x-audit-timestamp'], $h['x-audit-signature'], 'POST', '/v1/events', '{}', $now), 'valid signature rejected');
});

test('rejects a tampered body, path, method or wrong secret', function () {
    $now = 1_700_000_000;
    $h = signedHeaders('POST', '/v1/events', '{"a":1}', $now);
    [$ts, $sig] = [$h['x-audit-timestamp'], $h['x-audit-signature']];
    check(! Signature::verify(SECRET, $ts, $sig, 'POST', '/v1/events', '{"a":2}', $now), 'tampered body accepted');
    check(! Signature::verify(SECRET, $ts, $sig, 'POST', '/v1/other', '{"a":1}', $now), 'different path accepted');
    check(! Signature::verify(SECRET, $ts, $sig, 'GET', '/v1/events', '{"a":1}', $now), 'different method accepted');
    check(! Signature::verify('another-secret', $ts, $sig, 'POST', '/v1/events', '{"a":1}', $now), 'wrong secret accepted');
});

test('rejects a stale or future timestamp (replay window)', function () {
    $signedAt = 1_700_000_000;
    $h = signedHeaders('GET', '/v1/events', '', $signedAt);
    check(! Signature::verify(SECRET, $h['x-audit-timestamp'], $h['x-audit-signature'], 'GET', '/v1/events', '', $signedAt + 301), 'stale request accepted');
    check(! Signature::verify(SECRET, $h['x-audit-timestamp'], $h['x-audit-signature'], 'GET', '/v1/events', '', $signedAt - 301), 'future request accepted');
});

test('fails closed without a configured secret or headers', function () {
    $now = 1_700_000_000;
    $h = signedHeaders('GET', '/v1/events', '', $now, '');
    check(! Signature::verify('', $h['x-audit-timestamp'], $h['x-audit-signature'], 'GET', '/v1/events', '', $now), 'empty secret accepted');
    check(! Signature::verify(SECRET, null, null, 'GET', '/v1/events', '', $now), 'missing headers accepted');
});

// ---------------------------------------------------------------------------
echo "2. HTTP interface\n";
// ---------------------------------------------------------------------------

test('unsigned and badly signed /v1 requests get 401 and store nothing', function () {
    $store = new InMemoryEventStore;
    $app = new App($store, SECRET);
    $body = json_encode(validEvent());
    [$status] = $app->handle('POST', '/v1/events', [], $body, time());
    check($status === 401, "unsigned: expected 401, got {$status}");
    [$status] = $app->handle('POST', '/v1/events', signedHeaders('POST', '/v1/events', $body, time(), 'wrong'), $body, time());
    check($status === 401, "wrong key: expected 401, got {$status}");
    check($store->events === [], 'an unsigned event was stored');
});

test('a signed valid event is stored (201), and a retry is a 200 duplicate', function () {
    $store = new InMemoryEventStore;
    $app = new App($store, SECRET);
    $now = time();
    $body = json_encode(validEvent());
    [$status, $payload] = $app->handle('POST', '/v1/events', signedHeaders('POST', '/v1/events', $body, $now), $body, $now);
    check($status === 201 && $payload['status'] === 'created', "expected 201 created, got {$status}");
    [$status, $payload] = $app->handle('POST', '/v1/events', signedHeaders('POST', '/v1/events', $body, $now), $body, $now);
    check($status === 200 && $payload['status'] === 'duplicate', "expected 200 duplicate, got {$status}");
    check(count($store->events) === 1, 'the retry stored a second copy');
});

test('an invalid event is refused with 422', function () {
    $app = new App(new InMemoryEventStore, SECRET);
    $now = time();
    foreach ([
        validEvent(['event_id' => 'not-a-uuid']),
        validEvent(['action' => '']),
        validEvent(['occurred_at' => gmdate('c', $now + 3600)]),
        validEvent(['actor_user_id' => 'seven']),
    ] as $event) {
        $body = json_encode($event);
        [$status] = $app->handle('POST', '/v1/events', signedHeaders('POST', '/v1/events', $body, $now), $body, $now);
        check($status === 422, "expected 422, got {$status}");
    }
});

test('there is no update or delete route (405)', function () {
    $app = new App(new InMemoryEventStore, SECRET);
    $now = time();
    foreach (['PUT', 'PATCH', 'DELETE'] as $method) {
        [$status] = $app->handle($method, '/v1/events', signedHeaders($method, '/v1/events', '', $now), '', $now);
        check($status === 405, "{$method}: expected 405, got {$status}");
    }
});

test('reads are signed too, and filter by actor', function () {
    $store = new InMemoryEventStore;
    $store->append(validEvent(['actor_user_id' => 7]));
    $store->append(validEvent(['actor_user_id' => 9]));
    $app = new App($store, SECRET);
    $now = time();

    [$status] = $app->handle('GET', '/v1/events', [], '', $now);
    check($status === 401, "unsigned read: expected 401, got {$status}");

    $uri = '/v1/events?limit=50&actor_user_id=9';
    [$status, $payload] = $app->handle('GET', $uri, signedHeaders('GET', $uri, '', $now), '', $now);
    check($status === 200 && count($payload['data']) === 1 && $payload['data'][0]['actor_user_id'] === 9, 'actor filter failed');
});

test('last logins are returned per user', function () {
    $store = new InMemoryEventStore;
    $store->append(validEvent(['actor_user_id' => 7, 'action' => 'LOGIN', 'occurred_at' => '2026-09-01T08:00:00+00:00']));
    $app = new App($store, SECRET);
    $now = time();
    $uri = '/v1/last-logins?user_ids=7,9';
    [$status, $payload] = $app->handle('GET', $uri, signedHeaders('GET', $uri, '', $now), '', $now);
    $data = (array) $payload['data'];
    check($status === 200 && isset($data['7']) && ! isset($data['9']), 'last logins wrong');
});

test('health needs no signature', function () {
    [$status] = (new App(new InMemoryEventStore, SECRET))->handle('GET', '/health', [], '', time());
    check($status === 200, "expected 200, got {$status}");
});

// ---------------------------------------------------------------------------
echo "3. Append-only database (real Postgres)\n";
// ---------------------------------------------------------------------------

$dsn = getenv('AUDIT_TEST_DSN') ?: '';

if ($dsn === '') {
    $skipped++;
    echo "  SKIP  set AUDIT_TEST_DSN (and the owner/app credentials) to run against Postgres\n";
} else {
    $owner = new PDO($dsn, getenv('AUDIT_TEST_OWNER_USER') ?: '', getenv('AUDIT_TEST_OWNER_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $appPdo = new PDO($dsn, getenv('AUDIT_TEST_APP_USER') ?: '', getenv('AUDIT_TEST_APP_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $store = new PdoEventStore($appPdo);
    $count = fn () => (int) $owner->query('SELECT count(*) FROM audit_events')->fetchColumn();

    $eventId = uuid();
    $event = validEvent(['event_id' => $eventId, 'source' => 'test-suite']);
    $normalised = (new App($store, SECRET))->handle(
        'POST', '/v1/events', signedHeaders('POST', '/v1/events', json_encode($event), time()), json_encode($event), time()
    );

    test('the application role can insert through the service', function () use ($normalised, $owner, $eventId) {
        check($normalised[0] === 201, "expected 201, got {$normalised[0]}");
        $found = (int) $owner->query("SELECT count(*) FROM audit_events WHERE event_id = '{$eventId}'")->fetchColumn();
        check($found === 1, 'row not found after insert');
    });

    test('a duplicate event_id is ignored, not updated', function () use ($store, $event, $count) {
        $before = $count();
        $event['occurred_at'] = gmdate('Y-m-d\TH:i:s.uP');
        $event['source'] = 'test-suite';
        check($store->append($event) === false, 'duplicate reported as created');
        check($count() === $before, 'duplicate changed the row count');
    });

    test('UPDATE is refused for the application role (no privilege)', function () use ($appPdo, $eventId) {
        assertRefused($appPdo, "UPDATE audit_events SET description = 'rewritten' WHERE event_id = '{$eventId}'", ['42501'], 'app UPDATE');
    });

    test('DELETE is refused for the application role (no privilege)', function () use ($appPdo, $eventId) {
        assertRefused($appPdo, "DELETE FROM audit_events WHERE event_id = '{$eventId}'", ['42501'], 'app DELETE');
    });

    test('UPDATE is refused even for the table owner (trigger)', function () use ($owner, $eventId) {
        assertRefused($owner, "UPDATE audit_events SET description = 'rewritten' WHERE event_id = '{$eventId}'", ['23001'], 'owner UPDATE');
    });

    test('DELETE is refused even for the table owner (trigger)', function () use ($owner, $eventId) {
        assertRefused($owner, "DELETE FROM audit_events WHERE event_id = '{$eventId}'", ['23001'], 'owner DELETE');
    });

    test('TRUNCATE is refused even for the table owner (trigger)', function () use ($owner, $count) {
        $before = $count();
        assertRefused($owner, 'TRUNCATE audit_events', ['23001'], 'owner TRUNCATE');
        check($count() === $before, 'rows disappeared');
    });

    test('the row is unchanged after every refused mutation', function () use ($owner, $eventId) {
        $description = $owner->query("SELECT description FROM audit_events WHERE event_id = '{$eventId}'")->fetchColumn();
        check($description === 'Created case CDARS-1', 'the stored description changed');
    });

    test('the application role cannot disable the triggers', function () use ($appPdo) {
        assertRefused($appPdo, 'ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update_or_delete', ['42501'], 'app ALTER');
    });

    test('reads return newest first without the IP address', function () use ($store) {
        $rows = $store->recent(5, null);
        check($rows !== [] && ! array_key_exists('ip_address', $rows[0]), 'ip_address leaked or no rows');
    });
}

echo "\n{$passed} passed, {$failed} failed, {$skipped} skipped\n";
exit($failed === 0 ? 0 : 1);
