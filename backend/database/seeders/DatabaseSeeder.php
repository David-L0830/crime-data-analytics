<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            UserSeeder::class,
            SettingSeeder::class,
            CrimeTypeSeeder::class,
            IncidentSeeder::class,
            CriminalSeeder::class,
            VictimSeeder::class,
            // No audit-log seeder, deliberately. AuditLogSeeder used to write
            // 40 rows drawn at random from five hard-coded templates, none of
            // which recorded anything that happened, and two of which had gone
            // stale — one naming the removed residents module, one claiming a
            // CSV export the system does not produce. An audit entry asserts
            // that a specific person did a specific thing at a specific time,
            // so unlike a notification it has no truthful demo form: seeding
            // cannot make it true. Audit history is earned by using the system.
            NotificationSeeder::class,
            SyncLogSeeder::class,
        ]);
    }
}
