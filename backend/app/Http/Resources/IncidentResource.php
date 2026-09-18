<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Field names mirror src/utils/mockData.js `generateIncidents()` so the existing
// pages (IncidentFeed, Dashboard, Mapping, Analytics, Trends) work unmodified.
class IncidentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // Complainant contact number and address go only to the roles on the
        // User::canViewContactDetails() allow-list. For anyone else (the BADAC
        // Validator) the two keys are left out of the response entirely, on
        // every endpoint that returns an incident — so they never reach the
        // browser to be hidden. No authenticated user means no contact details.
        $contact = (bool) $request->user()?->canViewContactDetails();

        return [
            'id' => (string) $this->id,
            'incidentId' => $this->incident_code,
            'caseNumber' => $this->case_number,
            'crimeType' => $this->crime_type,
            'category' => $this->category,
            'date' => optional($this->incident_date)->format('Y-m-d'),
            'time' => $this->incident_time ? substr($this->incident_time, 0, 5) : null,
            'street' => $this->street,
            'sitio' => $this->sitio,
            'latitude' => $this->latitude !== null ? (float) $this->latitude : null,
            'longitude' => $this->longitude !== null ? (float) $this->longitude : null,
            'victimName' => $this->victim_name,
            'victimAge' => $this->victim_age,
            'victimGender' => $this->victim_gender,
            'suspectName' => $this->suspect_name,
            'suspectAge' => $this->suspect_age,
            // Complainant = who reported the crime; victim = who it happened
            // to. Usually the same person, which is what complainantIsVictim
            // records; when they differ, the four fields below say who filed
            // the report and how to reach them.
            'complainantIsVictim' => (bool) $this->complainant_is_victim,
            'complainantName' => $this->complainant_name,
            'complainantRelationship' => $this->complainant_relationship,
            'complainantContact' => $this->when($contact, fn () => $this->complainant_contact),
            'complainantAddress' => $this->when($contact, fn () => $this->complainant_address),
            'reportingOfficer' => $this->reporting_officer,
            'investigatingOfficer' => $this->investigating_officer,
            'badgeNumber' => $this->badge_number,
            'unit' => $this->unit,
            'status' => $this->status,
            'previousStatus' => $this->previous_status,
            'priority' => $this->priority,
            'description' => $this->description,
            // Legacy single-string column. Kept in the payload so nothing
            // that already reads it breaks; its contents were copied into
            // evidenceItems by the create_incident_evidence_table migration,
            // and new saves write evidenceItems only.
            'evidence' => $this->evidence,
            'evidenceItems' => $this->whenLoaded(
                'evidenceItems',
                fn () => $this->evidenceItems->map(fn ($e) => [
                    'id' => (string) $e->id,
                    'evidenceId' => $e->evidence_code,
                    'description' => $e->description,
                ])->values(),
                []
            ),
            // Record validation (separate from the case status above). The
            // names are read only from relations the controller eager-loaded,
            // so a caller that did not load them gets null rather than an
            // extra query per row. validatedAt null on a 'validated' row means
            // it was validated before the workflow existed — see the
            // add_validation_workflow_to_incidents migration.
            'validationStatus' => $this->validation_status,
            'validatedBy' => $this->relationLoaded('validator') ? $this->validator?->name : null,
            'validatedAt' => optional($this->validated_at)->toIso8601String(),
            'returnedBy' => $this->relationLoaded('returner') ? $this->returner?->name : null,
            'returnedAt' => optional($this->returned_at)->toIso8601String(),
            'correctionReason' => $this->correction_reason,
            'reportedBy' => $this->reported_by ? (string) $this->reported_by : null,
            'synced_at' => optional($this->synced_at)->toIso8601String(),
        ];
    }
}
