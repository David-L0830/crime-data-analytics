<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;

// GET /api/settings/metabase-status — the Super Administrator's read-only view
// of the Metabase embedding configuration (System Governance).
//
// It reports only WHETHER each value is configured. The embedding secret stays
// in the environment (METABASE_EMBEDDING_SECRET_KEY) and is changed there, on
// the host, never through this application: nothing here returns it, a prefix
// of it, its length or a hash of it, because any of those would help someone
// guess or confirm it. The site URL and dashboard IDs are not secrets; they
// already appear in every embed URL a signed-in user's browser receives.
//
// Nothing is contacted. This reads config/metabase.php, the same values
// MetabaseEmbedService signs with, so "ready" here means exactly "the embed
// endpoint has what it needs", not "the Metabase server is up".
class MetabaseStatusController extends Controller
{
    // Labels for the dashboard keys in config('metabase.dashboards'), named
    // after the modules that embed them.
    private const DASHBOARD_LABELS = [
        'crime' => 'Crime Reporting Dashboard',
        'analytics' => 'Statistical Analysis',
        'trends' => 'Trend and Pattern Detection',
    ];

    public function show()
    {
        $siteUrl = config('metabase.site_url');
        $siteUrl = is_string($siteUrl) && trim($siteUrl) !== '' ? rtrim(trim($siteUrl), '/') : null;
        $secretConfigured = filled(config('metabase.secret_key'));

        $dashboards = [];
        foreach ((array) config('metabase.dashboards', []) as $key => $id) {
            $dashboards[] = [
                'key' => $key,
                'label' => self::DASHBOARD_LABELS[$key] ?? $key,
                'id' => filled($id) ? (string) $id : null,
                'configured' => filled($id),
            ];
        }

        return response()->json([
            'data' => [
                'siteUrl' => $siteUrl,
                'siteUrlConfigured' => $siteUrl !== null,
                'embeddingSecretConfigured' => $secretConfigured,
                'tokenTtlSeconds' => (int) config('metabase.token_ttl', 600),
                'dashboards' => $dashboards,
                'ready' => $siteUrl !== null
                    && $secretConfigured
                    && collect($dashboards)->every(fn (array $d) => $d['configured']),
            ],
        ]);
    }
}
