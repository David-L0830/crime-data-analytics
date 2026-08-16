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
            'reportingOfficer' => $this->reporting_officer,
            'investigatingOfficer' => $this->investigating_officer,
            'badgeNumber' => $this->badge_number,
            'unit' => $this->unit,
            'status' => $this->status,
            'priority' => $this->priority,
            'description' => $this->description,
            'evidence' => $this->evidence,
            'reportedBy' => $this->reported_by ? (string) $this->reported_by : null,
            'synced_at' => optional($this->synced_at)->toIso8601String(),
        ];
    }
}
