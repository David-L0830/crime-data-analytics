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
     * scopeForRole() matches against (",badac_admin,badac_validator,").
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

    /**
     * The title that was withdrawn from the product but may still sit in older
     * databases. Named once here so the list query, the bulk mark-as-read and
     * the per-notification authorization check cannot disagree about it.
     */
    public const WITHDRAWN_TITLES = ['Backup Reminder'];

    /**
     * Limits a query to what one caller is entitled to see: their role's
     * audience, minus anything withdrawn from the product.
     *
     * THE WHOLE POINT of this scope is that it is the single definition of
     * "visible", used by every endpoint. It used to exist only as two separate
     * clauses copied into index() and markAllRead(), and markRead() had
     * neither — which is exactly how an Encoder could read an administrators-
     * only announcement by guessing its id.
     */
    public function scopeVisibleTo($query, ?string $role)
    {
        return $query
            ->whereNotIn('title', self::WITHDRAWN_TITLES)
            ->forRole($role);
    }

    /**
     * Whether one already-loaded notification is visible to a role.
     *
     * The row-level twin of scopeVisibleTo, for the case where the model has
     * already been resolved (route-model binding) and re-querying it just to
     * ask this question would be a wasted round trip. The two must agree; the
     * NotificationTest authorization cases assert that they do.
     */
    public function isVisibleTo(?string $role): bool
    {
        if (in_array($this->title, self::WITHDRAWN_TITLES, true)) {
            return false;
        }

        // A null audience is "everyone", which is what every notification
        // written before the column existed carries.
        if ($this->audience_roles === null) {
            return true;
        }

        // A caller with no role cannot be inside a restricted audience. Fails
        // closed on purpose: the alternative would admit an unresolvable role
        // to precisely the announcements that were restricted.
        if ($role === null) {
            return false;
        }

        // Same comma-anchored match as scopeForRole's LIKE, so one role name
        // cannot match another that merely contains it as a substring.
        return str_contains($this->audience_roles, ','.$role.',');
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
