<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Criminal;
use App\Models\Incident;
use App\Models\User;
use App\Models\Victim;
use Database\Seeders\SuperAdminSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Tests\TestCase;

// System Governance (Super Administrator) vs Operational Governance
// (Administrator).
//
//   Super Administrator — Settings, crime types, the raw audit trail and the
//     Administrator accounts; read-only everywhere else.
//   Administrator — operational data and validation, and the Encoder and
//     Validator accounts; reads the settings its analytics compute with, but
//     cannot change them, and cannot read the audit trail.
//   Nobody — can create, promote or manage a Super Administrator through the
//     API. SuperAdminSeeder is the only way one comes into existence.
class GovernanceRolesTest extends TestCase
{
    use RefreshDatabase;

    private const NEW_SUPABASE_ID = '11111111-2222-3333-4444-555555555555';

    private function user(string $role, array $attributes = []): User
    {
        return User::factory()->create(['role' => $role, ...$attributes]);
    }

    /**
     * Stubs the two Supabase Admin API calls an account creation makes:
     * provisioning, and the MFA-factor lookup UserResource performs.
     */
    private function fakeSupabaseAdmin(): void
    {
        config(['supabase.service_role_key' => 'test-only-service-role-key']);

        Http::fake([
            '*/auth/v1/admin/users' => Http::response(['id' => self::NEW_SUPABASE_ID], 200),
            '*/auth/v1/admin/users/*' => Http::response(['factors' => []], 200),
        ]);
    }

    private function newAccount(string $role, string $username): array
    {
        return [
            'fullName' => 'New Account',
            'username' => $username,
            'email' => $username.'@example.com',
            'role' => $role,
            'mfaMethod' => User::MFA_METHOD_EMAIL_OTP,
        ];
    }

    // ===================================================================
    // Settings, crime types and the audit trail
    // ===================================================================

