<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Complainant vs victim.
 *
 * The victim is the person the crime happened to; the complainant is the
 * person who actually walked in and filed the report. They are usually the
 * same person, but when the victim is hospitalised, a minor or otherwise
 * unable to report, somebody else does it for them, and the blotter has to
 * record who that was and how they are related.
 */
class ComplainantTest extends TestCase
{
    use RefreshDatabase;

    private function encoder(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'caseNumber' => 'CN-2026-0001',
            'crimeType' => 'Theft',
            'date' => '2026-05-01',
            'sitio' => 'Sitio 1',
            'street' => '12 Rizal St.',
            'status' => 'Open',
            'victimName' => 'Juan Dela Cruz',
        ], $overrides);
    }

    public function test_an_incident_defaults_to_the_complainant_being_the_victim(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.complainantIsVictim', true)
            ->assertJsonPath('data.complainantName', null);
    }

    public function test_a_separate_complainant_is_stored_in_its_own_columns(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'complainantIsVictim' => false,
            'complainantName' => 'Maria Dela Cruz',
            'complainantRelationship' => 'Mother',
            'complainantContact' => '0917 555 0101',
            'complainantAddress' => '14 Rizal St., Sitio 1',
        ]))
            ->assertCreated()
            ->assertJsonPath('data.complainantIsVictim', false)
            ->assertJsonPath('data.complainantName', 'Maria Dela Cruz')
            ->assertJsonPath('data.complainantRelationship', 'Mother')
            ->assertJsonPath('data.complainantContact', '0917 555 0101');

        // Structured columns, not text glued onto the description — the whole
        // point of the feature.
        $this->assertDatabaseHas('incidents', [
            'case_number' => 'CN-2026-0001',
            'victim_name' => 'Juan Dela Cruz',
            'complainant_name' => 'Maria Dela Cruz',
            'complainant_relationship' => 'Mother',
        ]);
    }

    public function test_a_complainant_name_is_required_when_the_complainant_is_not_the_victim(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'complainantIsVictim' => false,
            'complainantRelationship' => 'Mother',
        ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('complainantName');
    }

    public function test_saying_the_complainant_is_the_victim_clears_any_separate_complainant_details(): void
    {
        // Somebody corrects a record: the second person was entered by
        // mistake. Ticking the box must actually remove their name and phone
        // number, not just hide the fields.
        $this->encoder();

        $created = $this->postJson('/api/incidents', $this->payload([
            'complainantIsVictim' => false,
            'complainantName' => 'Maria Dela Cruz',
            'complainantContact' => '0917 555 0101',
        ]))->assertCreated()->json('data');

        $this->putJson("/api/incidents/{$created['id']}", [
            'complainantIsVictim' => true,
        ])->assertOk()
            ->assertJsonPath('data.complainantIsVictim', true)
            ->assertJsonPath('data.complainantName', null);

        $this->assertDatabaseHas('incidents', [
            'id' => $created['id'],
            'complainant_name' => null,
            'complainant_contact' => null,
            'complainant_relationship' => null,
            'complainant_address' => null,
        ]);
    }

    public function test_an_existing_incident_created_before_this_feature_stays_valid(): void
    {
        // Backwards compatibility: a row written by the factory has no
        // complainant data at all and must still read and update normally.
        $this->encoder();
        $incident = Incident::factory()->create();

        $this->getJson("/api/incidents/{$incident->id}")
            ->assertOk()
            ->assertJsonPath('data.complainantIsVictim', true)
            ->assertJsonPath('data.complainantName', null);
    }

    public function test_victim_information_still_works_alongside_the_complainant(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'victimName' => 'Juan Dela Cruz',
            'victimAge' => 15,
            'victimGender' => 'Male',
            'complainantIsVictim' => false,
            'complainantName' => 'Maria Dela Cruz',
            'complainantRelationship' => 'Mother',
        ]))
            ->assertCreated()
            ->assertJsonPath('data.victimName', 'Juan Dela Cruz')
            ->assertJsonPath('data.victimAge', 15)
            ->assertJsonPath('data.complainantName', 'Maria Dela Cruz');
    }
}
