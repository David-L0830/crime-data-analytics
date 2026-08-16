<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Criminal extends Model
{
    use HasFactory;

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
