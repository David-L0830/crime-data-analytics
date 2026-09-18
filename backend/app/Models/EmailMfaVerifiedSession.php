<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Records that one Supabase session (by its signed `session_id` claim) has
// entered a correct email MFA code. This is `email_mfa_verified` — an
// application-level fact, deliberately never described as Supabase aal2.
class EmailMfaVerifiedSession extends Model
{
    protected $fillable = [
        'user_id',
        'supabase_session_id',
        'verified_at',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'verified_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }
}
