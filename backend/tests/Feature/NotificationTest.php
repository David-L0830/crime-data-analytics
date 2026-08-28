<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\NotificationRead;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Notifications are shared announcements with PER-USER read state.
 *
 * These assertions moved from the app_notifications.read column to the
 * notification_reads pivot deliberately: read state used to be global, so the
 * first person to open the bell marked every message read for everybody else
 * too. The tests below now pin down the behaviour that replaced it — reading a
 * notification affects only the account that read it, and the legacy global
 * flag is still honoured so nothing already dismissed comes back.
 */
class NotificationTest extends TestCase
{
    use RefreshDatabase;

    private function actingUser(string $role = User::ROLE_BADAC_ADMIN): User
    {
        $user = User::factory()->create(['role' => $role]);
        $this->actingAsSupabase($user);

        return $user;
    }

    public function test_can_list_notifications(): void
    {
        $this->actingUser();
        AppNotification::factory()->count(3)->create();

        $this->getJson('/api/notifications')->assertOk()->assertJsonCount(3, 'data');
    }

    public function test_can_mark_a_single_notification_read(): void
    {
        $user = $this->actingUser();
        $notification = AppNotification::factory()->create(['read' => false]);

        $this->putJson("/api/notifications/{$notification->id}/read")
            ->assertOk()
            ->assertJsonPath('data.read', true);

        $this->assertDatabaseHas('notification_reads', [
            'app_notification_id' => $notification->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_marking_read_twice_does_not_fail(): void
    {
        // The (notification, user) pair is uniquely indexed; opening the bell
        // twice must be a no-op, not a 500.
        $user = $this->actingUser();
        $notification = AppNotification::factory()->create(['read' => false]);

        $this->putJson("/api/notifications/{$notification->id}/read")->assertOk();
        $this->putJson("/api/notifications/{$notification->id}/read")->assertOk();

        $this->assertSame(1, NotificationRead::where([
            'app_notification_id' => $notification->id,
            'user_id' => $user->id,
        ])->count());
    }

    public function test_mark_all_read_marks_every_unread_notification_when_no_title_given(): void
    {
        $user = $this->actingUser();
        AppNotification::factory()->count(2)->create(['title' => 'Hotspot Alert', 'read' => false]);
        AppNotification::factory()->count(2)->create(['title' => 'Case Resolved', 'read' => false]);

        $this->putJson('/api/notifications/read-all')->assertOk();

        $this->assertSame(
            4,
            NotificationRead::where('user_id', $user->id)->count()
        );
        $this->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonMissing(['read' => false]);
    }

    public function test_mark_all_read_scoped_to_title_only_affects_matching_notifications(): void
    {
        $user = $this->actingUser();
        $hotspotAlerts = AppNotification::factory()->count(3)->create(['title' => 'Hotspot Alert', 'read' => false]);
        $otherAlerts = AppNotification::factory()->count(2)->create(['title' => 'Case Resolved', 'read' => false]);

        $this->putJson('/api/notifications/read-all?title='.urlencode('Hotspot Alert'))->assertOk();

        foreach ($hotspotAlerts as $n) {
            $this->assertDatabaseHas('notification_reads', [
                'app_notification_id' => $n->id,
                'user_id' => $user->id,
            ]);
        }
        foreach ($otherAlerts as $n) {
            $this->assertDatabaseMissing('notification_reads', [
                'app_notification_id' => $n->id,
                'user_id' => $user->id,
            ]);
        }
    }

    public function test_encoder_can_also_mark_notifications_read(): void
    {
        // Notifications are shared by both roles — see routes/api.php.
        $encoder = $this->actingUser(User::ROLE_ENCODER);
        $notification = AppNotification::factory()->create(['title' => 'Hotspot Alert', 'read' => false]);

        $this->putJson('/api/notifications/read-all?title='.urlencode('Hotspot Alert'))->assertOk();

        $this->assertDatabaseHas('notification_reads', [
            'app_notification_id' => $notification->id,
            'user_id' => $encoder->id,
        ]);
    }

    public function test_one_users_read_does_not_mark_it_read_for_another_user(): void
    {
        // This is the whole point of per-user read state: the Administrator
        // opening the bell must not empty the Encoder's unread count.
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $notification = AppNotification::factory()->create(['read' => false]);

        $this->actingAsSupabase($admin)
            ->putJson("/api/notifications/{$notification->id}/read")
            ->assertOk();

        $this->actingAsSupabase($admin)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.read', true);

        // The test process keeps ONE application instance across requests, and
        // Laravel's RequestGuard memoises the user it resolved. Production
        // boots a fresh container per request, so this only ever bites here —
        // without it the second request below would still be answered as the
        // admin and the assertion would pass for the wrong reason.
        $this->app['auth']->forgetGuards();

        $this->actingAsSupabase($encoder)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.read', false);
    }

    public function test_legacy_globally_read_notifications_stay_read_for_everyone(): void
    {
        // Rows flagged read before per-user tracking existed must not reappear
        // as unread in every inbox after the upgrade.
        $this->actingUser();
        AppNotification::factory()->create(['read' => true]);

        $this->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.read', true);
    }

    public function test_a_role_only_receives_announcements_addressed_to_it(): void
    {
        // "New Criminal Record" is addressed to the two roles that can open
        // the Records module. An Encoder cannot, so sending it to them would
        // produce a notification whose only action is to be bounced off a
        // route their role is denied.
        AppNotification::factory()->create([
            'title' => 'New Criminal Record',
            'audience_roles' => AppNotification::audienceFor([
                User::ROLE_BADAC_ADMIN,
                User::ROLE_BADAC_READONLY,
            ]),
        ]);

        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($admin)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->app['auth']->forgetGuards();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_an_announcement_with_no_audience_reaches_every_role(): void
    {
        // Incident notifications, and every notification written before the
        // audience column existed, have a NULL audience and must stay visible
        // to everyone.
        AppNotification::factory()->create([
            'title' => 'New Incident',
            'audience_roles' => null,
        ]);

        foreach ([User::ROLE_BADAC_ADMIN, User::ROLE_ENCODER, User::ROLE_BADAC_READONLY] as $role) {
            $this->app['auth']->forgetGuards();
            $user = User::factory()->create(['role' => $role]);

            $this->actingAsSupabase($user)
                ->getJson('/api/notifications')
                ->assertOk()
                ->assertJsonCount(1, 'data');
        }
    }

    public function test_mark_all_read_does_not_touch_announcements_the_role_cannot_see(): void
    {
        $hidden = AppNotification::factory()->create([
            'title' => 'New Criminal Record',
            'read' => false,
            'audience_roles' => AppNotification::audienceFor([User::ROLE_BADAC_ADMIN]),
        ]);

        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder)
            ->putJson('/api/notifications/read-all')
            ->assertOk();

        $this->assertDatabaseMissing('notification_reads', [
            'app_notification_id' => $hidden->id,
            'user_id' => $encoder->id,
        ]);
    }

    public function test_creating_a_criminal_record_announces_it(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);

        $this->actingAsSupabase($admin)
            ->postJson('/api/criminals', ['fullName' => 'Juan Santos'])
            ->assertCreated();

        $notification = AppNotification::where('title', 'New Criminal Record')->first();
        $this->assertNotNull($notification);
        // Built from the row that was actually written, so the announcement
        // can never name a record that does not exist.
        $this->assertStringContainsString('Juan Santos', $notification->message);
    }

    public function test_creating_a_victim_record_announces_it(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);

        $this->actingAsSupabase($admin)
            ->postJson('/api/victims', ['fullName' => 'Maria Cruz'])
            ->assertCreated();

        $notification = AppNotification::where('title', 'New Victim Record')->first();
        $this->assertNotNull($notification);
        $this->assertStringContainsString('Maria Cruz', $notification->message);
    }

    public function test_unauthenticated_user_cannot_mark_notifications_read(): void
    {
        AppNotification::factory()->create(['read' => false]);

        $this->putJson('/api/notifications/read-all')->assertUnauthorized();
    }
}
