<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// GET /api/settings/metabase-status — the Super Administrator's read-only view
// of the Metabase embedding configuration. The secret stays in the environment
// and must never appear in the response in any form.
class MetabaseStatusTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-only-embedding-secret-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'metabase.site_url' => 'https://metabase.test.invalid/',
            'metabase.secret_key' => self::SECRET,
            'metabase.dashboards.crime' => 2,
            'metabase.dashboards.analytics' => 3,
            'metabase.dashboards.trends' => 4,
        ]);
    }

    private function actingRole(string $role): void
    {
        $this->actingAsSupabase(User::factory()->create(['role' => $role]));
    }

    public function test_super_admin_sees_the_configuration_status(): void
    {
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->getJson('/api/settings/metabase-status')
            ->assertOk()
            ->assertJsonPath('data.siteUrl', 'https://metabase.test.invalid')
            ->assertJsonPath('data.siteUrlConfigured', true)
            ->assertJsonPath('data.embeddingSecretConfigured', true)
            ->assertJsonPath('data.tokenTtlSeconds', 600)
            ->assertJsonPath('data.ready', true)
            ->assertJsonPath('data.dashboards.0.key', 'crime')
            ->assertJsonPath('data.dashboards.0.id', '2')
            ->assertJsonPath('data.dashboards.0.configured', true);
    }

    public function test_the_secret_never_appears_in_the_response(): void
    {
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $body = $this->getJson('/api/settings/metabase-status')->assertOk()->getContent();

        $this->assertStringNotContainsString(self::SECRET, $body);
        // Not even a fragment of it: a prefix or suffix narrows a guess.
        $this->assertStringNotContainsString(substr(self::SECRET, 0, 12), $body);
        $this->assertStringNotContainsString(substr(self::SECRET, -12), $body);
    }

    public function test_missing_values_are_reported_as_not_ready(): void
    {
        config([
            'metabase.secret_key' => null,
            'metabase.dashboards.trends' => null,
        ]);
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->getJson('/api/settings/metabase-status')
            ->assertOk()
            ->assertJsonPath('data.embeddingSecretConfigured', false)
            ->assertJsonPath('data.dashboards.2.key', 'trends')
            ->assertJsonPath('data.dashboards.2.configured', false)
            ->assertJsonPath('data.dashboards.2.id', null)
            ->assertJsonPath('data.ready', false);
    }

    public function test_it_reads_configuration_only_and_contacts_nothing(): void
    {
        Http::fake();
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->getJson('/api/settings/metabase-status')->assertOk();

        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'metabase'));
    }

    public function test_every_other_role_is_refused(): void
    {
        foreach ([User::ROLE_BADAC_ADMIN, User::ROLE_ENCODER, User::ROLE_BADAC_VALIDATOR] as $role) {
            $this->actingRole($role);

            $this->getJson('/api/settings/metabase-status')->assertForbidden();
        }
    }
}
