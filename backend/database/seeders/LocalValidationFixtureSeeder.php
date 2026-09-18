<?php

namespace Database\Seeders;

use App\Models\Incident;
use App\Models\User;
use App\Services\Barangay178Boundary;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * A controlled local dataset for verifying official-data filtering (CP-5A).
 *
 * WHY THIS EXISTS
 * ---------------
 * CP-5A makes "validated and not archived" the gate on every official figure
 * in the system — the Dashboard, Statistical Analysis, Trend and Pattern
 * Detection, Crime Mapping and Report Generation. A change like that can only
 * be verified against data that contains records on BOTH sides of the gate.
 * The local database holds a single incident, so without this fixture every
 * affected screen would render empty and prove nothing either way.
 *
 * WHAT IT GUARANTEES
 * ------------------
 * - IDEMPOTENT. Keyed on case_number with updateOrCreate, so running it twice
 *   leaves the same eight rows rather than duplicating or failing on the
 *   UNIQUE index on incidents.case_number.
 * - ISOLATED. Touches nothing whose case_number does not start with 'CP5A-'.
 *   The existing local incident (case number '123') is never read or written,
 *   and neither is any other record.
 * - NOT REGISTERED. Deliberately absent from DatabaseSeeder, so `db:seed` and
 *   `migrate:fresh --seed` never reach it. It runs only when named.
 * - LOCAL ONLY. Refuses to run outside the `local` environment.
 * - BOUNDARY-CHECKED. Every coordinate is verified against the real Barangay
 *   178 polygon before anything is written, and one bad point aborts the run
 *   without writing any record. See the check in run() for why.
 *
 * HOW TO RUN IT (from backend/)
 * -----------------------------
 *     php artisan db:seed --class=LocalValidationFixtureSeeder
 *
 * HOW TO REMOVE IT AGAIN (from backend/)
 * --------------------------------------
 *     php artisan tinker --execute="App\Models\Incident::where('case_number','like','CP5A-%')->forceDelete();"
 *
 * or, equivalently, straight against the local database:
 *
 *     DELETE FROM incidents WHERE case_number LIKE 'CP5A-%';
 *
 * Both remove exactly what this seeder created and nothing else. Evidence rows
 * are not created here, so nothing else has to be cleaned up.
 *
 * WHAT IT CREATES
 * ---------------
 * Eight incidents, each named for the case it covers:
 *
 *   CP5A-A1/A2/A3  validated, not archived   → the only OFFICIAL records
 *   CP5A-B1/B2     pending validation        → must not reach any official surface
 *   CP5A-C1        returned for correction   → must not reach any official surface
 *   CP5A-D1        archived + validated      → excluded by the archive rule alone
 *   CP5A-D2        archived + pending        → excluded twice over
 *
 * Every one carries coordinates inside the Barangay 178 polygon, so Crime
 * Mapping has something to plot on both sides of the gate — the map is the
 * one surface where an unfiltered record is visible at a glance. Sitios and
 * crime types are spread so the Analytics crosstab and the Trends per-sitio
 * charts change shape visibly when the filter is applied, and three validated
 * records against three unvalidated ones makes a wrong total obvious rather
 * than plausible.
 *
 * Dates are recent and fixed relative to today so the Dashboard's "this month"
 * counters have something to count without the fixture ageing out.
 */
class LocalValidationFixtureSeeder extends Seeder
{
    /**
     * The reserved prefix. Every row this seeder owns starts with it, and
     * nothing outside it is ever touched.
     */
    private const PREFIX = 'CP5A-';

