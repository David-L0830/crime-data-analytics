<?php

namespace Database\Seeders;

use App\Models\Incident;
use App\Models\Victim;
use Illuminate\Database\Seeder;

// Seeds sample victims and links them to cases (incidents) through the
// incident_victim pivot — mirrors CriminalSeeder's approach of building
// demo data on top of the incidents IncidentSeeder already created. Runs
// after CriminalSeeder so the same cases already have a criminal attached,
// letting a Criminal Profile demonstrate the full
// Criminal -> Case -> Victim(s) chain out of the box.
class VictimSeeder extends Seeder
{
    private const FIRST_NAMES = ['Juan', 'Maria', 'Pedro', 'Ana', 'Jose', 'Elena', 'Carlos', 'Rosa', 'Antonio', 'Luz'];

    private const LAST_NAMES = ['Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Garcia', 'Mendoza', 'Aquino', 'Flores'];

    private const CIVIL_STATUSES = ['Single', 'Married', 'Widowed', 'Separated'];

    public function run(): void
    {
        if (Victim::count() > 0) {
            return;
        }

        // Same 25-incident window CriminalSeeder used, so the demo victims
        // land on cases that already have a criminal attached.
        $cases = Incident::whereNotNull('suspect_name')->orderBy('id')->limit(25)->get()->values();

        if ($cases->isEmpty()) {
            return;
        }

        $seq = 1;
        $makeVictim = function () use (&$seq) {
            $birthYear = 1970 + random_int(0, 35);
            $victim = Victim::create([
                'victim_code' => 'V-'.str_pad((string) $seq, 4, '0', STR_PAD_LEFT),
                'full_name' => self::FIRST_NAMES[array_rand(self::FIRST_NAMES)].' '.self::LAST_NAMES[array_rand(self::LAST_NAMES)],
                'gender' => random_int(0, 1) ? 'Male' : 'Female',
                'date_of_birth' => "{$birthYear}-".str_pad((string) random_int(1, 12), 2, '0', STR_PAD_LEFT).'-15',
                'civil_status' => self::CIVIL_STATUSES[array_rand(self::CIVIL_STATUSES)],
                'nationality' => 'Filipino',
                'contact_number' => '09'.random_int(100000000, 999999999),
                'address' => 'Barangay 178, North Caloocan',
            ]);
            $seq++;

            return $victim;
        };

        // Case 1 (index 0): exactly one victim.
        $cases[0]->victims()->syncWithoutDetaching([$makeVictim()->id]);

        // Case 2 (index 1): multiple victims.
        $cases[1]->victims()->syncWithoutDetaching([$makeVictim()->id, $makeVictim()->id]);

        // Case 3 (index 2): deliberately left with no victims — demonstrates
        // the "No victims recorded for this case" empty state.

        // Case 4 (index 3) and case 8 (index 7): the same victim, involved
        // in more than one case.
        if ($cases->count() > 7) {
            $sharedVictim = $makeVictim();
            $cases[3]->victims()->syncWithoutDetaching([$sharedVictim->id]);
            $cases[7]->victims()->syncWithoutDetaching([$sharedVictim->id]);
        }

        // Remaining cases: a light, realistic scattering of zero or one
        // victim each, so most of the seeded criminal roster shows some
        // Victim Information variety rather than only the four cases above.
        foreach ($cases->slice(4) as $i => $case) {
            // $i keeps the original 0-based index into $cases (Collection::slice
            // preserves keys) — skip the two cases already seeded above.
            if (in_array($i, [3, 7], true)) {
                continue;
            }
            if (random_int(0, 1) === 0) {
                continue;
            }
            $case->victims()->syncWithoutDetaching([$makeVictim()->id]);
        }
    }
}
