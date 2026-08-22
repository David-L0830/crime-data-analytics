<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Firebase\JWT\JWT;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Issues short-lived, signed Metabase "static embedding" URLs for the
// Dashboard / Analytics / Trends pages. This is the ONLY place the Metabase
// embedding secret key is used — it is read from config('metabase.*')
// (server-side env vars) and never leaves this backend. The frontend only
// ever receives the finished, already-signed iframe URL from embedUrl()
// below (see src/services/metabaseService.js / MetabaseDashboard.jsx).
//
// Route protection (see routes/api.php) intentionally mirrors the existing
// GET /dashboard and GET /analytics routes: same 'auth:supabase' guard,
// same badac_admin/badac_readonly role restriction. Embedding does not
// introduce any new authorization boundary — it reuses the one already
// enforced for this app's analytics data.
class MetabaseController extends Controller
{
    // The only dashboard keys this endpoint will ever turn into a Metabase
    // dashboard ID. Keeping this as an explicit allow-list (rather than
    // trusting config('metabase.dashboards') keys alone) means a request
    // can never reach a dashboard this app doesn't know about, even if
    // config is edited later to add more entries for other purposes.
    private const ALLOWED_DASHBOARDS = ['crime-dashboard', 'crime-analytics', 'crime-trends'];

    // Query param (our side) => Metabase dashboard parameter slug (their
    // side). Whoever sets up each Metabase dashboard needs to add a
    // matching parameter with this exact slug for the filter to actually
    // narrow that dashboard's questions — see METABASE_SETUP.md. Sending a
    // slug a given dashboard doesn't define is harmless (Metabase ignores
    // unknown params), so it's safe to always send the full set.
    private const FILTER_PARAM_SLUGS = [
        'crimeType' => 'crime_type',
        'sitio' => 'sitio',
        'status' => 'status',
        'category' => 'category',
    ];

    // GET /api/metabase/embed-url?dashboard=crime-dashboard&dateFrom=...&dateTo=...&sitio=...
    public function embedUrl(Request $request): JsonResponse
    {
        $siteUrl = rtrim((string) config('metabase.site_url'), '/');
        $secret = config('metabase.embedding_secret_key');

        if ($siteUrl === '' || ! $secret) {
            return response()->json([
                'message' => 'Metabase is not configured on the server yet.',
            ], 503);
        }

        $key = (string) $request->query('dashboard');
        if (! in_array($key, self::ALLOWED_DASHBOARDS, true)) {
            return response()->json(['message' => 'Unknown or missing dashboard key.'], 422);
        }

        $dashboardId = config("metabase.dashboards.$key");
        if (! $dashboardId) {
            return response()->json([
                'message' => "No Metabase dashboard ID is configured for \"$key\" yet.",
            ], 503);
        }

        $params = $this->buildLockedParams($request);

        $payload = [
            'resource' => ['dashboard' => (int) $dashboardId],
            'params' => $params,
            // Short-lived on purpose — this token is only ever used once,
            // immediately, to load an <iframe src="...">. MetabaseDashboard
            // (frontend) re-requests a fresh URL well before this expires
            // for any dashboard left open longer than that.
            'exp' => now()->addMinutes(10)->timestamp,
        ];

        $token = JWT::encode($payload, $secret, 'HS256');

        return response()->json([
            'url' => "{$siteUrl}/embed/dashboard/{$token}#bordered=false&titled=false",
        ]);
    }

    // Turns this app's own filter query params into Metabase's "locked"
    // dashboard parameters (baked into the signed token, so the embedded
    // page can't be tricked into showing a different slice of data than
    // the one the backend intended). dateFrom/dateTo collapse into a
    // single Metabase date-range parameter, since Metabase's date field
    // filter expects one value in "start~end" form rather than two
    // separate params.
    private function buildLockedParams(Request $request): array
    {
        $params = [];

        $dateFrom = $request->query('dateFrom');
        $dateTo = $request->query('dateTo');
        if ($dateFrom || $dateTo) {
            $params['date_range'] = ($dateFrom ?: '').'~'.($dateTo ?: '');
        }

        foreach (self::FILTER_PARAM_SLUGS as $queryKey => $slug) {
            $value = $request->query($queryKey);
            if ($value !== null && $value !== '') {
                $params[$slug] = $value;
            }
        }

        return $params;
    }
}