    public function run(): void
    {
        if (! app()->environment('local')) {
            $this->command?->error(
                'LocalValidationFixtureSeeder is a local development fixture and refuses to run in '
                .app()->environment().'.'
            );

            return;
        }

        // Real local accounts if they exist, so the records carry believable
        // authorship; null is acceptable everywhere below and simply means the
        // column stays empty.
        $encoder = User::where('role', User::ROLE_ENCODER)->orderBy('id')->first();
        $reviewer = User::whereIn('role', [User::ROLE_BADAC_ADMIN, User::ROLE_BADAC_VALIDATOR])
            ->orderBy('id')
            ->first();

        $fixtures = $this->fixtures($encoder?->id, $reviewer?->id);

        // Every coordinate is checked against the real polygon BEFORE anything
        // is written, and one bad point stops the whole run.
        //
        // The first version of this fixture carried four coordinates that sat
        // inside the boundary's rectangular bounding box but outside the
        // barangay itself. Nothing objected: a seeder writes through the model
        // and so never meets StoreIncidentRequest, which would have rejected
        // all four with a 422. The only symptom was that Crime Mapping drew one
        // of them hollow and grey and out of the viewport, and the count looked
        // like the CP-5A filter was broken when it was not.
        //
        // Barangay178Boundary::contains() — the same predicate the API and the
        // map use — and deliberately NOT the bounding box, because reading a
        // point off that box is precisely the mistake this guards against.
        $boundary = app(Barangay178Boundary::class);
        $offenders = [];

        foreach ($fixtures as $fixture) {
            if (! $boundary->contains($fixture['latitude'], $fixture['longitude'])) {
                $offenders[] = sprintf(
                    '%s (%.7f, %.7f)',
                    $fixture['case_number'],
                    $fixture['latitude'],
                    $fixture['longitude'],
                );
            }
        }

        if ($offenders) {
            throw new RuntimeException(
                'LocalValidationFixtureSeeder: these fixture coordinates are outside the '
                .'Barangay 178 polygon and the API would reject them, so none were written — '
                .implode('; ', $offenders)
            );
        }

        foreach ($fixtures as $fixture) {
            $caseNumber = $fixture['case_number'];

            // updateOrCreate, not create: the whole point is that a second run
            // is a no-op rather than a UNIQUE violation.
            Incident::updateOrCreate(['case_number' => $caseNumber], $fixture);
        }

        $count = Incident::where('case_number', 'like', self::PREFIX.'%')->count();

        $this->command?->info("LocalValidationFixtureSeeder: {$count} CP5A-* incidents in place.");
        $this->command?->info('Remove them with: DELETE FROM incidents WHERE case_number LIKE \'CP5A-%\';');
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fixtures(?int $encoderId, ?int $reviewerId): array
    {
        $now = now();

        return [
            // ----- A. Validated, not archived: the official set -------------
            $this->incident('A1', [
                'crime_type' => 'Theft',
                'category' => 'Property Crime',
                'sitio' => 'Sitio 1',
                'street' => '12 Rizal Avenue',
                'latitude' => 14.7500000,
                'longitude' => 121.0600000,
                'status' => 'Solved',
                'incident_date' => $now->copy()->subDays(3)->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_VALIDATED,
                'validated_by' => $reviewerId,
                'validated_at' => $now->copy()->subDays(2),
                'reported_by' => $encoderId,
            ]),
            $this->incident('A2', [
                'crime_type' => 'Robbery',
                'category' => 'Property Crime',
                'sitio' => 'Sitio 2',
                'street' => '7 Mabini Street',
                'latitude' => 14.7530000,
                'longitude' => 121.0650000,
                'status' => 'Under Investigation',
                'incident_date' => $now->copy()->subDays(6)->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_VALIDATED,
                'validated_by' => $reviewerId,
                'validated_at' => $now->copy()->subDays(5),
                'reported_by' => $encoderId,
            ]),
            $this->incident('A3', [
                'crime_type' => 'Assault',
                'category' => 'Crime Against Person',
                'sitio' => 'Sitio 1',
                'street' => '3 Bonifacio Street',
                'latitude' => 14.7580000,
                'longitude' => 121.0588000,
                'status' => 'Open',
                'incident_date' => $now->copy()->subDay()->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_VALIDATED,
                'validated_by' => $reviewerId,
                'validated_at' => $now->copy()->subDay(),
                'reported_by' => $encoderId,
            ]),

            // ----- B. Pending validation: must never be official ------------
            //
            // Deliberately concentrated in Sitio 3 and on one crime type. If
            // the filter is missing anywhere, Sitio 3 appears in the charts and
            // on the map; if it is working, Sitio 3 is absent entirely. That is
            // easier to read than a count being two too high.
            $this->incident('B1', [
                'crime_type' => 'Vandalism',
                'category' => 'Property Crime',
                'sitio' => 'Sitio 3',
                'street' => '21 Luna Street',
                'latitude' => 14.7430000,
                'longitude' => 121.0778000,
                'status' => 'Open',
                'incident_date' => $now->copy()->subDays(2)->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_PENDING,
                'reported_by' => $encoderId,
            ]),
            $this->incident('B2', [
                'crime_type' => 'Vandalism',
                'category' => 'Property Crime',
                'sitio' => 'Sitio 3',
                'street' => '23 Luna Street',
                'latitude' => 14.7425000,
                'longitude' => 121.0683000,
                'status' => 'Under Investigation',
                'incident_date' => $now->copy()->subDays(4)->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_PENDING,
                'reported_by' => $encoderId,
            ]),

            // ----- C. Returned for correction: must never be official -------
            $this->incident('C1', [
                'crime_type' => 'Theft',
                'category' => 'Property Crime',
                'sitio' => 'Sitio 3',
                'street' => '44 Del Pilar Street',
                'latitude' => 14.7650000,
                'longitude' => 121.0543000,
                'status' => 'Open',
                'incident_date' => $now->copy()->subDays(5)->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_RETURNED,
                'returned_by' => $reviewerId,
                'returned_at' => $now->copy()->subDays(4),
                'correction_reason' => 'Sitio does not match the street given. Please confirm and resubmit.',
                'reported_by' => $encoderId,
            ]),

            // ----- D. Archived: excluded before validation is even asked ----
            //
            // D1 is validated, so it isolates the archive rule: if it shows up
            // anywhere, the archive filter broke rather than the new one. D2 is
            // archived AND pending, so it must be absent under either rule.
            $this->incident('D1', [
                'crime_type' => 'Robbery',
                'category' => 'Property Crime',
                'sitio' => 'Sitio 2',
                'street' => '9 Aguinaldo Street',
                'latitude' => 14.7490000,
                'longitude' => 121.0620000,
                'status' => 'Archived',
                'previous_status' => 'Closed',
                'incident_date' => $now->copy()->subDays(20)->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_VALIDATED,
                'validated_by' => $reviewerId,
                'validated_at' => $now->copy()->subDays(18),
                'reported_by' => $encoderId,
            ]),
            $this->incident('D2', [
                'crime_type' => 'Assault',
                'category' => 'Crime Against Person',
                'sitio' => 'Sitio 3',
                'street' => '15 Katipunan Street',
                'latitude' => 14.7580000,
                'longitude' => 121.0660000,
                'status' => 'Archived',
                'previous_status' => 'Open',
                'incident_date' => $now->copy()->subDays(25)->format('Y-m-d'),
                'validation_status' => Incident::VALIDATION_PENDING,
                'reported_by' => $encoderId,
            ]),
        ];
    }

    /**
     * The shared shape, so each fixture above states only what distinguishes
     * it. incident_code carries the same suffix as the case number, which
     * keeps a CP5A row recognisable on screens that show the code instead.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function incident(string $suffix, array $attributes): array
    {
        return array_merge([
            'case_number' => self::PREFIX.$suffix,
            'incident_code' => 'INC-'.self::PREFIX.$suffix,
            'incident_time' => '14:30',
            'priority' => 'Normal',
            'reporting_officer' => 'PO1 Local Fixture',
            'description' => 'CP5A local verification fixture. Safe to delete.',
            'complainant_is_victim' => true,
        ], $attributes);
    }
}
