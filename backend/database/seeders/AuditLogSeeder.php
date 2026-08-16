<?php

namespace Database\Seeders;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Seeder;

class AuditLogSeeder extends Seeder
{
    private const ACTIONS = [
        ['action' => 'LOGIN', 'module' => 'auth', 'target_type' => 'auth', 'description' => 'User signed in'],
        ['action' => 'LOGOUT', 'module' => 'auth', 'target_type' => 'auth', 'description' => 'User signed out'],
        ['action' => 'REPORT_EXPORTED', 'module' => 'reports', 'target_type' => 'report', 'description' => 'Report exported as CSV'],
        ['action' => 'UPDATE', 'module' => 'residents', 'target_type' => 'resident', 'description' => 'Resident record updated'],
        ['action' => 'UPDATE', 'module' => 'incidents', 'target_type' => 'incident', 'description' => 'Incident record updated'],
    ];

    public function run(): void
    {
        if (AuditLog::count() > 0) {
            return;
        }

        $user = User::where('username', 'admin')->first();

        for ($i = 0; $i < 40; $i++) {
            $entry = self::ACTIONS[array_rand(self::ACTIONS)];

            AuditLog::create([
                'user_id' => $user?->id,
                'action' => $entry['action'],
                'module' => $entry['module'],
                'target_type' => $entry['target_type'],
                'description' => $entry['description'],
                'ip_address' => '127.0.0.1',
                'created_at' => now()->subHours($i * 3),
                'updated_at' => now()->subHours($i * 3),
            ]);
        }
    }
}
