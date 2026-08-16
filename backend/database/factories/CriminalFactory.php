<?php

namespace Database\Factories;

use App\Models\Criminal;
use Illuminate\Database\Eloquent\Factories\Factory;

class CriminalFactory extends Factory
{
    protected $model = Criminal::class;

    public function definition(): array
    {
        static $seq = 1;
        $n = $seq++;

        return [
            'criminal_code' => 'CR-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT),
            'full_name' => fake()->name(),
            'date_of_birth' => fake()->date('Y-m-d', '-25 years'),
            'gender' => fake()->randomElement(['Male', 'Female']),
            'address' => fake()->streetAddress().', Barangay 178',
            'physical_description' => '170cm, average build',
            'status' => 'Active',
            'charges' => ['Theft'],
        ];
    }
}
