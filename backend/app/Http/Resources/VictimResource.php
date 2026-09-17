<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class VictimResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $contact = (bool) $request->user()?->canViewContactDetails();

        // Related Cases (Victim Profile) — every case this victim is tied to,
        // plus that case's own related criminal(s) and status, so the
        // Victim Profile can show "Case Number / Charge / Case Status /
        // Related Criminal" per the spec without duplicating the victim's
        // own personal information inside each case.
        $relatedCases = $this->relatedIncidents->map(fn ($i) => [
            'id' => (string) $i->id,
            'caseNumber' => $i->case_number,
            'charge' => $i->crime_type,
            'status' => $i->status,
            'relatedCriminals' => $i->relatedCriminals->map(fn ($c) => [
                'id' => (string) $c->id,
                'criminalId' => $c->criminal_code,
                'fullName' => $c->full_name,
            ])->values(),
        ])->values();

        return [
            'id' => (string) $this->id,
            'victimId' => $this->victim_code,
            'fullName' => $this->full_name,
            'alias' => $this->alias,
            'gender' => $this->gender,
            'dateOfBirth' => optional($this->date_of_birth)->format('Y-m-d'),
            'civilStatus' => $this->civil_status,
            'nationality' => $this->nationality,
            // Allow-listed roles only (User::canViewContactDetails()); left out
            // of the response entirely for the BADAC Validator. See
            // IncidentResource for the same rule on complainant details.
            'contactNumber' => $this->when($contact, fn () => $this->contact_number),
            'address' => $this->when($contact, fn () => $this->address),
            'status' => $this->status,
            // See CriminalResource — same purpose, consumed by
            // VictimRecords.jsx's Restore confirmation.
            'previousStatus' => $this->previous_status,
            'relatedCases' => $relatedCases,
        ];
    }
}
