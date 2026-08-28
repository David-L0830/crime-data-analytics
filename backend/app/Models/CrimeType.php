<?php

namespace App\Models;

use App\Services\CrimeTypeColorAllocator;
use Illuminate\Database\Eloquent\Model;

/**
 * A configurable crime type and the map colour bound to it.
 *
 * The colour lives here, on the row, rather than being computed by the
 * frontend — see CrimeTypeColorAllocator for why that is what makes colours
 * stable across refreshes, sessions, users and machines.
 */
class CrimeType extends Model
{
    protected $fillable = [
        'name',
        'color',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    /**
     * Assigns a colour to a NEW crime type, using every colour currently taken
     * as the exclusion set. Existing rows are only read, never rewritten, so
     * adding a crime type can never change an existing crime type's colour.
     */
    public static function allocateColor(string $name): string
    {
        return CrimeTypeColorAllocator::allocate(
            $name,
            static::query()->pluck('color')->all()
        );
    }
}
