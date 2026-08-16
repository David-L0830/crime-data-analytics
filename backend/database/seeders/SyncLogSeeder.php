<?php

namespace Database\Seeders;

use App\Models\SyncLog;
use Illuminate\Database\Seeder;

class SyncLogSeeder extends Seeder
{
    public function run(): void
    {
        if (SyncLog::count() > 0) {
            return;
        }

        $sources = ['PNP Regional Feed', 'Manual Upload', 'BADAC Field Report'];

        for ($i = 0; $i < 10; $i++) {
            SyncLog::create([
                'status' => random_int(0, 100) > 15 ? 'completed' : 'failed',
                'records_received' => random_int(2, 14),
                'source' => $sources[array_rand($sources)],
                'created_at' => now()->subDays($i),
                'updated_at' => now()->subDays($i),
            ]);
        }
    }
}
