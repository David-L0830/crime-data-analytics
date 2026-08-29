<?php

namespace Tests\Feature;

use App\Models\User;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Coverage for GET /api/embed/metabase/{dashboardKey}.
 *
 * This endpoint had no test at all, despite being the one route that touches
 * the Metabase embedding secret. Two things need to hold and neither was
 * verified anywhere: the secret must never leave the backend, and the filter
 * values must be *locked into the signed token* rather than left in the URL
 * where a viewer could edit them and pull a different slice of barangay data
 * out of the same dashboard.
 *
 * The README also states a filtering contract that nothing enforced in code:
 * "Cleared filters mean show everything. An empty value is omitted entirely
 * from the parameters sent to Metabase — it is never sent as an empty string,
 * which would filter for blank values and return nothing." That is asserted
 * here directly against the decoded token.
 *
 * Authentication follows BadacReadonlyTest: a genuine signed Supabase-style
 * JWT through SupabaseTokenValidator, so 401 (authentication) and 403
 * (authorization) stay two distinct layers, exactly as production enforces.
 *
 * METABASE_* is deliberately absent from phpunit.xml — the unconfigured case
 * is itself one of the behaviours under test — so the tests that need a
 * configured instance set it locally with config(). The secret used here is a
 * test-only string and matches nothing real.
 */
class MetabaseEmbedTest extends TestCase
{
    use RefreshDatabase;

    private const TEST_SECRET = 'test-only-metabase-embedding-secret-not-a-real-credential';

    private const TEST_SITE = 'https://metabase.test.invalid';

    /**
     * Tests\TestCase::actingAsSupabase() mints the signed Supabase-style JWT;
     * this only picks the role first, so each test reads as one line.
     */
    private function signedInAs(string $role): User
    {
        $user = User::factory()->create(['role' => $role]);
        $this->actingAsSupabase($user);

        return $user;
    }

    /** Point the embed service at a fake, self-consistent Metabase instance. */
    private function configureMetabase(): void
    {
        config([
            'metabase.site_url' => self::TEST_SITE,
            'metabase.secret_key' => self::TEST_SECRET,
            'metabase.dashboards.crime' => 2,
            'metabase.dashboards.analytics' => 3,
            'metabase.dashboards.trends' => 4,
        ]);
    }

    /**
     * Pull the JWT back out of the returned iframe URL and verify it against
     * the same secret the backend signed it with. Verifying rather than just
     * decoding is the point: a token the configured secret cannot validate
     * would be rejected by Metabase too.
     */
    private function decodeTokenFrom(string $url): array
    {
        $path = parse_url($url, PHP_URL_PATH);
        $token = substr($path, strrpos($path, '/') + 1);

        return (array) JWT::decode($token, new Key(self::TEST_SECRET, 'HS256'));
    }

    // --- Access control -----------------------------------------------------

    public function test_unauthenticated_request_is_rejected(): void
    {
        $this->configureMetabase();

        $this->getJson('/api/embed/metabase/crime')->assertUnauthorized();
    }

    public function test_encoder_is_forbidden(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_ENCODER);

