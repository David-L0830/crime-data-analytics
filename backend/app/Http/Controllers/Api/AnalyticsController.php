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
    public function index()
    {
        $incidents = $this->baseQuery()->get();

        return response()->json([
            'total' => $incidents->count(),
            'byCategory' => $incidents->countBy('category'),
            'byStatus' => $incidents->countBy('status'),
            'bySitio' => $incidents->countBy('sitio'),
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
