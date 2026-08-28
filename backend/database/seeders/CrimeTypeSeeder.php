<?php

namespace Database\Seeders;

use App\Models\CrimeType;
use App\Services\CrimeTypeColorAllocator;
use Illuminate\Database\Seeder;

/**
 * Seeds the configurable crime-type vocabulary and its map colours.
 *
 * The create_crime_types_table migration already does this for an existing
 * install (so a deployed database gets its rows without anyone having to run
 * seeders). This seeder exists for fresh local/test databases built with
 * db:seed, and is written to be idempotent for the same reason: it must never
 * reassign a colour that has already been handed out.
 */
class CrimeTypeSeeder extends Seeder
{
    private const TYPES = [
        'Theft',
        'Robbery',
        'Assault',
        'Homicide',
        'Murder',
        'Drug Offense',
        'Fraud',
        'Vandalism',
        'Cybercrime',
        'Domestic Violence',
        'Physical Injury',
        'Carnapping',
    ];

    public function run(): void
    {
        $used = CrimeType::query()->pluck('color')->all();

        foreach (self::TYPES as $name) {
            if (CrimeType::where('name', $name)->exists()) {
                continue;
            }

            $color = CrimeTypeColorAllocator::allocate($name, $used);
            $used[] = $color;

            CrimeType::create([
                'name' => $name,
                'color' => $color,
                'is_active' => true,
            ]);
        }
    }
}
