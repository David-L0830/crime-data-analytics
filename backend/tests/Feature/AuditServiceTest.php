<?php

namespace Tests\Feature;

use App\Jobs\ShipAuditEvent;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\Audit\AuditServiceClient;
use App\Services\Audit\AuditSignature;
use App\Services\Audit\AuditStore;
use App\Support\Audit;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

// The core app's side of service-audit (Phase 3): queued, signed, retried
// delivery; the proxied reads; and the default database store staying exactly
// as it was. The service's own suite (services/audit/tests/run.php) covers
// signature verification and the append-only triggers.
class AuditServiceTest extends TestCase
{
    use RefreshDatabase;

    private const SERVICE = 'http://service-audit.test';

    private const SECRET = 'core-test-audit-secret';

    private function useServiceStore(): void
    {
        config([
            'audit.driver' => 'service',
            'audit.service.url' => self::SERVICE,
            'audit.service.secret' => self::SECRET,
        ]);
        $this->app->forgetInstance(AuditStore::class);
        Audit::clearResolvedInstance(AuditStore::class);
    }

    /** True when the request carries a valid signature over exactly what was sent. */
    private function signedCorrectly(HttpRequest $request): bool
    {
        $uri = parse_url($request->url(), PHP_URL_PATH)
            .(parse_url($request->url(), PHP_URL_QUERY) ? '?'.parse_url($request->url(), PHP_URL_QUERY) : '');
        $timestamp = $request->header('X-Audit-Timestamp')[0] ?? '';

        return hash_equals(
            AuditSignature::sign(self::SECRET, $timestamp, $request->method(), $uri, $request->body()),
            $request->header('X-Audit-Signature')[0] ?? ''
        );
    }

    private function serviceRow(array $overrides = []): array
    {
        return array_merge([
            'id' => 41,
            'event_id' => '8a3c1f5e-2b7d-4c9a-9e1f-0d2b3c4d5e6f',
            'occurred_at' => '2026-09-20T08:15:00+00:00',
            'actor_user_id' => 7,
            'actor_name' => 'Luiza Perez',
            'actor_role' => 'encoder',
            'action' => 'CREATE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => 'Created case CDARS-1',
        ], $overrides);
    }

    // ===================================================================
    // The signing scheme and the default store
    // ===================================================================

    public function test_signatures_match_the_vector_shared_with_service_audit(): void
    {
        // The same value is asserted in services/audit/tests/run.php, which is
        // what proves the two independent implementations agree.
        $this->assertSame(
            '3122a2c9d192eb7c4963d4edfd13c3a5864aa1796fbb2187bdcde76a49b654a0',
            AuditSignature::sign('cdars-test-vector-secret', '1700000000', 'POST', '/v1/events', '{"action":"LOGIN"}')
        );
    }

    public function test_the_database_store_is_the_default_and_behaves_as_before(): void
    {
        Queue::fake();

        $this->assertFalse(Audit::isRemote());
        Audit::record(['user_id' => null, 'action' => 'UPDATE', 'module' => 'settings', 'description' => 'x']);

        $this->assertSame(1, AuditLog::count());
        Queue::assertNothingPushed();
    }

    // ===================================================================
    // Writes: queued, encrypted, after commit, never breaking the action
    // ===================================================================

