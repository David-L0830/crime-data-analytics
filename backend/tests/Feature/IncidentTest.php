<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Checkpoint 38 — the 'supabase.mfa' (EnsureSupabaseAal2) middleware has
// been removed from every route in routes/api.php; GET/POST/PUT /incidents*
// now only require 'auth:supabase' (+ role/ownership where applicable). This
// file still authenticates through a genuine signed test JWT (via
// actingAsSupabase(), same test-only shared-secret mechanism used
// throughout this suite) rather than actingAs(), so it exercises the real
// SupabaseTokenValidator path and can reach the actual role/ownership logic
// under test.
class IncidentTest extends TestCase
{
    use RefreshDatabase;

    protected function actingAsSupabase(User $user, string $aal = 'aal2'): static
    {
        if (! $user->supabase_user_id) {
            $user->forceFill(['supabase_user_id' => 'supabase-test-'.$user->id])->save();
        }

        $now = time();
        $claims = [
            'sub' => $user->supabase_user_id,
            'aud' => 'authenticated',
            'iss' => rtrim(config('supabase.url'), '/').'/auth/v1',
            'email' => $user->email,
            'email_verified' => true,
            'aal' => $aal,
            'iat' => $now,
            'exp' => $now + 3600,
        ];

        $token = JWT::encode($claims, config('supabase.jwt_secret'), 'HS256');

        return $this->withHeader('Authorization', 'Bearer '.$token);
    }

    private function actingUser(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    public function test_can_list_incidents(): void
    {
        $this->actingUser();
        Incident::factory()->count(3)->create();

        $this->getJson('/api/incidents')->assertOk()->assertJsonCount(3, 'data');
    }

    public function test_can_view_a_single_incident(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create();

        $this->getJson("/api/incidents/{$incident->id}")
            ->assertOk()
            ->assertJsonPath('data.caseNumber', $incident->case_number);
    }

    public function test_can_create_an_incident(): void
    {
        $this->actingUser();

        $payload = [
            'caseNumber' => 'CN-2025-9999',
            'crimeType' => 'Theft',
            'date' => '2025-06-01',
            'sitio' => 'Sitio 1',
            'street' => '12 Rizal St.',
            'status' => 'Open',
        ];

        $this->postJson('/api/incidents', $payload)
            ->assertCreated()
            ->assertJsonPath('data.caseNumber', 'CN-2025-9999');

        $this->assertDatabaseHas('incidents', ['case_number' => 'CN-2025-9999']);
    }

    public function test_incident_requires_case_number_and_sitio(): void
    {
        $this->actingUser();

        $this->postJson('/api/incidents', ['crimeType' => 'Theft', 'date' => '2025-06-01'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['caseNumber', 'sitio']);
    }

    public function test_can_update_an_incident(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}", ['status' => 'Solved'])
            ->assertOk()
            ->assertJsonPath('data.status', 'Solved');
    }

    // ===== crimeType must name a real crime_types row =====
    //
    // incidents.crime_type stores this vocabulary's name as a plain string —
    // no foreign key — so without this validation a caller could record an
    // incident against a crime type System Settings has never heard of,
    // orphaned from the map legend and every crime-type-grouped chart.
    // create_crime_types_table seeds a dozen real types (Theft, Robbery,
    // Assault among them — see CrimeTypeTest), so every existing test that
    // posts one of those names is unaffected.

    public function test_crime_type_must_exist_when_creating_an_incident(): void
    {
        $this->actingUser();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2025-9998',
            'crimeType' => 'Not A Real Crime Type',
            'date' => '2025-06-01',
            'sitio' => 'Sitio 1',
        ])->assertUnprocessable()->assertJsonValidationErrors(['crimeType']);

