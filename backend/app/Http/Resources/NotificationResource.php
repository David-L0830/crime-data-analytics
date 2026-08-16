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
            'read' => (bool) $this->read,
            'timestamp' => $this->created_at->toIso8601String(),
        ];
    }
}
