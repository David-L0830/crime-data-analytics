<?php

namespace Tests\Feature;

use App\Models\CrimeType;
use App\Models\Incident;
use App\Models\User;
use App\Services\Barangay178Boundary;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The geography this system is about, and the coordinate policy built on it.
 *
 * WHAT THESE PIN DOWN
 *
 * The map used to be centred on 14.7323, 121.0270 with a 500 m circle drawn
 * around it labelled "Barangay 178". That point is about 4.3 km south-west of
 * the barangay, in the Bagbag/Novaliches part of Quezon City, and the barangay
 * is roughly 2.6 km across rather than 1 km. Nothing in the codebase could
 * contradict either number, because both were literals and the "boundary" was
 * drawn from one of them.
 *
 * Everything is now derived from resources/geo/barangay-178.geojson —
 * OpenStreetMap relation 11322824, cross-checked against Nominatim, which
 * returned the identical 186-point ring. The assertions below are what would
 * catch that file being replaced with a different place, or replaced on only
 * one side of the frontend/backend pair.
 */
class Barangay178BoundaryTest extends TestCase
{
    use RefreshDatabase;

    private Barangay178Boundary $boundary;

    protected function setUp(): void
    {
        parent::setUp();
        $this->boundary = new Barangay178Boundary();
    }

    public function test_the_boundary_covers_the_published_extent_of_barangay_178(): void
    {
        $bounds = $this->boundary->bounds();

        // The extent OpenStreetMap reports for relation 11322824. Asserted to
        // four decimal places (~11 m) so an intentional boundary refresh does
        // not fail the suite over rounding, while a swap for a different
        // barangay — or a silent reversion to the old Quezon City coordinates —
        // does.
        $this->assertEqualsWithDelta(14.7420, $bounds['south'], 0.0001);
        $this->assertEqualsWithDelta(14.7656, $bounds['north'], 0.0001);
        $this->assertEqualsWithDelta(121.0533, $bounds['west'], 0.0001);
        $this->assertEqualsWithDelta(121.0779, $bounds['east'], 0.0001);
    }

    public function test_independently_published_centroids_fall_inside_the_boundary(): void
    {
        // Two sources that were not used to build the file: Nominatim's own
        // label point for the relation, and PhilAtlas's published centroid for
        // Barangay 178. If the stored polygon were some other place, neither
        // would land inside it.
        $this->assertTrue($this->boundary->contains(14.7559, 121.0596), 'Nominatim label point');
        $this->assertTrue($this->boundary->contains(14.7572, 121.0576), 'PhilAtlas centroid');
    }

    public function test_the_old_hardcoded_map_centre_is_outside_the_boundary(): void
    {
        // The regression guard. 14.7323, 121.0270 was the map centre, the
        // seeder's centre and the factory's centre. It is not in this barangay,
        // and this test fails if it is ever treated as though it were.
        $this->assertFalse($this->boundary->contains(14.7323, 121.0270));
    }

    public function test_the_bounding_box_is_not_mistaken_for_the_boundary(): void
    {
        // A corner of the bounding box that the polygon itself does not cover.
        // If contains() ever degraded into a rectangle test, this would start
        // returning true and the map would call a neighbouring barangay
        // "Barangay 178".
        $bounds = $this->boundary->bounds();

        $this->assertFalse(
            $this->boundary->contains($bounds['south'] + 0.00001, $bounds['west'] + 0.00001),
            'the south-west corner of the bounding box is not inside the barangay'
        );
    }

    public function test_unusable_coordinates_are_rejected_as_values(): void
    {
        $this->assertFalse(Barangay178Boundary::isUsableCoordinate(null, null));
        $this->assertFalse(Barangay178Boundary::isUsableCoordinate('', ''));
        $this->assertFalse(Barangay178Boundary::isUsableCoordinate('abc', '121.06'));
        $this->assertFalse(Barangay178Boundary::isUsableCoordinate(95, 121.06));
        $this->assertFalse(Barangay178Boundary::isUsableCoordinate(14.75, 200));
        // Null island — almost always an empty field rather than a place.
        $this->assertFalse(Barangay178Boundary::isUsableCoordinate(0, 0));

        $this->assertTrue(Barangay178Boundary::isUsableCoordinate(14.7559, 121.0596));
        $this->assertTrue(Barangay178Boundary::isUsableCoordinate('14.7559', '121.0596'));
    }

    public function test_the_two_coordinates_already_in_the_database_are_recognised_as_outside(): void
    {
        // The real damaged rows the worldwide validation rules allowed in:
        // incident 123's longitude 117.0282 is open sea some 450 km west of
        // Metro Manila, and incident 121 sits ~14 km away in another city.
        $this->assertFalse($this->boundary->contains(14.7305, 117.0282));
        $this->assertFalse($this->boundary->contains(14.6121, 121.1324));
    }

    public function test_random_points_are_generated_inside_the_polygon(): void
    {
        // Rejection sampling, not centre-plus-radius. A square around any
        // centre spills outside a barangay that is not square, so this asserts
        // the property the generator is supposed to guarantee rather than
        // spot-checking one draw.
        for ($i = 0; $i < 250; $i++) {
            [$lat, $lng] = $this->boundary->randomPointInside();
            $this->assertTrue(
                $this->boundary->contains($lat, $lng),
                "generated point {$lat}, {$lng} fell outside the boundary"
            );
        }
    }

