<?php

namespace Tests\Feature;

use App\Models\Criminal;
use App\Models\Incident;
use App\Models\Setting;
use App\Models\User;
use Database\Factories\IncidentFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GET /api/dashboard answers with OFFICIAL data.
 *
 * This file is new because the endpoint had no figure-level coverage at all.
 * Four other test classes call /api/dashboard — BadacValidatorTest,
 * EmailMfaTest, MfaEnforcementTest and MfaMethodSelectionTest — but every one
 * of them uses it purely as an authenticated-route probe, asserting 200 or 401
 * and never looking at the body. That is exactly how the endpoint kept counting
 * unreviewed encodings after CP-5A made "validated and not archived" the rule
 * for every figure people act on: nothing was watching the numbers.
 *
 * `$active` in DashboardController::index() is now Incident::scopeOfficial(),
 * and every incident-derived figure is built from it, so the cases below check
 * each one rather than the total alone — a filter applied to the KPIs but not
 * to `recentIncidents` would be a plausible partial fix and has to fail here.
 *
 * `hotspotCount` matters most. It is the same definition the Hotspot Alert
 * announces on (see HotspotAlertTest), so if these two drift apart the bell and
 * the API disagree about which sitios are hotspots.
 *
 * The factory sets no validation_status, so a bare Incident::factory() row is
 * pending. Rows meant to COUNT therefore say official() explicitly.
 */
