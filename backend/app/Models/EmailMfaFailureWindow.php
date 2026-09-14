<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A user's cumulative email-MFA failure budget for the current window.
 *
 * Deliberately survives resends, sign-outs and new Supabase sessions — see the
 * 2026_09_14_000004 migration for why each of those mattered. Written only by
 * EmailMfaService::verifyCode(), inside its transaction and under a row lock.
 */
class EmailMfaFailureWindow extends Model
{
    protected $fillable = [
        'user_id',
        'failures',
        'window_started_at',
    ];

    protected function casts(): array
    {
        return [
            'failures' => 'integer',
            'window_started_at' => 'datetime',
        ];
    }
}
