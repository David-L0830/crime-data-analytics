<?php

namespace Database\Seeders;

use App\Models\Incident;
use App\Models\User;
use Illuminate\Database\Seeder;

// Mirrors src/utils/mockData.js `generateIncidents()` so seeded data keeps the
// same shape/volume the frontend was built and demoed against.
class IncidentSeeder extends Seeder
{
    private const SITIOS = ['Sitio 1', 'Sitio 2', 'Sitio 3', 'Sitio 4', 'Sitio 5', 'Sitio 6', 'Sitio 7'];

    private const STREETS = [
        'Sitio 1' => ['Mabuhay St.', 'Kalayaan St.', 'Pascua St.', 'San Jose St.', 'Rizal St.'],
        'Sitio 2' => ['Bonifacio St.', 'Luna St.', 'Jacinto St.', 'Mabini St.', 'Del Pilar St.'],
        'Sitio 3' => ['Aguinaldo St.', 'Tupas St.', 'Sandoval St.', 'Cruz St.', 'Santos St.'],
        'Sitio 4' => ['Gomez St.', 'Burgos St.', 'Zamora St.', 'Reyes St.', 'Tolentino St.'],
        'Sitio 5' => ['Lapu-Lapu St.', 'Magellan St.', 'Legazpi St.', 'Rajah St.', 'Datu St.'],
        'Sitio 6' => ['Malvar St.', 'Makahiya St.', 'Sampaguita St.', 'Rosal St.', 'Ilang-Ilang St.'],
        'Sitio 7' => ['Narra St.', 'Mahogany St.', 'Acacia St.', 'Molave St.', 'Kamagong St.'],
    ];

    private const CRIME_TYPES = [
        'Theft', 'Robbery', 'Assault', 'Homicide', 'Murder', 'Drug Offense',
        'Fraud', 'Vandalism', 'Cybercrime', 'Domestic Violence', 'Physical Injury', 'Carnapping',
    ];

    private const TYPE_CATEGORY_MAP = [
        'Theft' => 'Property Crime', 'Robbery' => 'Property Crime', 'Vandalism' => 'Property Crime', 'Carnapping' => 'Property Crime',
        'Assault' => 'Violent Crime', 'Homicide' => 'Violent Crime', 'Murder' => 'Violent Crime',
        'Domestic Violence' => 'Violent Crime', 'Physical Injury' => 'Violent Crime',
        'Drug Offense' => 'Drug-Related', 'Fraud' => 'Financial Crime', 'Cybercrime' => 'Cybercrime',
    ];

    private const OFFICERS = ['PO1 Santos', 'PO2 Reyes', 'PO3 Cruz', 'SPO1 Garcia', 'SPO2 Mendoza', 'Insp. Torres'];

    // Realistic *fictional* Filipino names for demo/sample victim & suspect
    // records — mirrors src/utils/mockData.js's MALE_FIRST_NAMES /
    // FEMALE_FIRST_NAMES / CRIME_LAST_NAMES. This is synthetic seed data;
    // none of these names refer to real people.
    private const MALE_FIRST_NAMES = ['Juan', 'Pedro', 'Jose', 'Carlos', 'Antonio', 'Manuel', 'Francisco', 'Ramon', 'Eduardo', 'Rafael', 'Fernando', 'Miguel', 'Ricardo', 'Jaime', 'Arturo', 'Rogelio', 'Ruben', 'Ernesto', 'Gregorio', 'Luis', 'Vicente', 'Alberto', 'Roberto', 'Samuel', 'David', 'Daniel', 'Angelo', 'Marlon', 'Noel', 'Reynaldo'];

    private const FEMALE_FIRST_NAMES = ['Maria', 'Ana', 'Elena', 'Rosa', 'Luz', 'Carmen', 'Gloria', 'Teresa', 'Lourdes', 'Mercedes', 'Cristina', 'Adela', 'Dolores', 'Aurora', 'Socorro', 'Leticia', 'Corazon', 'Milagros', 'Nenita', 'Fe', 'Lilia', 'Nena', 'Remedios', 'Perla', 'Luzviminda', 'Angela', 'Sofia', 'Grace', 'Marites', 'Josefina'];

