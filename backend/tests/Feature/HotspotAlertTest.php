<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Incident;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Hotspot Alerts are now generated from real data.
 *
 * Before this, no code path in the application ever created one. The only
 * Hotspot Alert that existed was a fixed row written by NotificationSeeder
 * reading "Sitio 4 has exceeded the hotspot threshold this week" — asserted
 * unconditionally, naming a specific sitio, and verified by nothing. It was the
 * one entry in that seeder violating the seeder's own stated rule that it
 * "skips any notification it cannot back with an actual row". This is the same
 * defect the Case Resolved notification had before
 * IncidentController::announceResolutionIfNewlyResolved() replaced it, and it
 * is fixed the same way: the message is built from the rows that were actually
 * written, so the bell can never disagree with the database.
 *
 * "Hotspot" uses the definition the system already had, documented in
 * docs/API_ENDPOINTS.md and implemented by DashboardController's hotspotCount:
 * all-time, non-archived incidents grouped per sitio, qualifying when the count
 * meets or exceeds settings.hotspot_threshold.
 *
 * The alert fires on the CROSSING only — the save that first takes a sitio from
 * below the threshold to meeting it. Without that, every subsequent incident in
 * an already-qualifying sitio would emit another alert, and with a default
 * threshold of 3 most sitios qualify almost immediately, so the bell would
 * become noise.
 */
class HotspotAlertTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'caseNumber' => 'CN-2026-'.fake()->unique()->numberBetween(1000, 9999),
            'crimeType' => 'Theft',
            'date' => '2026-06-01',
            'sitio' => 'Sitio 4',
        ], $overrides);
    }

    /** Existing incidents in a sitio, created directly so no alert is emitted. */
    private function seedSitio(string $sitio, int $count, string $status = 'Open'): void
    {
        for ($i = 0; $i < $count; $i++) {
            Incident::factory()->create(['sitio' => $sitio, 'status' => $status]);
        }
    }

    private function hotspotAlerts()
    {
        return AppNotification::where('title', 'Hotspot Alert')->get();
    }

    // ---- crossing the threshold ----

    public function test_an_alert_is_created_when_a_sitio_crosses_the_threshold(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 3]);

        // Two existing incidents: this save is the third and the crossing.
        $this->seedSitio('Sitio 4', 2);

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))
            ->assertCreated();

        $this->assertCount(1, $this->hotspotAlerts());
    }

    public function test_no_alert_while_the_sitio_is_still_below_the_threshold(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 3]);

        // One existing incident: this save makes two, still under three.
        $this->seedSitio('Sitio 4', 1);

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))
            ->assertCreated();

        $this->assertCount(0, $this->hotspotAlerts());
    }

    // ---- deduplication ----

    public function test_no_second_alert_while_the_sitio_remains_a_hotspot(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->seedSitio('Sitio 4', 2);

        // The crossing.
        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))->assertCreated();
        // Three more incidents in a sitio that already qualifies.
        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))->assertCreated();
        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))->assertCreated();
        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))->assertCreated();

        $this->assertCount(1, $this->hotspotAlerts());
    }

    public function test_each_sitio_crosses_independently(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 2]);

        $this->seedSitio('Sitio 1', 1);
        $this->seedSitio('Sitio 2', 1);

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 1']))->assertCreated();
        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 2']))->assertCreated();

        $alerts = $this->hotspotAlerts();
        $this->assertCount(2, $alerts);
        $this->assertTrue($alerts->contains(fn ($a) => str_contains($a->message, 'Sitio 1')));
        $this->assertTrue($alerts->contains(fn ($a) => str_contains($a->message, 'Sitio 2')));
    }

    // ---- the message is built from real data ----

    public function test_the_message_names_the_real_sitio_and_its_real_count(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 4]);
        $this->seedSitio('Sitio 6', 3);

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 6']))
            ->assertCreated();

        $alert = $this->hotspotAlerts()->first();
        $this->assertNotNull($alert);
        $this->assertStringContainsString('Sitio 6', $alert->message);
        $this->assertStringContainsString('4', $alert->message);
        // The fabricated seeder wording must not survive anywhere.
        $this->assertStringNotContainsString('this week', $alert->message);
    }

    // ---- the configured threshold is honoured, not a literal ----

    public function test_the_configured_threshold_is_used_rather_than_a_hard_coded_value(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 5]);

        // Four existing incidents: under a hard-coded 3 this would already have
        // alerted long ago. It must not alert until the fifth.
        $this->seedSitio('Sitio 2', 3);
        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 2']))->assertCreated();
        $this->assertCount(0, $this->hotspotAlerts());

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 2']))->assertCreated();
        $this->assertCount(1, $this->hotspotAlerts());
    }

    // ---- archived incidents do not count ----

    public function test_archived_incidents_do_not_count_towards_the_threshold(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 3]);

        // Two archived plus one active: the active total is 1, not 3.
        $this->seedSitio('Sitio 5', 2, 'Archived');

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 5']))
            ->assertCreated();

        $this->assertCount(0, $this->hotspotAlerts());
    }

    // ---- shape of the notification ----

    public function test_the_alert_is_addressed_to_everyone_and_typed_as_a_warning(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 2]);
        $this->seedSitio('Sitio 3', 1);

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 3']))
            ->assertCreated();

        $alert = $this->hotspotAlerts()->first();
        $this->assertNotNull($alert);
        $this->assertSame('Hotspot Alert', $alert->title);
        // Null audience means every role, matching the New Incident announcement.
        $this->assertNull($alert->audience_roles);
        $this->assertSame('warning', $alert->type);
        $this->assertFalse((bool) $alert->read);
    }

    // ---- failure isolation ----

    public function test_a_failing_alert_does_not_fail_the_incident_save(): void
    {
        $this->admin();
        Setting::current()->update(['hotspot_threshold' => 2]);
        $this->seedSitio('Sitio 7', 1);

        // Registered through the event dispatcher rather than the model's static
        // hooks, so it cannot leak into another test.
        Event::listen('eloquent.creating: '.AppNotification::class, function ($event, $models) {
            $notification = is_array($models) ? $models[0] : $models;
            if ($notification->title === 'Hotspot Alert') {
                throw new \RuntimeException('notification store unavailable');
            }
        });

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 7']))
            ->assertCreated();

        // The incident survived; only the announcement was lost.
        $this->assertDatabaseHas('incidents', ['sitio' => 'Sitio 7', 'status' => 'Open']);
        $this->assertCount(0, $this->hotspotAlerts());
    }
}
