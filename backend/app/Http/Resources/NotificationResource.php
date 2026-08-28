<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class NotificationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'title' => $this->title,
            'message' => $this->message,
            'type' => $this->type,
            // Per-user, not the shared column: `read` answers "has the
            // signed-in user read this", which is what the bell count and the
            // unread styling in the dropdown are asserting.
            'read' => $this->isReadBy($request->user()?->id),
            'timestamp' => $this->created_at->toIso8601String(),
        ];
    }
}
