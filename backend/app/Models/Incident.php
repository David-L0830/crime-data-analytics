<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Incident extends Model
{
    use HasFactory;

    /**
     * The complete set of incident status values.
     *
     * This is the single server-side source of truth, mirroring STATUSES in
     * src/utils/constants.js (which drives the FilterBar and the incident
     * form). It exists so Store/UpdateIncidentRequest can validate against a
     * closed vocabulary instead of accepting any string: an unrecognised
     * status would be counted by the Dashboard's `total` but by neither
     * SOLVED_STATUSES nor PENDING_STATUSES, silently breaking the
     * solved + pending = total identity behind Resolution Rate.
     *
     * 'Archived' is deliberately included — IncidentController::archive()
     * writes it, and the Status filter uses it to surface archived records.
     */
    public const STATUSES = [
        'Open',
        'Under Investigation',
        'Solved',
        'Closed',
        'Archived',
    ];

    protected $fillable = [
        'incident_code',
        'case_number',
        'crime_type',
        'category',
        'incident_date',
        'incident_time',
        'street',
        'sitio',
        'latitude',
        'longitude',
        'victim_name',
        'victim_age',
        'victim_gender',
        'suspect_name',
        'suspect_age',
        'reporting_officer',
        'investigating_officer',
        'badge_number',
        'unit',
        'status',
        'priority',
        'description',
        'evidence',
        'reported_by',
        'synced_at',
    ];

    protected function casts(): array
    {
        return [
            'incident_date' => 'date:Y-m-d',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'victim_age' => 'integer',
            'suspect_age' => 'integer',
            'synced_at' => 'datetime',
        ];
    }

    public function reporter()
    {
        return $this->belongsTo(User::class, 'reported_by');
    }

    public function criminals()
    {
        return $this->hasMany(Criminal::class, 'related_incident_id');
    }

    // Inverse of Criminal::relatedIncidents() — every criminal linked to this
    // case through the criminal_incident pivot, not just the legacy
    // single related_incident_id above. Used to show "Related Criminal" on a
    // victim's profile without assuming a case has exactly one suspect.
    public function relatedCriminals()
    {
        return $this->belongsToMany(Criminal::class, 'criminal_incident')->withTimestamps();
    }

    // Every victim associated with this case (Victim Information feature) —
    // see Victim::relatedIncidents() for the inverse side.
    public function victims()
    {
        return $this->belongsToMany(Victim::class, 'incident_victim')->withTimestamps();
    }
}
