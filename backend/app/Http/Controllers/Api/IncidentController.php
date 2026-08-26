<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreIncidentRequest;
use App\Http\Requests\UpdateIncidentRequest;
use App\Http\Resources\IncidentResource;
use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\Incident;
use Illuminate\Http\Request;

class IncidentController extends Controller
{
    /**
     * The statuses that mean "this case is no longer outstanding".
     *
     * Mirrors SOLVED_STATUSES in src/utils/helpers.js, which is what the
     * Dashboard's Solved KPI and Crime Data Collection's "solved" status
     * group count against. Kept here (rather than only on the frontend) so
     * the server can decide for itself when a status change is a genuine
     * resolution and is worth announcing.
     */
    public const RESOLVED_STATUSES = ['Solved', 'Closed'];

    // GET /api/incidents
    public function index(Request $request)
    {
        $query = Incident::query();

        if ($request->filled('sitio')) {
            $query->where('sitio', $request->string('sitio'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->string('status'));
        }
        if ($request->filled('crimeType')) {
            $query->where('crime_type', $request->string('crimeType'));
        }
        if ($request->filled('category')) {
            $query->where('category', $request->string('category'));
        }
        if ($request->filled('date')) {
            $query->whereDate('incident_date', '=', $request->date('date'));
        }
        if ($request->filled('dateFrom')) {
            $query->whereDate('incident_date', '>=', $request->date('dateFrom'));
        }
        if ($request->filled('dateTo')) {
            $query->whereDate('incident_date', '<=', $request->date('dateTo'));
        }
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

        // Same reasoning as announceResolutionIfNewlyResolved() below: the
        // "New Incident" notification is now written from the row that was
        // actually created, instead of being a fixed seeded sentence that
        // referred to nothing in particular.
        $created = $incident->fresh();

        AppNotification::create([
            'title' => 'New Incident',
            'message' => "Case {$created->case_number} ({$created->crime_type}) was logged in {$created->sitio}.",
            'type' => 'info',
            'read' => false,
        ]);

        // fresh() so values the DATABASE supplied are reflected in the 201
        // payload. incidents.status is NOT NULL DEFAULT 'Open', so when the
        // caller omits status the column default is applied by Postgres and
        // the in-memory model still has it as null — the response would
        // otherwise report status: null for a row that actually says 'Open',
        // and DataContext.addRecord() pushes that response straight into the
        // UI. Same pattern already used by archive() below.
        return (new IncidentResource($created))->response()->setStatusCode(201);
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

        // Read BEFORE the write — this is what makes "Case Resolved" a real
        // transition rather than a re-announcement. Saving an already-Solved
        // incident (e.g. correcting a typo in its description) must not emit a
        // second notification, and nothing about an unrelated incident may
        // change as a side effect of this request.
        $statusBefore = $incident->status;

        $incident->update($this->mapToColumns($request->validated()));

        $incident->refresh();

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => "Updated incident {$incident->case_number}",
            'ip_address' => $request->ip(),
        ]);

        $this->announceResolutionIfNewlyResolved($incident, $statusBefore);

        return new IncidentResource($incident);
    }

    /**
     * Emits the "Case Resolved" notification the topbar bell shows, but only
     * on a genuine transition into a resolved status.
     *
     * Why this exists: before this, no code path in the application ever
     * created a Case Resolved notification. The only one that existed was a
     * fixed row written by NotificationSeeder whose message hard-coded the
     * case number CN-2025-0032 — an incident whose real status is assigned at
     * random by IncidentSeeder. So the bell asserted a case had been Solved
     * while the database said otherwise, and clicking through to Crime Data
     * Collection showed that contradiction directly. Meanwhile, actually
     * marking a case Solved produced no notification at all.
     *
     * The message is built from the row that was just written, so the
     * notification can never disagree with the database.
     */
    private function announceResolutionIfNewlyResolved(Incident $incident, ?string $statusBefore): void
    {
        $statusAfter = $incident->status;

        if ($statusAfter === $statusBefore) {
            return;
        }
        if (! in_array($statusAfter, self::RESOLVED_STATUSES, true)) {
            return;
        }
        // Already resolved before this edit (Solved -> Closed): the case was
        // not newly resolved, so there is nothing new to announce.
        if (in_array($statusBefore, self::RESOLVED_STATUSES, true)) {
            return;
        }

        AppNotification::create([
            'title' => 'Case Resolved',
            'message' => "Case {$incident->case_number} ({$incident->crime_type}) was marked as {$statusAfter}.",
            'type' => 'success',
            'read' => false,
        ]);
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
        $user = $request->user();

        // Encoders may only archive records they personally encoded — same
        // rule as update(). BADAC Administrator is unrestricted.
        if ($user?->isEncoder() && $incident->reported_by !== $user->id) {
            return response()->json(['message' => 'Encoders may only archive incidents they personally encoded.'], 403);
        }

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
            if (array_key_exists($from, $v)) {
                $out[$to] = $v[$from];
            }
        }

        return $out;
    }
}