    public function test_an_event_is_queued_encrypted_on_the_audit_queue_and_not_written_locally(): void
    {
        Queue::fake();
        $this->useServiceStore();
        $actor = User::factory()->create(['name' => 'Luiza Perez', 'role' => User::ROLE_ENCODER]);

        Audit::record([
            'user_id' => $actor->id,
            'action' => 'CREATE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => 'Created case CDARS-1',
            'ip_address' => '10.0.0.5',
        ]);

        Queue::assertPushedOn('audit', ShipAuditEvent::class);
        $job = Queue::pushed(ShipAuditEvent::class)->first();
        $this->assertInstanceOf(ShouldBeEncrypted::class, $job);
        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $job->event['event_id']);
        // Who acted is captured at the moment of acting — the service has no
        // users table to look it up in later.
        $this->assertSame('Luiza Perez', $job->event['actor_name']);
        $this->assertSame(User::ROLE_ENCODER, $job->event['actor_role']);
        $this->assertSame(0, AuditLog::count());
    }

    public function test_an_event_is_queued_only_when_its_transaction_commits(): void
    {
        Queue::fake();
        $this->useServiceStore();

        try {
            DB::transaction(function () {
                Audit::record(['action' => 'UPDATE', 'module' => 'incidents', 'description' => 'rolled back']);
                throw new RuntimeException('the action failed');
            });
        } catch (RuntimeException) {
        }
        Queue::assertNothingPushed();

        DB::transaction(fn () => Audit::record(['action' => 'UPDATE', 'module' => 'incidents', 'description' => 'committed']));
        Queue::assertPushed(ShipAuditEvent::class, 1);
    }

    public function test_a_queue_outage_never_breaks_the_audited_action(): void
    {
        $this->useServiceStore();
        // An asynchronous queue whose push genuinely fails.
        config(['queue.default' => 'database', 'queue.connections.database.table' => 'missing_jobs_table']);
        Log::spy();

        Audit::record(['action' => 'UPDATE', 'module' => 'settings', 'description' => 'still recorded somewhere']);

        Log::shouldHaveReceived('critical')->once()
            ->withArgs(fn ($message, $context) => str_contains($message, 'could not be queued')
                && $context['event']['description'] === 'still recorded somewhere');
    }

    // ===================================================================
    // Delivery: signed, retried, idempotent
    // ===================================================================

    public function test_delivery_is_a_signed_post_of_the_event(): void
    {
        $this->useServiceStore();
        Http::fake([self::SERVICE.'/*' => Http::response(['status' => 'created'], 201)]);
        $event = ['event_id' => '11111111-2222-4333-8444-555555555555', 'action' => 'LOGIN', 'occurred_at' => now()->toIso8601String()];

        (new ShipAuditEvent($event))->handle(app(AuditServiceClient::class));

        Http::assertSent(fn (HttpRequest $request) => $request->method() === 'POST'
            && $request->url() === self::SERVICE.'/v1/events'
            && $request['event_id'] === $event['event_id']
            && $this->signedCorrectly($request));
    }

    public function test_a_failed_delivery_throws_so_the_queue_retries_it(): void
    {
        $this->useServiceStore();
        Http::fake([self::SERVICE.'/*' => Http::response(['message' => 'down'], 503)]);
        $job = new ShipAuditEvent(['event_id' => '11111111-2222-4333-8444-555555555555', 'action' => 'LOGIN']);

        // Retried for up to a day with growing backoff, rather than a fixed
        // small number of attempts that a short outage would exhaust.
        $this->assertEqualsWithDelta(now()->addDay()->getTimestamp(), $job->retryUntil()->getTimestamp(), 5);
        $this->assertSame([10, 30, 60, 300], $job->backoff);

        $this->expectException(RequestException::class);
        $job->handle(app(AuditServiceClient::class));
    }

    public function test_a_duplicate_answer_counts_as_delivered(): void
    {
        $this->useServiceStore();
        Http::fake([self::SERVICE.'/*' => Http::response(['status' => 'duplicate'], 200)]);

        (new ShipAuditEvent(['event_id' => '11111111-2222-4333-8444-555555555555', 'action' => 'LOGIN']))
            ->handle(app(AuditServiceClient::class));

        Http::assertSentCount(1);
    }

    public function test_the_client_refuses_to_send_without_a_configured_secret(): void
    {
        $this->useServiceStore();
        config(['audit.service.secret' => '']);
        Http::fake();

        try {
            app(AuditServiceClient::class)->append(['event_id' => 'x', 'action' => 'LOGIN']);
            $this->fail('An unsigned request was sent.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('not configured', $e->getMessage());
        }
        Http::assertNothingSent();
    }

    public function test_repeated_sign_in_checks_in_one_session_reuse_one_event_id(): void
    {
        Queue::fake();
        $this->useServiceStore();
        $this->actingAsSupabase(User::factory()->create());

        $this->getJson('/api/user')->assertOk();
        $this->getJson('/api/user')->assertOk();

        $logins = Queue::pushed(ShipAuditEvent::class)->filter(fn ($job) => $job->event['action'] === 'LOGIN');
        $this->assertCount(2, $logins);
        // Same id, so service-audit stores the sign-in once.
        $this->assertCount(1, $logins->pluck('event.event_id')->unique());
    }

    // ===================================================================
    // Reads: GET /audit-logs and account activity proxy to the service
    // ===================================================================

    public function test_audit_logs_are_proxied_in_the_unchanged_response_shape(): void
    {
        $this->useServiceStore();
        Http::fake([self::SERVICE.'/v1/events*' => Http::response(['data' => [$this->serviceRow()]], 200)]);
        $this->actingAsSupabase(User::factory()->create(['role' => User::ROLE_SUPER_ADMIN]));

        $this->getJson('/api/audit-logs')
            ->assertOk()
            ->assertExactJson(['data' => [[
                'id' => '41',
                // Rendered in the app's timezone, exactly as AuditLogResource
                // renders audit_logs.created_at.
                'timestamp' => Carbon::parse('2026-09-20T08:15:00+00:00')
                    ->setTimezone(config('app.timezone'))->toIso8601String(),
                'performedBy' => 'Luiza Perez',
                'role' => 'encoder',
                'action' => 'CREATE',
                'targetType' => 'incident',
                'details' => 'Created case CDARS-1',
            ]]]);

        Http::assertSent(fn (HttpRequest $request) => $request->method() === 'GET'
            && $request->url() === self::SERVICE.'/v1/events?limit=200'
            && $this->signedCorrectly($request));
    }

    public function test_role_enforcement_stays_in_the_core_app(): void
    {
        $this->useServiceStore();
        Http::fake();
        $this->actingAsSupabase(User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]));

        $this->getJson('/api/audit-logs')->assertForbidden();

        Http::assertNotSent(fn (HttpRequest $request) => str_starts_with($request->url(), self::SERVICE));
    }

    public function test_an_unavailable_audit_service_is_a_502_that_reveals_nothing(): void
    {
        $this->useServiceStore();
        Http::fake([self::SERVICE.'/*' => Http::response(['message' => 'SQLSTATE[08006] host audit-db'], 500)]);
        $this->actingAsSupabase(User::factory()->create(['role' => User::ROLE_SUPER_ADMIN]));

        $response = $this->getJson('/api/audit-logs')->assertStatus(502);

        $this->assertStringNotContainsString('audit-db', $response->getContent());
    }

    public function test_account_activity_is_proxied_with_the_actor_filter_and_itself_audited(): void
    {
        Queue::fake();
        $this->useServiceStore();
        $target = User::factory()->create(['role' => User::ROLE_ENCODER]);
        Http::fake([self::SERVICE.'/v1/events*' => Http::response(['data' => [$this->serviceRow(['actor_user_id' => $target->id])]], 200)]);
        $this->actingAsSupabase(User::factory()->create(['role' => User::ROLE_SUPER_ADMIN]));

        $this->getJson("/api/users/{$target->id}/activity")
            ->assertOk()
            ->assertJsonPath('data.0.details', 'Created case CDARS-1');

        Http::assertSent(fn (HttpRequest $request) => $request->url() === self::SERVICE."/v1/events?limit=50&actor_user_id={$target->id}"
            && $this->signedCorrectly($request));
        Queue::assertPushed(ShipAuditEvent::class, fn ($job) => $job->event['action'] === 'VIEW');
    }

    public function test_the_user_list_reads_every_last_login_in_one_batched_call(): void
    {
        $this->useServiceStore();
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $validator = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        Http::fake([
            self::SERVICE.'/v1/last-logins*' => Http::response(['data' => [(string) $encoder->id => '2026-09-20T08:00:00+00:00']], 200),
        ]);
        $this->actingAsSupabase($admin);

        $rows = collect($this->getJson('/api/users')->assertOk()->json('data'))->keyBy('id');

        $this->assertSame(
            Carbon::parse('2026-09-20T08:00:00+00:00')->setTimezone(config('app.timezone'))->toIso8601String(),
            $rows[(string) $encoder->id]['lastLoginAt']
        );
        $this->assertNull($rows[(string) $validator->id]['lastLoginAt']);
        $this->assertCount(1, Http::recorded(fn (HttpRequest $request) => str_contains($request->url(), '/v1/last-logins')));
    }
}
