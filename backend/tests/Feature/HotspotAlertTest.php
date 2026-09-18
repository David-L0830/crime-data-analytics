<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Incident;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Hotspot Alerts are generated from OFFICIAL data, at the moment it changes.
 *
 * Two separate problems have been fixed here, and both are worth stating
 * because the tests below are shaped by them.
 *
 * FIRST: no code path ever created a Hotspot Alert. The only one that existed
 * was a fixed row written by NotificationSeeder reading "Sitio 4 has exceeded
 * the hotspot threshold this week" — asserted unconditionally, naming a
 * specific sitio, backed by nothing. That was replaced by an announcement built
 * from the rows actually counted, so the bell cannot disagree with the
 * database.
 *
 * SECOND, and what this file now covers: the announcement was made from
 * store(), counting every non-archived incident. CP-5A then made "validated and
 * not archived" the rule for every figure people act on, which left the alert
 * asserting something no other surface agreed with — a Hotspot Alert routes
 * straight to the Trends Hotspots panel, whose table CP-5A made validated-only,
 * so the bell could announce a sitio the panel showed as empty. And since
 * store() forces validation_status to pending, the one place it fired was the
 * one place the official count provably could not move.
 *
 * So the count is now official — validated and not archived, via
 * Incident::scopeOfficial() — and the announcement happens where that count can
 * actually go up:
 *
 *   approve()  pending|returned -> validated            (+1)
 *   restore()  archived+validated -> active+validated   (+1)
 *
 * The transitions that lower it (archive, return, a CP-5A-1 material edit) get
 * no call and need none: they cannot cross a threshold upwards, and because the
 * rule compares counts rather than recording that an alert was sent, a sitio
 * that recedes and climbs again correctly crosses again. Those re-arming paths
 * are tested here precisely because nothing in the code mentions them.
 *
 * Records are built directly through the factory wherever the test only needs
 * them to EXIST, because a seeded row bypasses the controller and so announces
 * nothing — which is what makes "no alert was written" a meaningful assertion
 * in the tests that then drive one real transition through the API.
 */
class HotspotAlertTest extends TestCase
{
    use RefreshDatabase;

    /**
     * A BADAC Administrator, acting. Holds validate, archive and restore, so
     * one account can drive every transition these tests need.
     */
    private function reviewer(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    private function encoder(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_ENCODER]);
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

    /**
     * Incidents in a sitio, created directly so no announcement is emitted.
     *
     * $attributes carries what makes each one count or not count: the default
     * is OFFICIAL (validated, not archived), and the tests that need pending,
     * returned or archived rows say so explicitly at the call site — the point
     * of most of them is that the row is present and still does not count.
     *
     * @return Collection<int, Incident>
     */
    private function seedSitio(string $sitio, int $count, array $attributes = []): Collection
    {
        return Incident::factory()->count($count)->create(array_merge([
            'sitio' => $sitio,
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ], $attributes));
    }

    /** One pending incident in a sitio, ready to be approved. */
    private function pendingIn(string $sitio, array $attributes = []): Incident
    {
        return $this->seedSitio($sitio, 1, array_merge([
            'validation_status' => Incident::VALIDATION_PENDING,
        ], $attributes))->first();
    }

    private function approve(Incident $incident)
    {
        return $this->putJson("/api/incidents/{$incident->id}/validate");
    }

    private function hotspotAlerts()
    {
        return AppNotification::where('title', 'Hotspot Alert')->get();
    }

    /** The official count the announcement is supposed to be quoting. */
    private function officialCount(string $sitio): int
    {
        return Incident::query()->official()->where('sitio', $sitio)->count();
    }

    // ---- creating a record announces nothing ----

