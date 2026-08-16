<?php

namespace Database\Seeders;

use App\Models\AppNotification;
use Illuminate\Database\Seeder;

class NotificationSeeder extends Seeder
{
    public function run(): void
    {
        if (AppNotification::count() > 0) {
            return;
        }

        $items = [
            ['title' => 'Hotspot Alert', 'message' => 'Sitio 4 has exceeded the hotspot threshold this week.', 'type' => 'warning'],
            ['title' => 'New Incident', 'message' => 'A new incident was logged in Sitio 2.', 'type' => 'info'],
            ['title' => 'Case Resolved', 'message' => 'Case CN-2025-0032 was marked as Solved.', 'type' => 'success'],
            ['title' => 'Sync Complete', 'message' => 'Data synchronization completed successfully.', 'type' => 'success'],
            ['title' => 'Overdue Case', 'message' => 'Case CN-2025-0011 has been Open for over 30 days.', 'type' => 'warning'],
        ];

        foreach ($items as $i => $item) {
            AppNotification::create([
                ...$item,
                'read' => $i > 2,
                'created_at' => now()->subHours($i * 5),
                'updated_at' => now()->subHours($i * 5),
            ]);
        }
    }
}