class DashboardTest extends TestCase
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

    private function dashboard()
    {
        return $this->getJson('/api/dashboard')->assertOk();
    }

    // ===== headline counters =====

    public function test_total_counts_only_official_incidents(): void
    {
        $this->actingUser();

        $this->official()->count(3)->create(['status' => 'Open']);
        Incident::factory()->count(4)->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        Incident::factory()->count(2)->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);
        $this->official()->count(5)->create(['status' => 'Archived']);

        $this->dashboard()->assertJsonPath('totalIncidents', 3);
    }

    public function test_the_status_counters_count_only_official_incidents(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create(['status' => 'Open']);
        $this->official()->create(['status' => 'Under Investigation']);
        $this->official()->count(3)->create(['status' => 'Solved']);

        // One unreviewed record in each status: none may be counted.
        foreach (['Open', 'Under Investigation', 'Solved'] as $status) {
            Incident::factory()->create([
                'status' => $status,
                'validation_status' => Incident::VALIDATION_PENDING,
            ]);
        }

        $this->dashboard()
            ->assertJsonPath('openIncidents', 2)
            ->assertJsonPath('underInvestigation', 1)
            ->assertJsonPath('solvedIncidents', 3)
            ->assertJsonPath('totalIncidents', 6);
    }

    public function test_an_archived_incident_is_excluded_even_when_validated(): void
    {
        // The archive rule is independent of the validation one: being reviewed
        // does not put a retired case back into the barangay's current picture.
        $this->actingUser();

        $this->official()->create(['status' => 'Open']);
        $this->official()->create(['status' => 'Archived']);

        $this->dashboard()
            ->assertJsonPath('totalIncidents', 1)
            ->assertJsonPath('openIncidents', 1);
    }

    // ===== groupings =====

    public function test_by_crime_type_groups_only_official_incidents(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create(['crime_type' => 'Theft', 'status' => 'Open']);
        Incident::factory()->count(4)->create([
            'crime_type' => 'Vandalism',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $byCrimeType = $this->dashboard()->json('byCrimeType');

        $this->assertSame(['Theft' => 2], $byCrimeType);
    }

    public function test_by_sitio_groups_only_official_incidents(): void
    {
        $this->actingUser();

        $this->official()->count(2)->create(['sitio' => 'Sitio 1', 'status' => 'Open']);
        Incident::factory()->count(4)->create([
            'sitio' => 'Sitio 3',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);

        $bySitio = $this->dashboard()->json('bySitio');

        $this->assertSame(['Sitio 1' => 2], $bySitio);
        // A sitio holding nothing but unreviewed records is absent entirely,
        // rather than present with a count that overstates it.
        $this->assertArrayNotHasKey('Sitio 3', $bySitio);
    }

    // ===== hotspotCount — the same definition the Hotspot Alert uses =====

    public function test_hotspot_count_counts_only_official_incidents(): void
    {
        $this->actingUser();
        Setting::current()->update(['hotspot_threshold' => 3]);

        // Sitio 1 qualifies on official data alone.
        $this->official()->count(3)->create(['sitio' => 'Sitio 1', 'status' => 'Open']);
        // Sitio 3 would qualify if unreviewed encodings counted. They do not.
        Incident::factory()->count(5)->create([
            'sitio' => 'Sitio 3',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        // Sitio 2 would qualify if archived records counted. They do not.
        $this->official()->count(4)->create(['sitio' => 'Sitio 2', 'status' => 'Archived']);

        $this->dashboard()->assertJsonPath('hotspotCount', 1);
    }

    public function test_hotspot_count_is_zero_when_nothing_is_validated(): void
    {
        // The API agrees with the bell: HotspotAlertTest pins that a sitio full
        // of pending records announces nothing, and this pins that the same
        // sitio is not reported as a hotspot either.
        $this->actingUser();
        Setting::current()->update(['hotspot_threshold' => 3]);

        Incident::factory()->count(10)->create([
            'sitio' => 'Sitio 3',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $this->dashboard()
            ->assertJsonPath('hotspotCount', 0)
            ->assertJsonPath('totalIncidents', 0);
    }

    public function test_hotspot_count_honours_the_configured_threshold(): void
    {
        $this->actingUser();
        Setting::current()->update(['hotspot_threshold' => 5]);

        $this->official()->count(4)->create(['sitio' => 'Sitio 1', 'status' => 'Open']);

        $this->dashboard()->assertJsonPath('hotspotCount', 0);

        $this->official()->create(['sitio' => 'Sitio 1', 'status' => 'Open']);

        $this->dashboard()->assertJsonPath('hotspotCount', 1);
    }

    // ===== recentIncidents =====

    public function test_recent_incidents_lists_only_official_records(): void
    {
        // The list a partial fix is most likely to miss: the KPIs and the
        // groupings can all be filtered while this one keeps surfacing case
        // numbers nobody has reviewed.
        $this->actingUser();

        $this->official()->create([
            'case_number' => 'CN-OFFICIAL',
            'incident_date' => '2026-05-01',
            'status' => 'Open',
        ]);
        // Newer, so it would head the list if it were included at all.
        Incident::factory()->create([
            'case_number' => 'CN-PENDING',
            'incident_date' => '2026-05-20',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-RETURNED',
            'incident_date' => '2026-05-19',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);
        $this->official()->create([
            'case_number' => 'CN-ARCHIVED',
            'incident_date' => '2026-05-18',
            'status' => 'Archived',
        ]);

        $recent = $this->dashboard()->json('recentIncidents');

        $this->assertCount(1, $recent);
        $this->assertSame('CN-OFFICIAL', $recent[0]['caseNumber']);
    }

    public function test_recent_incidents_is_empty_rather_than_permissive(): void
    {
        $this->actingUser();

        Incident::factory()->count(5)->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $this->assertSame([], $this->dashboard()->json('recentIncidents'));
    }

    // ===== everything outside the rule is untouched by it =====

    public function test_the_non_incident_figures_are_not_affected(): void
    {
        // totalCriminalRecords, lastSync and settings are not incident figures,
        // so the official-data rule has nothing to say about them. Pinned so a
        // future change to $active cannot quietly reach them.
        $this->actingUser();

        Criminal::factory()->count(3)->create();
        Incident::factory()->count(2)->create([
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $this->dashboard()
            ->assertJsonPath('totalCriminalRecords', 3)
            ->assertJsonPath('totalIncidents', 0)
            ->assertJsonStructure(['settings', 'lastSync']);
    }

    public function test_a_mixed_set_reports_consistently_across_every_figure(): void
    {
        // One fixture, every figure, so a rule applied to some of them and not
        // others cannot pass. Official: 2 Open + 1 Solved in Sitio 1.
        $this->actingUser();
        Setting::current()->update(['hotspot_threshold' => 3]);

        $this->official()->count(2)->create([
            'sitio' => 'Sitio 1',
            'crime_type' => 'Theft',
            'status' => 'Open',
        ]);
        $this->official()->create([
            'sitio' => 'Sitio 1',
            'crime_type' => 'Theft',
            'status' => 'Solved',
        ]);
        Incident::factory()->count(6)->create([
            'sitio' => 'Sitio 3',
            'crime_type' => 'Vandalism',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        $this->official()->count(4)->create([
            'sitio' => 'Sitio 2',
            'crime_type' => 'Robbery',
            'status' => 'Archived',
        ]);

        $response = $this->dashboard();

        $response
            ->assertJsonPath('totalIncidents', 3)
            ->assertJsonPath('openIncidents', 2)
            ->assertJsonPath('underInvestigation', 0)
            ->assertJsonPath('solvedIncidents', 1)
            // Sitio 1 holds three official records, so it is the one hotspot.
            ->assertJsonPath('hotspotCount', 1);

        $this->assertSame(['Theft' => 3], $response->json('byCrimeType'));
        $this->assertSame(['Sitio 1' => 3], $response->json('bySitio'));
        $this->assertCount(3, $response->json('recentIncidents'));
    }
}
