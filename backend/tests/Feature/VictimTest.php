<?php

namespace Tests\Feature;

use App\Models\Criminal;
use App\Models\Incident;
use App\Models\User;
use App\Models\Victim;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Checkpoint 38 — the 'supabase.mfa' (EnsureSupabaseAal2) middleware has
// been removed from every route. Victim/Criminal routes now carry only
// 'auth:supabase' + 'role:badac_admin[,badac_readonly]' — see
// routes/api.php. actingAs() alone still leaves no 'supabase_aal' request
// attribute (it never goes through SupabaseTokenValidator at all), so tests
// that actually hit a protected HTTP endpoint use actingSupabaseAdmin()
// (same real signed-JWT mechanism as IncidentTest /
// SupabaseTokenValidationTest); tests that only exercise models/
// relationships directly, with no HTTP request, keep the plain
// actingUser()/actingAs() they had
// before, since the Supabase guard is never in play for them.
class VictimTest extends TestCase
{
    use RefreshDatabase;

    private function actingUser(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAs($user);

        return $user;
    }

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

    private function actingSupabaseAdmin(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    public function test_can_list_victims(): void
    {
        $this->actingSupabaseAdmin();
        Victim::factory()->count(2)->create();

        $this->getJson('/api/victims')->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_can_view_a_victim_profile_with_related_cases(): void
    {
        $this->actingSupabaseAdmin();
        $victim = Victim::factory()->create();
        $incident = Incident::factory()->create();
        $victim->relatedIncidents()->attach($incident->id);

        $this->getJson("/api/victims/{$victim->id}")
            ->assertOk()
            ->assertJsonPath('data.fullName', $victim->full_name)
            ->assertJsonPath('data.relatedCases.0.caseNumber', $incident->case_number);
    }

    public function test_can_create_a_victim_and_attach_it_to_a_case(): void
    {
        $this->actingSupabaseAdmin();
        $incident = Incident::factory()->create();

        $response = $this->postJson('/api/victims', [
            'fullName' => 'Juan Dela Cruz',
            'gender' => 'Male',
            'incidentIds' => [$incident->id],
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.fullName', 'Juan Dela Cruz')
            ->assertJsonPath('data.relatedCases.0.id', (string) $incident->id);
    }

    public function test_can_update_a_victim_record(): void
    {
        $this->actingSupabaseAdmin();
        $victim = Victim::factory()->create(['civil_status' => 'Single']);

        $this->putJson("/api/victims/{$victim->id}", ['civilStatus' => 'Married'])
            ->assertOk()
            ->assertJsonPath('data.civilStatus', 'Married');
    }

    public function test_a_case_can_have_multiple_victims(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create();
        $victims = Victim::factory()->count(2)->create();
        $incident->victims()->attach($victims->pluck('id'));

        $this->assertCount(2, $incident->fresh()->victims);
    }

    public function test_the_same_victim_can_belong_to_multiple_cases(): void
    {
        $this->actingUser();
        $victim = Victim::factory()->create();
        $incidents = Incident::factory()->count(2)->create();
        $victim->relatedIncidents()->attach($incidents->pluck('id'));

        $this->assertCount(2, $victim->fresh()->relatedIncidents);
    }

    public function test_deleting_a_criminal_does_not_delete_the_case_victims(): void
    {
        $this->actingUser();
        $incident = Incident::factory()->create();
        $criminal = Criminal::factory()->create();
        $criminal->relatedIncidents()->attach($incident->id);
        $victim = Victim::factory()->create();
        $incident->victims()->attach($victim->id);

        $criminal->delete();

        $this->assertDatabaseHas('victims', ['id' => $victim->id]);
        $this->assertDatabaseHas('incident_victim', ['incident_id' => $incident->id, 'victim_id' => $victim->id]);
    }

    public function test_criminal_profile_exposes_victim_information_grouped_by_case(): void
    {
        $this->actingSupabaseAdmin();
        $incident = Incident::factory()->create();
        $criminal = Criminal::factory()->create();
        $criminal->relatedIncidents()->attach($incident->id);
        $victim = Victim::factory()->create();
        $incident->victims()->attach($victim->id);

        $this->getJson("/api/criminals/{$criminal->id}")
            ->assertOk()
            ->assertJsonPath('data.relatedIncidents.0.victims.0.fullName', $victim->full_name);
    }

    public function test_criminal_profile_handles_a_case_with_no_victims(): void
    {
        $this->actingSupabaseAdmin();
        $incident = Incident::factory()->create();
        $criminal = Criminal::factory()->create();
        $criminal->relatedIncidents()->attach($incident->id);

        $this->getJson("/api/criminals/{$criminal->id}")
            ->assertOk()
            ->assertJsonPath('data.relatedIncidents.0.victims', []);
    }

    public function test_new_victims_default_to_active_status(): void
    {
        $victim = Victim::factory()->create();

        $this->assertSame('Active', $victim->fresh()->status);
    }

    public function test_can_archive_a_victim(): void
    {
        $this->actingSupabaseAdmin();
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'Archived');

        $this->assertDatabaseHas('victims', ['id' => $victim->id, 'status' => 'Archived']);
    }

    public function test_archiving_a_victim_does_not_delete_the_row(): void
    {
        $this->actingSupabaseAdmin();
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}/archive")->assertOk();

        $this->assertDatabaseHas('victims', ['id' => $victim->id]);
    }

    public function test_archiving_a_victim_creates_an_archive_audit_event(): void
    {
        $this->actingSupabaseAdmin();
        $victim = Victim::factory()->create();

        $this->putJson("/api/victims/{$victim->id}/archive")->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'ARCHIVE',
            'target_type' => 'victim',
        ]);
        $this->assertDatabaseMissing('audit_logs', [
            'action' => 'DELETE',
            'target_type' => 'victim',
        ]);
    }
}
