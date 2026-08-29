<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreVictimRequest;
use App\Http\Requests\UpdateVictimRequest;
use App\Http\Resources\VictimResource;
use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\User;
use App\Models\Victim;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class VictimController extends Controller
{
    public function index(Request $request)
    {
        $query = Victim::query()->with('relatedIncidents.relatedCriminals');

        if ($request->filled('search')) {
            $q = $request->string('search');
            $query->where(function ($w) use ($q) {
                $w->where('full_name', 'ilike', "%{$q}%")
                    ->orWhere('alias', 'ilike', "%{$q}%")
                    ->orWhere('victim_code', 'ilike', "%{$q}%")
                    ->orWhereHas('relatedIncidents', fn ($ri) => $ri->where('case_number', 'ilike', "%{$q}%"));
            });
        }

        return VictimResource::collection($query->orderByDesc('id')->get());
    }

    public function show(Victim $victim)
    {
        $victim->load('relatedIncidents.relatedCriminals');

        return new VictimResource($victim);
    }

    public function store(StoreVictimRequest $request)
    {
        $validated = $request->validated();
        $data = $this->mapToColumns($validated);

        // See mintVictimCode(): the code names this row, so it is derived from
        // the row's own id after the insert. victim_code is NOT NULL UNIQUE, so
        // the insert itself carries a collision-proof placeholder that is
        // replaced a statement later inside the same transaction — nothing
        // outside can observe it, and a rollback takes it with it.
        $data['victim_code'] = 'TMP-'.Str::uuid()->toString();

        // The record, its case links and its audit entry are ONE unit of work,
        // matching IncidentController::store(). Before this they were three
        // unwrapped statements, so a failure partway through left a committed
        // victim record with no audit trail and no case links while the caller
        // was told the save had failed.
        $victim = DB::transaction(function () use ($request, $data, $validated) {
            $victim = Victim::create($data);

            $victim->forceFill([
                'victim_code' => $this->mintVictimCode($victim->id),
            ])->save();

            $this->syncCases($victim, $validated);

            AuditLog::create([
                'user_id' => $request->user()?->id,
                'action' => 'CREATE',
                'module' => 'criminal-records',
                'target_type' => 'victim',
                'description' => "Added victim record {$victim->full_name}",
                'ip_address' => $request->ip(),
            ]);

            return $victim;
        });

        // Same treatment as a new criminal record - see CriminalController.
        AppNotification::create([
            'title' => 'New Victim Record',
            'message' => "Victim record {$victim->victim_code} ({$victim->full_name}) was added.",
            'type' => 'info',
            'read' => false,
            // Records are an Administrator / BADAC module; Encoder has no
            // access to it, so this announcement is not addressed to them.
            'audience_roles' => AppNotification::audienceFor([
                User::ROLE_BADAC_ADMIN,
                User::ROLE_BADAC_READONLY,
            ]),
        ]);

        // fresh() before load() for the same reason as the other two
        // controllers: victims.status is NOT NULL DEFAULT 'Active' and is not
        // settable through StoreVictimRequest at all, so EVERY created victim
        // relies on the column default and would otherwise report
        // status: null in its own 201 response. Mirrors archive()'s
        // fresh()->load(...) pattern, so the response shape is unchanged.
        $victim = $victim->fresh()->load('relatedIncidents.relatedCriminals');

        return (new VictimResource($victim))->response()->setStatusCode(201);
    }

    /**
     * The human-facing code for a victim record, derived from the row it names.
     *
     * This used to be 'V-'.(max(id) + 1), read outside any transaction — a
     * PREDICTION of the id, made before the row existed, under no lock. Two
     * simultaneous creates read the same max(id), computed the same code and
     * the second violated victims_victim_code_unique, returning a 500 and
     * losing the record; because the failed insert rolls back, max(id) never
     * advanced and every retry recomputed the same colliding code, leaving the
     * endpoint wedged on 500.
     *
     * Deriving from the row's own id removes the race by construction rather
     * than by retrying: ids are unique, so no two concurrent transactions can
     * want the same code. The only collision still possible is with a legacy
     * row already holding this id's code — static data rather than a
     * competitor, which is what makes reading it here safe. That case takes the
     * suffix convention syncEvidence() uses for a repeated evidence reference
     * (EV-001 -> EV-001-2), so the code still names its row and the save still
     * succeeds. See IncidentController::mintIncidentCode().
     */
    private function mintVictimCode(int $id): string
    {
        $base = 'V-'.str_pad((string) $id, 4, '0', STR_PAD_LEFT);
        $candidate = $base;
        $suffix = 1;

        while (Victim::where('victim_code', $candidate)->whereKeyNot($id)->exists()) {
            $suffix++;
            $candidate = $base.'-'.$suffix;
        }

        return $candidate;
    }

    public function update(UpdateVictimRequest $request, Victim $victim)
    {
        $validated = $request->validated();
        $victim->update($this->mapToColumns($validated));
        $this->syncCases($victim, $validated);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'criminal-records',
            'target_type' => 'victim',
            'description' => "Updated victim record {$victim->full_name}",
            'ip_address' => $request->ip(),
        ]);

        $victim->load('relatedIncidents.relatedCriminals');

        return new VictimResource($victim);
    }

    // PUT /api/victims/{victim}/archive — Checkpoint 20 (Task 8). Replaces
    // the old physical-delete destroy() action. Sets status to 'Archived'
    // instead of removing the row; the same admin-only authorization that
    // already gated the old DELETE route (role:badac_admin in
    // routes/api.php — no per-record ownership rule exists for victims,
    // unlike incidents) is unchanged.
    public function archive(Request $request, Victim $victim)
    {
        // Same guard and same reason as CriminalController::archive(): a
        // second archive would capture 'Archived' as previous_status and
        // destroy the real one.
        if ($victim->status === 'Archived') {
            return response()->json(['message' => 'This victim record is already archived.'], 422);
        }

        $name = $victim->full_name;

        // Victims only ever hold 'Active' today, but the value is captured the
        // same way as for criminals rather than assumed, so the restore path
        // stays correct if the victim vocabulary is ever widened.
        $victim->update([
            'previous_status' => $victim->status,
            'status' => 'Archived',
        ]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'ARCHIVE',
            'module' => 'criminal-records',
            'target_type' => 'victim',
            'description' => "Archived victim record {$name}",
            'ip_address' => $request->ip(),
        ]);

        return new VictimResource($victim->fresh()->load('relatedIncidents.relatedCriminals'));
    }

    // PUT /api/victims/{victim}/restore — mirrors
    // CriminalController::restore() exactly: same role:badac_admin group, same
    // deterministic previous_status source, same refusal to consult the audit
    // trail, same safe fallback when previous_status is null or unrecognised.
    public function restore(Request $request, Victim $victim)
    {
        if ($victim->status !== 'Archived') {
            return response()->json(['message' => 'Only archived victim records can be restored.'], 422);
        }

        $previous = $victim->previous_status;
        $restored = in_array($previous, Victim::RESTORABLE_STATUSES, true)
            ? $previous
            : Victim::DEFAULT_STATUS;

        $victim->update([
            'status' => $restored,
            'previous_status' => null,
        ]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'RESTORE',
            'module' => 'criminal-records',
            'target_type' => 'victim',
            'description' => "Restored victim record {$victim->full_name} to {$restored}",
            'ip_address' => $request->ip(),
        ]);

        return new VictimResource($victim->fresh()->load('relatedIncidents.relatedCriminals'));
    }

    // Case links (incident_victim) are many-to-many — if the request sent an
    // explicit list, sync it (so removing a case from the list detaches it
    // too); otherwise leave existing links untouched. Same shape as
    // CriminalController::syncRelatedIncidents.
    private function syncCases(Victim $victim, array $validated): void
    {
        if (array_key_exists('incidentIds', $validated)) {
            $victim->relatedIncidents()->sync($validated['incidentIds'] ?? []);
        }
    }

    private function mapToColumns(array $v): array
    {
        $map = [
            'fullName' => 'full_name', 'alias' => 'alias', 'gender' => 'gender',
            'dateOfBirth' => 'date_of_birth', 'civilStatus' => 'civil_status',
            'nationality' => 'nationality', 'contactNumber' => 'contact_number',
            'address' => 'address',
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
