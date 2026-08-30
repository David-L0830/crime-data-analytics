<?php

namespace Database\Seeders;

use App\Http\Controllers\Api\IncidentController;
use App\Models\AppNotification;
use App\Models\Incident;
use Illuminate\Database\Seeder;

// Seeds the topbar bell with a small set of starting notifications.
//
// Every case-referencing notification is now derived from a REAL incident row
// rather than hard-coding a case number. The previous version wrote
// "Case CN-2025-0032 was marked as Solved" unconditionally, but IncidentSeeder
// assigns each incident a random status, so CN-2025-0032 was usually Open or
// Under Investigation. Clicking that notification searched Crime Data
// Collection for the case and showed a record that flatly contradicted it.
//
// Notifications for cases resolved from now on are written by
// IncidentController::announceResolutionIfNewlyResolved(); this seeder only
// provides plausible history for a freshly seeded install, and skips any
// notification it cannot back with an actual row.
class NotificationSeeder extends Seeder
{
    public function run(): void
    {
        if (AppNotification::count() > 0) {
            return;
        }

        $items = [];

        // The "Hotspot Alert" row that used to sit here — "Sitio 4 has exceeded
        // the hotspot threshold this week" — was the one entry in this seeder
        // breaking the rule stated above: it named a specific sitio and
        // asserted a specific fact, unconditionally, backed by nothing. Hotspot
        // alerts are now written from real per-sitio counts by
        // IncidentController::announceHotspotIfCrossed(), so seeding a fabricated
        // one would only reintroduce a claim the database cannot support.

        $newest = Incident::query()->orderByDesc('incident_date')->orderByDesc('id')->first();
        if ($newest) {
            $items[] = [
                'title' => 'New Incident',
                'message' => "Case {$newest->case_number} ({$newest->crime_type}) was logged in {$newest->sitio}.",
                'type' => 'info',
            ];
        }

        $resolved = Incident::query()
            ->whereIn('status', IncidentController::RESOLVED_STATUSES)
            ->orderByDesc('incident_date')
            ->first();
        if ($resolved) {
            $items[] = [
                'title' => 'Case Resolved',
                'message' => "Case {$resolved->case_number} ({$resolved->crime_type}) was marked as {$resolved->status}.",
                'type' => 'success',
            ];
        }

        $items[] = ['title' => 'Sync Complete', 'message' => 'Data synchronization completed successfully.', 'type' => 'success'];

        // "Open for over 30 days" has to be true of the row it names, so the
        // oldest still-open incident is chosen and its real age is reported.
        $overdue = Incident::query()
            ->where('status', 'Open')
            ->orderBy('incident_date')
            ->first();
        if ($overdue && $overdue->incident_date) {
            $days = (int) $overdue->incident_date->diffInDays(now());
            if ($days > 30) {
                $items[] = [
                    'title' => 'Overdue Case',
                    'message' => "Case {$overdue->case_number} has been Open for {$days} days.",
                    'type' => 'warning',
                ];
            }
        }

        foreach ($items as $i => $item) {
            AppNotification::create([
                ...$item,
                'read' => $i > 2,
                'created_at' => now()->subHours($i * 5),
                'updated_at' => now()->subHours($i * 5),
            ]);
        }
    }
}
