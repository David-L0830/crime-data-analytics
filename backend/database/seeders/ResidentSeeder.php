<?php

namespace Database\Seeders;

use App\Models\Resident;
use Illuminate\Database\Seeder;

class ResidentSeeder extends Seeder
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

    private const FIRST_NAMES = ['Juan', 'Maria', 'Pedro', 'Ana', 'Jose', 'Elena', 'Carlos', 'Rosa', 'Antonio', 'Luz', 'Manuel', 'Carmen', 'Francisco', 'Gloria', 'Ramon', 'Teresa', 'Eduardo', 'Lourdes', 'Rafael', 'Mercedes', 'Fernando', 'Cristina', 'Miguel', 'Adela', 'Ricardo', 'Dolores', 'Jaime', 'Aurora', 'Arturo', 'Socorro', 'Rogelio', 'Leticia', 'Ruben', 'Corazon', 'Ernesto', 'Milagros', 'Gregorio', 'Nenita', 'Luis', 'Fe', 'Vicente', 'Lilia', 'Alberto', 'Nena', 'Roberto', 'Remedios', 'Samuel', 'Perla', 'David', 'Luzviminda'];
    private const LAST_NAMES = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Aquino', 'Flores', 'Lopez', 'Villanueva', 'Gonzales', 'Torres', 'Rivera', 'Castillo', 'Dela Cruz', 'Ramos', 'Fernandez', 'Martinez', 'Rosario', 'Diaz', 'Castro', 'Aguilar', 'Hernandez', 'Mercado', 'Alcantara', 'Valdez', 'Soriano', 'Velasco', 'Manaloto', 'Quijano'];

    public function run(): void
    {
        if (Resident::count() > 0) {
            return;
        }

        for ($i = 0; $i < 50; $i++) {
            $firstName = self::FIRST_NAMES[$i % count(self::FIRST_NAMES)];
            $lastName = self::LAST_NAMES[$i % count(self::LAST_NAMES)];
            $sitio = self::SITIOS[array_rand(self::SITIOS)];
            $street = self::STREETS[$sitio][array_rand(self::STREETS[$sitio])];
            $birthYear = 1950 + random_int(0, 60);
            $status = random_int(0, 100) > 90
                ? ['Active', 'Inactive', 'Deceased', 'Transferred'][array_rand(['Active', 'Inactive', 'Deceased', 'Transferred'])]
                : 'Active';

            Resident::create([
                'resident_code' => 'RES-'.str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT),
                'first_name' => $firstName,
                'last_name' => $lastName,
                'date_of_birth' => "{$birthYear}-01-15",
                'gender' => random_int(0, 1) ? 'Male' : 'Female',
                'civil_status' => ['Single', 'Married', 'Widowed', 'Separated'][array_rand(['Single', 'Married', 'Widowed', 'Separated'])],
                'occupation' => ['Employed', 'Self-Employed', 'Student', 'Unemployed', 'Retired'][array_rand(['Employed', 'Self-Employed', 'Student', 'Unemployed', 'Retired'])],
                'sitio' => $sitio,
                'street' => $street,
                'contact_number' => '09'.random_int(100000000, 999999999),
                'status' => $status,
            ]);
        }
    }
}
