<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Records that one user has read one notification. See the
 * create_notification_reads_table migration for why read state is per-user
 * while the announcement itself stays shared.
 */
class NotificationRead extends Model
{
    protected $table = 'notification_reads';

    public $timestamps = false;

    protected $fillable = [
        'app_notification_id',
        'user_id',
        'read_at',
    ];

    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
        ];
    }
}
