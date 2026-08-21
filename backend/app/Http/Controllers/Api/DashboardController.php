<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Criminal;
use App\Models\Incident;
use App\Models\Setting;
use App\Models\SyncLog;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    // GET /api/dashboard
    public function index()
    {
        $settings = Setting::current();

        $active = Incident::where('status', '!=', 'Archived');

        $totalIncidents = (clone $active)->count();
        $openIncidents = (clone $active)->where('status', 'Open')->count();
        $underInvestigation = (clone $active)->where('status', 'Under Investigation')->count();
        $solved = (clone $active)->where('status', 'Solved')->count();

        $bySitio = (clone $active)->select('sitio', DB::raw('count(*) as total'))
            ->groupBy('sitio')->pluck('total', 'sitio');

        $hotspotCount = $bySitio->filter(fn ($count) => $count >= $settings->hotspot_threshold)->count();

        $byCrimeType = (clone $active)->select('crime_type', DB::raw('count(*) as total'))
            ->groupBy('crime_type')->orderByDesc('total')->pluck('total', 'crime_type');

        $recent = $active->clone()->orderByDesc('incident_date')->orderByDesc('id')->limit(5)->get()
            ->map(fn ($i) => [
                'id' => (string) $i->id,
                'caseNumber' => $i->case_number,
                'crimeType' => $i->crime_type,
                'date' => optional($i->incident_date)->format('Y-m-d'),
                'sitio' => $i->sitio,
                'status' => $i->status,
            ]);

        return response()->json([
            'totalIncidents' => $totalIncidents,
            'openIncidents' => $openIncidents,
            'underInvestigation' => $underInvestigation,
            'solvedIncidents' => $solved,
            // Checkpoint 28 — totalResidents removed with the Resident
            // Registry module; verified via grep that Dashboard.jsx never
            // read this field, so this is dead-response cleanup only.
            'totalCriminalRecords' => Criminal::count(),
            'hotspotCount' => $hotspotCount,
            'byCrimeType' => $byCrimeType,
            'bySitio' => $bySitio,
            'recentIncidents' => $recent,
            'lastSync' => SyncLog::where('status', 'completed')->latest()->first(),
            'settings' => $settings,
        ]);
    }
}
