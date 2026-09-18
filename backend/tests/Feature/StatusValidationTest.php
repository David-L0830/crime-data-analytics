<?php

namespace Tests\Feature;

use App\Models\Criminal;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Server-side status vocabulary. Store/Update{Incident,Criminal}Request used to
// accept ['nullable','string','max:50'], so any 50-character string was a valid
// status. Three consequences motivated closing the set:
//
//   1. the vocabulary was enforced only by the React dropdown;
//   2. PUT .../{id} with status='Archived' archived a record without going
//      through the dedicated archive endpoint, so it logged as UPDATE and
//      produced no ARCHIVE audit event, and left previous_status unset so a
//      later restore could only fall back to DEFAULT_STATUS. For INCIDENTS
//      that hole is now closed: Store/UpdateIncidentRequest validate against
//      Incident::ASSIGNABLE_STATUSES, which omits 'Archived'. Criminals and
//      victims are unchanged and still accept it on create/update;
//   3. an unrecognised incident status is counted by the Dashboard's `total`
//      but by neither SOLVED_STATUSES nor PENDING_STATUSES, silently breaking
//      the solved + pending = total identity behind Resolution Rate.
//
// Incident::STATUSES / Criminal::STATUSES are the single server-side source of
// truth for the DISPLAY vocabulary (what the Status filters offer and what a
// record may show), mirroring STATUSES / CRIMINAL_STATUSES in
// src/utils/constants.js. Incident::ASSIGNABLE_STATUSES is the narrower set a
// client may WRITE, mirroring ASSIGNABLE_STATUSES in the same file.
// These tests drive the model constants directly rather than repeating the
// values, so adding a status in one place cannot silently escape coverage.
class StatusValidationTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'username' => 'admin1',
            'email' => 'admin1@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
        ]);
    }

    private function incidentPayload(array $overrides = []): array
    {
        return array_merge([
            'caseNumber' => 'CN-2025-'.fake()->unique()->numberBetween(1000, 9999),
            'crimeType' => 'Theft',
            'date' => '2025-06-01',
            'sitio' => 'Sitio 1',
        ], $overrides);
    }

    private function criminalPayload(array $overrides = []): array
    {
        return array_merge([
            'fullName' => 'Test Person '.fake()->unique()->numberBetween(1000, 9999),
        ], $overrides);
    }

    // ---- 1. every currently valid status is accepted ----

    public function test_every_assignable_incident_status_is_accepted_on_create(): void
    {
        $this->actingAsSupabase($this->admin());

        foreach (Incident::ASSIGNABLE_STATUSES as $status) {
            $this->postJson('/api/incidents', $this->incidentPayload(['status' => $status]))
                ->assertCreated()
                ->assertJsonPath('data.status', $status);
        }

        $this->assertCount(count(Incident::ASSIGNABLE_STATUSES), Incident::all());
    }

    public function test_every_assignable_incident_status_is_accepted_on_update(): void
    {
        $this->actingAsSupabase($this->admin());
        $incident = Incident::factory()->create();

        foreach (Incident::ASSIGNABLE_STATUSES as $status) {
            $this->putJson("/api/incidents/{$incident->id}", ['status' => $status])
                ->assertOk()
                ->assertJsonPath('data.status', $status);
        }
    }

    public function test_every_criminal_status_is_accepted_on_create_and_update(): void
    {
        $this->actingAsSupabase($this->admin());

        foreach (Criminal::STATUSES as $status) {
            $this->postJson('/api/criminals', $this->criminalPayload(['status' => $status]))
                ->assertStatus(201)
                ->assertJsonPath('data.status', $status);
        }

        // Update the LAST API-created record rather than a factory one, so this
        // test exercises the same rows the POSTs above created.
        //
        // This used to be load-bearing: CriminalController::store() derived the
        // code from max(id)+1, which collided with CriminalFactory's own
        // 'CR-000N' sequence and blew up on criminals_criminal_code_unique.
        // Codes are now derived from the row's own id and fall back to a suffix
        // when one is already taken (see mintCriminalCode()), so mixing factory
        // and API records no longer collides.
        $criminal = Criminal::orderByDesc('id')->first();
        foreach (Criminal::STATUSES as $status) {
            $this->putJson("/api/criminals/{$criminal->id}", ['status' => $status])
                ->assertOk()
                ->assertJsonPath('data.status', $status);
        }
    }

    // ---- 2. an arbitrary status is rejected with 422 ----

    public function test_invalid_incident_status_is_rejected(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/incidents', $this->incidentPayload(['status' => 'Totally Made Up']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        $incident = Incident::factory()->create();
        $this->putJson("/api/incidents/{$incident->id}", ['status' => 'Pwned'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        // Rejected, not silently stored.
        $this->assertDatabaseMissing('incidents', ['status' => 'Pwned']);
    }

    public function test_invalid_criminal_status_is_rejected(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/criminals', $this->criminalPayload(['status' => 'Not A Status']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        $criminal = Criminal::factory()->create();
        $this->putJson("/api/criminals/{$criminal->id}", ['status' => 'Nope'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        $this->assertDatabaseMissing('criminals', ['status' => 'Nope']);
    }

    public function test_status_is_case_sensitive_so_near_misses_are_rejected(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/incidents', $this->incidentPayload(['status' => 'open']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    // ---- 3. 'Archived' stays in the vocabulary, but only the archive
    //         endpoint may write it on an incident ----

    public function test_archived_remains_in_the_status_vocabulary(): void
    {
        // Still displayable and still filterable — the Status filters on the
        // Dashboard, Incident Feed, Analytics, Trends and Mapping pages read
        // this set, and archived records have to remain findable through it.
        $this->assertContains('Archived', Incident::STATUSES);
        $this->assertContains('Archived', Criminal::STATUSES);

        // What changed is only who may assign it on an incident.
        $this->assertNotContains('Archived', Incident::ASSIGNABLE_STATUSES);
    }

    public function test_archived_is_not_assignable_to_an_incident_through_create_or_update(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/incidents', $this->incidentPayload(['status' => 'Archived']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        $incident = Incident::factory()->create(['status' => 'Open']);
        $this->putJson("/api/incidents/{$incident->id}", ['status' => 'Archived'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        // The status column is only ever reachable through the archive
        // endpoint, which is what also records previous_status and the
        // ARCHIVE audit event (see the two archive tests at the end).
        $this->assertDatabaseMissing('incidents', ['status' => 'Archived']);
    }

    public function test_criminal_archived_status_is_unchanged_by_the_incident_fix(): void
    {
        $this->actingAsSupabase($this->admin());

        // Deliberately out of scope: only the incident vocabulary was
        // narrowed. Criminals (and victims) still accept 'Archived' on
        // create/update exactly as before.
        $criminal = Criminal::factory()->create();
        $this->putJson("/api/criminals/{$criminal->id}", ['status' => 'Archived'])
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');
    }

    // ---- 4. existing behaviour otherwise unchanged ----

    public function test_status_may_be_omitted_and_falls_back_to_the_column_default(): void
    {
        $this->actingAsSupabase($this->admin());

        // Omitting status entirely is the path the app actually uses, and the
        // one test_can_create_an_incident already relies on. The column default
        // supplies the value.
        //
        // Explicit `status: null` is a separate case and is covered by
        // StatusDefaultsAndNullTest: it is now rejected with a 422 rather than
        // reaching the NOT NULL column and raising a 500.
        // Asserted against the stored row. That the 201 payload now agrees
        // with the row is covered by StatusDefaultsAndNullTest.
        $case = 'CN-2025-4242';
        $this->postJson('/api/incidents', $this->incidentPayload(['caseNumber' => $case]))
            ->assertCreated();
        $this->assertDatabaseHas('incidents', ['case_number' => $case, 'status' => 'Open']);

        $name = 'Omitted Status Person';
        $this->postJson('/api/criminals', $this->criminalPayload(['fullName' => $name]))
            ->assertStatus(201);
        $this->assertDatabaseHas('criminals', ['full_name' => $name, 'status' => 'Active']);
    }

    public function test_other_validation_rules_are_untouched(): void
    {
        $this->actingAsSupabase($this->admin());

        // caseNumber + sitio still required; status not implicated.
        $this->postJson('/api/incidents', ['crimeType' => 'Theft', 'date' => '2025-06-01'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['caseNumber', 'sitio'])
            ->assertJsonMissingValidationErrors(['status']);
    }

    // ---- 5. the dedicated archive endpoint still works and still audits ----

    public function test_incident_archive_endpoint_still_works_and_audits(): void
    {
        $this->actingAsSupabase($this->admin());
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Archived']);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'ARCHIVE',
            'module' => 'incidents',
            'target_type' => 'incident',
        ]);
    }

    public function test_criminal_archive_endpoint_still_works_and_audits(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Wanted']);

        $this->putJson("/api/criminals/{$criminal->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');

        $this->assertDatabaseHas('criminals', ['id' => $criminal->id, 'status' => 'Archived']);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'ARCHIVE',
            // CriminalController::archive() records module 'criminal-records',
            // matching the frontend module id, not the table name.
            'module' => 'criminal-records',
        ]);
    }
}
