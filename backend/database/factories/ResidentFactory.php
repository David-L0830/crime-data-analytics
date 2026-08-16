<?php

namespace Database\Factories;

use App\Models\Resident;
use Illuminate\Database\Eloquent\Factories\Factory;

class ResidentFactory extends Factory
{
    protected $model = Resident::class;

    public function definition(): array
    {
        static $seq = 1;
        $n = $seq++;

        return [
            'resident_code' => 'RES-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT),
            'first_name' => fake()->firstName(),
            'last_name' => fake()->lastName(),
            'date_of_birth' => fake()->date('Y-m-d', '-18 years'),
            'gender' => fake()->randomElement(['Male', 'Female']),
            'civil_status' => fake()->randomElement(['Single', 'Married', 'Widowed']),
            'occupation' => fake()->randomElement(['Employed', 'Student', 'Unemployed']),
            'sitio' => fake()->randomElement(['Sitio 1', 'Sitio 2', 'Sitio 3']),
            'street' => fake()->streetAddress(),
            'contact_number' => '09'.fake()->numerify('#########'),
            'status' => 'Active',
        ];
    }
}
