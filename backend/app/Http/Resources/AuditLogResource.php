<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AuditLogResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'timestamp' => $this->created_at->toIso8601String(),
            'performedBy' => $this->user?->name ?? 'System',
            'role' => $this->user?->role ?? 'system',
            'action' => $this->action,
            'targetType' => $this->target_type,
            'details' => $this->description,
        ];
    }
}
