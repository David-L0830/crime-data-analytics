<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

// Named AppNotification (table: app_notifications) rather than "Notification" to
// avoid clashing with Laravel's built-in Illuminate\Notifications\Notification.
//
// The ANNOUNCEMENT is system-wide; the READ STATE is per-user.
//
// Every row here is still a shared alert ("Case CN-2025-0032 was logged in
// Sitio 4") with no owner column — that part is unchanged and deliberate.
// What changed is read tracking. It used to live in the boolean `read`
// column on this row, which meant whoever opened the bell first marked the
// notification read for EVERY account, and the next person's unread count
// dropped to zero for messages they had never seen. Read state now lives in
// the notification_reads pivot (see NotificationRead and the
// create_notification_reads_table migration), keyed by user.
//
// The legacy `read` column is intentionally KEPT and still honoured as a
// global "already read by everyone" flag, so notifications that were marked
// read before this change do not reappear as unread in every inbox.
class AppNotification extends Model
{
    use HasFactory;

    protected $table = 'app_notifications';

    protected $fillable = [
        'title',
        'message',
        'type',
        'read',
        'audience_roles',
    ];

    protected function casts(): array
    {
        return [
            'read' => 'boolean',
        ];
    }

    /**
     * Encodes the roles an announcement is for, in the delimiter-wrapped form
     * scopeForRole() matches against (",badac_admin,badac_readonly,").
     *
     * Passing no roles returns null, which means "every authenticated role" —
     * the correct value for anything about incidents, which all three roles can
     * see.
     *
     * @param  list<string>  $roles
     */
    public static function audienceFor(array $roles = []): ?string
    {
        return $roles ? ','.implode(',', $roles).',' : null;
    }

    /**
     * Limits a query to the announcements a role is meant to receive.
     *
     * A NULL audience is for everyone, which is what every notification written
     * before this column existed has, so nothing already in an inbox
     * disappears. The LIKE is anchored by the surrounding commas, so
     * "badac_admin" cannot accidentally match some other role that merely
     * contains it as a substring.
     */
    public function scopeForRole($query, ?string $role)
    {
        if ($role === null) {
            return $query;
        }

        return $query->where(function ($q) use ($role) {
            $q->whereNull('audience_roles')
                ->orWhere('audience_roles', 'like', '%,'.$role.',%');
        });
    }

    public function reads()
    {
        return $this->hasMany(NotificationRead::class, 'app_notification_id');
    }

    /**
     * True when THIS user has read the notification.
     *
     * The legacy global flag is checked first so that anything already marked
     * read before per-user tracking existed stays read for everybody.
     */
    public function isReadBy(?int $userId): bool
    {
        if ($this->read) {
            return true;
        }
        if ($userId === null) {
            return false;
        }

        // relationLoaded() keeps this from firing a query per row when the
        // caller has already eager-loaded the pivot (NotificationController
        // does).
        if ($this->relationLoaded('reads')) {
            return $this->reads->contains('user_id', $userId);
        }

        return $this->reads()->where('user_id', $userId)->exists();
    }
}
