<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\CrimeType;
use App\Models\User;
use App\Services\CrimeTypeColorAllocator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Crime types and their map colours.
 *
 * The behaviour these lock down is the requirement that an Administrator can
 * add a crime type through System Settings and it just gets a colour — no
 * developer edits JavaScript — AND that doing so never disturbs a colour
 * already in use, because the map legend has to mean the same thing tomorrow
 * as it does today.
 *
 * Note the starting state: create_crime_types_table SEEDS the twelve types
 * that used to be hard-coded in the frontend, so every test here begins with a
 * populated, already-coloured table. That is deliberate — it is the state a
 * real install is in the moment the migration finishes, and testing against it
 * also proves the migration's own seeding works.
 */
class CrimeTypeTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($user);

        return $user;
    }

    public function test_the_migration_seeds_the_existing_vocabulary_with_colours(): void
    {
        $this->assertGreaterThanOrEqual(12, CrimeType::count());

        foreach (CrimeType::all() as $type) {
            $this->assertMatchesRegularExpression('/^#[0-9A-F]{6}$/', $type->color, $type->name);
        }

        // Every seeded colour is distinct, so no two crime types are
        // indistinguishable on the map.
        $colors = CrimeType::pluck('color')->all();
        $this->assertSame(count($colors), count(array_unique($colors)));
    }

    public function test_the_seeded_vocabulary_matches_the_documented_example_colours(): void
    {
        $this->assertSame('#2563EB', CrimeType::where('name', 'Assault')->value('color'));
        $this->assertSame('#EA580C', CrimeType::where('name', 'Theft')->value('color'));
        $this->assertSame('#DC2626', CrimeType::where('name', 'Robbery')->value('color'));
    }

    public function test_every_authenticated_role_can_read_crime_types(): void
    {
        // The incident form, the FilterBar and the map legend all need this
        // list, and BADAC (read-only) uses all three.
        foreach ([User::ROLE_BADAC_ADMIN, User::ROLE_ENCODER, User::ROLE_BADAC_READONLY] as $role) {
            // See NotificationTest for why guards are forgotten between two
            // different users inside one test.
            $this->app['auth']->forgetGuards();
            $user = User::factory()->create(['role' => $role]);

            $payload = $this->actingAsSupabase($user)
                ->getJson('/api/crime-types')
                ->assertOk()
                ->json('data');

            $theft = collect($payload)->firstWhere('name', 'Theft');
            $this->assertNotNull($theft, "Role {$role} could not read the crime-type list.");
            $this->assertSame('#EA580C', $theft['color']);
        }
    }

    public function test_a_new_crime_type_is_assigned_a_colour_automatically(): void
    {
        $this->admin();

        $response = $this->postJson('/api/crime-types', ['name' => 'Rape'])
            ->assertCreated();

        $color = $response->json('data.color');
        $this->assertMatchesRegularExpression('/^#[0-9A-F]{6}$/', $color);
        $this->assertDatabaseHas('crime_types', ['name' => 'Rape', 'color' => $color]);
    }

    public function test_an_assigned_colour_is_never_reused_by_a_later_crime_type(): void
    {
        $this->admin();

        // Deliberately more additions than the palette has spare entries, so
        // this also exercises the deterministic generator past exhaustion.
        foreach (['Rape', 'Kidnapping', 'Arson', 'Estafa', 'Trespassing', 'Illegal Gambling', 'Alarm and Scandal', 'Malicious Mischief'] as $name) {
            $this->postJson('/api/crime-types', ['name' => $name])->assertCreated();
        }

        $colors = CrimeType::pluck('color')->all();
        $this->assertSame(count($colors), count(array_unique($colors)));
    }

    public function test_adding_a_crime_type_does_not_change_an_existing_ones_colour(): void
    {
        $this->admin();
        $before = CrimeType::pluck('color', 'name')->all();

        $this->postJson('/api/crime-types', ['name' => 'Arson'])->assertCreated();

        foreach ($before as $name => $color) {
            $this->assertSame($color, CrimeType::where('name', $name)->value('color'), $name);
        }
    }

    public function test_a_colour_may_be_supplied_explicitly(): void
    {
        $this->admin();

        $this->postJson('/api/crime-types', ['name' => 'Arson', 'color' => '#123abc'])
            ->assertCreated()
            // Normalised to upper case so comparisons elsewhere are simple.
            ->assertJsonPath('data.color', '#123ABC');
    }

    public function test_an_invalid_colour_is_rejected(): void
    {
        $this->admin();

        $this->postJson('/api/crime-types', ['name' => 'Arson', 'color' => 'red'])
            ->assertStatus(422);
    }

    public function test_duplicate_crime_type_names_are_rejected(): void
    {
        $this->admin();

        $this->postJson('/api/crime-types', ['name' => 'Theft'])->assertStatus(422);
    }

    public function test_an_administrator_can_rename_recolour_and_disable_a_crime_type(): void
    {
        $this->admin();
        $type = CrimeType::where('name', 'Theft')->firstOrFail();

        $this->putJson("/api/crime-types/{$type->id}", [
            'name' => 'Qualified Theft',
            'color' => '#00AA55',
            'isActive' => false,
        ])->assertOk()
            ->assertJsonPath('data.name', 'Qualified Theft')
            ->assertJsonPath('data.color', '#00AA55')
            ->assertJsonPath('data.isActive', false);
    }

    public function test_a_colour_change_is_written_to_the_audit_log(): void
    {
        $this->admin();
        $type = CrimeType::where('name', 'Theft')->firstOrFail();

        $this->putJson("/api/crime-types/{$type->id}", ['color' => '#00AA55'])->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'module' => 'settings',
            'target_type' => 'crime_type',
        ]);
        $this->assertStringContainsString(
            'map colour #EA580C -> #00AA55',
            AuditLog::where('target_type', 'crime_type')->latest('id')->first()->description
        );
    }

    public function test_a_non_administrator_cannot_create_a_crime_type(): void
    {
        // The control is the route's role: middleware, not the UI hiding
        // System Settings — this calls the API directly, as a bypass would.
        $baseline = CrimeType::count();

        foreach ([User::ROLE_ENCODER, User::ROLE_BADAC_READONLY] as $role) {
            $this->app['auth']->forgetGuards();
            $user = User::factory()->create(['role' => $role]);

            $this->actingAsSupabase($user)
                ->postJson('/api/crime-types', ['name' => 'Arson '.$role])
                ->assertForbidden();
        }

        $this->assertSame($baseline, CrimeType::count());
    }

    public function test_a_non_administrator_cannot_change_a_crime_type_colour(): void
    {
        $type = CrimeType::where('name', 'Theft')->firstOrFail();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);

        $this->actingAsSupabase($encoder)
            ->putJson("/api/crime-types/{$type->id}", ['color' => '#000000'])
            ->assertForbidden();

        $this->assertSame('#EA580C', $type->fresh()->color);
    }

    public function test_an_unauthenticated_caller_cannot_read_or_write_crime_types(): void
    {
        $this->getJson('/api/crime-types')->assertUnauthorized();
        $this->postJson('/api/crime-types', ['name' => 'Arson'])->assertUnauthorized();
    }

    public function test_the_allocator_generates_a_deterministic_colour_once_the_palette_runs_out(): void
    {
        $exhausted = CrimeTypeColorAllocator::PALETTE;

        $first = CrimeTypeColorAllocator::allocate('Some Very New Crime', $exhausted);
        $second = CrimeTypeColorAllocator::allocate('Some Very New Crime', $exhausted);

        $this->assertSame($first, $second, 'The same name must always produce the same colour.');
        $this->assertMatchesRegularExpression('/^#[0-9A-F]{6}$/', $first);
        $this->assertNotContains($first, $exhausted);
    }
}