    public function test_the_factory_places_incidents_inside_the_barangay(): void
    {
        // The seeder and the factory used to carry their own duplicate copy of
        // the wrong centre. Both now draw from the boundary; this covers the
        // factory, which is what every other test in the suite builds from.
        foreach (Incident::factory()->count(25)->make() as $incident) {
            $this->assertTrue(
                $this->boundary->contains($incident->latitude, $incident->longitude),
                "factory produced {$incident->latitude}, {$incident->longitude} outside the barangay"
            );
        }
    }

    public function test_the_backend_and_frontend_boundary_files_are_identical(): void
    {
        // The frontend draws the boundary and the backend validates against it.
        // If they ever diverge, the map would accept a point the API rejects —
        // so the two files are asserted byte-identical rather than merely
        // similar.
        $backend = base_path('resources/geo/barangay-178.geojson');
        $frontend = base_path('../src/data/barangay178.geojson.json');

        $this->assertFileExists($backend);
        $this->assertFileExists($frontend);
        $this->assertSame(
            hash_file('sha256', $backend),
            hash_file('sha256', $frontend),
            'backend/resources/geo/barangay-178.geojson and src/data/barangay178.geojson.json must be the same file'
        );
    }

    // ---------------------------------------------------------------------
    // The API-level policy built on the boundary.
    // ---------------------------------------------------------------------

    private function payload(array $overrides = []): array
    {
        CrimeType::firstOrCreate(['name' => 'Theft'], ['color' => '#2E8B47', 'is_active' => true]);

        return array_merge([
            'caseNumber' => 'CN-2026-9001',
            'crimeType' => 'Theft',
            'date' => now()->format('Y-m-d'),
            'sitio' => 'Sitio 1',
        ], $overrides);
    }

    private function admin(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    public function test_an_incident_inside_the_barangay_is_accepted(): void
    {
        $this->admin();

        $this->postJson('/api/incidents', $this->payload([
            'latitude' => 14.7559,
            'longitude' => 121.0596,
        ]))->assertCreated();
    }

    public function test_an_incident_outside_the_barangay_is_rejected(): void
    {
        $this->admin();

        $this->postJson('/api/incidents', $this->payload([
            // The old seed centre — a real place, valid worldwide, and not in
            // this barangay.
            'latitude' => 14.7323,
            'longitude' => 121.0270,
        ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('latitude');

        $this->assertDatabaseMissing('incidents', ['case_number' => 'CN-2026-9001']);
    }

    public function test_the_open_sea_coordinate_that_reached_production_is_now_rejected(): void
    {
        $this->admin();

        $this->postJson('/api/incidents', $this->payload([
            'latitude' => 14.7305,
            'longitude' => 117.0282,
        ]))->assertStatus(422)->assertJsonValidationErrors('latitude');
    }

    public function test_an_incident_may_still_be_recorded_without_any_coordinate(): void
    {
        // Coordinates stay OPTIONAL on purpose. Many reports arrive with a
        // street and a sitio and no GPS reading, and demanding a coordinate
        // would push encoders into inventing one — the exact failure the
        // boundary rule exists to prevent.
        $this->admin();

        $this->postJson('/api/incidents', $this->payload([
            'latitude' => null,
            'longitude' => null,
        ]))->assertCreated();
    }

    public function test_half_a_coordinate_is_rejected(): void
    {
        $this->admin();

        $this->postJson('/api/incidents', $this->payload([
            'latitude' => 14.7559,
        ]))->assertStatus(422)->assertJsonValidationErrors('longitude');
    }

    public function test_the_rejection_message_names_the_barangay_and_the_acceptable_extent(): void
    {
        // "Invalid location" would leave an encoder with a correct-looking
        // coordinate and no idea what is wrong with it.
        $this->admin();

        $message = $this->postJson('/api/incidents', $this->payload([
            'latitude' => 14.7323,
            'longitude' => 121.0270,
        ]))->json('errors.latitude.0');

        $this->assertStringContainsString('outside Barangay 178', $message);
        $this->assertStringContainsString('14.74', $message);
    }

    public function test_editing_an_incident_cannot_move_it_outside_the_barangay(): void
    {
        // The rule is shared by both form requests, so an edit cannot be used
        // to reach a state a create would refuse.
        $admin = $this->admin();
        $incident = Incident::factory()->create(['reported_by' => $admin->id]);

        $this->putJson("/api/incidents/{$incident->id}", [
            'latitude' => 14.6121,
            'longitude' => 121.1324,
        ])->assertStatus(422)->assertJsonValidationErrors('latitude');
    }

    public function test_the_submitted_coordinates_are_never_silently_corrected(): void
    {
        // A record whose location the system quietly edited is worse than one
        // that failed to save: nothing afterwards reveals that it happened.
        $this->admin();

        $this->postJson('/api/incidents', $this->payload([
            'latitude' => 14.7559,
            'longitude' => 121.0596,
        ]))->assertCreated();

        $incident = Incident::where('case_number', 'CN-2026-9001')->firstOrFail();

        $this->assertEqualsWithDelta(14.7559, (float) $incident->latitude, 0.0000001);
        $this->assertEqualsWithDelta(121.0596, (float) $incident->longitude, 0.0000001);
    }
}
