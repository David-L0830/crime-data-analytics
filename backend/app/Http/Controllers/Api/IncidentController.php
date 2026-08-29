<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreIncidentRequest;
use App\Http\Requests\UpdateIncidentRequest;
use App\Http\Resources\IncidentResource;
use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

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

        $incidents = $query->with('evidenceItems')->orderByDesc('incident_date')->orderByDesc('id')->get();

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
            ->get([
                'id', 'case_number', 'crime_type', 'incident_date', 'incident_time',
                'street', 'sitio', 'status', 'priority', 'latitude', 'longitude',
            ]);

        // Case number, time and priority are included because the map popup
        // shows them. Victim, complainant and suspect details deliberately are
        // NOT in this payload: a map pin is a location, and identifying a
        // named individual by a dot on screen is exactly the disclosure this
        // module has to avoid.
        return $incidents->map(fn ($i) => [
            'id' => (string) $i->id,
            'latitude' => (float) $i->latitude,
            'longitude' => (float) $i->longitude,
            'caseNumber' => $i->case_number,
            'crimeType' => $i->crime_type,
            'date' => optional($i->incident_date)->format('Y-m-d'),
            'time' => $i->incident_time ? substr($i->incident_time, 0, 5) : null,
            'location' => $i->street,
            'sitio' => $i->sitio,
            'status' => $i->status,
            'priority' => $i->priority,
        ]);
    }

    // GET /api/incidents/{incident}
    public function show(Incident $incident)
    {
        return new IncidentResource($incident->load('evidenceItems'));
    }

    // POST /api/incidents
    public function store(StoreIncidentRequest $request)
    {
        $validated = $request->validated();
        $data = $this->mapToColumns($validated);
        $data['reported_by'] = $request->user()?->id;

        // incident_code is NOT NULL UNIQUE and the id it names does not exist
        // until the insert has happened, so the row goes in carrying a
        // placeholder that is replaced from its own id a statement later,
        // inside the same transaction. Nothing outside the transaction can
        // observe the placeholder, and a rollback takes it with it.
        $data['incident_code'] = 'TMP-'.Str::uuid()->toString();

        // The incident, its evidence items and its audit entry are ONE unit of
        // work. Before this they were three unwrapped statements, so a failure
        // partway through (a rejected evidence row, say) left a committed
        // incident behind while the caller was told the save had failed —
        // the encoder then re-entered the case and got a duplicate-case-number
        // error for a record they could not see.
        $incident = DB::transaction(function () use ($request, $data, $validated) {
            $incident = Incident::create($data);

            $incident->forceFill([
                'incident_code' => $this->mintIncidentCode($incident->id),
            ])->save();

            // Structured evidence (Evidence ID + Description), written only when
            // the caller sent the field at all - see syncEvidence().
            $this->syncEvidence($request, $incident, $validated);

            AuditLog::create([
                'user_id' => $request->user()?->id,
                'action' => 'CREATE',
                'module' => 'incidents',
                'target_type' => 'incident',
                'description' => "Created incident {$incident->case_number}",
                'ip_address' => $request->ip(),
            ]);

            return $incident;
        });

        $created = $incident->fresh()->load('evidenceItems');

        // Announced only now, OUTSIDE and AFTER the transaction. That ordering
        // is the guarantee that a notification can never describe an incident
        // that was not actually saved: if the transaction above rolls back,
        // this line is never reached.
        $this->announceNewIncident($created, $request->user());

        // fresh() so values the DATABASE supplied are reflected in the 201
        // payload. incidents.status is NOT NULL DEFAULT 'Open', so when the
        // caller omits status the column default is applied by Postgres and
        // the in-memory model still has it as null — the response would
        // otherwise report status: null for a row that actually says 'Open',
        // and DataContext.addRecord() pushes that response straight into the
        // UI. Same pattern already used by archive() below.
        return (new IncidentResource($created))->response()->setStatusCode(201);
    }

    /**
     * The human-facing code for an incident, derived from the row it names.
     *
     * This used to be 'INC-'.(max(id) + 1), read outside the transaction — a
     * PREDICTION of the id, made before the row existed, under no lock. Two
     * simultaneous creates read the same max(id), computed the same code and
     * the second one violated incidents_incident_code_unique, so an encoder got
     * a 500 and lost the case they had just typed. Worse, it did not recover:
     * the failed insert rolls back, so max(id) never advances, and every retry
     * recomputed the same colliding code — the endpoint stayed on 500 until a
     * row was added by some other means.
     *
     * Deriving from the row's own id removes the race by construction rather
     * than by retrying: ids are unique, so no two concurrent transactions can
     * ever want the same code. The only collision still possible is with a
     * legacy row that already holds this id's code, and that is static data
     * rather than a competitor — which is why reading it here is safe.
     *
     * Such a legacy row gets the suffix treatment syncEvidence() has always
     * applied to a repeated evidence reference (EV-001 -> EV-001-2), so the
     * code still names its row and the save still succeeds.
     */
    private function mintIncidentCode(int $id): string
    {
        $base = 'INC-'.str_pad((string) $id, 5, '0', STR_PAD_LEFT);
        $candidate = $base;
        $suffix = 1;

        while (Incident::where('incident_code', $candidate)->whereKeyNot($id)->exists()) {
            $suffix++;
            $candidate = $base.'-'.$suffix;
        }

        return $candidate;
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

        $this->syncEvidence($request, $incident, $request->validated());

        $incident->refresh()->load('evidenceItems');

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
     * Announces a newly recorded incident on the topbar bell.
     *
     * Deliberately called AFTER the creating transaction commits (see store()),
     * so the announcement can only ever describe a case that really exists.
     * Exactly one notification is written per created incident — "incident",
     * "case" and "record" are the same entity in this system, so a single
     * action must not fan out into three announcements.
     *
     * The message is built from the committed row plus the acting user, and
     * carries what the bell needs to be useful without opening the case: the
     * case number, what happened, and where. Nothing here identifies a victim,
     * a complainant or a suspect — the notification is visible to every role,
     * including read-only BADAC accounts, and naming a private individual in
     * it would disclose more than the recipient needs in order to decide
     * whether to open the record.
     *
     * A failure to announce must never turn a SUCCESSFUL save into an error
     * response, which is why this swallows and logs instead of throwing: the
     * crime record is the artefact that matters, the bell is a convenience.
     */
    private function announceNewIncident(Incident $incident, ?User $actor): void
    {
        try {
            AppNotification::create([
                'title' => 'New Incident',
                'message' => sprintf(
                    'Case %s (%s) was logged in %s by %s.',
                    $incident->case_number,
                    $incident->crime_type,
                    $incident->sitio ?: 'an unspecified location',
                    $actor?->name ?: 'the system'
                ),
                'type' => 'info',
                // No audience restriction: every role can open Crime Data
                // Collection, so a new incident is relevant to all of them.
                'audience_roles' => null,
                'read' => false,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Incident saved but its notification could not be written', [
                'incident_id' => $incident->id,
                'case_number' => $incident->case_number,
                'error' => $e->getMessage(),
            ]);
        }
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

        return new IncidentResource($incident->fresh()->load('evidenceItems'));
    }

    private function mapToColumns(array $v): array
    {
        $map = [
            'caseNumber' => 'case_number', 'crimeType' => 'crime_type', 'category' => 'category',
            'date' => 'incident_date', 'time' => 'incident_time', 'street' => 'street', 'sitio' => 'sitio',
            'latitude' => 'latitude', 'longitude' => 'longitude',
            'victimName' => 'victim_name', 'victimAge' => 'victim_age', 'victimGender' => 'victim_gender',
            'suspectName' => 'suspect_name', 'suspectAge' => 'suspect_age',
            'complainantIsVictim' => 'complainant_is_victim',
            'complainantName' => 'complainant_name',
            'complainantRelationship' => 'complainant_relationship',
            'complainantContact' => 'complainant_contact',
            'complainantAddress' => 'complainant_address',
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

        // "The complainant IS the victim" means there is no separate
        // complainant, so no separate complainant details may be stored.
        // Clearing them here (rather than trusting the form to send blanks) is
        // what stops a record from keeping a stale second person's name and
        // phone number after somebody ticks the box - data the barangay has no
        // basis to hold once it has been said not to apply.
        if (array_key_exists('complainant_is_victim', $out) && $out['complainant_is_victim']) {
            $out['complainant_name'] = null;
            $out['complainant_relationship'] = null;
            $out['complainant_contact'] = null;
            $out['complainant_address'] = null;
        }

        return $out;
    }

    /**
     * Replaces an incident's evidence list with what was submitted.
     *
     * Only runs when `evidenceItems` was actually present in the validated
     * payload. That distinction matters for PUT: an edit that never touches
     * evidence (correcting a typo in the description, changing a status) must
     * leave the existing evidence rows alone, not delete them because the
     * request happened not to mention them.
     *
     * @param  array<string, mixed>  $validated
     */
    private function syncEvidence(Request $request, Incident $incident, array $validated): void
    {
        if (! array_key_exists('evidenceItems', $validated)) {
            return;
        }

        $items = collect($validated['evidenceItems'] ?? [])
            ->map(fn ($item) => [
                'evidence_code' => trim((string) ($item['evidenceId'] ?? '')),
                'description' => trim((string) ($item['description'] ?? '')),
            ])
            // A row with neither an id nor a description is an empty form row,
            // not evidence.
            ->filter(fn ($item) => $item['evidence_code'] !== '' || $item['description'] !== '')
            ->values();

        $existingCount = $incident->evidenceItems()->count();
        $incident->evidenceItems()->delete();

        $seq = 0;
        $used = [];
        foreach ($items as $item) {
            $seq++;
            $code = $item['evidence_code'];
            if ($code === '') {
                // Auto-numbered when the encoder leaves the reference blank,
                // so an evidence item always has an identifier to cite.
                $code = 'EV-'.str_pad((string) $seq, 3, '0', STR_PAD_LEFT);
            }
            // The (incident_id, evidence_code) unique index would reject a
            // repeated reference; suffix it rather than failing the whole save.
            $candidate = $code;
            $suffix = 1;
            while (in_array($candidate, $used, true)) {
                $suffix++;
                $candidate = $code.'-'.$suffix;
            }
            $used[] = $candidate;

            $incident->evidenceItems()->create([
                'evidence_code' => $candidate,
                'description' => $item['description'] !== '' ? $item['description'] : $candidate,
            ]);
        }

        if ($existingCount === 0 && $items->isEmpty()) {
            return;
        }

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'incidents',
            'target_type' => 'evidence',
            'description' => "Recorded {$items->count()} evidence item(s) for incident {$incident->case_number}",
            'ip_address' => $request->ip(),
        ]);
    }
}
