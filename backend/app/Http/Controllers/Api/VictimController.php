<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreVictimRequest;
use App\Http\Requests\UpdateVictimRequest;
use App\Http\Resources\VictimResource;
use App\Models\AuditLog;
use App\Models\Victim;
use Illuminate\Http\Request;

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
        $data['victim_code'] = 'V-'.str_pad((string) (Victim::max('id') + 1), 4, '0', STR_PAD_LEFT);

        $victim = Victim::create($data);
        $this->syncCases($victim, $validated);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'CREATE',
            'module' => 'criminal-records',
            'target_type' => 'victim',
            'description' => "Added victim record {$victim->full_name}",
            'ip_address' => $request->ip(),
        ]);

        $victim->load('relatedIncidents.relatedCriminals');

        return (new VictimResource($victim))->response()->setStatusCode(201);
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
        $name = $victim->full_name;
        $victim->update(['status' => 'Archived']);

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
            if (array_key_exists($from, $v)) $out[$to] = $v[$from];
        }

        return $out;
    }
}
