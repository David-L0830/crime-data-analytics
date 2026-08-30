<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Structured evidence — an Evidence ID plus a description, repeatable per case.
 *
 * The important guarantee here is not the happy path but the two ways this
 * could quietly destroy data: an edit that never mentions evidence must not
 * delete it, and the free-text evidence recorded before this feature existed
 * must still be there afterwards.
 */
class EvidenceTest extends TestCase
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
            'caseNumber' => 'CN-2026-0100',
            'crimeType' => 'Robbery',
            'date' => '2026-05-01',
            'sitio' => 'Sitio 2',
            'status' => 'Open',
        ], $overrides);
    }

    public function test_an_incident_can_be_created_with_several_evidence_items(): void
    {
        $this->encoder();

        $response = $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [
                ['evidenceId' => 'EV-001', 'description' => 'CCTV footage from the entrance of the residence'],
                ['evidenceId' => 'EV-002', 'description' => 'Black jacket recovered from the crime scene'],
                ['evidenceId' => 'EV-003', 'description' => 'Photograph of damaged property'],
            ],
        ]))->assertCreated();

        $response->assertJsonCount(3, 'data.evidenceItems')
            ->assertJsonPath('data.evidenceItems.0.evidenceId', 'EV-001')
            ->assertJsonPath('data.evidenceItems.0.description', 'CCTV footage from the entrance of the residence');

        $this->assertDatabaseHas('incident_evidence', [
            'evidence_code' => 'EV-002',
            'description' => 'Black jacket recovered from the crime scene',
        ]);
    }

    public function test_an_evidence_item_left_without_a_reference_is_numbered_automatically(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [
                ['description' => 'Recovered mobile phone'],
            ],
        ]))->assertCreated()
            ->assertJsonPath('data.evidenceItems.0.evidenceId', 'EV-001');
    }

    public function test_repeated_evidence_references_are_disambiguated_rather_than_rejected(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [
                ['evidenceId' => 'EV-001', 'description' => 'First item'],
                ['evidenceId' => 'EV-001', 'description' => 'Second item typed with the same reference'],
            ],
        ]))->assertCreated()
            ->assertJsonCount(2, 'data.evidenceItems')
            ->assertJsonPath('data.evidenceItems.0.evidenceId', 'EV-001')
            ->assertJsonPath('data.evidenceItems.1.evidenceId', 'EV-001-2');
    }

    public function test_blank_evidence_rows_are_ignored(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [
                ['evidenceId' => '', 'description' => ''],
                ['evidenceId' => 'EV-001', 'description' => 'A real item'],
            ],
        ]))->assertCreated()
            ->assertJsonCount(1, 'data.evidenceItems');
    }

    public function test_updating_evidence_replaces_the_list(): void
    {
        $this->encoder();

        $created = $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [
                ['evidenceId' => 'EV-001', 'description' => 'Original item'],
                ['evidenceId' => 'EV-002', 'description' => 'Another original item'],
            ],
        ]))->assertCreated()->json('data');

        $this->putJson("/api/incidents/{$created['id']}", [
            'evidenceItems' => [
                ['evidenceId' => 'EV-001', 'description' => 'Corrected description'],
            ],
        ])->assertOk()
            ->assertJsonCount(1, 'data.evidenceItems')
            ->assertJsonPath('data.evidenceItems.0.description', 'Corrected description');

        $this->assertDatabaseMissing('incident_evidence', ['description' => 'Another original item']);
    }

    public function test_an_edit_that_does_not_mention_evidence_leaves_it_untouched(): void
    {
        // The failure this prevents: changing a case's status silently wiping
        // its evidence because the request happened not to include the field.
        $this->encoder();

        $created = $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [
                ['evidenceId' => 'EV-001', 'description' => 'CCTV footage'],
            ],
        ]))->assertCreated()->json('data');

        $this->putJson("/api/incidents/{$created['id']}", ['status' => 'Under Investigation'])
            ->assertOk()
            ->assertJsonCount(1, 'data.evidenceItems')
            ->assertJsonPath('data.evidenceItems.0.description', 'CCTV footage');
    }

    public function test_an_explicitly_empty_list_clears_the_evidence(): void
    {
        $this->encoder();

        $created = $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [['evidenceId' => 'EV-001', 'description' => 'CCTV footage']],
        ]))->assertCreated()->json('data');

        $this->putJson("/api/incidents/{$created['id']}", ['evidenceItems' => []])
            ->assertOk()
            ->assertJsonCount(0, 'data.evidenceItems');
    }

    public function test_evidence_is_recorded_in_the_audit_log(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [['evidenceId' => 'EV-001', 'description' => 'CCTV footage']],
        ]))->assertCreated();

        $this->assertDatabaseHas('audit_logs', [
            'module' => 'incidents',
            'target_type' => 'evidence',
        ]);
    }

    public function test_evidence_rows_are_removed_when_their_incident_is_deleted(): void
    {
        // Cascade, so evidence can never outlive the case it belongs to and
        // become an orphaned record of somebody's property.
        $this->encoder();

        $created = $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [['evidenceId' => 'EV-001', 'description' => 'CCTV footage']],
        ]))->assertCreated()->json('data');

        Incident::findOrFail($created['id'])->delete();

        $this->assertDatabaseCount('incident_evidence', 0);
    }

    public function test_evidence_is_listed_with_incidents(): void
    {
        $this->encoder();

        $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [['evidenceId' => 'EV-001', 'description' => 'CCTV footage']],
        ]))->assertCreated();

        $this->getJson('/api/incidents')
            ->assertOk()
            ->assertJsonPath('data.0.evidenceItems.0.description', 'CCTV footage');
    }

    public function test_an_unauthenticated_caller_cannot_read_evidence(): void
    {
        $incident = Incident::factory()->create();

        $this->getJson("/api/incidents/{$incident->id}")->assertUnauthorized();
    }
}
