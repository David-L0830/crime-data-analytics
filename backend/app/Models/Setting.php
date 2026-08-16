<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Single-row settings table (barangay profile + thresholds used by Dashboard/Trends).
class Setting extends Model
{
    protected $fillable = [
        'barangay',
        'population',
        'threshold',
        'hotspot_threshold',
        'categories',
    ];

    protected function casts(): array
    {
        return [
            'categories' => 'array',
        ];
    }

    public static function current(): self
    {
        return static::firstOrCreate(['id' => 1], [
            'barangay' => 'Barangay 178',
            'population' => 15000,
            'threshold' => 5,
            'hotspot_threshold' => 3,
            'categories' => ['Property Crime', 'Violent Crime', 'Drug-Related', 'Financial Crime', 'Cybercrime', 'Public Order'],
        ]);
    }
}
