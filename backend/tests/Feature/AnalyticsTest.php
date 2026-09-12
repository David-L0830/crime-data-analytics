<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Section 6 Phase 2: AnalyticsController::index() was rewritten to aggregate
// in PostgreSQL (GROUP BY + count()) instead of loading every non-archived
// incident into PHP and counting with Collection::countBy(). These tests
// pin the exact response shape/values the old implementation produced, so a
// behavior change in either direction — not just a crash — would fail here.
// BadacReadonlyTest already covers that the route is reachable for that
// role; this file covers correctness of the aggregation itself.
class AnalyticsTest extends TestCase
{
    use RefreshDatabase;

    private function actingUser(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    public function test_overview_aggregates_totals_and_group_counts(): void
    {
        $this->actingUser();

        Incident::factory()->count(2)->create([
            'category' => 'Property Crime',
            'status' => 'Open',
            'sitio' => 'Sitio 1',
        ]);

        Incident::factory()->create([
            'category' => null,
            'status' => 'Solved',
            'sitio' => 'Sitio 2',
        ]);

        $response = $this->getJson('/api/analytics')->assertOk();

        $response->assertJsonPath('total', 3);

        // Group order is not part of the contract (GROUP BY carries no
        // ordering guarantee, matching the old Collection::countBy() output,
        // which was likewise never sorted) — so each key is checked
        // individually rather than comparing whole arrays positionally.
        $byCategory = $response->json('byCategory');
        $this->assertSame(2, $byCategory['Property Crime']);
        // Collection::countBy() previously collapsed a null group value to a
        // '' array key (PHP's null-to-'' array key coercion); the SQL
        // GROUP BY + pluck() implementation reproduces the same key so the
        // frontend contract does not change.
        $this->assertSame(1, $byCategory['']);
        $this->assertCount(2, $byCategory);

        $byStatus = $response->json('byStatus');
        $this->assertSame(2, $byStatus['Open']);
        $this->assertSame(1, $byStatus['Solved']);
        $this->assertCount(2, $byStatus);

        $bySitio = $response->json('bySitio');
        $this->assertSame(2, $bySitio['Sitio 1']);
        $this->assertSame(1, $bySitio['Sitio 2']);
        $this->assertCount(2, $bySitio);
    }

    public function test_overview_excludes_archived_incidents(): void
    {
        $this->actingUser();

        Incident::factory()->create(['status' => 'Open', 'sitio' => 'Sitio 1']);
        Incident::factory()->create(['status' => 'Archived', 'sitio' => 'Sitio 1']);

        $response = $this->getJson('/api/analytics')->assertOk();

        $response->assertJsonPath('total', 1);
        $this->assertArrayNotHasKey('Archived', $response->json('byStatus'));
    }

    public function test_overview_with_no_matching_incidents_returns_empty_groups(): void
    {
        $this->actingUser();

        $response = $this->getJson('/api/analytics')->assertOk();

        $response->assertJsonPath('total', 0);
        $this->assertSame([], $response->json('byCategory'));
        $this->assertSame([], $response->json('byStatus'));
        $this->assertSame([], $response->json('bySitio'));
    }
}
