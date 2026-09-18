<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Incident;
use Illuminate\Support\Facades\DB;

class AnalyticsController extends Controller
{
    /**
     * The one query every figure on these four endpoints is built from.
     *
     * OFFICIAL data only — validated and not archived (Phase 2B), via
     * Incident::scopeOfficial(). This used to exclude archived records alone,
     * which meant every statistic here counted encodings nobody had reviewed
     * and presented them as the barangay's figures. CP-5A closed that on the
     * Statistical Analysis page, which computes client-side from useData(), but
     * these endpoints kept the old rule — so the API still answered with
     * unreviewed data to anything that called it.
     *
     * Kept as one method deliberately: index(), crimeTypes(), monthly() and
     * locations() all start here, so the rule cannot hold for some of them and
     * not others.
     */
    private function baseQuery()
    {
        return Incident::query()->official();
    }

    // GET /api/analytics — general overview used by the Analytics page.
    //
    // Aggregates in PostgreSQL rather than loading every non-archived
    // incident into PHP and counting there (Section 6 Phase 2 audit
    // finding) — same `select(...)->groupBy(...)->pluck('total', ...)`
    // shape DashboardController::index() already uses for `bySitio`/
    // `byCrimeType`, which produces the same {value: count} map shape the
    // frontend previously received from Collection::countBy().
    public function index()
    {
        $total = $this->baseQuery()->count();

        $byCategory = $this->baseQuery()
            ->select('category', DB::raw('count(*) as total'))
            ->groupBy('category')
            ->pluck('total', 'category');

        $byStatus = $this->baseQuery()
            ->select('status', DB::raw('count(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status');

        $bySitio = $this->baseQuery()
            ->select('sitio', DB::raw('count(*) as total'))
            ->groupBy('sitio')
            ->pluck('total', 'sitio');

        return response()->json([
            'total' => $total,
            'byCategory' => $byCategory,
            'byStatus' => $byStatus,
            'bySitio' => $bySitio,
        ]);
    }

    // GET /api/analytics/crime-types
    public function crimeTypes()
    {
        $data = $this->baseQuery()
            ->select('crime_type', DB::raw('count(*) as total'))
            ->groupBy('crime_type')
            ->orderByDesc('total')
            ->get();

        return response()->json($data);
    }

    // GET /api/analytics/monthly — used by Trends page.
    public function monthly()
    {
        $data = $this->baseQuery()
            ->select(DB::raw("to_char(incident_date, 'YYYY-MM') as month"), DB::raw('count(*) as total'))
            ->groupBy('month')
            ->orderBy('month')
            ->get();

        return response()->json($data);
    }

    // GET /api/analytics/locations
    public function locations()
    {
        $data = $this->baseQuery()
            ->select('sitio', DB::raw('count(*) as total'))
            ->groupBy('sitio')
            ->orderByDesc('total')
            ->get();

        return response()->json($data);
    }
}
