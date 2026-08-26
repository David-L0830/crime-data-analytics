<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Victim extends Model
{
    use HasFactory;

    /**
     * The complete set of victim-record status values.
     *
     * Added as the server-side source of truth so the restore endpoint can
     * validate the value it is about to write, mirroring the existing
     * Criminal::STATUSES precedent. The values are exactly those already
     * declared by VICTIM_STATUSES in src/utils/constants.js — victims have
     * only ever had 'Active' (the column default, see
     * 2025_01_06_000001_add_status_to_victims_table.php) and 'Archived'
     * (written by VictimController::archive()). Nothing is added or removed
     * here; the vocabulary is unchanged, it is simply now expressed in one
     * place on the server as well.
     *
     * Note that, unlike criminals, victim status is not client-settable at
     * all: StoreVictimRequest/UpdateVictimRequest carry no status rule and
     * VictimController::mapToColumns() maps no status column.
     */
    public const STATUSES = [
        'Active',
        'Archived',
    ];

    /**
     * Statuses a record may be restored TO — 'Archived' excluded for the same
     * reason as Criminal::RESTORABLE_STATUSES.
     */
    public const RESTORABLE_STATUSES = [
        'Active',
    ];

    /**
     * Fallback when previous_status is null or unrecognised — matches the
     * victims.status column default.
     */
    public const DEFAULT_STATUS = 'Active';

    protected $fillable = [
        'victim_code',
        'full_name',
        'alias',
        'gender',
        'date_of_birth',
        'civil_status',
        'nationality',
        'contact_number',
        'address',
        'status',
        // Server-controlled only — see the same note on Criminal. Victims are
        // doubly protected, since mapToColumns() maps no status field either.
        'previous_status',
    ];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date:Y-m-d',
        ];
    }

    // Every case (incidents row) this victim is associated with — a victim is
    // never linked to a criminal directly, only through shared cases. Mirrors
    // Criminal::relatedIncidents() so both sides of the case relationship
    // read the same way.
    public function relatedIncidents()
    {
        return $this->belongsToMany(Incident::class, 'incident_victim')->withTimestamps();
    }
}
