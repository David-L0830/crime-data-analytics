<?php

use App\Services\CrimeTypeColorAllocator;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Crime types become configurable data instead of a hard-coded JavaScript
 * array (src/utils/constants.js CRIME_TYPES), so an Administrator can add one
 * through System Settings without a developer touching code.
 *
 * `color` is the single source of truth for the Crime Mapping module's marker
 * colour. Storing it on the row — rather than deriving it at render time — is
 * what makes a colour STABLE: the same crime type keeps the same colour across
 * refreshes, sign-outs, users and machines, because the colour is a stored
 * fact, not a function of whatever happens to be in the current map viewport.
 *
 * Data preservation: this migration only CREATES a table and seeds it. It
 * reads incidents.crime_type to make sure every crime type already present in
 * live data gets a row (and therefore a colour) — no incident row is written,
 * updated or deleted.
 */
return new class extends Migration
{
    /**
     * The vocabulary that shipped hard-coded in the frontend. Seeded so an
     * existing install behaves exactly as it did before, only now editable.
     */
    private const SEED_TYPES = [
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

    public function up(): void
    {
        if (! Schema::hasTable('crime_types')) {
            Schema::create('crime_types', function (Blueprint $table) {
                $table->id();
                $table->string('name')->unique();
                // #RRGGBB — always exactly 7 characters, validated server-side.
                $table->string('color', 7);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        $names = self::SEED_TYPES;

        // Any crime type that exists in live incident data but not in the
        // seed list still needs a row, or the map would have no colour for it.
        if (Schema::hasTable('incidents')) {
            $fromData = DB::table('incidents')
                ->select('crime_type')
                ->whereNotNull('crime_type')
                ->distinct()
                ->pluck('crime_type')
                ->all();
            $names = array_values(array_unique(array_merge($names, $fromData)));
        }

        $used = DB::table('crime_types')->pluck('color')->all();

        foreach ($names as $name) {
            $name = trim((string) $name);
            if ($name === '') {
                continue;
            }
            $exists = DB::table('crime_types')->where('name', $name)->exists();
            if ($exists) {
                continue;
            }

            $color = CrimeTypeColorAllocator::allocate($name, $used);
            $used[] = $color;

            DB::table('crime_types')->insert([
                'name' => $name,
                'color' => $color,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('crime_types');
    }
};
