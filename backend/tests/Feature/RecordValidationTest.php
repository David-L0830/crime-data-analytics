<?php

namespace Tests\Feature;

use App\Http\Requests\UpdateIncidentRequest;
use App\Models\AuditLog;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Record validation by the BADAC Administrator or BADAC Validator.
 *
 * A submitted incident is pending until an Administrator or Validator
 * validates it or returns it for correction. The properties that matter, each
 * with its own group below:
 *
 *   - Only an Administrator or Validator can validate or return, enforced on
 *     the server.
 *   - A client cannot set the validation state through create or update.
 *   - Every transition persists who, when and (for a return) why, and leaves
 *     an audit row.
 *   - An Encoder's correction puts the record back in the review queue.
 */
class RecordValidationTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'name' => 'Admin Reviewer']);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function encoder(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function pendingIncident(array $overrides = []): Incident
    {
        return Incident::factory()->create(array_merge([
            'validation_status' => Incident::VALIDATION_PENDING,
        ], $overrides));
    }

    // ---------------------------------------------------------------
    // Submission
    // ---------------------------------------------------------------

    public function test_a_new_incident_is_pending_validation(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2026-7001',
            'crimeType' => 'Theft',
            'date' => '2026-09-01',
            'sitio' => 'Sitio 1',
            'street' => '12 Rizal St.',
            'status' => 'Open',
        ])
            ->assertCreated()
            ->assertJsonPath('data.validationStatus', 'pending')
            ->assertJsonPath('data.validatedBy', null)
            ->assertJsonPath('data.validatedAt', null);

        $this->assertDatabaseHas('incidents', [
            'case_number' => 'CN-2026-7001',
            'validation_status' => 'pending',
        ]);
    }

    public function test_a_client_cannot_create_an_already_validated_incident(): void
    {
        $this->admin();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2026-7002',
            'crimeType' => 'Theft',
            'date' => '2026-09-01',
            'sitio' => 'Sitio 1',
            'street' => '12 Rizal St.',
            'validationStatus' => 'validated',
            'validation_status' => 'validated',
            'validatedBy' => 1,
        ])->assertCreated()->assertJsonPath('data.validationStatus', 'pending');
    }

    public function test_a_client_cannot_validate_through_the_update_endpoint(): void
    {
        $this->admin();
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}", [
            'validationStatus' => 'validated',
            'validation_status' => 'validated',
        ])->assertOk();

        $this->assertSame('pending', $incident->fresh()->validation_status);
    }

    // ---------------------------------------------------------------
    // Authorisation
    // ---------------------------------------------------------------

    public function test_an_encoder_cannot_validate_even_their_own_record(): void
    {
        $encoder = $this->encoder();
        $incident = $this->pendingIncident(['reported_by' => $encoder->id]);

        $this->putJson("/api/incidents/{$incident->id}/validate")->assertForbidden();
        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => 'Wrong sitio recorded.'])
            ->assertForbidden();

        $this->assertSame('pending', $incident->fresh()->validation_status);
    }

    public function test_a_badac_validator_can_validate(): void
    {
        $validator = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        $this->actingAsSupabase($validator);
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'validated');

        $this->assertSame($validator->id, $incident->fresh()->validated_by);
    }

    public function test_a_badac_validator_can_return_for_correction(): void
    {
        $validator = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        $this->actingAsSupabase($validator);
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => 'Wrong sitio recorded.'])
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'returned');

        $this->assertSame($validator->id, $incident->fresh()->returned_by);
    }

    public function test_an_unauthenticated_request_cannot_validate(): void
    {
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}/validate")->assertUnauthorized();
        $this->assertSame('pending', $incident->fresh()->validation_status);
    }

    // ---------------------------------------------------------------
    // Approve
    // ---------------------------------------------------------------

    public function test_an_administrator_can_validate_and_the_validator_and_time_persist(): void
    {
        $admin = $this->admin();
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'validated')
            ->assertJsonPath('data.validatedBy', 'Admin Reviewer');

        $fresh = $incident->fresh();
        $this->assertSame('validated', $fresh->validation_status);
        $this->assertSame($admin->id, $fresh->validated_by);
        $this->assertNotNull($fresh->validated_at);

        // Visible on the list endpoint too, which is what the UI reads.
        $row = collect($this->getJson('/api/incidents')->assertOk()->json('data'))
            ->firstWhere('id', (string) $incident->id);
        $this->assertSame('validated', $row['validationStatus']);
        $this->assertSame('Admin Reviewer', $row['validatedBy']);
        $this->assertNotNull($row['validatedAt']);

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'VALIDATE',
            'module' => 'incidents',
            'target_type' => 'incident',
            'description' => "Validated incident {$incident->case_number}",
        ]);
    }

    public function test_validating_does_not_change_the_case_status(): void
    {
        $this->admin();
        $incident = $this->pendingIncident(['status' => 'Under Investigation']);

        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();

        $this->assertSame('Under Investigation', $incident->fresh()->status);
    }

    public function test_an_already_validated_record_cannot_be_validated_twice(): void
    {
        $this->admin();
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertStatus(422);

        $this->assertSame(1, AuditLog::where('action', 'VALIDATE')->count());
    }

    public function test_an_archived_record_cannot_be_validated(): void
    {
        $this->admin();
        $incident = $this->pendingIncident(['status' => 'Archived']);

        $this->putJson("/api/incidents/{$incident->id}/validate")->assertStatus(422);
        $this->assertSame('pending', $incident->fresh()->validation_status);
    }

    // ---------------------------------------------------------------
    // Return for correction
    // ---------------------------------------------------------------

    public function test_an_administrator_can_return_a_record_with_a_reason(): void
    {
        $admin = $this->admin();
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => 'Incident time is missing.'])
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'returned')
            ->assertJsonPath('data.returnedBy', 'Admin Reviewer')
            ->assertJsonPath('data.correctionReason', 'Incident time is missing.');

        $fresh = $incident->fresh();
        $this->assertSame('returned', $fresh->validation_status);
        $this->assertSame($admin->id, $fresh->returned_by);
        $this->assertNotNull($fresh->returned_at);
        $this->assertSame('Incident time is missing.', $fresh->correction_reason);

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'RETURN',
            'target_type' => 'incident',
            'description' => "Returned incident {$incident->case_number} for correction: Incident time is missing.",
        ]);
    }

    public function test_a_correction_reason_is_required(): void
    {
        $this->admin();
        $incident = $this->pendingIncident();

        $this->putJson("/api/incidents/{$incident->id}/return", [])
            ->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => '   '])
            ->assertStatus(422)->assertJsonValidationErrors('reason');

        $this->assertSame('pending', $incident->fresh()->validation_status);
        $this->assertSame(0, AuditLog::where('action', 'RETURN')->count());
    }

    public function test_returning_a_validated_record_withdraws_its_validation(): void
    {
        $admin = $this->admin();
        $incident = $this->pendingIncident([
            'validation_status' => 'validated',
            'validated_by' => $admin->id,
            'validated_at' => now(),
        ]);

        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => 'Victim age is wrong.'])
            ->assertOk()
            ->assertJsonPath('data.validatedBy', null)
            ->assertJsonPath('data.validatedAt', null);

        $fresh = $incident->fresh();
        $this->assertSame('returned', $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);
    }

    // ---------------------------------------------------------------
    // last_edited_by — who last changed the content under review
    // ---------------------------------------------------------------

    public function test_the_last_edited_by_column_exists_and_is_nullable(): void
    {
        $this->assertTrue(Schema::hasColumn('incidents', 'last_edited_by'));

        // Nullable, and null by default: the column is added without a
        // backfill, so every row that predates it stays unattributed.
        $incident = $this->pendingIncident();
        $this->assertNull($incident->fresh()->last_edited_by);
    }

    public function test_deleting_the_editor_nulls_the_reference_rather_than_the_record(): void
    {
        $editor = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['last_edited_by' => $editor->id]);

        $editor->delete();

        $fresh = $incident->fresh();
        $this->assertNotNull($fresh, 'Deleting a user must not delete their incidents.');
        $this->assertNull($fresh->last_edited_by);
    }

    public function test_creating_an_incident_records_the_submitter_but_no_editor(): void
    {
        // Creation is authorship, not an edit. reported_by already says who
        // filed it; last_edited_by means somebody changed it afterwards.
        $encoder = $this->encoder();

        $response = $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2026-7101',
            'crimeType' => 'Theft',
            'date' => '2026-09-01',
            'sitio' => 'Sitio 1',
            'street' => '12 Rizal St.',
            'status' => 'Open',
        ])->assertCreated();

        $incident = Incident::findOrFail($response->json('data.id'));
        $this->assertSame($encoder->id, $incident->reported_by);
        $this->assertNull($incident->last_edited_by);
    }

    public function test_an_administrator_edit_records_the_administrator_as_last_editor(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['reported_by' => $encoder->id]);

        $admin = $this->admin();
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '12 Bonifacio St.'])->assertOk();

        $fresh = $incident->fresh();
        $this->assertSame($admin->id, $fresh->last_edited_by);
        // The submitter is unchanged — the two fields answer different questions.
        $this->assertSame($encoder->id, $fresh->reported_by);
    }

    public function test_an_encoder_correction_records_the_encoder_as_last_editor(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident([
            'reported_by' => $encoder->id,
            'validation_status' => Incident::VALIDATION_RETURNED,
            'correction_reason' => 'Street name is missing.',
        ]);

        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '7 Rizal St.'])->assertOk();

        $this->assertSame($encoder->id, $incident->fresh()->last_edited_by);
    }

    public function test_a_client_cannot_choose_who_the_last_editor_was(): void
    {
        // The same protection the validation columns have: mapToColumns() is an
        // allow-list and the form requests validate no such key, so a crafted
        // body cannot name somebody else as the editor and unblock its own
        // approval.
        $someoneElse = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident();

        $admin = $this->admin();
        $this->putJson("/api/incidents/{$incident->id}", [
            'street' => '3 Mabini St.',
            'lastEditedBy' => $someoneElse->id,
            'last_edited_by' => $someoneElse->id,
        ])->assertOk();

        $this->assertSame($admin->id, $incident->fresh()->last_edited_by);
    }

    public function test_the_last_editor_cannot_validate_the_record(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['reported_by' => $encoder->id]);

        // An Administrator holds edit_any_record, so this is the one role that
        // can both rewrite a record and then approve it.
        $admin = $this->admin();
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '9 Luna St.'])->assertOk();

        $this->putJson("/api/incidents/{$incident->id}/validate")->assertForbidden();

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_PENDING, $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);
        $this->assertSame(0, AuditLog::where('action', 'VALIDATE')->count());
    }

    public function test_a_different_reviewer_can_validate_a_record_someone_else_edited(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $editor = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'name' => 'Editing Admin']);
        $incident = $this->pendingIncident([
            'reported_by' => $encoder->id,
            'last_edited_by' => $editor->id,
        ]);

        $validator = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        $this->actingAsSupabase($validator);

        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();

        $this->assertSame($validator->id, $incident->fresh()->validated_by);
    }

    public function test_a_record_nobody_has_edited_is_reviewed_on_its_submitter_alone(): void
    {
        // last_edited_by null must never match the caller, or every record
        // predating the column would be frozen.
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['reported_by' => $encoder->id, 'last_edited_by' => null]);

        $this->admin();
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();

        $this->assertSame(Incident::VALIDATION_VALIDATED, $incident->fresh()->validation_status);
    }

    public function test_validating_does_not_change_the_last_editor(): void
    {
        $editor = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['last_edited_by' => $editor->id]);

        $this->admin();
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();

        // The reviewer must not become the last editor — that would make every
        // record's editor its reviewer and defeat this guard entirely.
        $this->assertSame($editor->id, $incident->fresh()->last_edited_by);
    }

    public function test_returning_a_record_does_not_change_the_last_editor(): void
    {
        $editor = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['last_edited_by' => $editor->id]);

        $this->admin();
        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => 'Victim age is wrong.'])
            ->assertOk();

        $this->assertSame($editor->id, $incident->fresh()->last_edited_by);
    }

    public function test_archiving_and_restoring_do_not_change_the_last_editor(): void
    {
        $editor = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['last_edited_by' => $editor->id, 'status' => 'Open']);

        $this->admin();
        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();
        $this->assertSame($editor->id, $incident->fresh()->last_edited_by);

        $this->putJson("/api/incidents/{$incident->id}/restore")->assertOk();
        $this->assertSame($editor->id, $incident->fresh()->last_edited_by);
    }

    /**
     * Returning a record must not bind its reviewer to it for ever.
     *
     * B edits and returns; A corrects. A's correction takes over
     * last_edited_by, so B is now reviewing A's words — which is what review
     * is. B must be allowed to validate.
     */
    public function test_a_reviewer_may_validate_after_the_encoder_corrects_what_the_reviewer_edited(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $reviewer = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'name' => 'Reviewing Admin']);
        $incident = $this->pendingIncident(['reported_by' => $encoder->id]);

        // B edits, then returns it.
        $this->actingAsSupabase($reviewer);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '4 Del Pilar St.'])->assertOk();
        $this->assertSame($reviewer->id, $incident->fresh()->last_edited_by);

        $this->putJson("/api/incidents/{$incident->id}/return", ['reason' => 'Street still looks wrong.'])
            ->assertOk();

        // B cannot validate while B's own edit is the newest content.
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertForbidden();

        // A corrects it, taking over last_edited_by.
        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '5 Del Pilar St.'])->assertOk();
        $this->assertSame($encoder->id, $incident->fresh()->last_edited_by);

        // B may now validate, and the 2C cleanup still applies.
        $this->actingAsSupabase($reviewer);
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_VALIDATED, $fresh->validation_status);
        $this->assertSame($reviewer->id, $fresh->validated_by);
        $this->assertSame($encoder->id, $fresh->last_edited_by);
        $this->assertNull($fresh->returned_by);
        $this->assertNull($fresh->returned_at);
        $this->assertNull($fresh->correction_reason);
    }

    // ---------------------------------------------------------------
    // Nobody validates their own submission
    // ---------------------------------------------------------------

    /**
     * Validation is a second pair of eyes. A record approved by the person who
     * filed it has had one pair looking twice, so the approval attests to
     * nothing — and because the record then counts as official, the gap is not
     * cosmetic.
     *
     * Enforced on the server for BOTH validating roles. The Administrator is
     * unrestricted elsewhere in IncidentController and is deliberately not
     * unrestricted here.
     */
    public function test_a_validator_cannot_validate_an_incident_they_submitted(): void
    {
        $validator = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        $incident = $this->pendingIncident(['reported_by' => $validator->id]);

        $this->actingAsSupabase($validator);
        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertForbidden();

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_PENDING, $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);
        $this->assertSame(0, AuditLog::where('action', 'VALIDATE')->count());
    }

    public function test_an_administrator_cannot_validate_an_incident_they_submitted(): void
    {
        $admin = $this->admin();
        $incident = $this->pendingIncident(['reported_by' => $admin->id]);

        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertForbidden();

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_PENDING, $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);
        $this->assertSame(0, AuditLog::where('action', 'VALIDATE')->count());
    }

    public function test_a_different_validator_can_validate_another_users_incident(): void
    {
        $author = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['reported_by' => $author->id]);

        $validator = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR]);
        $this->actingAsSupabase($validator);

        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'validated');

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_VALIDATED, $fresh->validation_status);
        $this->assertSame($validator->id, $fresh->validated_by);
        $this->assertNotNull($fresh->validated_at);
    }

    public function test_a_different_administrator_can_validate_another_users_incident(): void
    {
        $author = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'name' => 'Filing Admin']);
        $incident = $this->pendingIncident(['reported_by' => $author->id]);

        $admin = $this->admin();

        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'validated');

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_VALIDATED, $fresh->validation_status);
        $this->assertSame($admin->id, $fresh->validated_by);
        $this->assertNotNull($fresh->validated_at);
    }

    /**
     * A record whose creator is not recorded — an imported or seeded row —
     * matches nobody. A null creator is an absent one, not the caller, so the
     * record stays validatable and the guard does not quietly freeze history.
     */
    public function test_an_incident_with_no_recorded_submitter_can_still_be_validated(): void
    {
        $incident = $this->pendingIncident(['reported_by' => null]);

        $admin = $this->admin();
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();

        $this->assertSame(Incident::VALIDATION_VALIDATED, $incident->fresh()->validation_status);
    }

    /**
     * A validated record must not also carry a return.
     *
     * Approving a returned record used to set the validated columns and leave
     * returned_by, returned_at and correction_reason exactly as they were.
     * IncidentResource exposes all three, so the record reported that it had
     * been validated AND that it had been sent back, with the reason still
     * attached — two contradictory accounts of the same row.
     */
    public function test_validating_a_returned_record_clears_its_return_metadata(): void
    {
        $returner = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'name' => 'First Reviewer']);
        $incident = $this->pendingIncident([
            'validation_status' => Incident::VALIDATION_RETURNED,
            'returned_by' => $returner->id,
            'returned_at' => now()->subDay(),
            'correction_reason' => 'The victim age contradicts the narrative.',
        ]);

        $validator = User::factory()->create(['role' => User::ROLE_BADAC_VALIDATOR, 'name' => 'Second Reviewer']);
        $this->actingAsSupabase($validator);

        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'validated')
            ->assertJsonPath('data.validatedBy', 'Second Reviewer')
            ->assertJsonPath('data.returnedBy', null)
            ->assertJsonPath('data.returnedAt', null)
            ->assertJsonPath('data.correctionReason', null);

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_VALIDATED, $fresh->validation_status);
        $this->assertSame($validator->id, $fresh->validated_by);
        $this->assertNotNull($fresh->validated_at);
        $this->assertNull($fresh->returned_by);
        $this->assertNull($fresh->returned_at);
        $this->assertNull($fresh->correction_reason);
    }

    /**
     * The same invariant along the route a record actually travels.
     *
     * A returned record is corrected by its Encoder, which resets it to pending
     * and deliberately KEEPS correction_reason so the reviewer can see what was
     * asked for. That is right while the record is pending. Once it is
     * approved, the reason and the return must go with the rejection they
     * belonged to.
     */
    public function test_a_corrected_and_resubmitted_record_keeps_no_return_metadata_once_validated(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $returner = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'name' => 'First Reviewer']);
        $incident = $this->pendingIncident([
            'reported_by' => $encoder->id,
            'validation_status' => Incident::VALIDATION_RETURNED,
            'returned_by' => $returner->id,
            'returned_at' => now()->subDay(),
            'correction_reason' => 'Street name is missing.',
        ]);

        // The Encoder corrects it. Still pending, and the reason is still there
        // on purpose — this assertion pins that existing behaviour.
        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '7 Rizal St.'])
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'pending')
            ->assertJsonPath('data.correctionReason', 'Street name is missing.');

        $admin = $this->admin();
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertOk();

        $fresh = $incident->fresh();
        $this->assertSame(Incident::VALIDATION_VALIDATED, $fresh->validation_status);
        $this->assertSame($admin->id, $fresh->validated_by);
        $this->assertNull($fresh->returned_by);
        $this->assertNull($fresh->returned_at);
        $this->assertNull($fresh->correction_reason);
    }

    // ---------------------------------------------------------------
    // Resubmission
    // ---------------------------------------------------------------

    public function test_an_encoders_correction_resubmits_a_returned_record(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident([
            'reported_by' => $encoder->id,
            'validation_status' => 'returned',
            'correction_reason' => 'Street is missing.',
            'returned_at' => now(),
        ]);

        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '5 Luna St.'])
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'pending')
            // Kept, so the reviewer can see what had been asked for.
            ->assertJsonPath('data.correctionReason', 'Street is missing.');

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'UPDATE',
            'description' => "Updated incident {$incident->case_number} and resubmitted it for validation",
        ]);
    }

    public function test_an_encoder_editing_a_validated_record_sends_it_back_to_pending(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident([
            'reported_by' => $encoder->id,
            'validation_status' => 'validated',
            'validated_by' => $admin->id,
            'validated_at' => now(),
        ]);

        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '5 Luna St.'])->assertOk();

        $fresh = $incident->fresh();
        $this->assertSame('pending', $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);
    }

    public function test_an_administrator_edit_keeps_the_validation_state(): void
    {
        $admin = $this->admin();
        $incident = $this->pendingIncident([
            'validation_status' => 'validated',
            'validated_by' => $admin->id,
            'validated_at' => now(),
        ]);

        $this->putJson("/api/incidents/{$incident->id}", ['street' => '5 Luna St.'])->assertOk();

        $this->assertSame('validated', $incident->fresh()->validation_status);
        $this->assertSame($admin->id, $incident->fresh()->validated_by);
    }

    public function test_an_encoder_cannot_keep_a_record_validated_with_crafted_request_data(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident([
            'reported_by' => $encoder->id,
            'validation_status' => 'validated',
            'validated_by' => $admin->id,
            'validated_at' => now(),
        ]);

        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", [
            'street' => '9 Mabini St.',
            'validationStatus' => 'validated',
            'validation_status' => 'validated',
            'validatedBy' => $admin->id,
            'validated_by' => $admin->id,
            'validatedAt' => now()->toIso8601String(),
            'validated_at' => now()->toDateTimeString(),
        ])
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'pending')
            ->assertJsonPath('data.validatedBy', null);

        $fresh = $incident->fresh();
        $this->assertSame('9 Mabini St.', $fresh->street);
        $this->assertSame('pending', $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);
    }

    public function test_an_administrator_cannot_change_validation_state_through_crafted_update_data(): void
    {
        $admin = $this->admin();
        $incident = $this->pendingIncident([
            'validation_status' => 'validated',
            'validated_by' => $admin->id,
            'validated_at' => now(),
        ]);

        $this->putJson("/api/incidents/{$incident->id}", [
            'street' => '5 Luna St.',
            'validationStatus' => 'pending',
            'validation_status' => 'pending',
            'validated_by' => null,
        ])->assertOk()->assertJsonPath('data.validationStatus', 'validated');

        $fresh = $incident->fresh();
        $this->assertSame('5 Luna St.', $fresh->street);
        $this->assertSame('validated', $fresh->validation_status);
        $this->assertSame($admin->id, $fresh->validated_by);
        $this->assertNotNull($fresh->validated_at);
    }

    /**
     * The C1 race, reproduced deterministically.
     *
     * Route model binding loads the incident while it is still pending. Before
     * the controller body runs, an Administrator's validation is committed to
     * the same row — exactly the interleaving two concurrent requests produce.
     * The hook is the container's `resolving` callback for the form request,
     * which Laravel fires after SubstituteBindings and before the controller
     * method, so the controller really does receive a stale in-memory model.
     *
     * Deciding from that stale copy left the record 'validated' with the
     * Encoder's unreviewed street. The update must instead decide from the row
     * as it is at write time.
     *
     * Limitation: the suite runs on in-memory SQLite, where lockForUpdate() is
     * a no-op and two requests cannot truly run in parallel, so this proves the
     * stale-read bug is gone rather than exercising Postgres row locks. The
     * lock's ordering guarantee is documented in IncidentController::update().
     */
    public function test_a_validation_committed_after_the_encoder_request_loaded_the_record_cannot_survive_the_edit(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident(['reported_by' => $encoder->id, 'street' => 'Old St.']);

        $staleModelObserved = false;
        $this->app->resolving(UpdateIncidentRequest::class, function () use ($incident, $admin, &$staleModelObserved) {
            DB::table('incidents')->where('id', $incident->id)->update([
                'validation_status' => 'validated',
                'validated_by' => $admin->id,
                'validated_at' => now(),
            ]);

            // Proof the interleaving is real: the model the controller is about
            // to receive was bound before the validation and still says pending.
            $bound = request()->route('incident');
            $staleModelObserved = $bound instanceof Incident
                && $bound->validation_status === 'pending'
                && DB::table('incidents')->where('id', $incident->id)->value('validation_status') === 'validated';
        });

        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => 'Unreviewed St.'])
            ->assertOk()
            ->assertJsonPath('data.street', 'Unreviewed St.')
            ->assertJsonPath('data.validationStatus', 'pending');

        $this->assertTrue($staleModelObserved, 'The controller must have received a stale, pre-validation model.');

        $fresh = $incident->fresh();
        $this->assertSame('Unreviewed St.', $fresh->street);
        $this->assertSame('pending', $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);

        // The audit trail reflects what actually happened to the row.
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $encoder->id,
            'action' => 'UPDATE',
            'description' => "Updated incident {$incident->case_number} and resubmitted it for validation",
        ]);
    }

    public function test_an_administrator_can_validate_the_record_again_after_an_encoder_resubmits_it(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'name' => 'Second Review']);
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = $this->pendingIncident([
            'reported_by' => $encoder->id,
            'validation_status' => 'validated',
            'validated_by' => $admin->id,
            'validated_at' => now()->subDay(),
        ]);

        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$incident->id}", ['street' => '7 Rizal St.'])
            ->assertOk()->assertJsonPath('data.validationStatus', 'pending');

        $this->actingAsSupabase($admin);
        $this->putJson("/api/incidents/{$incident->id}/validate")
            ->assertOk()
            ->assertJsonPath('data.validationStatus', 'validated')
            ->assertJsonPath('data.validatedBy', 'Second Review');
    }

    // ---------------------------------------------------------------
    // Historical records and filtering
    // ---------------------------------------------------------------

    public function test_the_migration_backfilled_existing_rows_as_validated_without_inventing_a_validator(): void
    {
        // Simulates a pre-existing row the way the migration found it, then
        // re-runs the migration's backfill statement against it.
        $migration = require database_path('migrations/2026_09_17_000001_add_validation_workflow_to_incidents.php');
        $incident = Incident::factory()->create();

        $migration->down();
        $migration->up();

        $fresh = $incident->fresh();
        $this->assertSame('validated', $fresh->validation_status);
        $this->assertNull($fresh->validated_by);
        $this->assertNull($fresh->validated_at);

        // And the column default for rows written afterwards is pending.
        $id = DB::table('incidents')->insertGetId([
            'incident_code' => 'INC-RAW-1',
            'case_number' => 'CN-RAW-1',
            'crime_type' => 'Theft',
            'incident_date' => '2026-09-01',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertSame('pending', DB::table('incidents')->where('id', $id)->value('validation_status'));
    }

    public function test_the_list_can_be_filtered_by_validation_status(): void
    {
        $this->admin();
        $this->pendingIncident();
        $this->pendingIncident(['validation_status' => 'validated']);
        $this->pendingIncident(['validation_status' => 'returned']);

        $this->getJson('/api/incidents?validationStatus=pending')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/incidents?validationStatus=validated')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/incidents')->assertOk()->assertJsonCount(3, 'data');
    }
}
