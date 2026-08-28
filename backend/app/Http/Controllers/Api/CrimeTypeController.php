<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\CrimeTypeResource;
use App\Models\AuditLog;
use App\Models\CrimeType;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Administrator-managed crime-type vocabulary and the map colour bound to each
 * type.
 *
 * READ is open to every authenticated role: the incident form, the FilterBar
 * and the Crime Mapping legend all need the list, and BADAC (read-only) uses
 * all three. WRITE is Administrator-only, enforced by the role: middleware on
 * the routes (see routes/api.php) — the UI hiding System Settings from other
 * roles is a convenience, not the control.
 */
class CrimeTypeController extends Controller
{
    // GET /api/crime-types
    public function index()
    {
        return CrimeTypeResource::collection(
            CrimeType::query()->orderBy('name')->get()
        );
    }

    // POST /api/crime-types
    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100', Rule::unique('crime_types', 'name')],
            // Colour is OPTIONAL on purpose: the whole point of automatic
            // assignment is that an Administrator adding "Rape" through System
            // Settings never has to think about colour. A colour may still be
            // supplied deliberately, and is then honoured.
            'color' => ['nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'isActive' => ['sometimes', 'boolean'],
        ], [
            'name.unique' => 'That crime type already exists.',
            'color.regex' => 'Colour must be a hex value such as #2563EB.',
        ]);

        $name = trim($data['name']);

        $crimeType = CrimeType::create([
            'name' => $name,
            'color' => isset($data['color'])
                ? strtoupper($data['color'])
                : CrimeType::allocateColor($name),
            'is_active' => $data['isActive'] ?? true,
        ]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'CREATE',
            'module' => 'settings',
            'target_type' => 'crime_type',
            'description' => "Created crime type {$crimeType->name} with map colour {$crimeType->color}",
            'ip_address' => $request->ip(),
        ]);

        return (new CrimeTypeResource($crimeType))->response()->setStatusCode(201);
    }

    // PUT /api/crime-types/{crimeType}
    public function update(Request $request, CrimeType $crimeType)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100', Rule::unique('crime_types', 'name')->ignore($crimeType->id)],
            'color' => ['sometimes', 'required', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'isActive' => ['sometimes', 'boolean'],
        ], [
            'name.unique' => 'That crime type already exists.',
            'color.regex' => 'Colour must be a hex value such as #2563EB.',
        ]);

        $before = ['name' => $crimeType->name, 'color' => $crimeType->color, 'is_active' => $crimeType->is_active];

        $crimeType->update(array_filter([
            'name' => isset($data['name']) ? trim($data['name']) : null,
            'color' => isset($data['color']) ? strtoupper($data['color']) : null,
            'is_active' => $data['isActive'] ?? null,
        ], fn ($v) => $v !== null));

        $crimeType->refresh();

        // Colour changes are audited explicitly — the map legend is how the
        // whole barangay reads the map, so a silent recolour would be an
        // unexplained change in every printed map afterwards.
        $changes = [];
        if ($before['name'] !== $crimeType->name) {
            $changes[] = "name {$before['name']} -> {$crimeType->name}";
        }
        if ($before['color'] !== $crimeType->color) {
            $changes[] = "map colour {$before['color']} -> {$crimeType->color}";
        }
        if ($before['is_active'] !== $crimeType->is_active) {
            $changes[] = $crimeType->is_active ? 'enabled' : 'disabled';
        }

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'settings',
            'target_type' => 'crime_type',
            'description' => "Updated crime type {$crimeType->name}"
                .($changes ? ' ('.implode(', ', $changes).')' : ''),
            'ip_address' => $request->ip(),
        ]);

        return new CrimeTypeResource($crimeType);
    }
}
