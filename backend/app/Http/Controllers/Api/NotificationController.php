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
        // scopeVisibleTo is the single definition of what a caller may see:
        // their role's audience (an Encoder has no Records access, so a "new
        // criminal record" announcement would send them to a route their role
        // is bounced off), minus titles withdrawn from the product. It is the
        // same scope markAllRead() applies and the same rule markRead() now
        // enforces, so the three cannot drift apart.
        $items = AppNotification::query()
            ->visibleTo($request->user()?->role)
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
        // AUTHORIZATION. This check is the whole reason this method is not two
        // lines shorter.
        //
        // Route-model binding resolves ANY id the caller cares to type, and
        // this endpoint answers with a full NotificationResource — title and
        // message included. Without this gate, an Encoder could walk the id
        // space and read announcements addressed only to administrators (the
        // "New Criminal Record" and "New Victim Record" ones, which
        // CriminalController and VictimController restrict to
        // badac_admin + badac_readonly), even though GET /notifications
        // correctly refuses to list them. Marking a notification read was a
        // read primitive with no read check.
        //
        // 404, not 403: a 403 would confirm that a notification with that id
        // exists and is simply off-limits, which is itself a disclosure. To a
        // caller not in the audience, the notification does not exist — the
        // same answer GET /notifications gives by omission.
        //
        // The rule lives on the model (isVisibleTo) rather than being spelled
        // out here, so it is the same rule scopeVisibleTo applies to the list.
        if (! $notification->isVisibleTo($request->user()?->role)) {
            abort(404);
        }

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
            ->visibleTo($request->user()?->role)
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
