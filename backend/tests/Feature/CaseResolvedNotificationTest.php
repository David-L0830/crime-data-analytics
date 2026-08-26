<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// "Case Resolved" end to end: action -> API request -> status written to the
// database -> notification that agrees with what was written.
//
// The defect these tests close: no code path in the application ever created
// a Case Resolved notification. The only one that existed was a fixed row
// written by NotificationSeeder whose message hard-coded the case number
// CN-2025-0032, while IncidentSeeder assigns each incident a random status —
// so the topbar bell announced a resolution the incidents table did not
// agree with, and resolving a case for real produced no notification at all.
//
// Every assertion here is about a message built from the row that was
// actually written, so the notification cannot drift from the database.
class CaseResolvedNotificationTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function updatePayload(Incident $incident, array $overrides = []): array
    {
        return array_merge([
            'caseNumber' => $incident->case_number,
            'crimeType' => $incident->crime_type,
            'date' => $incident->incident_date->format('Y-m-d'),
            'sitio' => $incident->sitio,
        ], $overrides);
    }

    public function test_marking_an_open_case_solved_writes_the_status_and_announces_it(): void
    {
        $this->admin();
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}", $this->updatePayload($incident, [
            'status' => 'Solved',
        ]))
            ->assertOk()
            ->assertJsonPath('data.status', 'Solved');

        // The database, not just the response.
        $this->assertDatabaseHas('incidents', [
            'id' => $incident->id,
            'status' => 'Solved',
        ]);

        $notification = AppNotification::where('title', 'Case Resolved')->sole();
        $this->assertSame('success', $notification->type);
        $this->assertFalse($notification->read);
        // The real case number of the row that was updated, and the status it
        // actually holds — the two things the old seeded notification could
        // not guarantee.
        $this->assertStringContainsString($incident->case_number, $notification->message);
        $this->assertStringContainsString('Solved', $notification->message);
    }

    public function test_closing_an_under_investigation_case_also_announces_it(): void
    {
        $this->admin();
        $incident = Incident::factory()->create(['status' => 'Under Investigation']);

        $this->putJson("/api/incidents/{$incident->id}", $this->updatePayload($incident, [
            'status' => 'Closed',
        ]))->assertOk();

        $notification = AppNotification::where('title', 'Case Resolved')->sole();
        $this->assertStringContainsString('Closed', $notification->message);
    }

    public function test_editing_an_already_solved_case_does_not_announce_it_again(): void
    {
        $this->admin();
        $incident = Incident::factory()->create(['status' => 'Solved']);

        $this->putJson("/api/incidents/{$incident->id}", $this->updatePayload($incident, [
            'status' => 'Solved',
            'description' => 'Corrected a typo in the narrative.',
        ]))->assertOk();

        $this->assertSame(0, AppNotification::where('title', 'Case Resolved')->count());
    }

    public function test_moving_between_two_resolved_statuses_does_not_announce_a_new_resolution(): void
    {
        $this->admin();
        $incident = Incident::factory()->create(['status' => 'Solved']);

        $this->putJson("/api/incidents/{$incident->id}", $this->updatePayload($incident, [
            'status' => 'Closed',
        ]))->assertOk();

        // The case was already resolved before this edit, so nothing was
        // newly resolved and there is nothing new to announce.
        $this->assertSame(0, AppNotification::where('title', 'Case Resolved')->count());
    }

    public function test_a_status_change_that_is_not_a_resolution_announces_nothing(): void
    {
        $this->admin();
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}", $this->updatePayload($incident, [
            'status' => 'Under Investigation',
        ]))->assertOk();

        $this->assertSame(0, AppNotification::where('title', 'Case Resolved')->count());
    }

    public function test_archiving_is_not_treated_as_a_resolution(): void
    {
        $this->admin();
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Archived']);
        $this->assertSame(0, AppNotification::where('title', 'Case Resolved')->count());
    }

    public function test_resolving_one_case_leaves_every_other_incident_untouched(): void
    {
        $this->admin();
        $target = Incident::factory()->create(['status' => 'Open']);
        $bystanders = Incident::factory()->count(3)->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$target->id}", $this->updatePayload($target, [
            'status' => 'Solved',
        ]))->assertOk();

        foreach ($bystanders as $other) {
            $this->assertDatabaseHas('incidents', ['id' => $other->id, 'status' => 'Open']);
        }

        // No duplicate row was created for the case that was resolved.
        $this->assertSame(1, Incident::where('case_number', $target->case_number)->count());
        $this->assertSame(4, Incident::count());
    }

    public function test_solved_and_pending_counts_stay_consistent_after_a_resolution(): void
    {
        $this->admin();
        Incident::factory()->count(2)->create(['status' => 'Solved']);
        $pending = Incident::factory()->count(3)->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$pending->first()->id}", $this->updatePayload($pending->first(), [
            'status' => 'Solved',
        ]))->assertOk();

        // solved + pending must still equal the total: one row moved from one
        // group to the other, and no row landed outside both.
        $solved = Incident::whereIn('status', ['Solved', 'Closed'])->count();
        $pendingCount = Incident::whereIn('status', ['Open', 'Under Investigation'])->count();

        $this->assertSame(3, $solved);
        $this->assertSame(2, $pendingCount);
        $this->assertSame(Incident::count(), $solved + $pendingCount);
    }

    public function test_creating_an_incident_announces_it_with_its_real_case_number(): void
    {
        $this->admin();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2026-9001',
            'crimeType' => 'Theft',
            'date' => '2026-05-04',
            'sitio' => 'Sitio 2',
        ])->assertCreated();

        $notification = AppNotification::where('title', 'New Incident')->sole();
        $this->assertStringContainsString('CN-2026-9001', $notification->message);
        $this->assertStringContainsString('Sitio 2', $notification->message);
    }
}
