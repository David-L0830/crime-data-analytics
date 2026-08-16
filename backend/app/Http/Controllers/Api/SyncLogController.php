<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SyncLog;

class SyncLogController extends Controller
{
    // GET /api/sync-logs — used by Dashboard/Settings sync-status widgets.
    public function index()
    {
        return SyncLog::orderByDesc('created_at')->get([
            'id', 'status', 'records_received', 'source', 'created_at',
        ])->map(fn ($l) => [
            'id' => (string) $l->id,
            'timestamp' => $l->created_at->toIso8601String(),
            'status' => $l->status,
            'recordsReceived' => $l->records_received,
            'source' => $l->source,
        ]);
    }
}
