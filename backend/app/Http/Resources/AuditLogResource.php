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
            // audit_logs.created_at is nullable in the schema, and this was
            // the only unguarded timestamp dereference in the file — the two
            // lines below already use ?->. One null row would have raised a
            // 500 for the WHOLE collection, taking down the Audit Logs page
            // rather than degrading a single row. The column stays nullable;
            // this is a serialisation guard, not a schema change.
            'timestamp' => $this->created_at?->toIso8601String(),
            'performedBy' => $this->user?->name ?? 'System',
            'role' => $this->user?->role ?? 'system',
            'action' => $this->action,
            'targetType' => $this->target_type,
            'details' => $this->description,
        ];
    }
}
