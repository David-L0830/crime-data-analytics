<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One structured evidence item belonging to an incident: a reference
 * identifier ("EV-001") plus what the item actually is ("CCTV footage from the
 * entrance of the residence").
 *
 * A case may hold any number of these — the previous single
 * `incidents.evidence` string could hold exactly one unlabelled sentence.
 */
class Evidence extends Model
{
    protected $table = 'incident_evidence';

    protected $fillable = [
        'incident_id',
        'evidence_code',
        'description',
    ];

    public function incident()
    {
        return $this->belongsTo(Incident::class);
    }
}
