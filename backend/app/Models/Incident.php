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

    /**
     * Statuses a client may ASSIGN through POST /incidents and
     * PUT /incidents/{incident}.
     *
     * 'Archived' is excluded on purpose. Archiving is a two-column write —
     * previous_status must capture the status being left at the same moment
     * status becomes 'Archived' — and only IncidentController::archive()
     * performs it. A create or update carrying status: 'Archived' would reach
     * 'Archived' without ever setting previous_status, leaving a row that
     * restore() can only send back to DEFAULT_STATUS, and it would bypass the
     * already-archived guard and the ARCHIVE audit event as well.
     * Store/UpdateIncidentRequest validate against this set; STATUSES stays
     * the full vocabulary for filtering and display.
     */
    public const ASSIGNABLE_STATUSES = [
        'Open',
        'Under Investigation',
        'Solved',
        'Closed',
    ];

    /**
     * Statuses a record may be restored TO.
     *
     * 'Archived' is excluded on purpose: it is the state being left, so
     * restoring "to" it would leave the record archived and unrestorable.
     * IncidentController::restore() validates previous_status against this
     * set and falls back to DEFAULT_STATUS when it does not match. Mirrors
     * Criminal::RESTORABLE_STATUSES / Victim::RESTORABLE_STATUSES.
     */
    public const RESTORABLE_STATUSES = [
        'Open',
        'Under Investigation',
        'Solved',
        'Closed',
    ];

    /**
     * Status a record falls back to when previous_status is null or is no
     * longer a recognised value — matches the incidents.status column default.
     */
    public const DEFAULT_STATUS = 'Open';

    /**
     * Record validation states — a separate axis from the case `status`.
     *
     * pending   — submitted, awaiting review by a BADAC Administrator.
     * validated — reviewed and accepted as an official record.
     * returned  — sent back to the encoder with a correction reason.
     *
     * Written ONLY by the server: IncidentController::store() (pending),
     * approve() (validated), returnForCorrection() (returned) and an Encoder's
     * update() (back to pending). None of these columns is in mapToColumns(),
     * so no client payload can set them. Mirrors VALIDATION_STATUSES in
     * src/utils/constants.js.
     */
    public const VALIDATION_PENDING = 'pending';

    public const VALIDATION_VALIDATED = 'validated';

    public const VALIDATION_RETURNED = 'returned';

    public const VALIDATION_STATUSES = [
        self::VALIDATION_PENDING,
        self::VALIDATION_VALIDATED,
        self::VALIDATION_RETURNED,
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
        'complainant_is_victim',
        'complainant_name',
        'complainant_relationship',
        'complainant_contact',
        'complainant_address',
        'reporting_officer',
        'investigating_officer',
        'badge_number',
        'unit',
        'status',
        // Server-controlled only. Deliberately absent from
        // IncidentController::mapToColumns() and from Store/UpdateIncidentRequest,
        // so a client cannot supply it and forge a restore target; the archive
        // endpoint is the only writer. Mirrors Criminal::$fillable.
        'previous_status',
        'priority',
        'description',
        'evidence',
        'reported_by',
        'synced_at',
        // Server-controlled only, like previous_status: absent from
        // IncidentController::mapToColumns() and from the form requests.
        'validation_status',
        'validated_by',
        'validated_at',
        'returned_by',
        'returned_at',
        'correction_reason',
        // Also server-controlled. Fillable so IncidentController::update() can
        // append it to the column array, exactly as it appends the validation
        // columns above — and safe for the same reason: mapToColumns() is an
        // explicit allow-list that maps no client key to it, and the form
        // requests never validate one, so nothing a caller sends can reach it.
        'last_edited_by',
    ];

    protected function casts(): array
    {
        return [
            'incident_date' => 'date:Y-m-d',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'complainant_is_victim' => 'boolean',
            'victim_age' => 'integer',
            'suspect_age' => 'integer',
            'synced_at' => 'datetime',
            'validated_at' => 'datetime',
            'returned_at' => 'datetime',
        ];
    }

    public function reporter()
    {
        return $this->belongsTo(User::class, 'reported_by');
    }

    /**
     * The last authenticated user to substantively edit this incident's
     * content. Null on a record nobody has edited since the column existed —
     * which is every record created before it, and every newly created one.
     */
    public function lastEditor()
    {
        return $this->belongsTo(User::class, 'last_edited_by');
    }

    public function validator()
    {
        return $this->belongsTo(User::class, 'validated_by');
    }

    public function returner()
    {
        return $this->belongsTo(User::class, 'returned_by');
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

    // Structured evidence items (Evidence ID + Description). Replaces the
    // single free-text `evidence` column as the place evidence is recorded;
    // that column is deliberately left in place and its contents were copied
    // into this table by the create_incident_evidence_table migration.
    public function evidenceItems()
    {
        return $this->hasMany(Evidence::class)->orderBy('evidence_code')->orderBy('id');
    }
}
