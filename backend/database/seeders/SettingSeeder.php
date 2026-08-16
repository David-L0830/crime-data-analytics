<?php

namespace Database\Seeders;

use App\Models\Setting;
use Illuminate\Database\Seeder;

class SettingSeeder extends Seeder
{
    public function run(): void
    {
        Setting::updateOrCreate(['id' => 1], [
            'barangay' => 'Barangay 178',
            'population' => 15000,
            'threshold' => 5,
            'hotspot_threshold' => 3,
            'categories' => ['Property Crime', 'Violent Crime', 'Drug-Related', 'Financial Crime', 'Cybercrime', 'Public Order'],
        ]);
    }
}
