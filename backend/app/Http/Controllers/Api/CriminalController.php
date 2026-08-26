<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreCriminalRequest;
use App\Http\Requests\UpdateCriminalRequest;
use App\Http\Resources\CriminalResource;
use App\Models\AuditLog;
use App\Models\Criminal;
use App\Models\Incident;
use Illuminate\Http\Request;

class CriminalController extends Controller
{
    public function index(Request $request)
    {
        $query = Criminal::query()->with('relatedIncidents.victims');

        if ($request->filled('status')) {
            $query->where('status', $request->string('status'));
        }
        if ($request->filled('search')) {
            // Search supports Full Name, Alias, Criminal ID, or Case Number
            // (Part I-49) — duplicate full names stay distinguishable because
            // the results still carry criminalId/DOB/sitio for the UI to
            // disambiguate with (Part I-50).
            $q = $request->string('search');
            $query->where(function ($w) use ($q) {
                $w->where('full_name', 'ilike', "%{$q}%")
                    ->orWhere('alias', 'ilike', "%{$q}%")
                    ->orWhere('criminal_code', 'ilike', "%{$q}%")
                    ->orWhere('related_case_number', 'ilike', "%{$q}%")
                    ->orWhereHas('relatedIncidents', fn ($ri) => $ri->where('case_number', 'ilike', "%{$q}%"));
            });
        }

        return CriminalResource::collection($query->orderByDesc('id')->get());
    }

    public function show(Criminal $criminal)
    {
        $criminal->load('relatedIncidents.victims');

        return new CriminalResource($criminal);
    }

    public function store(StoreCriminalRequest $request)
    {
        $validated = $request->validated();
        $data = $this->mapToColumns($validated);
        $data['criminal_code'] = 'CR-'.str_pad((string) (Criminal::max('id') + 1), 4, '0', STR_PAD_LEFT);

        if (! empty($data['related_incident_id'])) {
            $incident = Incident::find($data['related_incident_id']);
            $data['related_case_number'] = $incident?->case_number;
        }

        $criminal = Criminal::create($data);
        $this->syncRelatedIncidents($criminal, $validated);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'CREATE',
            'module' => 'criminal-records',
            'target_type' => 'criminal',
            'description' => "Added criminal record {$criminal->full_name}",
            'ip_address' => $request->ip(),
        ]);

        // fresh() before load() so the database-applied default for
        // criminals.status (NOT NULL DEFAULT 'Active') is reflected in the 201
        // payload rather than coming back as null. Mirrors archive()'s
        // fresh()->load(...) pattern, so the response shape is unchanged.
        $criminal = $criminal->fresh()->load('relatedIncidents.victims');

        return (new CriminalResource($criminal))->response()->setStatusCode(201);
    }

    public function update(UpdateCriminalRequest $request, Criminal $criminal)
    {
        $validated = $request->validated();
        $data = $this->mapToColumns($validated);

        if (! empty($data['related_incident_id'])) {
            $incident = Incident::find($data['related_incident_id']);
            $data['related_case_number'] = $incident?->case_number;
        }

        $criminal->update($data);
        $this->syncRelatedIncidents($criminal, $validated);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'criminal-records',
            'target_type' => 'criminal',
            'description' => "Updated criminal record {$criminal->full_name}",
            'ip_address' => $request->ip(),
        ]);

        $criminal->load('relatedIncidents.victims');

        return new CriminalResource($criminal);
    }

    // PUT /api/criminals/{criminal}/archive — mirrors VictimController::archive():
    // sets status to 'Archived' instead of physically deleting the row. Same
    // admin-only authorization as create/update (role:badac_admin in
    // routes/api.php) — no per-record ownership rule exists for criminals,
    // same as victims.
    public function archive(Request $request, Criminal $criminal)
    {
        $name = $criminal->full_name;
        $criminal->update(['status' => 'Archived']);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'ARCHIVE',
            'module' => 'criminal-records',
            'target_type' => 'criminal',
            'description' => "Archived criminal record {$name}",
            'ip_address' => $request->ip(),
        ]);

        $criminal->load('relatedIncidents.victims');

        return new CriminalResource($criminal->fresh()->load('relatedIncidents.victims'));
    }

    // Related Incidents (Part I-42/44) is many-to-many — if the request sent
    // an explicit list, sync it; otherwise leave existing links untouched.
    private function syncRelatedIncidents(Criminal $criminal, array $validated): void
    {
        if (array_key_exists('relatedIncidentIds', $validated)) {
            $criminal->relatedIncidents()->sync($validated['relatedIncidentIds'] ?? []);
        } elseif (! empty($validated['relatedIncidentId'])) {
            $criminal->relatedIncidents()->syncWithoutDetaching([$validated['relatedIncidentId']]);
        }
    }

    private function mapToColumns(array $v): array
    {
        $map = [
            'fullName' => 'full_name', 'alias' => 'alias', 'dateOfBirth' => 'date_of_birth', 'gender' => 'gender',
            'civilStatus' => 'civil_status', 'nationality' => 'nationality',
            'address' => 'address', 'sitio' => 'sitio', 'contactNumber' => 'contact_number',
            'photoUrl' => 'photo_path',
            'physicalDescription' => 'physical_description', 'height' => 'height', 'weight' => 'weight',
            'build' => 'build', 'hairColor' => 'hair_color', 'eyeColor' => 'eye_color',
            'distinguishingMarks' => 'distinguishing_marks',
            'status' => 'status', 'charges' => 'charges', 'notes' => 'notes',
            'relatedIncidentId' => 'related_incident_id',
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
