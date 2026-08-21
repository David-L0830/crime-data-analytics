<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class UserFactory extends Factory
{
    protected $model = User::class;

    // No 'password' here — Supabase Auth owns every credential now (see
    // AUTH_MIGRATION_STATUS.md); 'password' is not in User::$fillable and
    // the column is nullable, so factory-created test users never need one.
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'username' => fake()->unique()->userName(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'role' => User::ROLE_BADAC_ADMIN,
            'remember_token' => Str::random(10),
        ];
    }
}
