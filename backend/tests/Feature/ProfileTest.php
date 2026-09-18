<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Self-service Profile Settings — PUT /api/me and POST /api/me/avatar.
 *
 * These endpoints had no test coverage at all, which is why "Change Profile
 * does not work" could not be answered from the repository: there was nothing
 * asserting that the name reaches the database, that the response carries the
 * new value back, or that a failed picture upload is reported as a failure
 * rather than a success. Each of those is pinned down below.
 *
 * The avatar cases exercise the LOCAL-DISK fallback (via Storage::fake), not
 * Supabase Storage. The Supabase path needs a real bucket and a service-role
 * key, neither of which exists in a test run — see the final report for what
 * that leaves unverified.
 */
class ProfileTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_can_update_their_own_display_name(): void
    {
        $user = User::factory()->create(['name' => 'Old Name']);

        $this->actingAsSupabase($user)
            ->putJson('/api/me', ['fullName' => 'New Name'])
            ->assertOk()
            // The response must carry the new value: the frontend merges this
            // straight into AuthContext, so a stale body would leave the
            // sidebar showing the old name until a full reload.
            ->assertJsonPath('data.fullName', 'New Name');

        // ...and it must actually be in the database, which is what survives
        // the page refresh the user does next.
        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'New Name']);
    }

    public function test_the_updated_name_survives_a_fresh_request(): void
    {
        // The "refresh the page and it is still there" requirement, expressed
        // the only way a backend test can: a second, independent request must
        // report the new value.
        $user = User::factory()->create(['name' => 'Old Name']);

        $this->actingAsSupabase($user)->putJson('/api/me', ['fullName' => 'Persisted Name'])->assertOk();

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.fullName', 'Persisted Name');
    }

    public function test_updating_the_profile_writes_an_audit_entry(): void
    {
        $user = User::factory()->create();

        $this->actingAsSupabase($user)->putJson('/api/me', ['fullName' => 'Audited Name'])->assertOk();

        $this->assertTrue(
            AuditLog::where('user_id', $user->id)
                ->where('module', 'users')
                ->where('action', 'UPDATE')
                ->exists()
        );
    }

    public function test_a_blank_name_is_rejected_with_a_validation_error(): void
    {
        $user = User::factory()->create(['name' => 'Original']);

        $this->actingAsSupabase($user)
            ->putJson('/api/me', ['fullName' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('fullName');

        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'Original']);
    }

    public function test_an_unauthenticated_caller_cannot_update_a_profile(): void
    {
        $user = User::factory()->create(['name' => 'Untouched']);

        $this->putJson('/api/me', ['fullName' => 'Hijacked'])->assertUnauthorized();

        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'Untouched']);
    }

    public function test_every_role_may_edit_its_own_profile(): void
    {
        // Profile Settings is reachable from the sidebar for all three roles,
        // and PUT /me carries no `role:` middleware on purpose — editing your
        // own display name is not an administrative action.
        foreach ([User::ROLE_BADAC_ADMIN, User::ROLE_ENCODER, User::ROLE_BADAC_VALIDATOR] as $role) {
            $this->app['auth']->forgetGuards();
            $user = User::factory()->create(['role' => $role]);

            $this->actingAsSupabase($user)
                ->putJson('/api/me', ['fullName' => 'Renamed '.$role])
                ->assertOk()
                ->assertJsonPath('data.fullName', 'Renamed '.$role);
        }
    }

    public function test_uploading_an_avatar_stores_the_file_and_returns_a_url(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $response = $this->actingAsSupabase($user)
            ->post('/api/me/avatar', ['avatar' => UploadedFile::fake()->image('me.png')])
            ->assertOk();

        // Stored under a per-user key, so a re-upload replaces the picture
        // instead of leaving an orphan behind for every change.
        Storage::disk('public')->assertExists("avatars/{$user->id}.png");

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'avatar_path' => "avatars/{$user->id}.png",
        ]);

        $this->assertNotNull($response->json('data.avatarUrl'));
        $this->assertStringContainsString("avatars/{$user->id}.png", $response->json('data.avatarUrl'));
    }

    public function test_an_avatar_url_is_absolute_so_the_frontend_can_load_it_cross_origin(): void
    {
        // The frontend is served from a different origin than this API, so a
        // relative path would resolve against the wrong host and 404 — which is
        // exactly what a blank APP_URL used to produce.
        Storage::fake('public');
        $user = User::factory()->create();

        $url = $this->actingAsSupabase($user)
            ->post('/api/me/avatar', ['avatar' => UploadedFile::fake()->image('me.png')])
            ->json('data.avatarUrl');

        $this->assertMatchesRegularExpression('#^https?://#', $url);
    }

    public function test_a_non_image_upload_is_rejected(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $this->actingAsSupabase($user)
            ->post('/api/me/avatar', ['avatar' => UploadedFile::fake()->create('notes.pdf', 40, 'application/pdf')])
            ->assertStatus(422)
            ->assertJsonValidationErrors('avatar');

        $this->assertDatabaseHas('users', ['id' => $user->id, 'avatar_path' => null]);
    }

    public function test_an_oversized_image_is_rejected(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        // 4 MB is the documented cap (ProfileController and the modal's own
        // client-side check both state it); 5 MB must not get through.
        $this->actingAsSupabase($user)
            ->post('/api/me/avatar', ['avatar' => UploadedFile::fake()->image('huge.png')->size(5 * 1024)])
            ->assertStatus(422)
            ->assertJsonValidationErrors('avatar');
    }

    public function test_an_unauthenticated_caller_cannot_upload_an_avatar(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $this->post('/api/me/avatar', ['avatar' => UploadedFile::fake()->image('me.png')])
            ->assertUnauthorized();

        $this->assertDatabaseHas('users', ['id' => $user->id, 'avatar_path' => null]);
    }

    public function test_the_avatar_always_belongs_to_the_authenticated_caller(): void
    {
        // There is no {user} parameter on this route, so "you can only change
        // your own picture" is structural. This pins that down: uploading while
        // signed in as one account must not touch any other account's row.
        Storage::fake('public');
        $me = User::factory()->create();
        $someoneElse = User::factory()->create();

        $this->actingAsSupabase($me)
            ->post('/api/me/avatar', ['avatar' => UploadedFile::fake()->image('me.png')])
            ->assertOk();

        $this->assertDatabaseHas('users', ['id' => $me->id, 'avatar_path' => "avatars/{$me->id}.png"]);
        $this->assertDatabaseHas('users', ['id' => $someoneElse->id, 'avatar_path' => null]);
    }

    public function test_a_legacy_relative_avatar_path_still_resolves(): void
    {
        // Accounts that uploaded a picture before Supabase Storage existed hold
        // a relative local-disk path. User::avatarUrl() must keep resolving
        // those, or configuring a bucket would blank every existing avatar.
        $user = User::factory()->create();
        $user->forceFill(['avatar_path' => 'avatars/legacy.png'])->save();

        $this->actingAsSupabase($user)
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.avatarUrl', fn ($url) => str_ends_with($url, '/storage/avatars/legacy.png'));
    }

    public function test_an_absolute_avatar_url_is_returned_unchanged(): void
    {
        // What a Supabase Storage upload stores. It must be handed to the
        // browser as-is rather than being prefixed with this API's own host.
        $user = User::factory()->create();
        $stored = 'https://example.supabase.co/storage/v1/object/public/avatars/9.png';
        $user->forceFill(['avatar_path' => $stored])->save();

        $this->actingAsSupabase($user)
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.avatarUrl', $stored);
    }
}
