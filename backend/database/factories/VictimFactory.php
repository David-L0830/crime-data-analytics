<?php

namespace Database\Factories;

use App\Models\Victim;
use Illuminate\Database\Eloquent\Factories\Factory;

class VictimFactory extends Factory
{
    protected $model = Victim::class;

    public function definition(): array
    {
        static $seq = 1;
        $n = $seq++;

        return [
            'victim_code' => 'V-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT),
            'full_name' => fake()->name(),
            'gender' => fake()->randomElement(['Male', 'Female']),
            'date_of_birth' => fake()->date('Y-m-d', '-18 years'),
            'civil_status' => fake()->randomElement(['Single', 'Married', 'Widowed', 'Separated']),
            'nationality' => 'Filipino',
            'address' => fake()->streetAddress().', Barangay 178',
        ];
    }
}
