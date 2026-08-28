<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The announcement raised when a crime incident is recorded.
 *
 * The guarantees pinned down here are the ones that are easy to get wrong and
 * expensive when wrong: exactly ONE announcement per action, never an
 * announcement for a save that did not happen, never a failed save because the
 * announcement failed, and never more disclosure in the announcement than the
 * roles that receive it are entitled to.
 */
class IncidentNotificationTest extends TestCase
{
    use RefreshDatabase;

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'caseNumber' => 'CN-2026-0123',
            'crimeType' => 'Assault',
            'date' => '2026-05-01',
            'sitio' => 'Sitio 4',
            'street' => '12 Rizal St.',
            'status' => 'Open',
        ], $overrides);
    }

    public function test_recording_an_incident_creates_exactly_one_notification(): void
    {
        // "Incident", "case" and "record" are one entity here, so one action
        // must not fan out into three announcements.
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER, 'name' => 'Ana Reyes']);
        $this->actingAsSupabase($encoder);

        $this->postJson('/api/incidents', $this->payload())->assertCreated();

        $this->assertSame(1, AppNotification::count());
        $this->assertSame(1, AppNotification::where('title', 'New Incident')->count());
    }

    public function test_the_notification_names_the_case_crime_location_and_recorder(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER, 'name' => 'Ana Reyes']);
        $this->actingAsSupabase($encoder);

        $this->postJson('/api/incidents', $this->payload())->assertCreated();

        $message = AppNotification::where('title', 'New Incident')->value('message');

        $this->assertStringContainsString('CN-2026-0123', $message);
        $this->assertStringContainsString('Assault', $message);
        $this->assertStringContainsString('Sitio 4', $message);
        $this->assertStringContainsString('Ana Reyes', $message);
    }

    public function test_the_notification_does_not_disclose_victim_or_suspect_identities(): void
    {
        // Every role receives this announcement, read-only BADAC included.
        // Naming a private individual in it would disclose more than the
        // recipient needs in order to decide whether to open the case.
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->postJson('/api/incidents', $this->payload([
            'victimName' => 'Juan Dela Cruz',
            'suspectName' => 'Pedro Santos',
            'complainantIsVictim' => false,
            'complainantName' => 'Maria Dela Cruz',
            'complainantContact' => '0917 555 0101',
        ]))->assertCreated();

        $message = AppNotification::where('title', 'New Incident')->value('message');

        $this->assertStringNotContainsString('Juan Dela Cruz', $message);
        $this->assertStringNotContainsString('Pedro Santos', $message);
        $this->assertStringNotContainsString('Maria Dela Cruz', $message);
        $this->assertStringNotContainsString('0917 555 0101', $message);
    }

    public function test_a_rejected_incident_produces_no_notification(): void
    {
        // Validation failure — nothing was saved, so nothing may be announced.
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->postJson('/api/incidents', ['crimeType' => 'Assault'])
            ->assertStatus(422);

        $this->assertSame(0, AppNotification::count());
        $this->assertSame(0, Incident::count());
    }

    public function test_a_duplicate_case_number_produces_neither_incident_nor_notification(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->postJson('/api/incidents', $this->payload())->assertCreated();
        $this->postJson('/api/incidents', $this->payload())->assertStatus(422);

        // The second attempt added neither a row nor an announcement.
        $this->assertSame(1, Incident::count());
        $this->assertSame(1, AppNotification::count());
    }

    public function test_the_incident_and_its_evidence_are_written_in_one_transaction(): void
    {
        // Proves the write is genuinely transactional: with the surrounding
        // transaction rolled back, neither the incident nor its evidence
        // survives — no half-saved case is left behind.
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        DB::beginTransaction();
        $this->postJson('/api/incidents', $this->payload([
            'evidenceItems' => [
                ['evidenceId' => 'EV-001', 'description' => 'CCTV footage'],
            ],
        ]))->assertCreated();
        DB::rollBack();

        $this->assertSame(0, Incident::where('case_number', 'CN-2026-0123')->count());
        $this->assertDatabaseCount('incident_evidence', 0);
    }

    public function test_the_announcement_reaches_every_role(): void
    {
        // A new incident is relevant to all three roles — each can open Crime
        // Data Collection — so it carries no audience restriction.
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);
        $this->postJson('/api/incidents', $this->payload())->assertCreated();

        $this->assertNull(AppNotification::where('title', 'New Incident')->value('audience_roles'));

        foreach ([User::ROLE_BADAC_ADMIN, User::ROLE_ENCODER, User::ROLE_BADAC_READONLY] as $role) {
            // See NotificationTest for why guards are forgotten between users.
            $this->app['auth']->forgetGuards();
            $user = User::factory()->create(['role' => $role]);

            $this->actingAsSupabase($user)
                ->getJson('/api/notifications')
                ->assertOk()
                ->assertJsonPath('data.0.title', 'New Incident')
                // Unread for each of them independently — nobody inherits
                // another account's read state.
                ->assertJsonPath('data.0.read', false);
        }
    }

    public function test_a_new_incident_starts_unread_and_can_be_read_per_user(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);
        $this->postJson('/api/incidents', $this->payload())->assertCreated();

        $notification = AppNotification::where('title', 'New Incident')->firstOrFail();

        $this->app['auth']->forgetGuards();
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);

        $this->actingAsSupabase($admin)
            ->putJson("/api/notifications/{$notification->id}/read")
            ->assertOk();

        $this->actingAsSupabase($admin)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.read', true);

        // The encoder who filed it has still not read it.
        $this->app['auth']->forgetGuards();
        $this->actingAsSupabase($encoder)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.read', false);
    }

    public function test_updating_an_incident_without_resolving_it_announces_nothing_new(): void
    {
        // Guards against the bell filling with noise on every ordinary edit.
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $created = $this->postJson('/api/incidents', $this->payload())
            ->assertCreated()
            ->json('data');

        $this->putJson("/api/incidents/{$created['id']}", ['street' => '14 Rizal St.'])
            ->assertOk();

        $this->assertSame(1, AppNotification::count());
    }
}
