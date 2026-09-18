<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Models\User;
use Database\Factories\IncidentFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Section 6 Phase 2: AnalyticsController::index() was rewritten to aggregate
// in PostgreSQL (GROUP BY + count()) instead of loading every non-archived
// incident into PHP and counting with Collection::countBy(). These tests
// pin the exact response shape/values the old implementation produced, so a
// behavior change in either direction — not just a crash — would fail here.
// BadacReadonlyTest already covers that the route is reachable for that
// role; this file covers correctness of the aggregation itself.
//
// These endpoints now answer with OFFICIAL data only — validated and not
// archived (Phase 2B), through AnalyticsController::baseQuery() and
// Incident::scopeOfficial(). Before that they excluded archived records alone,
// so every figure here counted encodings nobody had reviewed. CP-5A closed
// that on the Statistical Analysis page, which computes client-side from
// useData(); the API kept the old rule, which left it answering with
// unreviewed data to anything that called it.
//
// So the fixtures below say `official()` wherever a record is meant to be
// COUNTED, and the exclusion cases state the three ways a record is not
// official. The factory deliberately sets no validation_status, so a bare
// Incident::factory() row is pending — which is exactly what the exclusion
// cases want and exactly why the counted rows have to be explicit.
class AnalyticsTest extends TestCase
{
    use RefreshDatabase;

    private function actingUser(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    /** Incidents that count: validated and not archived. */
    private function official(): IncidentFactory
    {
        return Incident::factory()->state([
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ]);
    }

    public function test_overview_aggregates_totals_and_group_counts(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create([
            'category' => 'Property Crime',
            'status' => 'Open',
            'sitio' => 'Sitio 1',
        ]);

        $this->official()->create([
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

        $this->official()->create(['status' => 'Open', 'sitio' => 'Sitio 1']);
        $this->official()->create(['status' => 'Archived', 'sitio' => 'Sitio 1']);

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

    // ===== Only OFFICIAL records reach these endpoints =====

    public function test_overview_excludes_pending_incidents(): void
    {
        $this->actingUser();

        $this->official()->create(['status' => 'Open', 'sitio' => 'Sitio 1']);
        Incident::factory()->create([
            'status' => 'Open',
            'sitio' => 'Sitio 3',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $response = $this->getJson('/api/analytics')->assertOk();

        $response->assertJsonPath('total', 1);
        $this->assertArrayNotHasKey('Sitio 3', $response->json('bySitio'));
    }

    public function test_overview_excludes_returned_incidents(): void
    {
        $this->actingUser();

        $this->official()->create(['status' => 'Open', 'sitio' => 'Sitio 1']);
        Incident::factory()->create([
            'status' => 'Open',
            'sitio' => 'Sitio 3',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);

        $response = $this->getJson('/api/analytics')->assertOk();

        $response->assertJsonPath('total', 1);
        $this->assertArrayNotHasKey('Sitio 3', $response->json('bySitio'));
    }

    public function test_overview_of_a_mixed_set_counts_only_the_official_records(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create(['status' => 'Open', 'sitio' => 'Sitio 1']);
        Incident::factory()->count(3)->create([
            'status' => 'Open',
            'sitio' => 'Sitio 3',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        Incident::factory()->count(2)->create([
            'status' => 'Open',
            'sitio' => 'Sitio 3',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);
        // Validated but archived: excluded by the archive rule alone, which is
        // independent of the validation one.
        $this->official()->create(['status' => 'Archived', 'sitio' => 'Sitio 2']);
        // Archived AND pending: excluded twice over.
        Incident::factory()->create([
            'status' => 'Archived',
            'sitio' => 'Sitio 2',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $response = $this->getJson('/api/analytics')->assertOk();

        $response->assertJsonPath('total', 2);
        $this->assertSame(['Sitio 1' => 2], $response->json('bySitio'));
    }

    public function test_overview_is_empty_rather_than_permissive_when_nothing_is_validated(): void
    {
        // Fails CLOSED. An API with no validated data answers with nothing, not
        // with everything — the safe direction for a figure people act on.
        $this->actingUser();

        Incident::factory()->count(5)->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $this->getJson('/api/analytics')->assertOk()->assertJsonPath('total', 0);
    }

    // ===== The rule holds on the other three endpoints too =====
    //
    // All four go through baseQuery(), so these guard the shared method rather
    // than each aggregation — the failure mode being guarded against is the
    // rule holding for some endpoints and not others.

    public function test_crime_types_counts_only_official_records(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create(['crime_type' => 'Theft', 'status' => 'Open']);
        Incident::factory()->count(4)->create([
            'crime_type' => 'Vandalism',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        $this->official()->create(['crime_type' => 'Robbery', 'status' => 'Archived']);

        $rows = $this->getJson('/api/analytics/crime-types')->assertOk()->json();

        $this->assertCount(1, $rows);
        $this->assertSame('Theft', $rows[0]['crime_type']);
        $this->assertSame(2, $rows[0]['total']);
    }

    public function test_monthly_counts_only_official_records(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create([
            'incident_date' => '2026-05-10',
            'status' => 'Open',
        ]);
        Incident::factory()->count(3)->create([
            'incident_date' => '2026-06-10',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);

        $rows = $this->getJson('/api/analytics/monthly')->assertOk()->json();

        $this->assertCount(1, $rows);
        $this->assertSame('2026-05', $rows[0]['month']);
        $this->assertSame(2, $rows[0]['total']);
    }

    public function test_locations_counts_only_official_records(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create(['sitio' => 'Sitio 1', 'status' => 'Open']);
        Incident::factory()->count(5)->create([
            'sitio' => 'Sitio 3',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $rows = $this->getJson('/api/analytics/locations')->assertOk()->json();

        $this->assertCount(1, $rows);
        $this->assertSame('Sitio 1', $rows[0]['sitio']);
        $this->assertSame(2, $rows[0]['total']);
    }
}
