<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationTest extends TestCase
{
    use RefreshDatabase;

    private function actingUser(string $role = User::ROLE_BADAC_ADMIN): User
    {
        $user = User::factory()->create(['role' => $role]);
        $this->actingAs($user);

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
        $this->actingUser();
        $notification = AppNotification::factory()->create(['read' => false]);

        $this->putJson("/api/notifications/{$notification->id}/read")
            ->assertOk()
            ->assertJsonPath('data.read', true);

        $this->assertDatabaseHas('app_notifications', ['id' => $notification->id, 'read' => true]);
    }

    public function test_mark_all_read_marks_every_unread_notification_when_no_title_given(): void
    {
        $this->actingUser();
        AppNotification::factory()->count(2)->create(['title' => 'Hotspot Alert', 'read' => false]);
        AppNotification::factory()->count(2)->create(['title' => 'Case Resolved', 'read' => false]);

        $this->putJson('/api/notifications/read-all')->assertOk();

        $this->assertSame(0, AppNotification::where('read', false)->count());
    }

    public function test_mark_all_read_scoped_to_title_only_affects_matching_notifications(): void
    {
        $this->actingUser();
        $hotspotAlerts = AppNotification::factory()->count(3)->create(['title' => 'Hotspot Alert', 'read' => false]);
        $otherAlerts = AppNotification::factory()->count(2)->create(['title' => 'Case Resolved', 'read' => false]);

        $this->putJson('/api/notifications/read-all?title='.urlencode('Hotspot Alert'))->assertOk();

        foreach ($hotspotAlerts as $n) {
            $this->assertDatabaseHas('app_notifications', ['id' => $n->id, 'read' => true]);
        }
        foreach ($otherAlerts as $n) {
            $this->assertDatabaseHas('app_notifications', ['id' => $n->id, 'read' => false]);
        }
    }

    public function test_encoder_can_also_mark_notifications_read(): void
    {
        // Notifications are shared by both roles — see routes/api.php.
        $this->actingUser(User::ROLE_ENCODER);
        AppNotification::factory()->create(['title' => 'Hotspot Alert', 'read' => false]);

        $this->putJson('/api/notifications/read-all?title='.urlencode('Hotspot Alert'))->assertOk();

        $this->assertSame(0, AppNotification::where('read', false)->count());
    }

    public function test_unauthenticated_user_cannot_mark_notifications_read(): void
    {
        AppNotification::factory()->create(['read' => false]);

        $this->putJson('/api/notifications/read-all')->assertUnauthorized();
    }
}
