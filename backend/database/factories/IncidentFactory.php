<?php

namespace Database\Factories;

use App\Models\Incident;
use App\Services\Barangay178Boundary;
use Illuminate\Database\Eloquent\Factories\Factory;

class IncidentFactory extends Factory
{
    protected $model = Incident::class;

    public function definition(): array
    {
        static $seq = 1;
        $n = $seq++;

        return [
            'incident_code' => 'INC-'.str_pad((string) $n, 5, '0', STR_PAD_LEFT),
            'case_number' => 'CN-TEST-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT),
            'crime_type' => fake()->randomElement(['Theft', 'Robbery', 'Assault', 'Vandalism']),
            'category' => 'Property Crime',
            'incident_date' => fake()->dateTimeBetween('-6 months', 'now')->format('Y-m-d'),
            'incident_time' => fake()->time('H:i'),
            'street' => fake()->streetAddress(),
            'sitio' => fake()->randomElement(['Sitio 1', 'Sitio 2', 'Sitio 3']),
            // Drawn from the real Barangay 178 polygon by rejection sampling,
            // not from a centre and a radius.
            //
            // This used to be `14.7323 ± 0.0032` — a square around a point some
            // 4.3 km outside the barangay, in Quezon City. Every incident this
            // factory has ever built was therefore somewhere the barangay does
            // not cover, and the same wrong pair was duplicated in
            // IncidentSeeder, so neither could contradict the other.
            //
            // Correcting the centre alone would still be wrong: a square around
            // ANY centre spills outside a barangay that is not square. Both
            // generators now ask the boundary itself, which is also what the
            // incident endpoints validate against — so a factory-built incident
            // is one that could genuinely have been recorded through the API.
            ...self::pointInsideBarangay178(),
            'status' => fake()->randomElement(['Open', 'Under Investigation', 'Solved', 'Closed']),
            'priority' => 'Normal',
        ];
    }

    /**
     * One coordinate pair inside the real barangay, as the two columns.
     *
     * Returned as an array so the caller can spread it and keep both values
     * from a single draw — taking latitude from one sample and longitude from
     * another would produce a pair that is inside the bounding box but not
     * necessarily inside the polygon.
     *
     * @return array{latitude: float, longitude: float}
     */
    private static function pointInsideBarangay178(): array
    {
        [$latitude, $longitude] = app(Barangay178Boundary::class)->randomPointInside();

        return compact('latitude', 'longitude');
    }
}