    public function test_super_admin_can_read_and_change_settings(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));

        $this->getJson('/api/settings')->assertOk();
        $this->putJson('/api/settings', ['population' => 20000])
            ->assertOk()
            ->assertJsonPath('population', 20000);
    }

    public function test_admin_can_read_settings_but_cannot_change_them(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));

        // Read access stays: the Administrator's analytics compute with it.
        $this->getJson('/api/settings')->assertOk()->assertJsonPath('population', 15000);

        $this->putJson('/api/settings', ['population' => 1])->assertForbidden();
        $this->getJson('/api/settings')->assertJsonPath('population', 15000);
    }

    public function test_only_the_super_admin_can_manage_crime_types(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));
        $this->postJson('/api/crime-types', ['name' => 'Arson'])->assertForbidden();

        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));
        $this->postJson('/api/crime-types', ['name' => 'Arson'])->assertCreated();
    }

    public function test_only_the_super_admin_can_read_the_audit_trail(): void
    {
        $encoder = $this->user(User::ROLE_ENCODER);

        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));
        $this->getJson('/api/audit-logs')->assertForbidden();
        $this->getJson("/api/users/{$encoder->id}/activity")->assertForbidden();

        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));
        $this->getJson('/api/audit-logs')->assertOk();
        $this->getJson("/api/users/{$encoder->id}/activity")->assertOk();
    }

    // ===================================================================
    // Read-only access to operations
    // ===================================================================

    public function test_super_admin_can_view_the_operational_and_analytics_modules(): void
    {
        $incident = Incident::factory()->create();
        $criminal = Criminal::factory()->create();
        $victim = Victim::factory()->create();

        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));

        foreach ([
            '/api/incidents',
            "/api/incidents/{$incident->id}",
            '/api/incidents/map',
            '/api/criminals',
            "/api/criminals/{$criminal->id}",
            '/api/victims',
            "/api/victims/{$victim->id}",
            '/api/dashboard',
            '/api/analytics',
        ] as $uri) {
            $this->getJson($uri)->assertOk();
        }
    }

    public function test_super_admin_cannot_create_edit_archive_or_validate_anything(): void
    {
        $incident = Incident::factory()->create();
        $criminal = Criminal::factory()->create();
        $victim = Victim::factory()->create();

        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));

        // The role: middleware refuses before any validation runs, so empty
        // bodies are enough to prove the route itself is closed.
        $this->postJson('/api/incidents', [])->assertForbidden();
        $this->putJson("/api/incidents/{$incident->id}", [])->assertForbidden();
        $this->putJson("/api/incidents/{$incident->id}/archive")->assertForbidden();
        $this->putJson("/api/incidents/{$incident->id}/restore")->assertForbidden();
        $this->putJson("/api/incidents/{$incident->id}/validate")->assertForbidden();
        $this->putJson("/api/incidents/{$incident->id}/return", [])->assertForbidden();
        $this->postJson('/api/criminals', [])->assertForbidden();
        $this->putJson("/api/criminals/{$criminal->id}", [])->assertForbidden();
        $this->putJson("/api/criminals/{$criminal->id}/archive")->assertForbidden();
        $this->postJson('/api/victims', [])->assertForbidden();
        $this->putJson("/api/victims/{$victim->id}", [])->assertForbidden();
        $this->putJson("/api/victims/{$victim->id}/archive")->assertForbidden();
    }

    public function test_super_admin_receives_no_contact_details(): void
    {
        $victim = Victim::factory()->create(['address' => '12 Sampaguita St, Barangay 178']);

        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));
        $this->getJson("/api/victims/{$victim->id}")
            ->assertJsonPath('data.address', '12 Sampaguita St, Barangay 178');

        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));
        $this->getJson("/api/victims/{$victim->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.address');
    }

    // ===================================================================
    // Account governance: who may create and manage which accounts
    // ===================================================================

    public function test_admin_can_create_only_encoder_and_validator_accounts(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));
        $this->fakeSupabaseAdmin();

        $this->postJson('/api/users', $this->newAccount(User::ROLE_ENCODER, 'newencoder'))
            ->assertCreated();

        foreach ([User::ROLE_BADAC_ADMIN, User::ROLE_SUPER_ADMIN] as $role) {
            $this->postJson('/api/users', $this->newAccount($role, 'refused'))
                ->assertUnprocessable()
                ->assertJsonValidationErrors('role');
        }

        $this->assertDatabaseMissing('users', ['username' => 'refused']);
    }

    public function test_admin_can_create_a_validator_account(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));
        $this->fakeSupabaseAdmin();

        $this->postJson('/api/users', $this->newAccount(User::ROLE_BADAC_VALIDATOR, 'newvalidator'))
            ->assertCreated()
            ->assertJsonPath('data.role', User::ROLE_BADAC_VALIDATOR);
    }

    public function test_super_admin_can_create_only_administrator_accounts(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));
        $this->fakeSupabaseAdmin();

        $this->postJson('/api/users', $this->newAccount(User::ROLE_BADAC_ADMIN, 'newadmin'))
            ->assertCreated()
            ->assertJsonPath('data.role', User::ROLE_BADAC_ADMIN);

        foreach ([User::ROLE_ENCODER, User::ROLE_BADAC_VALIDATOR, User::ROLE_SUPER_ADMIN] as $role) {
            $this->postJson('/api/users', $this->newAccount($role, 'refused'))
                ->assertUnprocessable()
                ->assertJsonValidationErrors('role');
        }

        $this->assertDatabaseMissing('users', ['username' => 'refused']);
    }

    public function test_a_refused_super_admin_creation_never_reaches_supabase(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));
        $this->fakeSupabaseAdmin();

        $this->postJson('/api/users', $this->newAccount(User::ROLE_SUPER_ADMIN, 'second'))
            ->assertUnprocessable();

        Http::assertNotSent(fn ($request) => $request->method() === 'POST'
            && str_ends_with($request->url(), '/auth/v1/admin/users'));
        $this->assertSame(1, User::where('role', User::ROLE_SUPER_ADMIN)->count());
    }

    public function test_admin_cannot_touch_a_super_admin_account(): void
    {
        $superAdmin = $this->user(User::ROLE_SUPER_ADMIN, [
            'name' => 'System Owner',
            'supabase_user_id' => 'supabase-super-admin',
        ]);
        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));
        // Faked so that any Admin API call would be RECORDED, and the final
        // assertion below can prove none was made.
        $this->fakeSupabaseAdmin();

        $this->putJson("/api/users/{$superAdmin->id}", ['fullName' => 'Renamed'])->assertForbidden();
        $this->putJson("/api/users/{$superAdmin->id}/status", ['isActive' => false])->assertForbidden();
        $this->postJson("/api/users/{$superAdmin->id}/two-factor/require", ['required' => false])->assertForbidden();
        $this->postJson("/api/users/{$superAdmin->id}/two-factor/disable")->assertForbidden();
        $this->postJson("/api/users/{$superAdmin->id}/temporary-password", ['temporaryPassword' => 'Unused-Temp-Pass-91'])
            ->assertForbidden();
        $this->postJson("/api/users/{$superAdmin->id}/password-reset-audit")->assertForbidden();

        $superAdmin->refresh();
        $this->assertSame('System Owner', $superAdmin->name);
        $this->assertTrue($superAdmin->is_active);
        $this->assertFalse((bool) $superAdmin->must_change_password);
        // The Gate refused before any Supabase Admin API call could be made.
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/auth/v1/admin/'));
    }

    public function test_admin_cannot_manage_another_administrator(): void
    {
        $otherAdmin = $this->user(User::ROLE_BADAC_ADMIN, ['name' => 'Other Admin']);
        $this->actingAsSupabase($this->user(User::ROLE_BADAC_ADMIN));

        $this->putJson("/api/users/{$otherAdmin->id}", ['fullName' => 'Renamed'])->assertForbidden();
        $this->putJson("/api/users/{$otherAdmin->id}/status", ['isActive' => false])->assertForbidden();

        $this->assertSame('Other Admin', $otherAdmin->fresh()->name);
        $this->assertTrue($otherAdmin->fresh()->is_active);
    }

    public function test_super_admin_can_manage_administrator_accounts(): void
    {
        $admin = $this->user(User::ROLE_BADAC_ADMIN, ['name' => 'Old Name']);
        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));

        $this->putJson("/api/users/{$admin->id}", ['fullName' => 'New Name'])
            ->assertOk()
            ->assertJsonPath('data.fullName', 'New Name');
        $this->putJson("/api/users/{$admin->id}/status", ['isActive' => false])
            ->assertOk()
            ->assertJsonPath('data.isActive', false);
    }

    public function test_super_admin_cannot_manage_operational_or_super_admin_accounts(): void
    {
        $encoder = $this->user(User::ROLE_ENCODER);
        $validator = $this->user(User::ROLE_BADAC_VALIDATOR);
        $otherSuperAdmin = $this->user(User::ROLE_SUPER_ADMIN);
        $self = $this->user(User::ROLE_SUPER_ADMIN);
        $this->actingAsSupabase($self);

        foreach ([$encoder, $validator, $otherSuperAdmin, $self] as $target) {
            $this->putJson("/api/users/{$target->id}", ['fullName' => 'Renamed'])->assertForbidden();
            $this->putJson("/api/users/{$target->id}/status", ['isActive' => false])->assertForbidden();
        }
    }

    public function test_both_tiers_can_list_accounts_but_see_credential_state_only_for_their_own(): void
    {
        $encoder = $this->user(User::ROLE_ENCODER);
        $admin = $this->user(User::ROLE_BADAC_ADMIN);
        $superAdmin = $this->user(User::ROLE_SUPER_ADMIN);

        $row = fn ($response, User $user) => collect($response->json('data'))
            ->firstWhere('id', (string) $user->id);

        $this->actingAsSupabase($admin);
        $asAdmin = $this->getJson('/api/users')->assertOk();
        $this->assertArrayHasKey('temporaryCredentialStatus', $row($asAdmin, $encoder));
        $this->assertArrayNotHasKey('temporaryCredentialStatus', $row($asAdmin, $superAdmin));

        $this->actingAsSupabase($superAdmin);
        $asSuperAdmin = $this->getJson('/api/users')->assertOk();
        $this->assertArrayHasKey('temporaryCredentialStatus', $row($asSuperAdmin, $admin));
        $this->assertArrayNotHasKey('temporaryCredentialStatus', $row($asSuperAdmin, $encoder));
    }

    public function test_role_permission_matrix_reports_the_governance_split(): void
    {
        $this->actingAsSupabase($this->user(User::ROLE_SUPER_ADMIN));

        $response = $this->getJson('/api/role-permissions')->assertOk();

        $this->assertContains(User::ROLE_SUPER_ADMIN, collect($response->json('data.roles'))->pluck('key'));

        $access = fn (string $module) => collect($response->json('data.modules'))
            ->firstWhere('id', $module)['access'];

        $this->assertSame('full', $access('settings')[User::ROLE_SUPER_ADMIN]);
        $this->assertSame('none', $access('settings')[User::ROLE_BADAC_ADMIN]);
        $this->assertSame('view', $access('audit-logs')[User::ROLE_SUPER_ADMIN]);
        $this->assertSame('none', $access('audit-logs')[User::ROLE_BADAC_ADMIN]);
        $this->assertSame('view', $access('incident-feed')[User::ROLE_SUPER_ADMIN]);
        $this->assertSame('full', $access('incident-feed')[User::ROLE_BADAC_ADMIN]);
        $this->assertSame('view', $access('criminal-records')[User::ROLE_SUPER_ADMIN]);
        $this->assertSame('full', $access('user-management')[User::ROLE_SUPER_ADMIN]);
        $this->assertSame('full', $access('user-management')[User::ROLE_BADAC_ADMIN]);
    }

    // ===================================================================
    // SuperAdminSeeder — the only way a Super Administrator is created
    // ===================================================================

    private function configureSuperAdmin(?string $name = 'System Owner', ?string $username = 'sysowner', ?string $email = 'owner@example.com'): void
    {
        config([
            'super_admin.name' => $name,
            'super_admin.username' => $username,
            'super_admin.email' => $email,
        ]);
    }

    public function test_seeder_creates_an_active_super_admin_with_email_mfa(): void
    {
        $this->configureSuperAdmin();

        $this->seed(SuperAdminSeeder::class);

        $superAdmin = User::where('email', 'owner@example.com')->firstOrFail();
        $this->assertSame(User::ROLE_SUPER_ADMIN, $superAdmin->role);
        $this->assertSame('sysowner', $superAdmin->username);
        $this->assertTrue($superAdmin->is_active);
        $this->assertSame(User::MFA_METHOD_EMAIL_OTP, $superAdmin->mfa_method);

        $log = AuditLog::where('module', 'users')->where('action', 'CREATE')->firstOrFail();
        $this->assertNull($log->user_id);
        $this->assertStringContainsString('SuperAdminSeeder', $log->description);
    }

    public function test_seeder_can_be_run_again_without_duplicating_the_account(): void
    {
        $this->configureSuperAdmin();
        $this->seed(SuperAdminSeeder::class);

        $this->configureSuperAdmin(name: 'Renamed Owner');
        $this->seed(SuperAdminSeeder::class);

        $this->assertSame(1, User::where('role', User::ROLE_SUPER_ADMIN)->count());
        $this->assertSame('Renamed Owner', User::where('email', 'owner@example.com')->value('name'));
        $this->assertTrue(AuditLog::where('module', 'users')->where('action', 'UPDATE')->exists());
    }

    public function test_seeder_refuses_to_run_without_configuration(): void
    {
        $this->configureSuperAdmin(email: null);

        try {
            (new SuperAdminSeeder)->run();
            $this->fail('The seeder ran without SUPER_ADMIN_EMAIL.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('SUPER_ADMIN_EMAIL', $e->getMessage());
        }

        $this->assertSame(0, User::where('role', User::ROLE_SUPER_ADMIN)->count());
    }

    public function test_seeder_never_promotes_an_existing_account(): void
    {
        $admin = $this->user(User::ROLE_BADAC_ADMIN, ['email' => 'owner@example.com']);
        $this->configureSuperAdmin();

        try {
            (new SuperAdminSeeder)->run();
            $this->fail('The seeder promoted an existing Administrator.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('never promoted', $e->getMessage());
        }

        $this->assertSame(User::ROLE_BADAC_ADMIN, $admin->fresh()->role);
        $this->assertSame(0, User::where('role', User::ROLE_SUPER_ADMIN)->count());
        $this->assertSame(0, AuditLog::count());
    }

    public function test_seeder_is_not_part_of_the_demo_database_seed(): void
    {
        $this->assertStringNotContainsString(
            'SuperAdminSeeder',
            file_get_contents(database_path('seeders/DatabaseSeeder.php'))
        );
    }
}
