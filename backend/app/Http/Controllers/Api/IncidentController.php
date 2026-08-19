<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreIncidentRequest;
use App\Http\Requests\UpdateIncidentRequest;
use App\Http\Resources\IncidentResource;
use App\Models\AuditLog;
use App\Models\Incident;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class IncidentController extends Controller
{
    // GET /api/incidents
    public function index(Request $request)
    {
        $query = Incident::query();

        if ($request->filled('sitio')) $query->where('sitio', $request->string('sitio'));
        if ($request->filled('status')) $query->where('status', $request->string('status'));
        if ($request->filled('crimeType')) $query->where('crime_type', $request->string('crimeType'));
        if ($request->filled('category')) $query->where('category', $request->string('category'));
        if ($request->filled('date')) $query->whereDate('incident_date', '=', $request->date('date'));
        if ($request->filled('dateFrom')) $query->whereDate('incident_date', '>=', $request->date('dateFrom'));
        if ($request->filled('dateTo')) $query->whereDate('incident_date', '<=', $request->date('dateTo'));
        if ($request->filled('search')) {
            $q = $request->string('search');
            $query->where(function ($w) use ($q) {
                $w->where('case_number', 'ilike', "%{$q}%")
                    ->orWhere('street', 'ilike', "%{$q}%")
                    ->orWhere('reporting_officer', 'ilike', "%{$q}%")
                    ->orWhere('crime_type', 'ilike', "%{$q}%")
                    ->orWhere('sitio', 'ilike', "%{$q}%");
            });
        }

        $incidents = $query->orderByDesc('incident_date')->orderByDesc('id')->get();

        return IncidentResource::collection($incidents);
    }

    // GET /api/incidents/map — location-only payload for the Leaflet map,
    // scoped to Barangay 178 (all incidents already belong to the barangay).
    public function map()
    {
        $incidents = Incident::query()
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->where('status', '!=', 'Archived')
            ->get(['id', 'crime_type', 'incident_date', 'street', 'sitio', 'status', 'latitude', 'longitude']);

        return $incidents->map(fn ($i) => [
            'id' => (string) $i->id,
            'latitude' => (float) $i->latitude,
            'longitude' => (float) $i->longitude,
            'crimeType' => $i->crime_type,
            'date' => optional($i->incident_date)->format('Y-m-d'),
            'location' => $i->street,
            'sitio' => $i->sitio,
            'status' => $i->status,
        ]);
    }

    // GET /api/incidents/{incident}
    public function show(Incident $incident)
    {
        return new IncidentResource($incident);
    }

    // POST /api/incidents
    public function store(StoreIncidentRequest $request)
    {
        $data = $this->mapToColumns($request->validated());
        $data['incident_code'] = 'INC-'.str_pad((string) (Incident::max('id') + 1), 5, '0', STR_PAD_LEFT);
        $data['reported_by'] = $request->user()?->id;

        $incident = Incident::create($data);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'CREATE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => "Created incident {$incident->case_number}",
            'ip_address' => $request->ip(),
        ]);

        return (new IncidentResource($incident))->response()->setStatusCode(201);
    }

    // PUT /api/incidents/{incident}
    public function update(UpdateIncidentRequest $request, Incident $incident)
    {
        $user = $request->user();

        // Encoders may only correct records they personally encoded — Part
        // H-30 of the RBAC spec. BADAC Administrator is unrestricted.
        if ($user?->isEncoder() && $incident->reported_by !== $user->id) {
            return response()->json(['message' => 'Encoders may only update incidents they personally encoded.'], 403);
        }

        $incident->update($this->mapToColumns($request->validated()));

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => "Updated incident {$incident->case_number}",
            'ip_address' => $request->ip(),
        ]);

        return new IncidentResource($incident);
    }

    // PUT /api/incidents/{incident}/archive — Checkpoint 20 (Tasks 2-4).
    // Replaces the old physical-delete destroy() action. Sets status to
    // 'Archived' instead of removing the row; does NOT call ->delete().
    // The exact same ownership rule that gated the old DELETE action is
    // preserved verbatim (Encoder may only archive incidents they
    // personally encoded; BADAC Administrator is unrestricted). This check
    // happens server-side regardless of what the frontend sends; the
    // frontend hiding the button is a UX nicety only.
    //
    // Note: AnalyticsController::baseQuery() already excludes
    // status != 'Archived' from every statistic, and the incidents /map
    // endpoint already excludes Archived incidents (see map() above) — both
    // predate this checkpoint and needed no change.
    public function archive(Request $request, Incident $incident)
    {
        // Route is now role:badac_admin only (see routes/api.php) — Encoder
        // can no longer reach this action, so no ownership check is needed
        // here anymore.
        $incident->update(['status' => 'Archived']);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'ARCHIVE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => "Archived incident {$incident->case_number}",
            'ip_address' => $request->ip(),
        ]);

        return new IncidentResource($incident->fresh());
    }

    private function mapToColumns(array $v): array
    {
        $map = [
            'caseNumber' => 'case_number', 'crimeType' => 'crime_type', 'category' => 'category',
            'date' => 'incident_date', 'time' => 'incident_time', 'street' => 'street', 'sitio' => 'sitio',
            'latitude' => 'latitude', 'longitude' => 'longitude',
            'victimName' => 'victim_name', 'victimAge' => 'victim_age', 'victimGender' => 'victim_gender',
            'suspectName' => 'suspect_name', 'suspectAge' => 'suspect_age',
            'reportingOfficer' => 'reporting_officer', 'investigatingOfficer' => 'investigating_officer',
            'badgeNumber' => 'badge_number', 'unit' => 'unit', 'status' => 'status', 'priority' => 'priority',
            'description' => 'description', 'evidence' => 'evidence',
        ];

        $out = [];
        foreach ($map as $from => $to) {
            if (array_key_exists($from, $v)) $out[$to] = $v[$from];
        }

        return $out;
    }
}
