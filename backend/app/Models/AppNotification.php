<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

// Named AppNotification (table: app_notifications) rather than "Notification" to
// avoid clashing with Laravel's built-in Illuminate\Notifications\Notification.
//
// Checkpoint 31 — ownership confirmed INTENTIONALLY GLOBAL, not per-user.
// There is no user_id column here (see the create_app_notifications_table
// migration) and none is being added. Every row is a system-wide alert
// (e.g. "Hotspot Alert", the removed "Backup Reminder") shown to every
// signed-in user through the same topbar bell; NotificationController's
// index/markRead/markAllRead all operate without any per-user scoping,
// and the frontend never labels these as personal ("your notifications")
// — see Header.jsx. Marking one read marks it read for every user, which
// matches how this feature has been built and audited across prior
// checkpoints (see FINAL_REQUIREMENT_AUDIT.md, item C1/M1-M8). If a truly
// personal, per-user notification stream is wanted in the future, that is
// a new feature (new table or a user_id column plus per-user read-state
// tracking, e.g. a pivot table), not a fix to this one.
class AppNotification extends Model
{
    use HasFactory;

    protected $table = 'app_notifications';

    protected $fillable = [
        'title',
        'message',
        'type',
        'read',
    ];

    protected function casts(): array
    {
        return [
            'read' => 'boolean',
        ];
    }
}
