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

    private function actingAsSupabase(User $user, string $aal = 'aal2'): static
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
}
