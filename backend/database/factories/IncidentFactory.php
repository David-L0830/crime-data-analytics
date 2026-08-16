<?php

namespace Database\Factories;

use App\Models\Incident;
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
            // Barangay 178 is a small urban barangay (~350m radius), not a
            // multi-km area — keep generated coordinates from spilling into
            // neighboring barangays.
            'latitude' => 14.7323 + fake()->randomFloat(6, -0.0032, 0.0032),
            'longitude' => 121.0270 + fake()->randomFloat(6, -0.0032, 0.0032),
            'status' => fake()->randomElement(['Open', 'Under Investigation', 'Solved', 'Closed']),
            'priority' => 'Normal',
        ];
    }
}
