<?php

namespace Tests\Feature;

use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Http\Client\StrayRequestException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// The test suite must be incapable of reaching the network.
//
// Tests\TestCase::setUp() calls Http::preventStrayRequests(), so any HTTP call
// not answered by an explicit Http::fake() throws StrayRequestException inside
// Laravel's client — before Guzzle's transport opens a socket or resolves a
// host. These tests pin that guarantee, that explicit fakes still work, and
// that JWT/JWKS verification remains genuinely tested against a LOCAL JWKS.
class HttpIsolationTest extends TestCase
{
    use RefreshDatabase;

    private function jwksUrl(): string
    {
        return rtrim((string) config('supabase.url'), '/').'/auth/v1/.well-known/jwks.json';
    }

    // --- Unexpected requests are refused locally ----------------------------

    public function test_stray_requests_are_prevented_by_default_in_every_test(): void
    {
        $this->assertTrue(Http::preventingStrayRequests());
    }

    public function test_an_unexpected_request_to_the_configured_supabase_host_fails_locally(): void
    {
        $this->assertStringStartsWith('https://test-project.supabase.co', $this->jwksUrl());

        try {
            Http::timeout(5)->get($this->jwksUrl());
            $this->fail('An un-faked request to the Supabase host was not refused.');
        } catch (StrayRequestException $e) {
            $this->assertStringContainsString($this->jwksUrl(), $e->getMessage());
        }
    }

    public function test_unexpected_requests_to_any_external_host_fail_locally(): void
    {
        $attempts = [
            fn () => Http::get('https://api.example.org/anything'),
            fn () => Http::get('http://example.com/'),
            fn () => Http::withToken('not-a-real-token')->post('https://hooks.example.net/notify', ['a' => 1]),
        ];

        foreach ($attempts as $i => $attempt) {
            try {
                $attempt();
                $this->fail("Unexpected request #{$i} was not refused.");
            } catch (StrayRequestException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    // --- Explicit fakes keep working ----------------------------------------

    public function test_an_explicit_fake_serves_its_request_while_other_hosts_stay_blocked(): void
    {
        Http::fake([
            'https://api.example.test/*' => Http::response(['ok' => true], 200),
        ]);

        $response = Http::get('https://api.example.test/status');
        $this->assertTrue($response->successful());
        $this->assertTrue($response->json('ok'));
        Http::assertSent(fn (HttpRequest $r) => $r->url() === 'https://api.example.test/status');

        $this->expectException(StrayRequestException::class);
        Http::get('https://unfaked.example.test/status');
    }

    // --- JWKS verification is tested against a LOCAL JWKS -------------------

    /**
     * A fresh ES256 (P-256) key pair and its public JWK, generated in memory
     * for this test only. Supabase's current JWT signing keys are ES256.
     *
     * @return array{privatePem: string, jwk: array<string, string>}
     */
    private function es256KeyPair(string $kid): array
    {
        // Windows PHP builds cannot find OpenSSL's config on their own, which
        // makes key generation fail; point at the bundled file when present.
        $cnf = dirname(PHP_BINARY).'/extras/ssl/openssl.cnf';
        $config = is_file($cnf) ? ['config' => $cnf] : [];

        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1'] + $config);
        $this->assertNotFalse($key, 'Could not generate a local EC test key.');

        openssl_pkey_export($key, $privatePem, null, $config);
        $details = openssl_pkey_get_details($key);

        $b64url = fn (string $bytes) => rtrim(strtr(base64_encode(str_pad($bytes, 32, "\0", STR_PAD_LEFT)), '+/', '-_'), '=');

        return [
            'privatePem' => $privatePem,
            'jwk' => [
                'kty' => 'EC',
                'crv' => 'P-256',
                'x' => $b64url($details['ec']['x']),
                'y' => $b64url($details['ec']['y']),
                'alg' => 'ES256',
                'use' => 'sig',
                'kid' => $kid,
            ],
        ];
    }

    private function es256Token(string $privatePem, string $kid, string $sub): string
    {
        $now = time();

        return JWT::encode([
            'sub' => $sub,
            'aud' => 'authenticated',
            'iss' => rtrim((string) config('supabase.url'), '/').'/auth/v1',
            'email' => 'jwks-user@example.com',
            'aal' => 'aal2',
            'session_id' => '44444444-4444-4444-8444-444444444444',
            'iat' => $now,
            'exp' => $now + 3600,
        ], $privatePem, 'ES256', $kid);
    }

    private function jwksUser(): User
    {
        return User::factory()->create([
            'username' => 'jwks-user',
            'email' => 'jwks-user@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-jwks-user',
        ]);
    }

    private function fakeSupabase(array $jwk): void
    {
        Http::fake([
            '*/auth/v1/.well-known/jwks.json' => Http::response(['keys' => [$jwk]], 200),
            // GET /user's security badges read the Admin API.
            '*/auth/v1/admin/users/*' => Http::response(['factors' => [], 'app_metadata' => []], 200),
        ]);
    }

    public function test_an_es256_token_is_verified_against_a_locally_faked_jwks(): void
    {
        // No shared secret: only the JWKS path can authenticate this token.
        config(['supabase.jwt_secret' => null]);

        $user = $this->jwksUser();
        $pair = $this->es256KeyPair('local-test-kid');
        $this->fakeSupabase($pair['jwk']);

        $this->withHeader('Authorization', 'Bearer '.$this->es256Token($pair['privatePem'], 'local-test-kid', 'supabase-jwks-user'))
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.id', (string) $user->id)
            ->assertJsonPath('data.authAssuranceLevel', 'aal2');

        // The JWKS came from the local fake at the configured (test) URL.
        $jwksRequests = Http::recorded(fn (HttpRequest $r) => $r->url() === $this->jwksUrl());
        $this->assertCount(1, $jwksRequests);
    }

    public function test_a_token_signed_by_a_key_outside_the_faked_jwks_is_rejected(): void
    {
        config(['supabase.jwt_secret' => null]);

        $this->jwksUser();
        $published = $this->es256KeyPair('local-test-kid');
        $attacker = $this->es256KeyPair('local-test-kid');
        $this->fakeSupabase($published['jwk']);

        $this->withHeader('Authorization', 'Bearer '.$this->es256Token($attacker['privatePem'], 'local-test-kid', 'supabase-jwks-user'))
            ->getJson('/api/user')
            ->assertUnauthorized();
    }

    // What every test class WITHOUT a JWKS fake now does: the validator's
    // JWKS fetch is refused locally (it records why), and the suite's HS256
    // test secret still authenticates the token.
    public function test_without_a_jwks_fake_the_lookup_is_refused_locally_and_hs256_still_authenticates(): void
    {
        $logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $e) use (&$logged) {
            $logged[] = $e->message.' '.json_encode($e->context);
        });

        $user = $this->jwksUser();

        $this->actingAsSupabase($user, 'aal2')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.id', (string) $user->id);

        $refusal = collect($logged)->first(fn ($line) => str_contains($line, 'Supabase JWKS endpoint unreachable.'));
        $this->assertNotNull($refusal, 'The JWKS lookup was not attempted, or was not refused.');
        $this->assertStringContainsString('without a matching fake', $refusal);
        $this->assertStringContainsString('test-project.supabase.co', $refusal);
    }
}