        $this->getJson('/api/embed/metabase/crime')->assertForbidden();
    }

    public function test_badac_readonly_can_obtain_an_embed_url(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_READONLY);

        $this->getJson('/api/embed/metabase/crime')
            ->assertOk()
            ->assertJsonStructure(['url']);
    }

    public function test_badac_admin_can_obtain_an_embed_url(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $this->getJson('/api/embed/metabase/analytics')->assertOk();
    }

    // --- Routing ------------------------------------------------------------

    public function test_unknown_dashboard_key_is_rejected(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $this->getJson('/api/embed/metabase/nonsense')
            ->assertNotFound()
            ->assertJsonPath('message', 'Unknown dashboard.');
    }

    public function test_each_dashboard_key_signs_its_own_configured_id(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        foreach (['crime' => 2, 'analytics' => 3, 'trends' => 4] as $key => $id) {
            $url = $this->getJson("/api/embed/metabase/$key")->json('url');
            $payload = $this->decodeTokenFrom($url);

            $this->assertSame($id, ((array) $payload['resource'])['dashboard']);
        }
    }

    // --- Misconfiguration ---------------------------------------------------

    public function test_missing_secret_returns_503_rather_than_an_unsigned_url(): void
    {
        $this->configureMetabase();
        config(['metabase.secret_key' => null]);
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $this->getJson('/api/embed/metabase/crime')
            ->assertStatus(503)
            ->assertJsonPath('message', 'Analytics dashboard is not configured yet.')
            ->assertJsonMissingPath('url');
    }

    public function test_missing_dashboard_id_returns_503(): void
    {
        $this->configureMetabase();
        config(['metabase.dashboards.trends' => null]);
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $this->getJson('/api/embed/metabase/trends')->assertStatus(503);
    }

    // --- Secret handling ----------------------------------------------------

    public function test_the_embedding_secret_never_appears_in_the_response(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $response = $this->getJson('/api/embed/metabase/crime')->assertOk();

        $this->assertStringNotContainsString(
            self::TEST_SECRET,
            $response->getContent(),
            'The Metabase embedding secret must never leave the backend.'
        );
    }

    public function test_the_signed_token_expires(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $url = $this->getJson('/api/embed/metabase/crime')->json('url');
        $payload = $this->decodeTokenFrom($url);

        $this->assertArrayHasKey('exp', $payload);
        $this->assertGreaterThan(time(), $payload['exp']);
        $this->assertLessThanOrEqual(
            time() + config('metabase.token_ttl', 600) + 5,
            $payload['exp']
        );
    }

    // --- Locked filter parameters -------------------------------------------

    public function test_filters_are_locked_into_the_signed_token(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $url = $this->getJson('/api/embed/metabase/crime?'.http_build_query([
            'dateFrom' => '2026-01-01',
            'dateTo' => '2026-03-31',
            'crimeType' => 'Theft',
            'sitio' => 'Sitio 3',
            'status' => 'Open',
            'category' => 'Property Crime',
        ]))->json('url');

        $params = (array) $this->decodeTokenFrom($url)['params'];

        $this->assertSame('2026-01-01~2026-03-31', $params['date_range']);
        $this->assertSame('Theft', $params['crime_type']);
        $this->assertSame('Sitio 3', $params['sitio']);
        $this->assertSame('Open', $params['status']);
        $this->assertSame('Property Crime', $params['category']);
    }

    /**
     * The README's filtering contract: a cleared filter means "show
     * everything", so it must be absent from the token rather than present as
     * an empty string — an empty string would filter for blank values and
     * return no rows at all.
     */
    public function test_cleared_filters_are_omitted_rather_than_sent_empty(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $url = $this->getJson('/api/embed/metabase/crime?'.http_build_query([
            'dateFrom' => '',
            'dateTo' => '',
            'crimeType' => '',
            'sitio' => 'Sitio 3',
            'status' => '',
            'category' => '',
        ]))->json('url');

        $params = (array) $this->decodeTokenFrom($url)['params'];

        $this->assertSame(['sitio' => 'Sitio 3'], $params);
    }

    public function test_no_filters_produce_an_empty_parameter_object(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $url = $this->getJson('/api/embed/metabase/crime')->json('url');
        $payload = $this->decodeTokenFrom($url);

        // Cast, not array literal: buildLockedParams()'s (object) cast is what
        // keeps an empty set encoding as {} rather than [], which Metabase
        // rejects.
        $this->assertSame([], (array) $payload['params']);
    }

    public function test_an_open_ended_date_range_keeps_the_tilde_separator(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $url = $this->getJson('/api/embed/metabase/crime?dateFrom=2026-01-01')->json('url');
        $params = (array) $this->decodeTokenFrom($url)['params'];

        $this->assertSame('2026-01-01~', $params['date_range']);
    }

    // --- Embed URL shape ----------------------------------------------------

    public function test_parameter_widgets_are_hidden_in_the_embed_url(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $url = $this->getJson('/api/embed/metabase/crime')->json('url');
        $fragment = parse_url($url, PHP_URL_FRAGMENT);

        // React's FilterBar is the only filter UI a user sees; Metabase's own
        // widgets must stay hidden inside the iframe.
        $this->assertStringContainsString('hide_parameters=', $fragment);
        foreach (config('metabase.hidden_parameters.crime') as $slug) {
            $this->assertStringContainsString($slug, $fragment);
        }
    }

    public function test_the_url_points_at_the_configured_site(): void
    {
        $this->configureMetabase();
        $this->signedInAs(User::ROLE_BADAC_ADMIN);

        $url = $this->getJson('/api/embed/metabase/crime')->json('url');

        $this->assertStringStartsWith(self::TEST_SITE.'/embed/dashboard/', $url);
    }
}
