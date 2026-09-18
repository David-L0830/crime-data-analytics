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

        // OFFICIAL data only — validated and not archived (Phase 2B), via
        // Incident::scopeOfficial(). This excluded archived records alone
        // before, so every headline figure below — including hotspotCount,
        // which is the same definition the Hotspot Alert announces on — counted
        // encodings nobody had reviewed. CP-5A fixed the Dashboard page, which
        // computes client-side from useData(); this endpoint kept the old rule.
        //
        // One query for every incident-derived figure, so the KPIs, the two
        // groupings, the hotspot count and the recent list cannot disagree
        // about what they are counting. Criminal::count(), the sync log and the
        // settings below are outside the rule and correctly so.
        $active = Incident::query()->official();

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
