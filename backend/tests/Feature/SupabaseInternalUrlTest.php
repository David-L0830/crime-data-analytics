<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\EmailMfaService;
use App\Services\SupabaseAdminService;
use App\Services\SupabaseStorageService;
use App\Support\SupabaseEndpoint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// SUPABASE_INTERNAL_URL (config/supabase.php): where this backend REACHES
// Supabase, when that differs from the public SUPABASE_URL tokens are issued
// under — the local Docker stack against a host-run Supabase CLI.
//
// Two rules, both pinned here:
//   1. Every server-to-server call goes to the internal address when it is set.
//   2. The token issuer and browser-facing URLs NEVER use it.
// And with it unset, everything uses SUPABASE_URL exactly as before.
class SupabaseInternalUrlTest extends TestCase
{
    use RefreshDatabase;

    private const PUBLIC = 'https://test-project.supabase.co'; // phpunit.xml SUPABASE_URL

    private const INTERNAL = 'http://host.docker.internal:54321';

    private function useInternalUrl(): void
    {
        config(['supabase.internal_url' => self::INTERNAL]);
    }

    private function sentTo(string $base): \Closure
    {
        return fn (HttpRequest $request) => str_starts_with($request->url(), $base.'/');
    }

    // --- The default: nothing changes -------------------------------------

    public function test_without_an_internal_url_both_addresses_are_the_public_url(): void
    {
        $this->assertSame(self::PUBLIC, SupabaseEndpoint::publicBase());
        $this->assertSame(self::PUBLIC, SupabaseEndpoint::serverBase());
    }

    public function test_without_an_internal_url_the_jwks_are_fetched_from_the_public_url(): void
    {
        Cache::flush();
        Http::fake([self::PUBLIC.'/*' => Http::response(['keys' => []], 200)]);

        // No usable key in the JWKS, so the HS256 test secret verifies the token.
        $this->actingAsSupabase(User::factory()->create())->getJson('/api/user')->assertOk();

        Http::assertSent(fn (HttpRequest $request) => $request->url() === self::PUBLIC.'/auth/v1/.well-known/jwks.json');
    }

    // --- Token verification -------------------------------------------------

    public function test_the_jwks_are_fetched_from_the_internal_url_when_set(): void
    {
        Cache::flush();
        $this->useInternalUrl();
        Http::fake([self::INTERNAL.'/*' => Http::response(['keys' => []], 200)]);

        $this->actingAsSupabase(User::factory()->create())->getJson('/api/user')->assertOk();

        Http::assertSent(fn (HttpRequest $request) => $request->url() === self::INTERNAL.'/auth/v1/.well-known/jwks.json');
        Http::assertNotSent($this->sentTo(self::PUBLIC));
    }

    public function test_the_issuer_is_still_checked_against_the_public_url(): void
    {
        Cache::flush();
        $this->useInternalUrl();
        Http::fake([self::INTERNAL.'/*' => Http::response(['keys' => []], 200)]);
        $user = User::factory()->create();

        // Issued under the public URL (actingAsSupabase's default): accepted.
        $this->actingAsSupabase($user)->getJson('/api/user')->assertOk();

        // A token claiming the INTERNAL address as its issuer is not one
        // Supabase issued for this project, and is refused.
        $this->actingAsSupabaseWithClaims($user, ['iss' => self::INTERNAL.'/auth/v1'], 'aal2')
            ->getJson('/api/user')
            ->assertUnauthorized();
    }

    // --- Admin API ------------------------------------------------------------

    public function test_admin_api_calls_go_to_the_internal_url(): void
    {
        $this->useInternalUrl();
        Http::fake([self::INTERNAL.'/*' => Http::response(['id' => 'sb-1', 'factors' => []], 200)]);

        app(SupabaseAdminService::class)->listFactors('sb-1');

        Http::assertSent(fn (HttpRequest $request) => $request->url() === self::INTERNAL.'/auth/v1/admin/users/sb-1');
        Http::assertNotSent($this->sentTo(self::PUBLIC));
    }

    public function test_password_verification_goes_to_the_internal_url(): void
    {
        $this->useInternalUrl();
        Http::fake([self::INTERNAL.'/*' => Http::response(['access_token' => 'unused'], 200)]);

        $this->assertTrue(app(SupabaseAdminService::class)->verifyPassword('person@example.com', 'Correct-Horse-9'));

        Http::assertSent(fn (HttpRequest $request) => str_starts_with($request->url(), self::INTERNAL.'/auth/v1/token'));
        Http::assertNotSent($this->sentTo(self::PUBLIC));
    }

    // --- Email MFA session check ------------------------------------------------

    public function test_the_email_mfa_session_check_goes_to_the_internal_url(): void
    {
        $this->useInternalUrl();
        $user = User::factory()->create(['supabase_user_id' => 'sb-live']);
        Http::fake([self::INTERNAL.'/*' => Http::response(['id' => 'sb-live'], 200)]);

        $request = Request::create('/api/user', 'GET', server: ['HTTP_AUTHORIZATION' => 'Bearer caller-token']);

        $this->assertTrue(app(EmailMfaService::class)->sessionIsLive($request, $user));
        Http::assertSent(fn (HttpRequest $request) => $request->url() === self::INTERNAL.'/auth/v1/user');
        Http::assertNotSent($this->sentTo(self::PUBLIC));
    }

    // --- Avatar storage -----------------------------------------------------------

    public function test_storage_writes_go_internal_but_urls_given_to_the_browser_stay_public(): void
    {
        $this->useInternalUrl();
        config(['supabase.avatar_bucket' => 'avatars']);
        Http::fake([self::INTERNAL.'/*' => Http::response([], 200)]);
        $storage = app(SupabaseStorageService::class);

        $this->assertTrue($storage->deleteObject('7.png'));
        Http::assertSent(fn (HttpRequest $request) => $request->method() === 'DELETE'
            && $request->url() === self::INTERNAL.'/storage/v1/object/avatars/7.png');

        // The browser cannot reach host.docker.internal; it gets the public URL,
        // and that URL is still recognised as one of this bucket's objects.
        $publicUrl = $storage->publicUrl('7.png');
        $this->assertSame(self::PUBLIC.'/storage/v1/object/public/avatars/7.png', $publicUrl);
        $this->assertSame('7.png', $storage->objectKeyFromUrl($publicUrl));
        $this->assertNull($storage->objectKeyFromUrl(self::INTERNAL.'/storage/v1/object/public/avatars/7.png'));
    }
}
