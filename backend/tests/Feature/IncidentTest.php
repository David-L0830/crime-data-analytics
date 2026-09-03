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
        Incident::factory()->create(['status' => 'Open']);

        $row = $this->getJson('/api/incidents/map')->assertOk()->json()[0];

        // Pinned as an exact set: an addition here is a privacy decision and
        // should have to be made deliberately, in this test, rather than
        // arriving as a side effect. Note 'location' — the street is exposed
        // under that name, which is what the map's popup reads.
        $this->assertSame([
            'id', 'latitude', 'longitude', 'caseNumber', 'crimeType',
            'date', 'time', 'location', 'sitio', 'status', 'priority',
        ], array_keys($row));
    }

    public function test_the_map_payload_omits_archived_and_uncoordinated_incidents(): void
    {
        $this->actingUser();

        Incident::factory()->create(['status' => 'Open']);
        Incident::factory()->create(['status' => 'Archived']);
        Incident::factory()->create(['status' => 'Open', 'latitude' => null, 'longitude' => null]);

        // The endpoint filters server-side, so the page receives only plottable,
        // non-archived incidents.
        $this->assertCount(1, $this->getJson('/api/incidents/map')->assertOk()->json());
    }

    public function test_the_map_endpoint_requires_authentication(): void
    {
        $this->getJson('/api/incidents/map')->assertUnauthorized();
    }
}
