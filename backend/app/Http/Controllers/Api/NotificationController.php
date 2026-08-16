<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationResource;
use App\Models\AppNotification;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    // GET /api/notifications
    public function index()
    {
        // "Backup Reminder" notifications were removed from the product per
        // Checkpoint 29's audit; excluding by title here (rather than only
        // at the seeder) also hides any already-seeded rows on existing
        // installs without a destructive migration.
        $items = AppNotification::where('title', '!=', 'Backup Reminder')
            ->orderByDesc('created_at')
            ->get();

        return NotificationResource::collection($items);
    }

    // PUT /api/notifications/{id}/read
    public function markRead(AppNotification $notification)
    {
        $notification->update(['read' => true]);

        return new NotificationResource($notification);
    }

    // PUT /api/notifications/read-all
    // Optionally scoped to a single notification title (e.g. ?title=Hotspot%20Alert)
    // so the Hotspots panel's "Mark All as Read" only touches hotspot-related
    // notifications instead of the whole inbox — reuses the same read/unread
    // column and endpoint the topbar bell already uses.
    public function markAllRead(Request $request)
    {
        $query = AppNotification::where('read', false);

        if ($request->filled('title')) {
            $query->where('title', $request->string('title'));
        }

        $query->update(['read' => true]);

        return response()->json(['message' => 'Notifications marked as read.']);
    }
}
