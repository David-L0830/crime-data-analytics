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
            'complainantContact' => $this->complainant_contact,
            'complainantAddress' => $this->complainant_address,
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
            'reportedBy' => $this->reported_by ? (string) $this->reported_by : null,
            'synced_at' => optional($this->synced_at)->toIso8601String(),
        ];
    }
}