    private const CRIME_LAST_NAMES = ['Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Garcia', 'Mendoza', 'Aquino', 'Flores', 'Lopez', 'Villanueva', 'Gonzales', 'Torres', 'Rivera', 'Castillo', 'Ramos', 'Fernandez', 'Martinez', 'Rosario', 'Diaz', 'Castro', 'Aguilar', 'Hernandez', 'Mercado', 'Alcantara', 'Valdez', 'Soriano', 'Velasco', 'Bernardo', 'Domingo', 'Pascual'];

    // $gender is optional — victims have a recorded gender to match
    // against; suspects don't (no suspect_gender column), so null draws
    // from either pool.
    private static function randomFullName(?string $gender = null): string
    {
        if ($gender === 'Male') {
            $pool = self::MALE_FIRST_NAMES;
        } elseif ($gender === 'Female') {
            $pool = self::FEMALE_FIRST_NAMES;
        } else {
            $pool = random_int(0, 1) ? self::MALE_FIRST_NAMES : self::FEMALE_FIRST_NAMES;
        }

        $first = $pool[array_rand($pool)];
        $last = self::CRIME_LAST_NAMES[array_rand(self::CRIME_LAST_NAMES)];

        return "{$first} {$last}";
    }

    private const CENTER_LAT = 14.7323;

    private const CENTER_LNG = 121.0270;

    private const BASE_COUNTS = [8, 7, 9, 8, 10, 12, 14, 13, 11, 10, 8, 7];

    /**
     * The twelve months this seeder fills, oldest first, ending with the
     * CURRENT month.
     *
     * This used to be a hard-coded ['2025-01' ... '2025-12']. That pinned the
     * demo dataset to a fixed year, so the further the calendar moved past it
     * the more of the application read as empty — the Dashboard's "Today's
     * Incidents" and "This Month" cards both count against today's date and
     * settle on zero once the newest seeded incident is a year old, which is
     * exactly what happened.
     *
     * Deriving the window from now() instead means a freshly seeded install is
     * always current, whenever it is set up. It also matches what `synced_at`
     * in this same seeder was already doing (now()->subDays(...)) — the two
     * are consistent now rather than one absolute and one relative.
     *
     * @return list<string> e.g. ['2025-09', ..., '2026-08']
     */
    private static function months(): array
    {
        $start = now()->startOfMonth()->subMonths(11);

        return array_map(
            fn (int $offset) => $start->copy()->addMonths($offset)->format('Y-m'),
            range(0, 11),
        );
    }

