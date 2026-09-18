<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreIncidentRequest;
use App\Http\Requests\UpdateIncidentRequest;
use App\Http\Resources\IncidentResource;
use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\Incident;
use App\Models\Setting;
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

    /**
     * Relations every IncidentResource response carries: the evidence list,
     * and the names of whoever validated or returned the record. Loaded with
     * only id + name so no other user column leaves the server.
     */
    private const DETAIL_RELATIONS = ['evidenceItems', 'validator:id,name', 'returner:id,name'];

    // GET /api/incidents
    public function index(Request $request)
    {
        $query = Incident::query();

        if ($request->filled('validationStatus')) {
            $query->where('validation_status', $request->string('validationStatus'));
        }

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

        $incidents = $query->with(self::DETAIL_RELATIONS)->orderByDesc('incident_date')->orderByDesc('id')->get();

        return IncidentResource::collection($incidents);
    }

    // GET /api/incidents/map — location-only payload for the Leaflet map,
    // scoped to Barangay 178 (all incidents already belong to the barangay).
    public function map()
    {
        $incidents = Incident::query()
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            // CP-5A — the map shows OFFICIAL data. Only a validated,
            // non-archived record is official (Phase 2B), so a pending or
            // returned incident is not plotted: a pin on a map projected in
            // the barangay hall asserts that a crime happened there, and an
            // unreviewed encoding has not earned that yet.
            //
            // Filtered here rather than by handing validation_status to the
            // client, which would put a workflow field into a payload whose
            // whole rule is that it carries the minimum the map needs. The
            // projection below is unchanged.
            ->official()
            ->get([
                'id', 'incident_code', 'case_number', 'crime_type', 'category',
                'incident_date', 'incident_time',
                'street', 'sitio', 'status', 'priority', 'latitude', 'longitude',
            ]);

        // Case number, time and priority are included because the map popup
        // shows them, and incident_code and category joined them when the popup
        // became a hover tooltip — both identify and classify a case without
        // naming anybody. Victim, complainant and suspect details deliberately
        // are NOT in this payload: a map pin is a location, and identifying a
        // named individual by a dot on screen is exactly the disclosure this
        // module has to avoid. That rule is what bounds this list, not the
        // convenience of whoever adds the next field.
        return $incidents->map(fn ($i) => [
            'id' => (string) $i->id,
            'latitude' => (float) $i->latitude,
            'longitude' => (float) $i->longitude,
            'incidentCode' => $i->incident_code,
            'caseNumber' => $i->case_number,
            'category' => $i->category,
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
        return new IncidentResource($incident->load(self::DETAIL_RELATIONS));
    }

    // POST /api/incidents
    public function store(StoreIncidentRequest $request)
    {
        $validated = $request->validated();
        $data = $this->mapToColumns($validated);
        $data['reported_by'] = $request->user()?->id;

        // Every new record, whoever submits it, awaits Administrator review.
        // Set explicitly rather than left to the column default so the rule
        // is visible here and cannot drift if that default ever changes.
        $data['validation_status'] = Incident::VALIDATION_PENDING;

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

        $created = $incident->fresh()->load(self::DETAIL_RELATIONS);

        // Announced only now, OUTSIDE and AFTER the transaction. That ordering
        // is the guarantee that a notification can never describe an incident
        // that was not actually saved: if the transaction above rolls back,
        // this line is never reached.
        //
        // "New Incident" is workflow signalling — a record was filed and needs
        // review — so it belongs here and stays here.
        //
        // The HOTSPOT alert deliberately does NOT. It is an analytic claim, and
        // this method forces validation_status to pending above, so a create
        // cannot move the official count at all: announcing here meant the
        // alert could only ever be computed from unreviewed encodings. It now
        // fires where the official count actually changes — see
        // announceHotspotIfCrossed() and its callers in approve()/restore().
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

        $columns = $this->mapToColumns($request->validated());

        // The edit, its evidence and its audit entry are one unit of work, and
        // the validation decision is made against the row as it is NOW, not as
        // route model binding loaded it.
        //
        // Why the lock: `$incident` was read before this request reached the
        // controller. If an Administrator validated the record in between, a
        // decision taken from that stale copy would see "pending", skip the
        // reset, and — because Eloquent writes only changed columns — leave
        // the Administrator's 'validated' untouched on content they never
        // reviewed. lockForUpdate() re-reads the row and holds it until commit,
        // so approve()/returnForCorrection(), whose conditional UPDATEs need
        // the same row lock, run strictly before (and are seen here) or
        // strictly after (and then review the edited content).
        [$incident, $statusBefore] = DB::transaction(function () use ($request, $incident, $user, $columns) {
            $locked = Incident::whereKey($incident->getKey())->lockForUpdate()->firstOrFail();

            // Read BEFORE the write — this is what makes "Case Resolved" a real
            // transition rather than a re-announcement. Saving an already-Solved
            // incident (e.g. correcting a typo in its description) must not emit
            // a second notification, and nothing about an unrelated incident may
            // change as a side effect of this request.
            $statusBefore = $locked->status;

            // Any MATERIAL edit is a (re)submission: the changed record has
            // not been reviewed in the shape it is now in, so it goes back to
            // pending. Who made the edit does not enter into it — an
            // Administrator editing a record they approved is editing content
            // nobody has reviewed since, exactly as an Encoder is. A returned
            // record corrected this way is how it re-enters the review queue.
            // The previous correction reason is kept so the reviewer can still
            // see what was asked for.
            //
            // `status` is the ONE exempt field. Moving a case Open -> Under
            // Investigation -> Solved is case progress, not a change to what
            // was recorded about the crime, and it must not drop the record out
            // of official data until somebody re-approves it.
            //
            // Computed BEFORE the validation and last_edited_by columns are
            // appended below, so the bookkeeping this decision writes can never
            // feed back into the decision itself.
            $materiallyChanged = $this->hasMaterialChange($locked, $columns)
                || $this->evidenceSetChanged($locked, $request->validated());

            // The validation columns are appended here, after mapToColumns(),
            // so nothing the client sent can supply or override them.
            $resubmitted = $materiallyChanged
                && $locked->validation_status !== Incident::VALIDATION_PENDING;
            if ($resubmitted) {
                $columns['validation_status'] = Incident::VALIDATION_PENDING;
                $columns['validated_by'] = null;
                $columns['validated_at'] = null;
            }

            // This endpoint is the one place incident CONTENT changes, for the
            // Administrator and for the Encoder correcting their own record
            // alike, so it is the one place that records who changed it.
            // approve(), returnForCorrection(), archive() and restore() change
            // workflow or lifecycle state and deliberately leave this alone.
            //
            // Appended here, after mapToColumns(), for the same reason as the
            // validation columns above: nothing the client sent can supply or
            // override it. The value comes from the authenticated session and
            // from nowhere else.
            $columns['last_edited_by'] = $user?->id;

            $locked->update($columns);

            $this->syncEvidence($request, $locked, $request->validated());

            AuditLog::create([
                'user_id' => $request->user()?->id,
                'action' => 'UPDATE',
                'module' => 'incidents',
                'target_type' => 'incident',
                'description' => $resubmitted
                    ? "Updated incident {$locked->case_number} and resubmitted it for validation"
                    : "Updated incident {$locked->case_number}",
                'ip_address' => $request->ip(),
            ]);

            return [$locked, $statusBefore];
        });

        $incident->refresh()->load(self::DETAIL_RELATIONS);

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
     * including BADAC Validator accounts, and naming a private individual in
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
     * Emits the "Hotspot Alert" notification when the transition just committed
     * is the one that turns its sitio into a hotspot.
     *
     * Why this exists: before this, no code path in the application ever
     * created a Hotspot Alert. The only one that existed was a fixed row
     * written by NotificationSeeder reading "Sitio 4 has exceeded the hotspot
     * threshold this week" — asserted unconditionally, naming one specific
     * sitio, and backed by nothing. It was the single entry in that seeder
     * breaking the seeder's own rule that it skips any notification it cannot
     * back with an actual row. Same shape as the CN-2025-0032 problem that
     * announceResolutionIfNewlyResolved() below was written to fix, and fixed
     * the same way: the message is built from the rows actually counted, so the
     * bell cannot disagree with the database.
     *
     * WHY IT COUNTS OFFICIAL RECORDS, AND WHY IT IS NOT CALLED FROM store()
     * ---------------------------------------------------------------------
     * It used to be called from store(), counting every non-archived incident.
     * CP-5A made "validated and not archived" the rule for every figure people
     * act on, and that left this announcement asserting something no other
     * surface agreed with: a Hotspot Alert routes straight to the Trends
     * Hotspots panel (see notificationRouting.js), whose table CP-5A made
     * validated-only — so the bell could announce a sitio the panel showed as
     * empty, and it escapes the app as a desktop notification while doing it.
     *
     * Worse, store() forces validation_status to pending, so a create can
     * never change the official count. The one place this fired was the one
     * place the figure provably could not move.
     *
     * So it now counts OFFICIAL records via Incident::scopeOfficial(), and it
     * is called from the two transitions that can actually raise that count:
     *
     *   approve()  pending|returned -> validated   (+1)
     *   restore()  archived+validated -> active+validated  (+1)
     *
     * The transitions that LOWER it — archive(), returnForCorrection(), and an
     * update() material edit sending a record back to pending — need no call:
     * they cannot cross a threshold upwards, and because this compares counts
     * rather than recording that an alert was sent, a sitio that recedes below
     * the threshold and climbs again correctly crosses again.
     *
     * Only the CROSSING announces. The count is read AFTER the commit, so the
     * record that just became official is included; the count before it is
     * therefore one lower, and comparing both against the threshold isolates
     * the single transition that takes a sitio from below it to meeting it.
     * Without that, every later approval in a qualifying sitio would announce
     * again — and with a default threshold of 3 most sitios qualify quickly, so
     * the bell would turn into noise.
     *
     * The `- 1` is DERIVED, not measured, so it is only sound while every
     * caller moves exactly one record into the official set. Both callers do:
     * approve() and restore() each perform a single conditional UPDATE that
     * either changes one row or reports that nothing changed. Do not call this
     * from anywhere that can shift the count by more than one.
     *
     * Known limitation, unchanged from the store() version and inherent to
     * deriving the before-count: two approvals into the same sitio committing
     * simultaneously can both read the post-both count, see a before-count at
     * or above the threshold, and both stay silent. The race can MISS an alert;
     * it cannot produce a duplicate. Fixing it would need persisted per-sitio
     * state, which this deliberately does not have.
     *
     * Expressed as two comparisons rather than the equivalent
     * `$countAfter === $threshold` because the two-sided form is what the rule
     * actually says, and it stays correct for a threshold of 0 or less — a
     * sitio that was never below the threshold never crosses it.
     */
    private function announceHotspotIfCrossed(Incident $incident): void
    {
        try {
            if (! $incident->sitio) {
                return;
            }

            $threshold = (int) Setting::current()->hotspot_threshold;

            // scopeOfficial() rather than a condition written out here: this is
            // the same "validated and not archived" rule the map, the reports
            // and the analytics endpoints apply, and it being one definition is
            // what stops this announcement drifting away from them again.
            $countAfter = Incident::query()
                ->official()
                ->where('sitio', $incident->sitio)
                ->count();
            $countBefore = $countAfter - 1;

            if (! ($countBefore < $threshold && $countAfter >= $threshold)) {
                return;
            }

            AppNotification::create([
                'title' => 'Hotspot Alert',
                'message' => sprintf(
                    // "validated incidents", not "active incidents": the figure
                    // quoted is the official count, and the message has to say
                    // which count it is or it invites the reader to compare it
                    // against a number nothing computes.
                    '%s has reached %d validated incidents, meeting the hotspot threshold of %d.',
                    $incident->sitio,
                    $countAfter,
                    $threshold
                ),
                'type' => 'warning',
                // No audience restriction, matching the New Incident
                // announcement: a hotspot concerns every role that can open the
                // module.
                'audience_roles' => null,
                'read' => false,
            ]);
        } catch (\Throwable $e) {
            // Same isolation as announceNewIncident(): the transition is already
            // committed and the caller has been told it succeeded, so a failure
            // to announce must not turn a successful validation or restore into
            // an error.
            Log::warning('Incident transition saved but its hotspot alert could not be written', [
                'incident_id' => $incident->id,
                'sitio' => $incident->sitio,
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

        // Same guard as CriminalController::archive() / VictimController::archive():
        // a second archive would capture 'Archived' as previous_status and
        // permanently destroy the real one, which is exactly what restore()
        // exists to prevent.
        if ($incident->status === 'Archived') {
            return response()->json(['message' => 'This incident is already archived.'], 422);
        }

        // Capture the meaningful pre-archive status (Open, Under Investigation,
        // Solved, Closed) before overwriting it, so restore() can put it back
        // exactly rather than guessing. Written in the same update() as the
        // status change so the two can never disagree.
        $incident->update([
            'previous_status' => $incident->status,
            'status' => 'Archived',
        ]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'ARCHIVE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => "Archived incident {$incident->case_number}",
            'ip_address' => $request->ip(),
        ]);

        return new IncidentResource($incident->fresh()->load(self::DETAIL_RELATIONS));
    }

    // PUT /api/incidents/{incident}/restore — the exact inverse of archive(),
    // mirroring CriminalController::restore() / VictimController::restore().
    // Registered in the same role:badac_admin,encoder group as archive() in
    // routes/api.php, and carries the identical per-record ownership rule:
    // "whoever may archive may restore."
    public function restore(Request $request, Incident $incident)
    {
        $user = $request->user();

        if ($user?->isEncoder() && $incident->reported_by !== $user->id) {
            return response()->json(['message' => 'Encoders may only restore incidents they personally encoded.'], 403);
        }

        if ($incident->status !== 'Archived') {
            return response()->json(['message' => 'Only archived incidents can be restored.'], 422);
        }

        // previous_status can legitimately be null — an incident archived
        // before this column existed, or one archived through the general
        // PUT /incidents/{id} status back door, which never passes through
        // archive(). Both fall back to DEFAULT_STATUS rather than writing
        // null (which would violate the NOT NULL column) or an unrecognised
        // status (which would then be unreachable through the Status filter).
        $previous = $incident->previous_status;
        $restored = in_array($previous, Incident::RESTORABLE_STATUSES, true)
            ? $previous
            : Incident::DEFAULT_STATUS;

        $incident->update([
            'status' => $restored,
            'previous_status' => null,
        ]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'RESTORE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => "Restored incident {$incident->case_number} to {$restored}",
            'ip_address' => $request->ip(),
        ]);

        $active = $incident->fresh();

        // Restoring is the OTHER way a sitio's official count goes up: an
        // archived record that was already validated re-enters official data
        // the moment it stops being archived, without anybody validating
        // anything. A sitio can therefore become a hotspot here.
        //
        // ONLY when the record is validated, and this condition is load-bearing
        // rather than an optimisation. announceHotspotIfCrossed() derives the
        // before-count as `countAfter - 1`, which is only true if the caller
        // moved exactly one record into the official set. Restoring a PENDING
        // or RETURNED record leaves the official count untouched, so the
        // derived before-count would be one too low — and a sitio already
        // sitting exactly at the threshold would announce a second time for a
        // transition that changed nothing.
        //
        // The guard above already refused anything that was not archived, so
        // reaching here means this record genuinely just left the archive.
        if ($active->validation_status === Incident::VALIDATION_VALIDATED) {
            $this->announceHotspotIfCrossed($active);
        }

        return new IncidentResource($active->load(self::DETAIL_RELATIONS));
    }

    // PUT /api/incidents/{incident}/validate — BADAC Administrator or BADAC
    // Validator.
    //
    // Authorization is the role:badac_admin,badac_validator middleware on the
    // route (see routes/api.php); an Encoder is refused with a 403 before this
    // runs, whatever the frontend shows. The check below repeats it inside the
    // action itself so the rule survives the route ever being regrouped.
    //
    // The transition is a single conditional UPDATE rather than read-then-
    // write, so two Administrators acting at once cannot both "win": the
    // second finds no row still in a validatable state and gets a 422.
    public function approve(Request $request, Incident $incident)
    {
        $user = $request->user();
        if (! $user?->canValidateRecords()) {
            return response()->json(['message' => 'Only a BADAC Administrator or BADAC Validator may validate records.'], 403);
        }

        if ($incident->status === 'Archived') {
            return response()->json(['message' => 'Archived incidents cannot be validated. Restore it first.'], 422);
        }

        // Nobody validates their own submission. Validation is a second pair of
        // eyes, and a record approved by the person who filed it has had one
        // pair looking twice — the review would attest to nothing.
        //
        // Applies to the Administrator as well as the Validator. The
        // Administrator is unrestricted everywhere else in this controller, and
        // is deliberately NOT unrestricted here: being senior is what makes an
        // unreviewed record look reviewed.
        //
        // 403 and a strict comparison against reported_by, the same shape as
        // the Encoder ownership guards in update()/archive()/restore() above.
        // A record with no reported_by (an imported or seeded row) matches
        // nobody, so it stays validatable — a null creator is an absent one,
        // not the caller.
        if ($incident->reported_by === $user->id) {
            return response()->json(['message' => 'You cannot validate an incident you submitted yourself. Another BADAC Administrator or BADAC Validator must review it.'], 403);
        }

        // The other way to end up reviewing your own words. An Administrator
        // holds edit_any_record, so they can rewrite somebody else's record and
        // then approve it — the submitter is a different person, so the guard
        // above lets it through, but the content under review is the
        // reviewer's. last_edited_by is what makes that visible; see the
        // add_last_edited_by_to_incidents_table migration for why it is a
        // column rather than something derived from audit_logs.
        //
        // Null again matches nobody: a record nobody has edited since the
        // column existed is reviewed on its creator alone.
        //
        // Note this does NOT permanently bind a reviewer to a record. If B
        // edits and returns it and then A corrects it, A's correction takes
        // over last_edited_by and B may validate — B is then reviewing A's
        // words, which is exactly what review is.
        if ($incident->last_edited_by === $user->id) {
            return response()->json(['message' => 'You cannot validate an incident you last edited. Another BADAC Administrator or BADAC Validator must review it.'], 403);
        }

        $updated = DB::transaction(function () use ($request, $incident, $user) {
            $changed = Incident::whereKey($incident->id)
                ->where('status', '!=', 'Archived')
                ->where('validation_status', '!=', Incident::VALIDATION_VALIDATED)
                ->update([
                    'validation_status' => Incident::VALIDATION_VALIDATED,
                    'validated_by' => $user->id,
                    'validated_at' => now(),

                    // The return state is cleared by the same statement that
                    // sets the validated state, so a validated row can never
                    // also carry a return.
                    //
                    // Without this a record that had been sent back kept
                    // returned_by, returned_at and correction_reason after it
                    // was approved — and IncidentResource exposes all three, so
                    // the modal showed "Validated by X" above the reason it had
                    // been rejected for. The record contradicted itself.
                    //
                    // Cleared unconditionally rather than only for a row that
                    // is currently 'returned'. The other way into this state is
                    // a returned record the Encoder corrects: update() resets it
                    // to pending and deliberately KEEPS correction_reason so the
                    // reviewer can see what was asked for. That is right while
                    // the record is pending, and wrong the moment it is
                    // approved, and this clause covers both paths with one rule.
                    'returned_by' => null,
                    'returned_at' => null,
                    'correction_reason' => null,

                    'updated_at' => now(),
                ]);

            if ($changed === 0) {
                return false;
            }

            AuditLog::create([
                'user_id' => $user->id,
                'action' => 'VALIDATE',
                'module' => 'incidents',
                'target_type' => 'incident',
                'description' => "Validated incident {$incident->case_number}",
                'ip_address' => $request->ip(),
            ]);

            return true;
        });

        if (! $updated) {
            return response()->json(['message' => 'This incident is already validated.'], 422);
        }

        // OUTSIDE and AFTER the transaction, exactly as store() announces: if
        // the update above rolled back, this line is never reached, so the bell
        // cannot describe a validation that did not happen.
        //
        // Reached only when $changed was 1 — the conditional UPDATE above moves
        // exactly one record into the official set, and a second attempt on the
        // same record returns the 422 instead. That is what makes this
        // exactly-once per genuine transition without any dedup state, and what
        // keeps announceHotspotIfCrossed()'s `countAfter - 1` sound.
        $validated = $incident->fresh();
        $this->announceHotspotIfCrossed($validated);

        return new IncidentResource($validated->load(self::DETAIL_RELATIONS));
    }

    // PUT /api/incidents/{incident}/return — BADAC Administrator or BADAC
    // Validator, authorized exactly as approve() above.
    //
    // Sends a record back to its encoder with a required reason. Allowed from
    // pending AND from validated: an Administrator who finds an error in an
    // already-validated record must be able to withdraw that validation, and
    // doing so clears validated_by/validated_at so the record stops presenting
    // itself as official. The reason is stored on the row (so the encoder sees
    // what to fix) and copied into the audit description (so the trail keeps
    // it even after a later return overwrites the column).
    public function returnForCorrection(Request $request, Incident $incident)
    {
        $user = $request->user();
        if (! $user?->canValidateRecords()) {
            return response()->json(['message' => 'Only a BADAC Administrator or BADAC Validator may return records for correction.'], 403);
        }

        $data = $request->validate([
            'reason' => ['required', 'string', 'min:5', 'max:1000'],
        ]);
        $reason = trim($data['reason']);

        if ($incident->status === 'Archived') {
            return response()->json(['message' => 'Archived incidents cannot be returned for correction. Restore it first.'], 422);
        }

        $updated = DB::transaction(function () use ($request, $incident, $user, $reason) {
            $changed = Incident::whereKey($incident->id)
                ->where('status', '!=', 'Archived')
                ->where('validation_status', '!=', Incident::VALIDATION_RETURNED)
                ->update([
                    'validation_status' => Incident::VALIDATION_RETURNED,
                    'validated_by' => null,
                    'validated_at' => null,
                    'returned_by' => $user->id,
                    'returned_at' => now(),
                    'correction_reason' => $reason,
                    'updated_at' => now(),
                ]);

            if ($changed === 0) {
                return false;
            }

            AuditLog::create([
                'user_id' => $user->id,
                'action' => 'RETURN',
                'module' => 'incidents',
                'target_type' => 'incident',
                'description' => "Returned incident {$incident->case_number} for correction: {$reason}",
                'ip_address' => $request->ip(),
            ]);

            return true;
        });

        if (! $updated) {
            return response()->json(['message' => 'This incident has already been returned for correction.'], 422);
        }

        return new IncidentResource($incident->fresh()->load(self::DETAIL_RELATIONS));
    }

    /**
     * The only column whose change does NOT send a record back for review.
     *
     * Case status is progress ON a record, not a change TO what was recorded
     * about the crime. Everything else mapToColumns() can write — including
     * priority, investigating_officer, reporting_officer, badge_number and
     * unit — is crime data and does trigger revalidation.
     */
    private const REVALIDATION_EXEMPT_COLUMNS = ['status'];

    /**
     * Did this request actually change the recorded crime data?
     *
     * Decided by comparing VALUES, never by which keys arrived. The edit form
     * posts the entire record on every save (IncidentModal's handleSubmit
     * spreads the whole form), so "the client sent `sitio`" says nothing about
     * whether `sitio` changed. Deciding on key presence would mark every save
     * material and revalidate records nobody had really edited.
     */
    private function hasMaterialChange(Incident $locked, array $columns): bool
    {
        foreach ($columns as $column => $value) {
            if (in_array($column, self::REVALIDATION_EXEMPT_COLUMNS, true)) {
                continue;
            }

            $submitted = $this->comparableValue($column, $value);
            $stored = $this->comparableValue($column, $locked->getRawOriginal($column));

            if ($submitted !== $stored) {
                return true;
            }
        }

        return false;
    }

    /**
     * One column's value reduced to the form in which two sides can honestly
     * be compared, or null for "no value".
     *
     * Three normalisations, each for a difference that is presentational only
     * and would otherwise revalidate a record on every save:
     *
     *  - EMPTY. The edit form seeds its inputs with `incident.field || ''`, so
     *    a NULL column comes back as an empty string. Collapsing both to null
     *    keeps "still empty" from reading as a change.
     *  - TIME. incidents.incident_time is `time without time zone`, so the
     *    database returns '14:30:00' while the form posts the '14:30' that
     *    IncidentResource gave it. Compared to the minute, which is the
     *    precision the application actually records.
     *  - CASTS. latitude/longitude are decimal:7, incident_date is date:Y-m-d,
     *    the ages are integers and complainant_is_victim is a boolean. Both
     *    sides are round-tripped through the model's own cast pipeline, so
     *    14.75 and '14.7500000' — or '2026-05-10' and a date-time — compare
     *    equal because they are equal.
     */
    private function comparableValue(string $column, mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($column === 'incident_time') {
            return substr((string) $value, 0, 5);
        }

        // setRawAttributes() then attributesToArray() applies exactly the casts
        // the model declares, and nothing else: the probe holds one attribute,
        // is never saved, and Incident declares no accessors or $appends that
        // could reach for a column that is not there.
        $probe = new Incident;
        $probe->setRawAttributes([$column => $value]);
        $normalized = $probe->attributesToArray()[$column] ?? null;

        if ($normalized === null) {
            return null;
        }

        if (is_bool($normalized)) {
            return $normalized ? '1' : '0';
        }

        return (string) $normalized;
    }

    /**
     * Did the evidence attached to this incident change?
     *
     * Evidence is part of the record — adding, removing or rewriting an item
     * changes how completely the case is documented — but it lives in its own
     * table, so it never appears in a column comparison. Read BEFORE
     * syncEvidence() runs, because that method deletes every row and writes the
     * submitted set back.
     *
     * Compared as a SET — trimmed, blank rows dropped, both sides sorted.
     * Order is not a fact about the case, and the relation reads back ordered
     * by evidence_code while the form posts in the order it displays, so an
     * order-sensitive comparison would call an unchanged list changed. A
     * brand-new item whose reference the encoder left blank is stored
     * auto-numbered ('EV-001'), so it reads as changed on the save that
     * introduces it — which it is — and matches from then on.
     *
     * Absent `evidenceItems` means the caller did not touch evidence at all
     * (the same guard syncEvidence() uses), so nothing changed.
     */
    private function evidenceSetChanged(Incident $incident, array $validated): bool
    {
        if (! array_key_exists('evidenceItems', $validated)) {
            return false;
        }

        $submitted = collect($validated['evidenceItems'] ?? [])
            ->map(fn ($item) => [
                trim((string) ($item['evidenceId'] ?? '')),
                trim((string) ($item['description'] ?? '')),
            ])
            ->filter(fn ($pair) => $pair[0] !== '' || $pair[1] !== '')
            ->sortBy(fn ($pair) => $pair)
            ->values()
            ->all();

        $stored = $incident->evidenceItems()
            ->get(['id', 'incident_id', 'evidence_code', 'description'])
            ->map(fn ($item) => [
                (string) $item->evidence_code,
                (string) $item->description,
            ])
            ->sortBy(fn ($pair) => $pair)
            ->values()
            ->all();

        return $submitted !== $stored;
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
