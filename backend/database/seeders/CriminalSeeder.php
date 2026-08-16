<?php

namespace Database\Seeders;

use App\Models\Criminal;
use App\Models\Incident;
use Illuminate\Database\Seeder;

class CriminalSeeder extends Seeder
{
    public function run(): void
    {
        if (Criminal::count() > 0) {
            return;
        }

        $suspects = Incident::whereNotNull('suspect_name')->orderBy('id')->limit(25)->get();

        foreach ($suspects as $i => $incident) {
            $birthYear = 1960 + random_int(0, 40);

            $criminal = Criminal::create([
                'criminal_code' => 'CR-'.str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT),
                'full_name' => $incident->suspect_name,
                'date_of_birth' => "{$birthYear}-01-15",
                'gender' => random_int(0, 1) ? 'Male' : 'Female',
                'address' => "{$incident->street}, {$incident->sitio}, Barangay 178",
                'physical_description' => random_int(150, 185).'cm, '.['slim', 'average', 'heavy', 'athletic'][array_rand(['slim', 'average', 'heavy', 'athletic'])].' build',
                'status' => ['Active', 'Wanted', 'Incarcerated', 'Released', 'Deceased'][array_rand(['Active', 'Wanted', 'Incarcerated', 'Released', 'Deceased'])],
                'charges' => [$incident->crime_type],
                'notes' => 'Known suspect in '.random_int(1, 3).' case(s) within Barangay 178.',
                'related_incident_id' => $incident->id,
                'related_case_number' => $incident->case_number,
            ]);

            // Keep the many-to-many criminal_incident pivot (Part I-42/44 —
            // "Related Incidents"/"Related Cases") in sync with the legacy
            // related_incident_id column set above, same as
            // CriminalController::syncRelatedIncidents does for real
            // create/update requests. Without this, every seeded criminal's
            // Related Incidents / Victim Information sections would render
            // empty, since both read relatedIncidents() (the pivot), not the
            // legacy column.
            $criminal->relatedIncidents()->syncWithoutDetaching([$incident->id]);
        }
    }
}
