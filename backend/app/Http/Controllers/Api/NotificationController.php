<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationResource;
use App\Models\AppNotification;
use App\Models\NotificationRead;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Notifications are shared announcements with PER-USER read state (see
 * AppNotification and the create_notification_reads_table migration).
 *
 * Everything in here is scoped to $request->user() — the authenticated caller
 * — so one account can never mark another account's inbox read, and the bell
 * count each person sees reflects what THEY have actually opened.
 */
class NotificationController extends Controller
{
    // GET /api/notifications
    public function index(Request $request)
    {
        // "Backup Reminder" notifications were removed from the product per
        // Checkpoint 29's audit; excluding by title here (rather than only
        // at the seeder) also hides any already-seeded rows on existing
        // installs without a destructive migration.
        $items = AppNotification::where('title', '!=', 'Backup Reminder')
            // Only the announcements this caller's ROLE is meant to receive.
            // An Encoder has no access to the Records module, so a "new
            // criminal record" announcement would send them to a route their
            // role is bounced off — see AppNotification::scopeForRole().
            ->forRole($request->user()?->role)
            // Eager-load only THIS user's read markers, so isReadBy() answers
            // from memory instead of one query per notification.
            ->with(['reads' => fn ($q) => $q->where('user_id', $request->user()?->id)])
            ->orderByDesc('created_at')
            ->get();

        return NotificationResource::collection($items);
    }

    // PUT /api/notifications/{id}/read
    public function markRead(Request $request, AppNotification $notification)
    {
        $userId = $request->user()?->id;

        if ($userId !== null) {
            // Idempotent: re-reading an already-read notification must not
            // fail on the (app_notification_id, user_id) unique index.
            NotificationRead::firstOrCreate(
                ['app_notification_id' => $notification->id, 'user_id' => $userId],
                ['read_at' => now()],
            );
        }

        // Reload with this user's markers so the response's `read` flag is the
        // state the caller will actually see on the next list.
        $notification->setRelation(
            'reads',
            $notification->reads()->where('user_id', $userId)->get()
        );

        return new NotificationResource($notification);
    }

    // PUT /api/notifications/read-all
    // Optionally scoped to a single notification title (e.g. ?title=Hotspot%20Alert)
    // so the Hotspots panel's "Mark All as Read" only touches hotspot-related
    // notifications instead of the whole inbox — reuses the same read-state
    // mechanism the topbar bell already uses.
    public function markAllRead(Request $request)
    {
        $userId = $request->user()?->id;

        if ($userId === null) {
            return response()->json(['message' => 'Notifications marked as read.']);
        }

        $query = AppNotification::query()
            ->where('read', false)
            // Scoped the same way index() is, so "mark all read" means the
            // notifications this person can actually see and nothing else.
            ->forRole($request->user()?->role)
            ->whereDoesntHave('reads', fn ($q) => $q->where('user_id', $userId));

        if ($request->filled('title')) {
            $query->where('title', $request->string('title'));
        }

        $now = now();
        $rows = $query->pluck('id')->map(fn ($id) => [
            'app_notification_id' => $id,
            'user_id' => $userId,
            'read_at' => $now,
        ])->all();

        if ($rows) {
            // Chunked because a long-lived install can accumulate a large
            // backlog and some drivers cap placeholders per statement.
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('notification_reads')->insert($chunk);
            }
        }

        return response()->json(['message' => 'Notifications marked as read.']);
    }
}
