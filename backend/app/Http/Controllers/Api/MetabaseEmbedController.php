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
    // 'crime' | 'analytics' | 'trends' | 'crime_summary' (see routes/api.php).
    public function show(Request $request, string $dashboardKey)
    {
        if (! in_array($dashboardKey, ['crime', 'analytics', 'trends', 'crime_summary'], true)) {
            return response()->json(['message' => 'Unknown dashboard.'], 404);
        }

        try {
            $url = $this->metabase->embedUrlFor($dashboardKey, $this->buildLockedParams($request));
        } catch (InvalidArgumentException $e) {
            Log::warning('Metabase embed misconfigured: '.$e->getMessage());

            return response()->json(['message' => 'Analytics dashboard is not configured yet.'], 503);
        }

        return response()->json(['url' => $url]);
    }

    // Turns this app's own filter query params into Metabase's "locked"
    // dashboard parameters (baked into the signed token, so the embedded
    // page can't be tricked into showing a different slice of data than
    // the one the backend intended). dateFrom/dateTo collapse into a
    // single Metabase date-range parameter ("start~end"), matching what
    // Metabase's date field filter expects.
    private function buildLockedParams(Request $request): array
    {
        $params = [];

        $dateFrom = $request->query('dateFrom');
        $dateTo = $request->query('dateTo');
        if ($dateFrom || $dateTo) {
            $params['date_range'] = ($dateFrom ?: '').'~'.($dateTo ?: '');
        }

        $slugs = [
            'crimeType' => 'crime_type',
            'sitio' => 'sitio',
            'status' => 'status',
            'category' => 'category',
        ];

        foreach ($slugs as $queryKey => $slug) {
            $value = $request->query($queryKey);
            if ($value !== null && $value !== '') {
                $params[$slug] = $value;
            }
        }

        return $params;
    }
}