        $this->assertDatabaseMissing('incidents', ['case_number' => 'CN-2025-9998']);
    }

    public function test_crime_type_must_exist_when_updating_an_incident(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['crime_type' => 'Theft']);

        $this->putJson("/api/incidents/{$incident->id}", ['crimeType' => 'Not A Real Crime Type'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['crimeType']);

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'crime_type' => 'Theft']);
    }

    // ===== 'Archived' is not a client-assignable status =====
    //
    // Archiving is a two-column write: previous_status must capture the status
    // being left at the same moment status becomes 'Archived'. Only
    // IncidentController::archive() does that, and it also refuses a second
    // archive and writes the ARCHIVE audit event. A create or update carrying
    // status: 'Archived' reached the same column through
    // Rule::in(Incident::STATUSES) while doing none of it, leaving a row that
    // restore() could only send back to DEFAULT_STATUS. Store/Update now
    // validate against Incident::ASSIGNABLE_STATUSES instead; STATUSES stays
    // the full vocabulary the Status filters display.

    public function test_creating_an_incident_with_status_archived_is_rejected(): void
    {
        $this->actingUser();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2025-9997',
            'crimeType' => 'Theft',
            'date' => '2025-06-01',
            'sitio' => 'Sitio 1',
            'status' => 'Archived',
        ])->assertUnprocessable()->assertJsonValidationErrors(['status']);

        $this->assertDatabaseMissing('incidents', ['case_number' => 'CN-2025-9997']);
    }

    public function test_updating_an_incident_to_status_archived_is_rejected(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}", ['status' => 'Archived'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        // Neither column moved: the row is still Open, and nothing wrote a
        // previous_status behind the archive endpoint's back.
        $this->assertDatabaseHas('incidents', [
            'id' => $incident->id,
            'status' => 'Open',
            'previous_status' => null,
        ]);
    }

    public function test_the_other_statuses_are_still_assignable(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Open']);

        // Guard against over-tightening: only 'Archived' was removed.
        foreach (Incident::ASSIGNABLE_STATUSES as $status) {
            $this->putJson("/api/incidents/{$incident->id}", ['status' => $status])
                ->assertOk()
                ->assertJsonPath('data.status', $status);
        }
    }

    public function test_editing_an_archived_incident_without_a_status_leaves_it_archived(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Archived', 'previous_status' => 'Solved']);

        // What the edit form now sends for an archived record: the status key
        // is omitted entirely, so mapToColumns() never touches the column and
        // the details can still be corrected.
        $this->putJson("/api/incidents/{$incident->id}", ['description' => 'Corrected narrative.'])
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');

        $this->assertDatabaseHas('incidents', [
            'id' => $incident->id,
            'status' => 'Archived',
            'previous_status' => 'Solved',
            'description' => 'Corrected narrative.',
        ]);
    }

    // ===== previous_status is server-controlled =====
    //
    // It is absent from Store/UpdateIncidentRequest::rules() and from
    // IncidentController::mapToColumns(), so a client-supplied value never
    // reaches validated() and never reaches the column. These pin that: the
    // restore target is decided by what archive() recorded, not by whatever
    // the caller claims the record used to be.

    public function test_previous_status_cannot_be_set_when_creating_an_incident(): void
    {
        $this->actingUser();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2025-9996',
            'crimeType' => 'Theft',
            'date' => '2025-06-01',
            'sitio' => 'Sitio 1',
            'status' => 'Open',
            'previous_status' => 'Solved',
            'previousStatus' => 'Solved',
        ])->assertCreated();

        $this->assertDatabaseHas('incidents', [
            'case_number' => 'CN-2025-9996',
            'previous_status' => null,
        ]);
    }

    public function test_previous_status_cannot_be_forged_when_updating_an_incident(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Archived', 'previous_status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}", [
            'previous_status' => 'Solved',
            'previousStatus' => 'Solved',
        ])->assertOk();

        $this->assertDatabaseHas('incidents', [
            'id' => $incident->id,
            'previous_status' => 'Open',
        ]);
    }

    public function test_a_forged_previous_status_cannot_change_where_restore_sends_an_incident(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Under Investigation']);

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();

        // The caller tries to rewrite history before restoring.
        $this->putJson("/api/incidents/{$incident->id}", [
            'previous_status' => 'Solved',
            'previousStatus' => 'Solved',
        ])->assertOk();

        // Restore still uses what archive() captured.
        $this->putJson("/api/incidents/{$incident->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Under Investigation');
    }

    public function test_can_archive_an_incident(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Archived']);
    }

    public function test_archiving_an_incident_does_not_delete_the_row(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create();

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id]);
    }

    public function test_archiving_an_incident_creates_an_archive_audit_event(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create();

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'ARCHIVE',
            'target_type' => 'incident',
        ]);
        $this->assertDatabaseMissing('audit_logs', [
            'action' => 'DELETE',
            'target_type' => 'incident',
        ]);
    }

    public function test_encoder_can_archive_their_own_incident(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = Incident::factory()->create(['reported_by' => $encoder->id]);

        $this->actingAsSupabase($encoder)
            ->putJson("/api/incidents/{$incident->id}/archive")
            ->assertOk();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Archived']);
    }

    public function test_encoder_cannot_archive_another_encoders_incident(): void
    {
        $owner = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $otherEncoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = Incident::factory()->create(['reported_by' => $owner->id, 'status' => 'Open']);

        $this->actingAsSupabase($otherEncoder)
            ->putJson("/api/incidents/{$incident->id}/archive")
            ->assertForbidden();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Open']);
    }

    public function test_unauthenticated_user_cannot_archive_an_incident(): void
    {
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertUnauthorized();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Open']);
    }

    public function test_admin_can_archive_any_encoders_incident(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = Incident::factory()->create(['reported_by' => $encoder->id]);

        $this->actingUser(); // admin
        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Archived']);
    }

    public function test_archiving_an_already_archived_incident_is_rejected(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Archived', 'previous_status' => 'Solved']);

        $this->putJson("/api/incidents/{$incident->id}/archive")->assertStatus(422);

        // The guard exists specifically so a second archive can never
        // overwrite the real previous_status with 'Archived'.
        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'previous_status' => 'Solved']);
    }

    // ===== PUT /incidents/{incident}/restore — the inverse of archive() =====

    public function test_can_restore_an_archived_incident_to_its_previous_status(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Open']);
        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();

        $this->putJson("/api/incidents/{$incident->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Open');

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Open', 'previous_status' => null]);
    }

    public function test_restoring_an_incident_with_no_previous_status_falls_back_to_the_default(): void
    {
        $this->actingUser();
        // Archived directly (bypassing archive()), so previous_status is null —
        // the same shape a pre-migration archived row would have.
        $incident = Incident::factory()->create(['status' => 'Archived', 'previous_status' => null]);

        $this->putJson("/api/incidents/{$incident->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.status', 'Open');
    }

    public function test_restoring_a_non_archived_incident_is_rejected(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}/restore")->assertStatus(422);
    }

    public function test_restoring_an_incident_creates_a_restore_audit_event(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['status' => 'Open']);
        $this->putJson("/api/incidents/{$incident->id}/archive")->assertOk();

        $this->putJson("/api/incidents/{$incident->id}/restore")->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'RESTORE',
            'target_type' => 'incident',
        ]);
    }

    public function test_encoder_can_restore_their_own_incident(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = Incident::factory()->create(['reported_by' => $encoder->id, 'status' => 'Archived', 'previous_status' => 'Open']);

        $this->actingAsSupabase($encoder)
            ->putJson("/api/incidents/{$incident->id}/restore")
            ->assertOk();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Open']);
    }

    public function test_encoder_cannot_restore_another_encoders_incident(): void
    {
        $owner = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $otherEncoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $incident = Incident::factory()->create(['reported_by' => $owner->id, 'status' => 'Archived', 'previous_status' => 'Open']);

        $this->actingAsSupabase($otherEncoder)
            ->putJson("/api/incidents/{$incident->id}/restore")
            ->assertForbidden();

        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'Archived']);
    }

    public function test_unauthenticated_user_cannot_restore_an_incident(): void
    {
        $incident = Incident::factory()->create(['status' => 'Archived', 'previous_status' => 'Open']);

        $this->putJson("/api/incidents/{$incident->id}/restore")->assertUnauthorized();
    }

    // ===== GET /incidents/map — the privacy contract =====
    //
    // These are REGRESSION GUARDS, not a fix. IncidentController::map() already
    // behaves this way; nothing in the endpoint changes here. They exist because
    // the contract was entirely unpinned — no test covered this route at all —
    // while the Crime Mapping page is being switched over to consume it
    // precisely so that identifying details stop reaching the browser. A
    // payload this deliberately narrow should not be able to widen unnoticed.

    public function test_the_map_payload_excludes_identifying_details(): void
    {
        $this->actingUser();

        Incident::factory()->create([
            'validation_status' => Incident::VALIDATION_VALIDATED,

            'status' => 'Open',
            'victim_name' => 'Maria Santos',
            'victim_age' => 34,
            'victim_gender' => 'Female',
            'suspect_name' => 'Juan Dela Cruz',
            'suspect_age' => 41,
            'complainant_name' => 'Pedro Reyes',
            'complainant_contact' => '09171234567',
            'complainant_address' => '12 Rizal St.',
            'description' => 'Narrative that must not travel to the map.',
            'reporting_officer' => 'PO1 Cruz',
        ]);

        $response = $this->getJson('/api/incidents/map')->assertOk();
        $row = $response->json()[0];

        // A map pin is a location. Identifying a named individual by a dot on a
        // screen that can be projected in a barangay hall is the disclosure this
        // endpoint exists to avoid.
        foreach ([
            'victimName', 'victim_name', 'victimAge', 'victimGender',
            'suspectName', 'suspect_name', 'suspectAge',
            'complainantName', 'complainant_name', 'complainantContact',
            'complainantAddress', 'description', 'reportingOfficer',
        ] as $forbidden) {
            $this->assertArrayNotHasKey($forbidden, $row);
        }

        // And the values themselves, in case a field is ever renamed rather
        // than removed.
        $encoded = $response->getContent();
        $this->assertStringNotContainsString('Maria Santos', $encoded);
        $this->assertStringNotContainsString('Juan Dela Cruz', $encoded);
        $this->assertStringNotContainsString('Pedro Reyes', $encoded);
        $this->assertStringNotContainsString('09171234567', $encoded);
    }

    public function test_the_map_payload_carries_exactly_the_fields_the_map_needs(): void
    {
        $this->actingUser();
        Incident::factory()->create([
            'validation_status' => Incident::VALIDATION_VALIDATED,
            'status' => 'Open']);

        $row = $this->getJson('/api/incidents/map')->assertOk()->json()[0];

        // Pinned as an exact set: an addition here is a privacy decision and
        // should have to be made deliberately, in this test, rather than
        // arriving as a side effect. Note 'location' — the street is exposed
        // under that name, which is what the map's popup reads.
        //
        // 'incidentCode' and 'category' were added deliberately, here, when the
        // map's click-popup became a hover tooltip: both identify and classify
        // a case without naming any person, which is the line this payload
        // draws. Nothing about a victim, complainant or suspect may join them.
        $this->assertSame([
            'id', 'latitude', 'longitude', 'incidentCode', 'caseNumber', 'category',
            'crimeType', 'date', 'time', 'location', 'sitio', 'status', 'priority',
        ], array_keys($row));
    }

    public function test_the_map_payload_omits_archived_and_uncoordinated_incidents(): void
    {
        $this->actingUser();

        Incident::factory()->create([
            'validation_status' => Incident::VALIDATION_VALIDATED,
            'status' => 'Open']);
        Incident::factory()->create([
            'validation_status' => Incident::VALIDATION_VALIDATED,
            'status' => 'Archived']);
        Incident::factory()->create([
            'validation_status' => Incident::VALIDATION_VALIDATED,
            'status' => 'Open', 'latitude' => null, 'longitude' => null]);

        // The endpoint filters server-side, so the page receives only plottable,
        // non-archived incidents.
        $this->assertCount(1, $this->getJson('/api/incidents/map')->assertOk()->json());
    }

    // ===== CP-5A — the map plots OFFICIAL data only =====
    //
    // A pin on a map that gets projected in the barangay hall asserts that a
    // crime happened at that spot. An encoding nobody has reviewed has not
    // earned that assertion, so the endpoint withholds it rather than leaving
    // the page to decide. Filtered server-side on purpose: the payload never
    // carries validation_status, because a workflow field has no business in a
    // projection whose whole rule is that it carries the minimum the map needs.

    public function test_the_map_payload_includes_validated_non_archived_incidents(): void
    {
        $this->actingUser();

        Incident::factory()->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ]);

        $this->assertCount(1, $this->getJson('/api/incidents/map')->assertOk()->json());
    }

    public function test_the_map_payload_omits_pending_incidents(): void
    {
        $this->actingUser();

        Incident::factory()->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $this->assertCount(0, $this->getJson('/api/incidents/map')->assertOk()->json());
    }

    public function test_the_map_payload_omits_returned_incidents(): void
    {
        $this->actingUser();

        Incident::factory()->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);

        $this->assertCount(0, $this->getJson('/api/incidents/map')->assertOk()->json());
    }

    public function test_the_map_payload_omits_a_validated_but_archived_incident(): void
    {
        // The archive rule is independent of the new one: being reviewed does
        // not put a retired case back on the barangay's current map.
        $this->actingUser();

        Incident::factory()->create([
            'status' => 'Archived',
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ]);

        $this->assertCount(0, $this->getJson('/api/incidents/map')->assertOk()->json());
    }

    public function test_the_map_payload_plots_only_the_official_incident_of_a_mixed_set(): void
    {
        $this->actingUser();

        $official = Incident::factory()->create([
            'case_number' => 'CN-OFFICIAL',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-PENDING',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-RETURNED',
            'status' => 'Under Investigation',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-ARCHIVED-VALIDATED',
            'status' => 'Archived',
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-ARCHIVED-PENDING',
            'status' => 'Archived',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $rows = $this->getJson('/api/incidents/map')->assertOk()->json();

        $this->assertCount(1, $rows);
        $this->assertSame($official->case_number, $rows[0]['caseNumber']);
    }

    public function test_the_map_payload_still_withholds_the_field_it_filters_on(): void
    {
        // The filtering happens in the query, not by handing the client a
        // workflow column to filter on itself.
        $this->actingUser();

        Incident::factory()->create([
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ]);

        $response = $this->getJson('/api/incidents/map')->assertOk();

        $this->assertArrayNotHasKey('validationStatus', $response->json()[0]);
        $this->assertArrayNotHasKey('validation_status', $response->json()[0]);
        $this->assertStringNotContainsString('validation', $response->getContent());
    }

    public function test_the_map_endpoint_requires_authentication(): void
    {
        $this->getJson('/api/incidents/map')->assertUnauthorized();
    }

    // ===== An incident cannot be dated in the future =====
    //
    // `date` alone accepted any parseable date, so a mis-keyed year (2026 typed
    // as 2062) was storable. Such a record is not merely wrong, it is invisible:
    // it sits beyond every dashboard date range and drags trend lines with it.
    // Today remains valid because reports are very often encoded the same day.

    public function test_a_future_dated_incident_is_rejected(): void
    {
        $this->actingUser();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2025-7001',
            'crimeType' => 'Theft',
            'date' => now()->addDay()->format('Y-m-d'),
            'sitio' => 'Sitio 1',
        ])->assertUnprocessable()->assertJsonValidationErrors(['date']);

        $this->assertDatabaseMissing('incidents', ['case_number' => 'CN-2025-7001']);
    }

    public function test_an_incident_dated_today_is_accepted(): void
    {
        $this->actingUser();

        $this->postJson('/api/incidents', [
            'caseNumber' => 'CN-2025-7002',
            'crimeType' => 'Theft',
            'date' => now()->format('Y-m-d'),
            'sitio' => 'Sitio 1',
        ])->assertCreated();

        $this->assertDatabaseHas('incidents', ['case_number' => 'CN-2025-7002']);
    }

    public function test_updating_an_incident_to_a_future_date_is_rejected(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create(['incident_date' => '2026-01-15']);

        $this->putJson("/api/incidents/{$incident->id}", [
            'date' => now()->addYear()->format('Y-m-d'),
        ])->assertUnprocessable()->assertJsonValidationErrors(['date']);

        // The stored date is untouched: a rejected edit changes nothing.
        $this->assertDatabaseHas('incidents', [
            'id' => $incident->id,
            'incident_date' => '2026-01-15',
        ]);
    }

    public function test_updating_an_incident_without_changing_its_date_still_works(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create([
            'incident_date' => '2026-01-15',
            'status' => 'Open',
        ]);

        // `sometimes` must keep an edit that omits `date` entirely out of the
        // new rule's way, otherwise every existing record becomes uneditable.
        $this->putJson("/api/incidents/{$incident->id}", ['status' => 'Solved'])
            ->assertOk()
            ->assertJsonPath('data.status', 'Solved');

        $this->assertDatabaseHas('incidents', [
            'id' => $incident->id,
            'incident_date' => '2026-01-15',
        ]);
    }
}
