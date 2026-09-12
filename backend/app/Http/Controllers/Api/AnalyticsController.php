<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Incident;
use Illuminate\Support\Facades\DB;

class AnalyticsController extends Controller
{
    private function baseQuery()
    {
        return Incident::where('status', '!=', 'Archived');
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
