<?php

namespace Database\Factories;

use App\Models\AppNotification;
use Illuminate\Database\Eloquent\Factories\Factory;

class AppNotificationFactory extends Factory
{
    protected $model = AppNotification::class;

    public function definition(): array
    {
        return [
            'title' => fake()->sentence(3),
            'message' => fake()->sentence(),
            'type' => fake()->randomElement(['info', 'success', 'warning']),
            'read' => false,
        ];
    }
}
