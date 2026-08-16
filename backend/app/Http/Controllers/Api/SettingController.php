<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Setting;
use Illuminate\Http\Request;

class SettingController extends Controller
{
    // GET /api/settings
    public function show()
    {
        return response()->json(Setting::current());
    }

    // PUT /api/settings
    public function update(Request $request)
    {
        $data = $request->validate([
            'barangay' => ['sometimes', 'string', 'max:150'],
            'population' => ['sometimes', 'integer', 'min:0'],
            'threshold' => ['sometimes', 'integer', 'min:0'],
            'hotspotThreshold' => ['sometimes', 'integer', 'min:0'],
            'categories' => ['sometimes', 'array'],
        ]);

        $settings = Setting::current();
        $settings->update([
            'barangay' => $data['barangay'] ?? $settings->barangay,
            'population' => $data['population'] ?? $settings->population,
            'threshold' => $data['threshold'] ?? $settings->threshold,
            'hotspot_threshold' => $data['hotspotThreshold'] ?? $settings->hotspot_threshold,
            'categories' => $data['categories'] ?? $settings->categories,
        ]);

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => 'UPDATE',
            'module' => 'settings',
            'target_type' => 'settings',
            'description' => 'Updated system settings',
            'ip_address' => $request->ip(),
        ]);

        return response()->json($settings->fresh());
    }
}
