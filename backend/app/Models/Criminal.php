<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Criminal extends Model
{
    use HasFactory;

    /**
     * The complete set of criminal-record status values.
     *
     * Single server-side source of truth, mirroring CRIMINAL_STATUSES in
     * src/utils/constants.js. Unlike incident statuses these are mostly
     * facts about a person rather than workflow states, so the closed set
     * matters: a typo would otherwise be stored verbatim and then be
     * unreachable through the Status filter.
     *
     * 'Archived' is deliberately included — CriminalController::archive()
     * writes it, and CriminalRecords.jsx uses it to hide archived records
     * from the default list.
     */
    public const STATUSES = [
        'Active',
        'Wanted',
        'Incarcerated',
        'Released',
        'Deceased',
        'Archived',
    ];

    /**
     * Statuses a record may be restored TO.
     *
     * 'Archived' is excluded on purpose: it is the state being left, so
     * restoring "to" it would leave the record archived and unrestorable.
     * CriminalController::restore() validates previous_status against this
     * set and falls back to the column default when it does not match.
     */
    public const RESTORABLE_STATUSES = [
        'Active',
        'Wanted',
        'Incarcerated',
        'Released',
        'Deceased',
    ];

    /**
     * Status a record falls back to when previous_status is null or is no
     * longer a recognised value — matches the criminals.status column default.
     */
    public const DEFAULT_STATUS = 'Active';

    protected $fillable = [
        'criminal_code',
        'full_name',
        'alias',
        'date_of_birth',
        'gender',
        'civil_status',
        'nationality',
        'address',
        'sitio',
        'contact_number',
        'photo_path',
        'physical_description',
        'height',
        'weight',
        'build',
        'hair_color',
        'eye_color',
        'distinguishing_marks',
        'status',
        // Server-controlled only. Deliberately absent from
        // CriminalController::mapToColumns() and from Store/UpdateCriminalRequest,
        // so a client cannot supply it and forge a restore target; the archive
        // endpoint is the only writer.
        'previous_status',
        'charges',
        'notes',
        'related_incident_id',
        'related_case_number',
    ];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date:Y-m-d',
            'charges' => 'array',
        ];
    }

    // Legacy single-incident link — kept for backward compatibility; profiles
    // should read relatedIncidents() instead, which supports many.
    public function incident()
    {
        return $this->belongsTo(Incident::class, 'related_incident_id');
    }

    // Every incident this criminal/suspect is linked to (Part I-42/44 of the
    // design spec — a criminal can have multiple related cases, not just one).
    public function relatedIncidents()
    {
        return $this->belongsToMany(Incident::class, 'criminal_incident')->withTimestamps();
    }
}
