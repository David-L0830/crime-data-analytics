<?php

namespace Database\Seeders;

use App\Models\Incident;
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

    private const MONTHS = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'];

    private const BASE_COUNTS = [8, 7, 9, 8, 10, 12, 14, 13, 11, 10, 8, 7];

    public function run(): void
    {
        if (Incident::count() > 0) {
            return;
        }

        $id = 1;

        foreach (self::MONTHS as $mIndex => $month) {
            $count = min(self::BASE_COUNTS[$mIndex] + random_int(-2, 3), 120 - $id + 1);

            for ($i = 0; $i < $count && $id <= 120; $i++) {
                $type = self::CRIME_TYPES[array_rand(self::CRIME_TYPES)];
                $category = self::TYPE_CATEGORY_MAP[$type] ?? 'Public Order';
                $day = str_pad((string) random_int(1, 28), 2, '0', STR_PAD_LEFT);
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
                $caseNumber = 'CN-2025-'.str_pad((string) $id, 4, '0', STR_PAD_LEFT);

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
                ]);

                $id++;
            }
        }
    }
}
