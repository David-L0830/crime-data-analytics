<?php

namespace Tests\Feature;

use App\Models\Criminal;
use App\Models\User;
use App\Models\Victim;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Archive → Restore for Criminal and Victim records.
//
// Archiving used to overwrite `status` with 'Archived', destroying the
// meaningful pre-archive value with no way back: a 'Wanted' criminal became
// indistinguishable from any other archived record. Nothing in the schema
// preserved it — audit_logs carries no target_id and no status, its
// description is only "Archived criminal record {name}", and full_name is
// deliberately not unique — so the audit trail could never have been a
// reliable source. It is not consulted here, and must never be: these tests
// assert the round trip is driven entirely by the row's own previous_status
// column.
//
// The invariant every test below defends: for any starting status S,
// archive() then restore() returns the record to exactly S, and no row is ever
// deleted.
class RestoreTest extends TestCase
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

    // ===== Criminal — every status survives the round trip =====

    /**
     * The headline guarantee, driven off the model constant rather than a
     * repeated list, so a status added to Criminal::RESTORABLE_STATUSES cannot
     * silently escape coverage.
     */
    public function test_every_criminal_status_survives_archive_and_restore(): void
    {
        $this->actingAsSupabase($this->admin());

        foreach (Criminal::RESTORABLE_STATUSES as $status) {
            $criminal = Criminal::factory()->create(['status' => $status]);

            $this->putJson("/api/criminals/{$criminal->id}/archive")
                ->assertOk()
                ->assertJsonPath('data.status', 'Archived')
                ->assertJsonPath('data.previousStatus', $status);

            $this->putJson("/api/criminals/{$criminal->id}/restore")
                ->assertOk()
                ->assertJsonPath('data.status', $status)
                ->assertJsonPath('data.previousStatus', null);

            $this->assertDatabaseHas('criminals', [
                'id' => $criminal->id,
                'status' => $status,
                'previous_status' => null,
            ]);
        }

        // Named explicitly as well, so a reader sees the concrete cases and a
        // regression naming the wrong status is unambiguous in the failure.
        $this->assertSame(
            ['Active', 'Wanted', 'Incarcerated', 'Released', 'Deceased'],
            Criminal::RESTORABLE_STATUSES,
        );
    }

    public function test_archive_saves_the_previous_status_on_the_row(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Wanted']);

        $this->assertNull($criminal->previous_status);

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertOk();

        $this->assertDatabaseHas('criminals', [
            'id' => $criminal->id,
            'status' => 'Archived',
            'previous_status' => 'Wanted',
        ]);
    }

    public function test_restore_clears_the_previous_status(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Incarcerated']);

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertOk();
        $this->putJson("/api/criminals/{$criminal->id}/restore")->assertOk();

        $this->assertNull($criminal->fresh()->previous_status);
    }

    public function test_repeated_archive_restore_cycles_preserve_the_same_status(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Deceased']);

        foreach (range(1, 2) as $ignored) {
            $this->putJson("/api/criminals/{$criminal->id}/archive")->assertOk();
            $this->putJson("/api/criminals/{$criminal->id}/restore")
                ->assertOk()
                ->assertJsonPath('data.status', 'Deceased');
        }

        $this->assertSame('Deceased', $criminal->fresh()->status);
        $this->assertNull($criminal->fresh()->previous_status);
    }

    // ===== The critical guard =====

    /**
     * Without this guard the second archive would capture 'Archived' as
     * previous_status and destroy the real one permanently — the exact data
     * loss this whole feature exists to prevent. The list UI hides the Archive
     * button for archived rows, but the endpoint is directly callable.
     */
    public function test_archiving_an_already_archived_criminal_cannot_overwrite_previous_status(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Wanted']);

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertOk();

        $this->putJson("/api/criminals/{$criminal->id}/archive")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This criminal record is already archived.');

        // 'Wanted' survived the second call.
        $this->assertSame('Wanted', $criminal->fresh()->previous_status);

        // And it still restores correctly afterwards.
        $this->putJson("/api/criminals/{$criminal->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Wanted');
    }

    public function test_archiving_an_already_archived_victim_is_rejected(): void
    {
        $this->actingAsSupabase($this->admin());
        $victim = Victim::factory()->create(['status' => 'Active']);

        $this->putJson("/api/victims/{$victim->id}/archive")->assertOk();

        $this->putJson("/api/victims/{$victim->id}/archive")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This victim record is already archived.');

        $this->assertSame('Active', $victim->fresh()->previous_status);
    }

    // ===== Restore refuses records that are not archived =====

    public function test_restoring_a_criminal_that_is_not_archived_is_422(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Wanted']);

        $this->putJson("/api/criminals/{$criminal->id}/restore")
            ->assertStatus(422)
            ->assertJsonPath('message', 'Only archived criminal records can be restored.');

        // The live status is untouched by the refused request.
        $this->assertSame('Wanted', $criminal->fresh()->status);
    }

    public function test_restoring_a_victim_that_is_not_archived_is_422(): void
    {
        $this->actingAsSupabase($this->admin());
        $victim = Victim::factory()->create(['status' => 'Active']);

        $this->putJson("/api/victims/{$victim->id}/restore")
            ->assertStatus(422)
            ->assertJsonPath('message', 'Only archived victim records can be restored.');

        $this->assertSame('Active', $victim->fresh()->status);
    }

    // ===== Safe fallbacks =====

    /**
     * A record can reach 'Archived' without ever passing through archive():
     * PUT /criminals/{id} with status='Archived' is accepted (the back door
     * StatusValidationTest documents), and any row predating the
     * previous_status column has null too. Restoring must yield the column
     * default, never null — writing null would violate the NOT NULL status
     * column and produce a 500.
     */
    public function test_restore_falls_back_to_active_when_previous_status_is_null(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create([
            'status' => 'Archived',
            'previous_status' => null,
        ]);

        $this->putJson("/api/criminals/{$criminal->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Active');

        $this->assertSame('Active', $criminal->fresh()->status);
    }

    public function test_restore_falls_back_to_active_when_previous_status_is_retired_or_invalid(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create([
            'status' => 'Archived',
            'previous_status' => 'Some Retired Status',
        ]);

        $this->putJson("/api/criminals/{$criminal->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Active');

        $this->assertNotSame('Some Retired Status', $criminal->fresh()->status);
    }

    /**
     * 'Archived' is excluded from RESTORABLE_STATUSES on purpose — restoring
     * "to" Archived would leave the record archived and permanently stuck.
     */
    public function test_restore_never_restores_to_archived(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create([
            'status' => 'Archived',
            'previous_status' => 'Archived',
        ]);

        $this->putJson("/api/criminals/{$criminal->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Active');

        $this->assertNotContains('Archived', Criminal::RESTORABLE_STATUSES);
        $this->assertNotContains('Archived', Victim::RESTORABLE_STATUSES);
    }

    public function test_restore_falls_back_to_active_for_a_victim_with_null_previous_status(): void
    {
        $this->actingAsSupabase($this->admin());
        $victim = Victim::factory()->create([
            'status' => 'Archived',
            'previous_status' => null,
        ]);

        $this->putJson("/api/victims/{$victim->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Active');
    }

    // ===== Victim round trip =====

    public function test_victim_archive_and_restore_round_trip(): void
    {
        $this->actingAsSupabase($this->admin());
        $victim = Victim::factory()->create(['status' => 'Active']);

        $this->putJson("/api/victims/{$victim->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived')
            ->assertJsonPath('data.previousStatus', 'Active');

        $this->putJson("/api/victims/{$victim->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Active')
            ->assertJsonPath('data.previousStatus', null);

        $this->assertDatabaseHas('victims', [
            'id' => $victim->id,
            'status' => 'Active',
            'previous_status' => null,
        ]);
    }

    // ===== Nothing is ever deleted =====

    public function test_no_row_is_deleted_at_any_point_in_the_cycle(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Released']);
        $victim = Victim::factory()->create(['status' => 'Active']);

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertOk();
        $this->putJson("/api/victims/{$victim->id}/archive")->assertOk();
        $this->assertDatabaseHas('criminals', ['id' => $criminal->id]);
        $this->assertDatabaseHas('victims', ['id' => $victim->id]);

        $this->putJson("/api/criminals/{$criminal->id}/restore")->assertOk();
        $this->putJson("/api/victims/{$victim->id}/restore")->assertOk();
        $this->assertDatabaseHas('criminals', ['id' => $criminal->id]);
        $this->assertDatabaseHas('victims', ['id' => $victim->id]);

        $this->assertSame(1, Criminal::count());
        $this->assertSame(1, Victim::count());
    }

    // ===== Audit =====

    public function test_restoring_a_criminal_writes_exactly_one_restore_audit_row(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create([
            'status' => 'Wanted',
            'full_name' => 'Audited Person',
        ]);

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertOk();
        $this->putJson("/api/criminals/{$criminal->id}/restore")->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'RESTORE',
            'module' => 'criminal-records',
            'target_type' => 'criminal',
            'description' => 'Restored criminal record Audited Person to Wanted',
        ]);
        $this->assertSame(1, \App\Models\AuditLog::where('action', 'RESTORE')->count());
    }

    public function test_restoring_a_victim_writes_exactly_one_restore_audit_row(): void
    {
        $this->actingAsSupabase($this->admin());
        $victim = Victim::factory()->create(['full_name' => 'Audited Victim', 'status' => 'Active']);

        $this->putJson("/api/victims/{$victim->id}/archive")->assertOk();
        $this->putJson("/api/victims/{$victim->id}/restore")->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'RESTORE',
            'module' => 'criminal-records',
            'target_type' => 'victim',
            'description' => 'Restored victim record Audited Victim to Active',
        ]);
        $this->assertSame(1, \App\Models\AuditLog::where('action', 'RESTORE')->count());
    }

    public function test_the_archive_audit_row_is_unchanged_and_still_written(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Wanted', 'full_name' => 'Trail Person']);

        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertOk();

        // Exactly the row archive() has always written — unchanged wording,
        // unchanged module, unchanged target_type.
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'ARCHIVE',
            'module' => 'criminal-records',
            'target_type' => 'criminal',
            'description' => 'Archived criminal record Trail Person',
        ]);

        $archiveRow = \App\Models\AuditLog::where('action', 'ARCHIVE')->firstOrFail();

        $this->putJson("/api/criminals/{$criminal->id}/restore")->assertOk();

        // Restoring does not rewrite or remove the ARCHIVE row — the trail
        // keeps both halves of the story.
        $this->assertDatabaseHas('audit_logs', ['id' => $archiveRow->id]);
        $this->assertSame(
            $archiveRow->description,
            \App\Models\AuditLog::find($archiveRow->id)->description,
        );
    }

    // ===== previous_status is server-controlled =====

    /**
     * previous_status is in $fillable so archive()/restore() can write it, but
     * it must never be reachable from a request body — otherwise a caller
     * could forge the status a record will be restored to. mapToColumns()
     * omits it and the form requests carry no rule for it, so it is stripped
     * before it reaches the model.
     */
    public function test_previous_status_cannot_be_set_by_a_client_on_create(): void
    {
        $this->actingAsSupabase($this->admin());

        $this->postJson('/api/criminals', [
            'fullName' => 'Forged Restore Target',
            'previousStatus' => 'Wanted',
            'previous_status' => 'Wanted',
        ])->assertStatus(201);

        $this->assertNull(
            Criminal::where('full_name', 'Forged Restore Target')->firstOrFail()->previous_status,
        );
    }

    public function test_previous_status_cannot_be_set_by_a_client_on_update(): void
    {
        $this->actingAsSupabase($this->admin());
        $criminal = Criminal::factory()->create(['status' => 'Active']);

        $this->putJson("/api/criminals/{$criminal->id}", [
            'previousStatus' => 'Deceased',
            'previous_status' => 'Deceased',
        ])->assertOk();

        $this->assertNull($criminal->fresh()->previous_status);
    }

    public function test_previous_status_cannot_be_set_by_a_client_on_a_victim(): void
    {
        $this->actingAsSupabase($this->admin());
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}", [
            'previousStatus' => 'Wanted',
            'previous_status' => 'Wanted',
        ])->assertOk();

        $this->assertNull($victim->fresh()->previous_status);
    }

    // ===== Status vocabulary is unchanged =====

    public function test_the_existing_status_vocabulary_is_unchanged(): void
    {
        // Criminal::STATUSES is the set this feature must not disturb —
        // 'Archived' in particular stays, since archive() still writes it.
        $this->assertSame(
            ['Active', 'Wanted', 'Incarcerated', 'Released', 'Deceased', 'Archived'],
            Criminal::STATUSES,
        );
        $this->assertContains('Archived', Criminal::STATUSES);

        // Victim::STATUSES is newly expressed server-side, mirroring the
        // VICTIM_STATUSES already declared in src/utils/constants.js. No value
        // is added or removed by doing so.
        $this->assertSame(['Active', 'Archived'], Victim::STATUSES);
    }
}
