<?php

namespace App\Services;

use Firebase\JWT\JWT;
use InvalidArgumentException;

// Signs Metabase's static-embedding JWT server-side, using the secret key
// from config/metabase.php (METABASE_EMBEDDING_SECRET_KEY — never exposed
// to the frontend). Mirrors how SupabaseTokenValidator is the one place
// that ever touches a Supabase secret: this is the one place that ever
// touches the Metabase embedding secret.
class MetabaseEmbedService
{
    /**
     * Build a ready-to-use signed iframe URL for one of the three
     * dashboards configured in config('metabase.dashboards').
     *
     * @param string $dashboardKey  'crime' | 'analytics' | 'trends'
     * @param array  $params        Optional Metabase dashboard filter
     *                               params to lock into the token, e.g.
     *                               ['sitio' => 'Sitio 3'].
     */
    public function embedUrlFor(string $dashboardKey, array $params = []): string
    {
        $dashboardId = config("metabase.dashboards.$dashboardKey");

        if (! $dashboardId) {
            throw new InvalidArgumentException(
                "No Metabase dashboard ID configured for \"$dashboardKey\" — check METABASE_DASHBOARD_ID_".strtoupper($dashboardKey)." in backend/.env"
            );
        }

        $secret = config('metabase.secret_key');
        if (! $secret) {
            throw new InvalidArgumentException('METABASE_EMBEDDING_SECRET_KEY is not set in backend/.env');
        }

        $payload = [
            'resource' => ['dashboard' => (int) $dashboardId],
            'params' => (object) $params,
            'exp' => now()->addSeconds(config('metabase.token_ttl', 600))->timestamp,
        ];

        $token = JWT::encode($payload, $secret, 'HS256');

        $siteUrl = rtrim(config('metabase.site_url'), '/');

        // Hash-fragment display options. Everything here is read by Metabase's
        // embed page in the browser — the token above, and the parameters baked
        // into it, are unaffected by anything appended to this fragment.
        // Appearance defaults match Metabase's own, so a dashboard with no
        // entry in config('metabase.appearance') keeps its previous fragment.
        $appearance = config("metabase.appearance.$dashboardKey")
            ?: ['bordered' => 'true', 'titled' => 'true'];

        $parts = [];
        foreach ($appearance as $option => $value) {
            $parts[] = $option.'='.$value;
        }
        $fragment = implode('&', $parts);

        $hidden = config("metabase.hidden_parameters.$dashboardKey", []);
        if ($hidden) {
            $fragment .= '&hide_parameters='.implode(',', $hidden);
        }

        return "$siteUrl/embed/dashboard/$token#$fragment";
    }
}