    public function test_creating_an_incident_never_announces_a_hotspot(): void
    {
        // THE DEFECT, pinned. store() forces validation_status to pending, so
        // however close a sitio is to qualifying, a create cannot take it over
        // the line — the official count is unchanged by definition.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->seedSitio('Sitio 4', 2);

        $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))
            ->assertCreated();

        $this->assertCount(0, $this->hotspotAlerts());
        $this->assertSame(2, $this->officialCount('Sitio 4'));
    }

    public function test_creating_many_incidents_in_one_sitio_never_announces_a_hotspot(): void
    {
        // Before the fix this sitio would have alerted on the third save.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);

        foreach (range(1, 5) as $ignored) {
            $this->postJson('/api/incidents', $this->payload(['sitio' => 'Sitio 4']))
                ->assertCreated();
        }

        $this->assertCount(0, $this->hotspotAlerts());
    }

    // ---- approval is where the crossing happens ----

    public function test_an_approval_that_crosses_the_official_threshold_announces(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);

        // Two already official: this approval is the third and the crossing.
        $this->seedSitio('Sitio 4', 2);
        $pending = $this->pendingIn('Sitio 4');

        $this->approve($pending)->assertOk();

        $this->assertCount(1, $this->hotspotAlerts());
        $this->assertSame(3, $this->officialCount('Sitio 4'));
    }

    public function test_no_alert_while_the_official_count_is_still_below_the_threshold(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);

        $this->seedSitio('Sitio 4', 1);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertSame(2, $this->officialCount('Sitio 4'));
        $this->assertCount(0, $this->hotspotAlerts());
    }

    public function test_an_approval_from_returned_crosses_exactly_as_one_from_pending(): void
    {
        // A corrected record re-enters review as pending, but an Administrator
        // may also approve a returned record directly. Both are the same single
        // step into the official set.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);

        $this->seedSitio('Sitio 4', 2);
        $returned = $this->pendingIn('Sitio 4', [
            'validation_status' => Incident::VALIDATION_RETURNED,
            'correction_reason' => 'Sitio does not match the street given.',
        ]);

        $this->approve($returned)->assertOk();

        $this->assertCount(1, $this->hotspotAlerts());
    }

    // ---- deduplication ----

    public function test_no_second_alert_while_the_sitio_remains_a_hotspot(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->seedSitio('Sitio 4', 2);

        // The crossing.
        $this->approve($this->pendingIn('Sitio 4'))->assertOk();
        // Three more approvals in a sitio that already qualifies.
        $this->approve($this->pendingIn('Sitio 4'))->assertOk();
        $this->approve($this->pendingIn('Sitio 4'))->assertOk();
        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertSame(6, $this->officialCount('Sitio 4'));
        $this->assertCount(1, $this->hotspotAlerts());
    }

    public function test_a_rejected_second_approval_cannot_announce_twice(): void
    {
        // approve() answers 422 for a record that is already validated, so the
        // announcement is unreachable on a retry or a double-click. That 422 is
        // what makes this exactly-once without any stored dedup state.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->seedSitio('Sitio 4', 2);
        $pending = $this->pendingIn('Sitio 4');

        $this->approve($pending)->assertOk();
        $this->approve($pending)->assertStatus(422);

        $this->assertCount(1, $this->hotspotAlerts());
    }

    public function test_each_sitio_crosses_independently(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 2]);

        $this->seedSitio('Sitio 1', 1);
        $this->seedSitio('Sitio 2', 1);

        $this->approve($this->pendingIn('Sitio 1'))->assertOk();
        $this->approve($this->pendingIn('Sitio 2'))->assertOk();

        $alerts = $this->hotspotAlerts();
        $this->assertCount(2, $alerts);
        $this->assertTrue($alerts->contains(fn ($a) => str_contains($a->message, 'Sitio 1')));
        $this->assertTrue($alerts->contains(fn ($a) => str_contains($a->message, 'Sitio 2')));
    }

    // ---- only official records count ----

    public function test_pending_records_do_not_count_towards_the_threshold(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 5]);

        // Two official and ten pending. Counted naively that is twelve, well
        // over the threshold; officially it is two.
        $this->seedSitio('Sitio 4', 2);
        $this->seedSitio('Sitio 4', 10, ['validation_status' => Incident::VALIDATION_PENDING]);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertSame(3, $this->officialCount('Sitio 4'));
        $this->assertCount(0, $this->hotspotAlerts());
    }

    public function test_returned_records_do_not_count_towards_the_threshold(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 5]);

        $this->seedSitio('Sitio 4', 2);
        $this->seedSitio('Sitio 4', 10, ['validation_status' => Incident::VALIDATION_RETURNED]);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertSame(3, $this->officialCount('Sitio 4'));
        $this->assertCount(0, $this->hotspotAlerts());
    }

    public function test_archived_records_do_not_count_even_when_validated(): void
    {
        // The archive rule is independent of the validation one: being reviewed
        // does not put a retired case back into the barangay's current picture.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 5]);

        $this->seedSitio('Sitio 4', 2);
        $this->seedSitio('Sitio 4', 10, ['status' => 'Archived']);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertSame(3, $this->officialCount('Sitio 4'));
        $this->assertCount(0, $this->hotspotAlerts());
    }

    public function test_a_mixed_sitio_crosses_on_its_official_count_alone(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);

        $this->seedSitio('Sitio 4', 2);
        $this->seedSitio('Sitio 4', 4, ['validation_status' => Incident::VALIDATION_PENDING]);
        $this->seedSitio('Sitio 4', 3, ['validation_status' => Incident::VALIDATION_RETURNED]);
        $this->seedSitio('Sitio 4', 5, ['status' => 'Archived']);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $alert = $this->hotspotAlerts()->first();
        $this->assertNotNull($alert);
        // The quoted figure is the official three, not the fifteen rows present.
        $this->assertStringContainsString('3 validated incidents', $alert->message);
    }

    // ---- recession re-arms the crossing ----

    public function test_archiving_lowers_the_official_count_and_allows_a_later_crossing(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->seedSitio('Sitio 4', 2);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();
        $this->assertCount(1, $this->hotspotAlerts());

        // Archiving an official record drops the sitio back below the line.
        $official = Incident::query()->official()->where('sitio', 'Sitio 4')->first();
        $this->putJson("/api/incidents/{$official->id}/archive")->assertOk();
        $this->assertSame(2, $this->officialCount('Sitio 4'));

        // Climbing back over it crosses again — the rule compares counts, it
        // does not remember having announced.
        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertSame(3, $this->officialCount('Sitio 4'));
        $this->assertCount(2, $this->hotspotAlerts());
    }

    public function test_returning_a_validated_record_lowers_the_count_and_allows_a_later_crossing(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->seedSitio('Sitio 4', 2);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();
        $this->assertCount(1, $this->hotspotAlerts());

        $official = Incident::query()->official()->where('sitio', 'Sitio 4')->first();
        $this->putJson("/api/incidents/{$official->id}/return", ['reason' => 'Street number is wrong.'])
            ->assertOk();
        $this->assertSame(2, $this->officialCount('Sitio 4'));

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertCount(2, $this->hotspotAlerts());
    }

    public function test_a_material_edit_lowers_the_official_count_and_allows_a_later_crossing(): void
    {
        // CP-5A-1: a materially edited record goes back to pending, so it
        // leaves official data — a third way a sitio recedes below the
        // threshold, and the only one that is not itself a validation action.
        $reviewer = $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);
        $this->seedSitio('Sitio 4', 2);

        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $owned = $this->pendingIn('Sitio 4', ['reported_by' => $encoder->id]);

        $this->actingAsSupabase($reviewer);
        $this->approve($owned)->assertOk();
        $this->assertCount(1, $this->hotspotAlerts());
        $this->assertSame(3, $this->officialCount('Sitio 4'));

        // The encoder corrects their own validated record: material, so it goes
        // back to pending and out of the official set.
        $this->actingAsSupabase($encoder);
        $this->putJson("/api/incidents/{$owned->id}", ['street' => '99 Corrected Street'])
            ->assertOk();
        $this->assertSame(Incident::VALIDATION_PENDING, $owned->fresh()->validation_status);
        $this->assertSame(2, $this->officialCount('Sitio 4'));

        // Re-approved by somebody who is neither its encoder nor its last
        // editor, so the self-review guards do not bite.
        $this->actingAsSupabase($reviewer);
        $this->approve($owned)->assertOk();

        $this->assertSame(3, $this->officialCount('Sitio 4'));
        $this->assertCount(2, $this->hotspotAlerts());
    }

    // ---- restore is the other way the official count goes up ----

    public function test_restoring_an_archived_validated_record_can_cross_the_threshold(): void
    {
        // No approval involved: the record was already validated, and leaving
        // the archive is what puts it back into official data.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);

        $this->seedSitio('Sitio 4', 2);
        $archived = $this->seedSitio('Sitio 4', 1, [
            'status' => 'Archived',
            'previous_status' => 'Open',
        ])->first();

        $this->putJson("/api/incidents/{$archived->id}/restore")->assertOk();

        $this->assertSame(3, $this->officialCount('Sitio 4'));
        $this->assertCount(1, $this->hotspotAlerts());
    }

    public function test_restoring_a_pending_record_announces_nothing(): void
    {
        // The guard in restore() is load-bearing, not an optimisation. A
        // restored PENDING record does not change the official count, so the
        // derived `countAfter - 1` before-count would be one too low — and a
        // sitio already sitting exactly at the threshold would announce a
        // second time for a transition that changed nothing.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 3]);

        $this->seedSitio('Sitio 4', 2);
        $this->approve($this->pendingIn('Sitio 4'))->assertOk();
        $this->assertCount(1, $this->hotspotAlerts());

        $archived = $this->seedSitio('Sitio 4', 1, [
            'status' => 'Archived',
            'previous_status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ])->first();

        $this->putJson("/api/incidents/{$archived->id}/restore")->assertOk();

        $this->assertSame(3, $this->officialCount('Sitio 4'));
        $this->assertCount(1, $this->hotspotAlerts());
    }

    public function test_restoring_below_the_threshold_announces_nothing(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 5]);

        $this->seedSitio('Sitio 4', 1);
        $archived = $this->seedSitio('Sitio 4', 1, [
            'status' => 'Archived',
            'previous_status' => 'Open',
        ])->first();

        $this->putJson("/api/incidents/{$archived->id}/restore")->assertOk();

        $this->assertSame(2, $this->officialCount('Sitio 4'));
        $this->assertCount(0, $this->hotspotAlerts());
    }

    // ---- the message is built from real data ----

    public function test_the_message_names_the_real_sitio_and_its_real_validated_count(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 4]);
        $this->seedSitio('Sitio 6', 3);

        $this->approve($this->pendingIn('Sitio 6'))->assertOk();

        $alert = $this->hotspotAlerts()->first();
        $this->assertNotNull($alert);
        $this->assertStringContainsString('Sitio 6', $alert->message);
        $this->assertStringContainsString('4 validated incidents', $alert->message);
        $this->assertStringContainsString('threshold of 4', $alert->message);
        // The figure is the official one, so the wording has to say which count
        // it is rather than inviting a comparison against "active incidents",
        // which nothing computes any more.
        $this->assertStringNotContainsString('active incidents', $alert->message);
        // The fabricated seeder wording must not survive anywhere.
        $this->assertStringNotContainsString('this week', $alert->message);
    }

    // ---- the configured threshold is honoured, not a literal ----

    public function test_the_configured_threshold_is_used_rather_than_a_hard_coded_value(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 5]);

        // Three already official: under a hard-coded 3 this would already have
        // alerted. It must not alert until the fifth.
        $this->seedSitio('Sitio 2', 3);

        $this->approve($this->pendingIn('Sitio 2'))->assertOk();
        $this->assertCount(0, $this->hotspotAlerts());

        $this->approve($this->pendingIn('Sitio 2'))->assertOk();
        $this->assertCount(1, $this->hotspotAlerts());
    }

    public function test_a_threshold_of_zero_never_announces(): void
    {
        // SettingController validates hotspot_threshold as integer min:0, so 0
        // is a value a user can really choose. The crossing is expressed as two
        // comparisons rather than `$countAfter === $threshold` precisely so this
        // stays coherent: a sitio was never below zero, so it never crosses
        // zero, and "everywhere is a hotspot" is not announced as news.
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 0]);

        $this->approve($this->pendingIn('Sitio 4'))->assertOk();
        $this->approve($this->pendingIn('Sitio 4'))->assertOk();

        $this->assertSame(2, $this->officialCount('Sitio 4'));
        $this->assertCount(0, $this->hotspotAlerts());
    }

    // ---- shape of the notification ----

    public function test_the_alert_is_addressed_to_everyone_and_typed_as_a_warning(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 2]);
        $this->seedSitio('Sitio 3', 1);

        $this->approve($this->pendingIn('Sitio 3'))->assertOk();

        $alert = $this->hotspotAlerts()->first();
        $this->assertNotNull($alert);
        $this->assertSame('Hotspot Alert', $alert->title);
        // Null audience means every role, matching the New Incident
        // announcement — unchanged by this checkpoint.
        $this->assertNull($alert->audience_roles);
        $this->assertSame('warning', $alert->type);
        $this->assertFalse((bool) $alert->read);
    }

    // ---- failure isolation ----

    public function test_a_failing_alert_does_not_fail_the_approval(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 2]);
        $this->seedSitio('Sitio 7', 1);
        $pending = $this->pendingIn('Sitio 7');

        // Registered through the event dispatcher rather than the model's static
        // hooks, so it cannot leak into another test.
        Event::listen('eloquent.creating: '.AppNotification::class, function ($event, $models) {
            $notification = is_array($models) ? $models[0] : $models;
            if ($notification->title === 'Hotspot Alert') {
                throw new \RuntimeException('notification store unavailable');
            }
        });

        $this->approve($pending)->assertOk();

        // The validation survived; only the announcement was lost.
        $this->assertSame(
            Incident::VALIDATION_VALIDATED,
            $pending->fresh()->validation_status
        );
        $this->assertCount(0, $this->hotspotAlerts());
    }

    public function test_a_failing_alert_does_not_fail_the_restore(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 2]);
        $this->seedSitio('Sitio 7', 1);
        $archived = $this->seedSitio('Sitio 7', 1, [
            'status' => 'Archived',
            'previous_status' => 'Open',
        ])->first();

        Event::listen('eloquent.creating: '.AppNotification::class, function ($event, $models) {
            $notification = is_array($models) ? $models[0] : $models;
            if ($notification->title === 'Hotspot Alert') {
                throw new \RuntimeException('notification store unavailable');
            }
        });

        $this->putJson("/api/incidents/{$archived->id}/restore")->assertOk();

        $this->assertDatabaseHas('incidents', ['id' => $archived->id, 'status' => 'Open']);
        $this->assertCount(0, $this->hotspotAlerts());
    }

    // ---- a record with no sitio ----

    public function test_an_incident_without_a_sitio_announces_nothing(): void
    {
        $this->reviewer();
        Setting::current()->update(['hotspot_threshold' => 1]);

        $this->approve($this->pendingIn('Sitio 4', ['sitio' => null]))->assertOk();

        $this->assertCount(0, $this->hotspotAlerts());
    }
}
