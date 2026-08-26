<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CriminalResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // Victim Information is organized by case, not attached to the
        // criminal directly (Criminal -> Case -> Victim) — each related
        // case/incident carries its own concise victim summary here so the
        // profile can group victims under the case they belong to. A case
        // with no linked victims simply gets an empty array; the frontend
        // renders the "No victims recorded for this case" empty state.
        $relatedIncidents = $this->relatedIncidents->map(fn ($i) => [
            'id' => (string) $i->id,
            'caseNumber' => $i->case_number,
            'crimeType' => $i->crime_type,
            'date' => optional($i->incident_date)->format('Y-m-d'),
            'location' => $i->street,
            'sitio' => $i->sitio,
            'status' => $i->status,
            'victims' => $i->victims->map(fn ($v) => [
                'id' => (string) $v->id,
                'victimId' => $v->victim_code,
                'fullName' => $v->full_name,
            ])->values(),
        ])->values();

        // Case History is built only from real, existing data — the criminal
        // record's own creation/update timestamps plus each related
        // incident's reported date and current status — never invented
        // events (Part I-43 of the design spec).
        $caseHistory = collect();
        $caseHistory->push([
            'date' => optional($this->created_at)->toIso8601String(),
            'label' => 'Record created',
            'detail' => "Criminal record {$this->criminal_code} opened.",
        ]);
        foreach ($this->relatedIncidents as $i) {
            $caseHistory->push([
                'date' => optional($i->incident_date)->toIso8601String() ?? optional($i->created_at)->toIso8601String(),
                'label' => 'Incident reported',
                'detail' => "{$i->case_number} — {$i->crime_type} ({$i->status})",
            ]);
        }
        if ($this->updated_at && $this->updated_at->ne($this->created_at)) {
            $caseHistory->push([
                'date' => $this->updated_at->toIso8601String(),
                'label' => 'Record updated',
                'detail' => "Criminal record {$this->criminal_code} last updated.",
            ]);
        }
        $caseHistory = $caseHistory->filter(fn ($e) => $e['date'])->sortBy('date')->values();

        return [
            'id' => (string) $this->id,
            'criminalId' => $this->criminal_code,
            'fullName' => $this->full_name,
            'alias' => $this->alias,
            'dateOfBirth' => optional($this->date_of_birth)->format('Y-m-d'),
            'gender' => $this->gender,
            'civilStatus' => $this->civil_status,
            'nationality' => $this->nationality,
            'address' => $this->address,
            'sitio' => $this->sitio,
            'contactNumber' => $this->contact_number,
            'photoUrl' => $this->photo_path,
            'physicalDescription' => $this->physical_description,
            'height' => $this->height,
            'weight' => $this->weight,
            'build' => $this->build,
            'hairColor' => $this->hair_color,
            'eyeColor' => $this->eye_color,
            'distinguishingMarks' => $this->distinguishing_marks,
            'status' => $this->status,
            // The status this record will return to if restored — null unless
            // it is currently archived. Exposed so CriminalRecords.jsx can
            // name the target in its Restore confirmation ("restore to
            // Wanted") instead of asking the user to confirm blind.
            'previousStatus' => $this->previous_status,
            'charges' => $this->charges ?? [],
            'notes' => $this->notes,
            'relatedIncidentId' => $this->related_incident_id ? (string) $this->related_incident_id : null,
            'relatedCaseNumber' => $this->related_case_number,
            'relatedIncidents' => $relatedIncidents,
            'caseHistory' => $caseHistory,
        ];
    }
}
