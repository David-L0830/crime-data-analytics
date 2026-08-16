<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Victim extends Model
{
    use HasFactory;

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