    public function run(): void
    {
        if (Incident::count() > 0) {
            return;
        }

        $id = 1;

        // Ownership. Every incident created through the application records
        // who encoded it (IncidentController::store), and the Encoder role is
        // built on that column: an Encoder may only correct or archive records
        // they personally encoded. Seeded incidents used to leave it null,
        // which made `reported_by !== $user->id` true for every single one —
        // so the demo Encoder account could edit nothing at all and the whole
        // role was invisible in a walkthrough.
        //
        // Roughly 60/40 Encoder/Administrator. Both sides matter: the Encoder
        // needs records it CAN edit, and records owned by someone else so the
        // ownership restriction is demonstrable rather than merely asserted.
        // Deterministic (id modulo) rather than random, so a reseed produces
        // the same split and a walkthrough script stays valid.
        $encoderId = User::where('username', 'encoder')->value('id');
        $adminId = User::where('username', 'admin')->value('id');

        $months = self::months();
        $lastMonthIndex = count($months) - 1;

        // Past months draw days from 1..28, which is safe in every month
        // including February. The final month in the window is the CURRENT
        // month, and there the ceiling is TODAY: generating a later day would
        // create future-dated crime records, which is both nonsensical and the
        // exact thing incident-date validation should reject.
        //
        // Today's day number is used directly rather than min(28, today) —
        // capping at 28 would make it impossible for any record to land on
        // today for three days of most months, which is precisely the case
        // the "Today's Incidents" card needs.
        $todayDay = (int) now()->format('j');

        foreach ($months as $mIndex => $month) {
            $count = min(self::BASE_COUNTS[$mIndex] + random_int(-2, 3), 120 - $id + 1);
            $isCurrentMonth = $mIndex === $lastMonthIndex;
            $maxDay = $isCurrentMonth ? $todayDay : 28;

            for ($i = 0; $i < $count && $id <= 120; $i++) {
                $type = self::CRIME_TYPES[array_rand(self::CRIME_TYPES)];
                $category = self::TYPE_CATEGORY_MAP[$type] ?? 'Public Order';
                // The first record of the current month is pinned to TODAY so
                // the Dashboard's "Today's Incidents" card has something to
                // count on a freshly seeded install. Without it that card
                // reads zero on any day the random draw happens to miss.
                $dayNumber = $isCurrentMonth && $i === 0 ? $maxDay : random_int(1, $maxDay);
                $day = str_pad((string) $dayNumber, 2, '0', STR_PAD_LEFT);
                $hour = str_pad((string) random_int(0, 23), 2, '0', STR_PAD_LEFT);
                $minute = str_pad((string) random_int(0, 59), 2, '0', STR_PAD_LEFT);
                $sitio = self::SITIOS[array_rand(self::SITIOS)];
                $streetName = self::STREETS[$sitio][array_rand(self::STREETS[$sitio])];
                $houseNum = random_int(1, 300);
                // Barangay 178 is a small urban barangay (~350m radius) — a
                // ±250/10000 (~2.5km) spread was landing points in neighboring
                // barangays, so keep this tight to the actual barangay extent.
                $lat = self::CENTER_LAT + random_int(-32, 32) / 10000;
                $lng = self::CENTER_LNG + random_int(-32, 32) / 10000;
                $statusPool = $mIndex < 8
                    ? ['Solved', 'Closed', 'Under Investigation', 'Open']
                    : ['Open', 'Under Investigation'];
                $status = $statusPool[array_rand($statusPool)];
                $gender = random_int(0, 1) ? 'Male' : 'Female';
                $age = random_int(18, 72);
                $officer = self::OFFICERS[array_rand(self::OFFICERS)];
                $hasSuspect = random_int(0, 100) > 45;
                // Year comes from the record's own date rather than a literal,
                // so a case number can never disagree with the incident it
                // identifies. The sequence stays global (not per-year) because
                // incidents.case_number is UNIQUE across the whole table.
                $caseNumber = 'CN-'.substr($month, 0, 4).'-'.str_pad((string) $id, 4, '0', STR_PAD_LEFT);

                Incident::create([
                    'incident_code' => 'INC-'.str_pad((string) $id, 5, '0', STR_PAD_LEFT),
                    'case_number' => $caseNumber,
                    'crime_type' => $type,
                    'category' => $category,
                    'incident_date' => "{$month}-{$day}",
                    'incident_time' => "{$hour}:{$minute}",
                    'street' => "{$houseNum} {$streetName}",
                    'sitio' => $sitio,
                    'latitude' => round($lat, 7),
                    'longitude' => round($lng, 7),
                    'victim_name' => self::randomFullName($gender),
                    'victim_age' => $age,
                    'victim_gender' => $gender,
                    'suspect_name' => $hasSuspect ? self::randomFullName() : null,
                    'suspect_age' => $hasSuspect ? random_int(20, 59) : null,
                    'reporting_officer' => $officer,
                    'investigating_officer' => random_int(0, 1) ? self::OFFICERS[array_rand(self::OFFICERS)] : null,
                    'badge_number' => 'B178-'.random_int(100, 149),
                    'unit' => ['Patrol', 'Investigation', 'Traffic', 'Drug Enforcement'][array_rand(['Patrol', 'Investigation', 'Traffic', 'Drug Enforcement'])],
                    'status' => $status,
                    'priority' => in_array($type, ['Homicide', 'Murder', 'Robbery'], true) ? 'High' : 'Normal',
                    'description' => "{$type} incident reported in {$sitio}, Barangay 178, North Caloocan.",
                    'evidence' => random_int(0, 1) ? "evidence_{$id}.pdf" : null,
                    'synced_at' => random_int(0, 100) > 30 ? now()->subDays(random_int(0, 20)) : null,
                    // Null only if the seeded accounts are absent — this
                    // seeder must not hard-fail on an install where
                    // UserSeeder has not run.
                    'reported_by' => ($id % 5 < 3 ? $encoderId : $adminId) ?: null,
                ]);

                $id++;
            }
        }
    }
}
