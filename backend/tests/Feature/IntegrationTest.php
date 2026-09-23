<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Models\Setting;
use App\Models\User;
use Database\Factories\IncidentFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// GET /api/v1/integrations/* — the read-only, pull-based outputs to the two
// BPA Level 2 sub-systems (Security Alert System, Campaign Planning). These
// pin three things: only OFFICIAL incidents are counted, the hotspot risk
// levels match hotspotRisk() in src/utils/helpers.js, and nothing that
// identifies a person or a case leaves through either endpoint.
class IntegrationTest extends TestCase
{
    use RefreshDatabase;

    private const HOTSPOTS = '/api/v1/integrations/security-alerts/hotspots';

    private const TRENDS = '/api/v1/integrations/campaign-planning/trends';

    private function actingRole(string $role): void
    {
        $this->actingAsSupabase(User::factory()->create(['role' => $role]));
    }

    /** Incidents that count: validated and not archived. */
    private function official(): IncidentFactory
    {
        return Incident::factory()->state([
            'validation_status' => Incident::VALIDATION_VALIDATED,
            'status' => 'Open',
        ]);
    }

    /** One of each way a record is NOT official, all in the given sitio. */
    private function unofficial(string $sitio): void
    {
        Incident::factory()->create([
            'sitio' => $sitio,
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        Incident::factory()->create([
            'sitio' => $sitio,
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);
        Incident::factory()->create([
            'sitio' => $sitio,
            'validation_status' => Incident::VALIDATION_VALIDATED,
            'status' => 'Archived',
        ]);
    }

    // ---- Security Alert System: hotspots ----

    public function test_hotspots_classify_each_sitio_against_the_configured_threshold(): void
    {
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->official()->count(5)->create(['sitio' => 'Sitio 1', 'crime_type' => 'Theft']);
        $this->official()->count(3)->create(['sitio' => 'Sitio 2', 'crime_type' => 'Robbery']);
        $this->official()->count(2)->create(['sitio' => 'Sitio 3', 'crime_type' => 'Assault']);

        $response = $this->getJson(self::HOTSPOTS)->assertOk();

        $response
            ->assertJsonPath('meta.recipient', 'Security Alert System Module')
            ->assertJsonPath('meta.deliveryModel', 'pull')
            ->assertJsonPath('criteria.hotspotThreshold', 3)
            ->assertJsonPath('criteria.highRiskBoundary', 5)
            ->assertJsonPath('summary.totalIncidents', 10)
            ->assertJsonPath('summary.areasReported', 3)
            ->assertJsonPath('summary.hotspotCount', 2)
            ->assertJsonPath('summary.highRiskCount', 1)
            // Busiest area first.
            ->assertJsonPath('areas.0.sitio', 'Sitio 1')
            ->assertJsonPath('areas.0.incidentCount', 5)
            ->assertJsonPath('areas.0.isHotspot', true)
            ->assertJsonPath('areas.0.riskLevel', 'High')
            ->assertJsonPath('areas.0.crimeTypes.0.crimeType', 'Theft')
            ->assertJsonPath('areas.0.crimeTypes.0.count', 5)
            ->assertJsonPath('areas.1.sitio', 'Sitio 2')
            ->assertJsonPath('areas.1.riskLevel', 'Medium')
            ->assertJsonPath('areas.1.isHotspot', true)
            ->assertJsonPath('areas.2.sitio', 'Sitio 3')
            ->assertJsonPath('areas.2.riskLevel', 'Low')
            ->assertJsonPath('areas.2.isHotspot', false);
    }

    public function test_a_threshold_above_five_raises_the_high_boundary_with_it(): void
    {
        // hotspotRisk(): High starts at max(5, threshold), so a sitio below the
        // threshold is never labelled High.
        Setting::current()->update(['hotspot_threshold' => 7]);
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->official()->count(6)->create(['sitio' => 'Sitio 1']);

        $this->getJson(self::HOTSPOTS)
            ->assertOk()
            ->assertJsonPath('criteria.highRiskBoundary', 7)
            ->assertJsonPath('areas.0.isHotspot', false)
            ->assertJsonPath('areas.0.riskLevel', 'Low');
    }

    public function test_hotspots_count_official_incidents_only(): void
    {
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->official()->count(2)->create(['sitio' => 'Sitio 1']);
        $this->unofficial('Sitio 1');
        $this->unofficial('Sitio 2');

        $this->getJson(self::HOTSPOTS)
            ->assertOk()
            ->assertJsonPath('summary.totalIncidents', 2)
            ->assertJsonPath('summary.areasReported', 1)
            ->assertJsonPath('areas.0.incidentCount', 2)
            ->assertJsonPath('areas.0.isHotspot', false);
    }

    // ---- Campaign Planning: trends ----

    public function test_trends_aggregate_months_crime_types_and_categories(): void
    {
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->official()->count(2)->create([
            'incident_date' => '2026-01-10', 'crime_type' => 'Theft', 'category' => 'Property Crime',
        ]);
        $this->official()->create([
            'incident_date' => '2026-01-20', 'crime_type' => 'Assault', 'category' => 'Violent Crime',
        ]);
        $this->official()->create([
            'incident_date' => '2026-03-05', 'crime_type' => 'Theft', 'category' => 'Property Crime',
        ]);

        $this->getJson(self::TRENDS)
            ->assertOk()
            ->assertJsonPath('meta.recipient', 'Campaign Planning Module')
            ->assertJsonPath('summary.totalIncidents', 4)
            ->assertJsonPath('summary.firstMonth', '2026-01')
            ->assertJsonPath('summary.lastMonth', '2026-03')
            ->assertJsonPath('summary.monthsWithIncidents', 2)
            ->assertJsonPath('monthlyTotals', [
                ['month' => '2026-01', 'count' => 3],
                ['month' => '2026-03', 'count' => 1],
            ])
            ->assertJsonPath('monthlyByCrimeType', [
                ['month' => '2026-01', 'crimeType' => 'Assault', 'count' => 1],
                ['month' => '2026-01', 'crimeType' => 'Theft', 'count' => 2],
                ['month' => '2026-03', 'crimeType' => 'Theft', 'count' => 1],
            ])
            ->assertJsonPath('crimeTypeTotals', [
                ['crimeType' => 'Theft', 'count' => 3],
                ['crimeType' => 'Assault', 'count' => 1],
            ])
            ->assertJsonPath('categoryTotals', [
                ['category' => 'Property Crime', 'count' => 3],
                ['category' => 'Violent Crime', 'count' => 1],
            ]);
    }

    public function test_trends_count_official_incidents_only(): void
    {
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $this->official()->create(['incident_date' => '2026-02-01']);
        $this->unofficial('Sitio 1');

        $this->getJson(self::TRENDS)
            ->assertOk()
            ->assertJsonPath('summary.totalIncidents', 1)
            ->assertJsonPath('monthlyTotals', [['month' => '2026-02', 'count' => 1]]);
    }

    // ---- no identifying data leaves ----

    public function test_neither_endpoint_exposes_identifying_fields(): void
    {
        $this->actingRole(User::ROLE_SUPER_ADMIN);

        $incident = $this->official()->create([
            'case_number' => 'CASE-SENTINEL-001',
            'victim_name' => 'Sentinel Victim',
            'suspect_name' => 'Sentinel Suspect',
            'street' => 'Sentinel Street',
        ]);

        foreach ([self::HOTSPOTS, self::TRENDS] as $endpoint) {
            $body = $this->getJson($endpoint)->assertOk()->getContent();

            foreach (['CASE-SENTINEL-001', 'Sentinel', $incident->incident_code] as $needle) {
                $this->assertStringNotContainsString($needle, $body, "{$endpoint} leaked {$needle}");
            }
            foreach (['"id"', '"latitude"', '"longitude"', '"reported_by"'] as $key) {
                $this->assertStringNotContainsString($key, $body, "{$endpoint} leaked {$key}");
            }
        }
    }

    // ---- access ----

    public function test_both_endpoints_require_authentication(): void
    {
        $this->getJson(self::HOTSPOTS)->assertUnauthorized();
        $this->getJson(self::TRENDS)->assertUnauthorized();
    }

    public function test_only_the_super_administrator_may_pull(): void
    {
        foreach ([User::ROLE_BADAC_ADMIN, User::ROLE_BADAC_VALIDATOR, User::ROLE_ENCODER] as $role) {
            $this->actingRole($role);

            $this->getJson(self::HOTSPOTS)->assertForbidden();
            $this->getJson(self::TRENDS)->assertForbidden();
        }
    }
}
