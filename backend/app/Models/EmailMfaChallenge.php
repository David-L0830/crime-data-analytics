<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// A sent, not-yet-entered email MFA code for one Supabase session. Holds an
// HMAC of the code only — see EmailMfaService.
class EmailMfaChallenge extends Model
{
    protected $fillable = [
        'user_id',
        'supabase_session_id',
        'code_hash',
        'attempts',
        'expires_at',
        'consumed_at',
    ];

    // The hash is useless without APP_KEY, but it is still authentication
    // material and has no business in any serialized output.
    protected $hidden = ['code_hash'];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
        ];
    }
}
