<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MetabaseEmbedService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

// Same role-restricted access as AnalyticsController/DashboardController —
// only returns a signed iframe URL, never the Metabase secret itself.
class MetabaseEmbedController extends Controller
{
    public function __construct(private MetabaseEmbedService $metabase) {}

    // GET /api/embed/metabase/{dashboardKey} — dashboardKey is
    // 'crime' | 'analytics' | 'trends' (see routes/api.php).
    public function show(Request $request, string $dashboardKey)
    {
        if (! in_array($dashboardKey, ['crime', 'analytics', 'trends'], true)) {
            return response()->json(['message' => 'Unknown dashboard.'], 404);
        }

        try {
            $url = $this->metabase->embedUrlFor($dashboardKey);
        } catch (InvalidArgumentException $e) {
            Log::warning('Metabase embed misconfigured: '.$e->getMessage());

            return response()->json(['message' => 'Analytics dashboard is not configured yet.'], 503);
        }

        return response()->json(['url' => $url]);
    }
}