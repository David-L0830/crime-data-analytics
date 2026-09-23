<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Incident;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Read-only, pull-based outputs from CDARS to the two BPA Level 2 sub-systems
 * it reports to:
 *
 *   - Security Alert System Module  ← crime hotspot and risk area information
 *   - Campaign Planning Module       ← crime trend and analytical figures
 *
 * CDARS pushes nothing. Each sub-system (or an administrator acting for it)
 * pulls a snapshot from these endpoints, and nothing here writes.
 *
 * OFFICIAL data only — validated and not archived — through
 * Incident::scopeOfficial(), the same rule every figure people act on uses.
 *
 * Every field is an explicit, aggregated projection: counts grouped by sitio,
 * crime type, category and month. No record identifiers, names, contact
 * details, coordinates or free text leave through here, so neither sub-system
 * receives anything that identifies a person or a case.
 *
 * Top-level keys are named (areas, monthlyTotals, ...) rather than wrapped in
 * `data`, because the frontend's api helper unwraps a `data` key and would
 * drop the meta, criteria and summary blocks around it.
 */
class IntegrationController extends Controller
{
    /**
     * The incident count at which a sitio's risk reaches High. Mirrors
     * HOTSPOT_HIGH_BOUNDARY in src/utils/helpers.js, which the Trends page
     * classifies with, so the Security Alert System receives the same risk
     * level the barangay sees on screen.
     */
    private const HOTSPOT_HIGH_BOUNDARY = 5;

    // GET /api/v1/integrations/security-alerts/hotspots
    public function securityAlertHotspots(): JsonResponse
    {
        // Same fallback as hotspotRisk() and the column default: 3 when unset.
        $threshold = (int) (Setting::current()->hotspot_threshold ?? 3);
        $highBoundary = max(self::HOTSPOT_HIGH_BOUNDARY, $threshold);

        $rows = Incident::query()->official()
            ->select('sitio', 'crime_type', DB::raw('count(*) as total'))
            ->groupBy('sitio', 'crime_type')
            ->get();

        $areas = $rows
            ->groupBy(fn ($row) => $row->sitio ?? '')
            ->map(function ($group) use ($threshold, $highBoundary) {
                $count = (int) $group->sum('total');

                return [
                    'sitio' => $group->first()->sitio,
                    'incidentCount' => $count,
                    'isHotspot' => $count >= $threshold,
                    'riskLevel' => $this->riskLevel($count, $threshold, $highBoundary),
                    'crimeTypes' => $group
                        ->sortBy([['total', 'desc'], ['crime_type', 'asc']])
                        ->map(fn ($row) => [
                            'crimeType' => $row->crime_type,
                            'count' => (int) $row->total,
                        ])
                        ->values(),
                ];
            })
            ->sortBy([['incidentCount', 'desc'], ['sitio', 'asc']])
            ->values();

        return response()->json([
            'meta' => $this->meta('Security Alert System Module', 'crime-hotspots'),
            'criteria' => [
                'hotspotThreshold' => $threshold,
                'highRiskBoundary' => $highBoundary,
                'riskLevels' => [
                    'Low' => 'incidentCount below hotspotThreshold',
                    'Medium' => 'incidentCount at or above hotspotThreshold, below highRiskBoundary',
                    'High' => 'incidentCount at or above highRiskBoundary',
                ],
            ],
            'summary' => [
                'totalIncidents' => (int) $areas->sum('incidentCount'),
                'areasReported' => $areas->count(),
                'hotspotCount' => $areas->where('isHotspot', true)->count(),
                'highRiskCount' => $areas->where('riskLevel', 'High')->count(),
            ],
            'areas' => $areas,
        ]);
    }

    // GET /api/v1/integrations/campaign-planning/trends
    public function campaignPlanningTrends(): JsonResponse
    {
        // Same month expression AnalyticsController::monthly() uses for the
        // Trends page.
        $month = DB::raw("to_char(incident_date, 'YYYY-MM') as month");

        $monthly = Incident::query()->official()
            ->whereNotNull('incident_date')
            ->select($month, DB::raw('count(*) as total'))
            ->groupBy('month')
            ->orderBy('month')
            ->get()
            ->map(fn ($row) => ['month' => $row->month, 'count' => (int) $row->total])
            ->values();

        $monthlyByCrimeType = Incident::query()->official()
            ->whereNotNull('incident_date')
            ->select($month, 'crime_type', DB::raw('count(*) as total'))
            ->groupBy('month', 'crime_type')
            ->orderBy('month')
            ->orderBy('crime_type')
            ->get()
            ->map(fn ($row) => [
                'month' => $row->month,
                'crimeType' => $row->crime_type,
                'count' => (int) $row->total,
            ])
            ->values();

        $crimeTypeTotals = Incident::query()->official()
            ->select('crime_type', DB::raw('count(*) as total'))
            ->groupBy('crime_type')
            ->orderByDesc('total')
            ->orderBy('crime_type')
            ->get()
            ->map(fn ($row) => ['crimeType' => $row->crime_type, 'count' => (int) $row->total])
            ->values();

        $categoryTotals = Incident::query()->official()
            ->select('category', DB::raw('count(*) as total'))
            ->groupBy('category')
            ->orderByDesc('total')
            ->orderBy('category')
            ->get()
            ->map(fn ($row) => ['category' => $row->category, 'count' => (int) $row->total])
            ->values();

        return response()->json([
            'meta' => $this->meta('Campaign Planning Module', 'crime-trends'),
            'summary' => [
                'totalIncidents' => (int) $crimeTypeTotals->sum('count'),
                'firstMonth' => $monthly->first()['month'] ?? null,
                'lastMonth' => $monthly->last()['month'] ?? null,
                'monthsWithIncidents' => $monthly->count(),
            ],
            'monthlyTotals' => $monthly,
            'monthlyByCrimeType' => $monthlyByCrimeType,
            'crimeTypeTotals' => $crimeTypeTotals,
            'categoryTotals' => $categoryTotals,
        ]);
    }

    /** Mirrors hotspotRisk() in src/utils/helpers.js. */
    private function riskLevel(int $count, int $threshold, int $highBoundary): string
    {
        if ($count >= $highBoundary) {
            return 'High';
        }

        return $count >= $threshold ? 'Medium' : 'Low';
    }

    private function meta(string $recipient, string $dataset): array
    {
        return [
            'source' => 'CDARS — Barangay 178, North Caloocan',
            'recipient' => $recipient,
            'dataset' => $dataset,
            'deliveryModel' => 'pull',
            'dataScope' => 'Validated, non-archived incidents only',
            'generatedAt' => now()->toIso8601String(),
        ];
    }
}
