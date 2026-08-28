<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Incident;
use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Tests\TestCase;

// Checkpoint 38 — the 'supabase.mfa' (EnsureSupabaseAal2) middleware has
// been removed from every route; GET/PUT /users* now only require
// 'auth:supabase' + role:badac_admin. This file still authenticates through
// a genuine signed test JWT (same test-only shared-secret mechanism used
// throughout this suite, see SupabaseTokenValidationTest) instead of
// actingAs(), so it exercises the real SupabaseTokenValidator path.
class UserManagementTest extends TestCase
{
    use RefreshDatabase;

    protected function actingAsSupabase(User $user, string $aal = 'aal2'): static
    {
        if (! $user->supabase_user_id) {
            $user->forceFill(['supabase_user_id' => 'supabase-test-'.$user->id])->save();
        }

        $now = time();
        $claims = [
            'sub' => $user->supabase_user_id,
            'aud' => 'authenticated',
            'iss' => rtrim(config('supabase.url'), '/').'/auth/v1',
            'email' => $user->email,
            'email_verified' => true,
            'aal' => $aal,
            'iat' => $now,
            'exp' => $now + 3600,
        ];

        $token = JWT::encode($claims, config('supabase.jwt_secret'), 'HS256');

        return $this->withHeader('Authorization', 'Bearer '.$token);
    }

    private function actingAdmin(): User
    {
        $admin = User::factory()->create([
            'name' => 'John Paul Paran',
            'username' => 'admin',
            'role' => User::ROLE_BADAC_ADMIN,
        ]);
        $this->actingAsSupabase($admin);

        return $admin;
    }

    public function test_admin_can_list_users(): void
    {
        $this->actingAdmin();
        User::factory()->create(['username' => 'encoder', 'role' => User::ROLE_ENCODER]);

        $this->getJson('/api/users')->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_encoder_cannot_list_users(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->getJson('/api/users')->assertForbidden();
    }

    public function test_encoder_cannot_update_another_user(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($encoder);

        $this->putJson("/api/users/{$admin->id}", ['fullName' => 'Hacked Name'])->assertForbidden();
    }

    public function test_admin_can_update_a_users_profile_fields(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create(['name' => 'Luiza Perez', 'username' => 'encoder', 'role' => User::ROLE_ENCODER]);

        $response = $this->putJson("/api/users/{$encoder->id}", [
            'fullName' => 'Luiza Perez',
            'username' => 'encoder-updated',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.fullName', 'Luiza Perez')
            ->assertJsonPath('data.username', 'encoder-updated');
    }

    // Checkpoint 31 — admin email sync fix. 'email' is deliberately not an
    // editable field through this endpoint anymore (see UpdateUserRequest's
    // Checkpoint 31 comment): Supabase Auth is authoritative for sign-in
    // email, and this endpoint has no verified path to update it there too.
    // A submitted 'email' must be silently ignored, not applied and not
    // rejected as invalid input.
    public function test_admin_email_field_is_not_editable_through_update(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create([
            'name' => 'Luiza Perez',
            'username' => 'encoder',
            'email' => 'original@example.com',
            'role' => User::ROLE_ENCODER,
        ]);

        $response = $this->putJson("/api/users/{$encoder->id}", [
            'fullName' => 'Luiza Perez',
            'email' => 'attempted-change@example.com',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.fullName', 'Luiza Perez')
            ->assertJsonPath('data.email', 'original@example.com');

        $this->assertSame('original@example.com', $encoder->fresh()->email);
    }

    public function test_update_rejects_duplicate_username(): void
    {
        $this->actingAdmin();
        User::factory()->create(['username' => 'taken']);
        $target = User::factory()->create(['username' => 'free']);

        $this->putJson("/api/users/{$target->id}", ['username' => 'taken'])
            ->assertUnprocessable();
    }

    public function test_role_field_is_not_mass_assignable_through_update(): void
    {
        $admin = $this->actingAdmin();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);

        $this->putJson("/api/users/{$encoder->id}", [
            'fullName' => 'Still Encoder',
            'role' => User::ROLE_BADAC_ADMIN, // attempted privilege escalation via payload
        ])->assertOk();

        $this->assertSame(User::ROLE_ENCODER, $encoder->fresh()->role);
    }

    public function test_admin_can_deactivate_another_users_account(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER, 'is_active' => true]);

        $this->putJson("/api/users/{$encoder->id}/status", ['isActive' => false])
            ->assertOk()
            ->assertJsonPath('data.isActive', false);

        $this->assertFalse($encoder->fresh()->is_active);
    }

    public function test_admin_cannot_deactivate_their_own_account(): void
    {
        $admin = $this->actingAdmin();

        $this->putJson("/api/users/{$admin->id}/status", ['isActive' => false])
            ->assertStatus(422);

        $this->assertTrue($admin->fresh()->is_active);
    }

    // ===================================================================
    // Account Administration — account creation (POST /api/users)
    // ===================================================================

    /** A Supabase id that belongs to nothing else -- a genuinely new account. */
    private const NEW_SUPABASE_ID = '11111111-2222-3333-4444-555555555555';

    /**
     * Stubs Supabase's Admin API. Two endpoints are involved in a create:
     * POST /auth/v1/admin/users (provisioning) and GET
     * /auth/v1/admin/users/{id} (the MFA-factor lookup UserResource does for
     * every serialized account).
     *
     * `$returnedId` exists so a test can make Supabase hand back an id that is
     * ALREADY linked to another account -- the case that must never lead to a
     * deletion.
     *
     * @param  array<string, mixed>  $errorPayload  body for a non-200 response
     */
    private function fakeSupabaseAdmin(
        int $createStatus = 200,
        ?string $returnedId = null,
        array $errorPayload = []
    ): void {
        config(['supabase.service_role_key' => 'test-only-service-role-key']);

        Http::fake([
            '*/auth/v1/admin/users' => Http::response(
                $createStatus === 200
                    ? ['id' => $returnedId ?? self::NEW_SUPABASE_ID]
                    : ($errorPayload !== [] ? $errorPayload : ['msg' => 'nope']),
                $createStatus
            ),
            '*/auth/v1/admin/users/*' => Http::response(['factors' => []], 200),
        ]);
    }

    public function test_admin_can_create_an_account_in_both_systems(): void
    {
        $this->actingAdmin();
        $this->fakeSupabaseAdmin();

        $response = $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
            'isActive' => true,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.fullName', 'Maria Santos')
            ->assertJsonPath('data.role', User::ROLE_ENCODER)
            ->assertJsonPath('data.isActive', true)
            // Never signed in yet — reported as null, never as a made-up date.
            ->assertJsonPath('data.lastLoginAt', null);

        $created = User::where('username', 'msantos')->first();
        $this->assertNotNull($created);
        // The Supabase Auth half is what makes the account able to sign in at
        // all; a local row on its own would be a dead account.
        $this->assertSame(self::NEW_SUPABASE_ID, $created->supabase_user_id);
        // No credential is ever stored on this side.
        $this->assertNull($created->password);
    }

    public function test_account_creation_is_written_to_the_audit_trail(): void
    {
        $admin = $this->actingAdmin();
        $this->fakeSupabaseAdmin();

        $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertCreated();

        $log = AuditLog::where('action', 'CREATE')->where('module', 'users')->first();
        $this->assertNotNull($log);
        $this->assertSame($admin->id, $log->user_id);
        $this->assertStringContainsString('msantos', $log->description);
    }

    public function test_no_local_account_survives_when_supabase_refuses(): void
    {
        $this->actingAdmin();
        $this->fakeSupabaseAdmin(422);

        $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertStatus(422);

        // The whole point of the transaction: no half-provisioned account
        // that exists locally but can never authenticate.
        $this->assertNull(User::where('username', 'msantos')->first());
    }

    public function test_create_rejects_a_duplicate_username_or_email(): void
    {
        $this->actingAdmin();
        User::factory()->create(['username' => 'taken', 'email' => 'taken@example.com']);

        $this->postJson('/api/users', [
            'fullName' => 'Someone Else',
            'username' => 'taken',
            'email' => 'fresh@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertUnprocessable();

        $this->postJson('/api/users', [
            'fullName' => 'Someone Else',
            'username' => 'fresh',
            'email' => 'taken@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertUnprocessable();
    }

    public function test_create_rejects_an_unknown_role(): void
    {
        $this->actingAdmin();

        $this->postJson('/api/users', [
            'fullName' => 'Someone Else',
            'username' => 'fresh',
            'email' => 'fresh@example.com',
            'role' => 'superuser',
        ])->assertUnprocessable();

        $this->assertNull(User::where('username', 'fresh')->first());
    }

    public function test_encoder_cannot_create_an_account(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->postJson('/api/users', [
            'fullName' => 'Escalated Admin',
            'username' => 'escalated',
            'email' => 'escalated@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
        ])->assertForbidden();

        $this->assertNull(User::where('username', 'escalated')->first());
    }

    public function test_a_newly_created_supabase_account_is_removed_again_when_the_local_row_cannot_be_saved(): void
    {
        $this->actingAdmin();

        // The id handed back belongs to no other account, so it is genuinely
        // this operation's to undo. That distinction is the whole point: an
        // earlier version of this test forced the failure by making Supabase
        // return an id an INCUMBENT account already held, and then asserted we
        // deleted it -- specifying the destruction of an unrelated identity as
        // correct behaviour. See the regression test directly below.
        $this->fakeSupabaseAdmin();

        // Fail the local save after Supabase has provisioned the account.
        // Scoped to this test's application instance, so no listener leaks.
        Event::listen('eloquent.updating: '.User::class, function () {
            throw new RuntimeException('simulated local failure after Supabase provisioning');
        });

        $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertStatus(422);

        // Neither system keeps the half-made account.
        $this->assertNull(User::where('username', 'msantos')->first());
        Http::assertSent(fn ($request) => $request->method() === 'DELETE'
            && str_contains($request->url(), '/admin/users/'.self::NEW_SUPABASE_ID));
    }

    /**
     * Regression guard for the compensating delete.
     *
     * If Supabase ever answered a duplicate creation with 2xx and the EXISTING
     * user's record instead of an error, the unique constraint on
     * users.supabase_user_id would fail the local save and the compensation
     * would delete that existing user's Supabase identity -- destroying a live
     * account that this operation never created. The guard in
     * UserController::store() clears the compensation id before throwing so
     * that can never happen.
     */
    public function test_a_supabase_id_that_already_belongs_to_another_account_is_never_deleted(): void
    {
        $this->actingAdmin();

        $incumbentId = '99999999-8888-7777-6666-555555555555';
        $incumbent = User::factory()->create([
            'username' => 'incumbent',
            'supabase_user_id' => $incumbentId,
        ]);

        // Supabase hands back the incumbent's identity rather than a new one.
        $this->fakeSupabaseAdmin(200, $incumbentId);

        $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertStatus(422);

        // No half-made local account...
        $this->assertNull(User::where('username', 'msantos')->first());

        // ...and, the point of this test: nothing was deleted, and the
        // incumbent's identity is exactly as it was.
        Http::assertNotSent(fn ($request) => $request->method() === 'DELETE');
        $this->assertSame($incumbentId, $incumbent->fresh()->supabase_user_id);
        $this->assertDatabaseHas('users', ['id' => $incumbent->id, 'username' => 'incumbent']);
    }

    public function test_a_duplicate_is_recognised_from_the_supabase_error_code_not_only_the_status(): void
    {
        $this->actingAdmin();

        // A status this code does not special-case (400), carrying Supabase's
        // own duplicate error code. Supabase documents no HTTP status for
        // email_exists, so the code is the signal that must be honoured.
        $this->fakeSupabaseAdmin(400, null, [
            'error_code' => 'email_exists',
            'msg' => 'A user with this email address has already been registered',
        ]);

        $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'That email address is already registered in Supabase Auth.');

        $this->assertNull(User::where('username', 'msantos')->first());
        Http::assertNotSent(fn ($request) => $request->method() === 'DELETE');
    }

    public function test_the_generated_supabase_password_is_never_returned_to_the_caller(): void
    {
        $this->actingAdmin();
        $this->fakeSupabaseAdmin();

        $response = $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertCreated();

        // The random password exists only as an argument to the Supabase call.
        // It must not appear in the response, and nothing password-shaped may
        // be serialized back to the administrator.
        $body = $response->getContent();
        $this->assertStringNotContainsString('password', strtolower($body));

        // Nor may it be written to this database.
        $this->assertNull(User::where('username', 'msantos')->first()->password);

        // ...and the audit row records the act, never the credential.
        $log = AuditLog::where('action', 'CREATE')->where('module', 'users')->first();
        $this->assertStringNotContainsString('password', strtolower($log->description));
    }

    public function test_badac_readonly_cannot_reach_any_account_administration_endpoint(): void
    {
        $viewer = User::factory()->create(['role' => User::ROLE_BADAC_READONLY]);
        $target = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($viewer);

        // Encoder coverage already exists for each of these; BADAC
        // (read-only) is the third role and must be refused just as firmly.
        $this->getJson('/api/users')->assertForbidden();
        $this->postJson('/api/users', [
            'fullName' => 'X',
            'username' => 'x',
            'email' => 'x@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertForbidden();
        $this->getJson("/api/users/{$target->id}/activity")->assertForbidden();
        $this->postJson("/api/users/{$target->id}/password-reset-audit")->assertForbidden();
        $this->putJson("/api/users/{$target->id}/status", ['isActive' => false])->assertForbidden();
        $this->getJson('/api/role-permissions')->assertForbidden();

        $this->assertTrue($target->fresh()->is_active);
    }

    public function test_account_administration_endpoints_reject_an_unauthenticated_caller(): void
    {
        $target = User::factory()->create(['role' => User::ROLE_ENCODER]);

        // No Authorization header at all — rejected by the guard before any
        // role check or controller runs.
        $this->getJson('/api/users')->assertUnauthorized();
        $this->postJson('/api/users', [])->assertUnauthorized();
        $this->getJson("/api/users/{$target->id}/activity")->assertUnauthorized();
        $this->postJson("/api/users/{$target->id}/password-reset-audit")->assertUnauthorized();
        $this->getJson('/api/role-permissions')->assertUnauthorized();
    }

    // ===================================================================
    // Last login — derived from the existing audit trail, not invented
    // ===================================================================

    /** Creates an audit row for $user, backdated to $daysAgo days ago. */
    private function auditRow(User $user, string $action, int $daysAgo): AuditLog
    {
        $log = AuditLog::create([
            'user_id' => $user->id,
            'action' => $action,
            'module' => 'auth',
            'description' => $action,
        ]);

        $log->forceFill(['created_at' => now()->subDays($daysAgo)])->save();

        return $log;
    }

    public function test_last_login_comes_from_the_most_recent_login_audit_row(): void
    {
        $this->actingAdmin();
        $target = User::factory()->create(['username' => 'seen', 'role' => User::ROLE_ENCODER]);

        $this->auditRow($target, 'LOGIN', 9);
        $this->auditRow($target, 'LOGIN', 4);   // the answer: the NEWEST login

        // Both of these are newer than every LOGIN above. If the aggregate
        // failed to filter on `action`, it would return one of these instead
        // and the assertion below would fail — which is the whole point of
        // dating them this way rather than creating them all at `now()`.
        $this->auditRow($target, 'LOGOUT', 1);
        $this->auditRow($target, 'UPDATE', 0);

        $response = $this->getJson('/api/users')->assertOk();

        $row = collect($response->json('data'))->firstWhere('username', 'seen');
        $this->assertNotNull($row['lastLoginAt']);
        $this->assertSame(
            now()->subDays(4)->toDateString(),
            Carbon::parse($row['lastLoginAt'])->toDateString()
        );
    }

    public function test_last_login_is_scoped_to_each_account_separately(): void
    {
        $this->actingAdmin();
        $alice = User::factory()->create(['username' => 'alice', 'role' => User::ROLE_ENCODER]);
        $bob = User::factory()->create(['username' => 'bob', 'role' => User::ROLE_ENCODER]);

        $this->auditRow($alice, 'LOGIN', 6);
        $this->auditRow($bob, 'LOGIN', 2);

        $rows = collect($this->getJson('/api/users')->assertOk()->json('data'));

        // One account's sign-in must never be reported as another's.
        $this->assertSame(
            now()->subDays(6)->toDateString(),
            Carbon::parse($rows->firstWhere('username', 'alice')['lastLoginAt'])->toDateString()
        );
        $this->assertSame(
            now()->subDays(2)->toDateString(),
            Carbon::parse($rows->firstWhere('username', 'bob')['lastLoginAt'])->toDateString()
        );
    }

    public function test_last_login_is_null_for_an_account_that_has_never_signed_in(): void
    {
        $this->actingAdmin();
        User::factory()->create(['username' => 'never', 'role' => User::ROLE_ENCODER]);

        $response = $this->getJson('/api/users')->assertOk();
        $row = collect($response->json('data'))->firstWhere('username', 'never');

        $this->assertNull($row['lastLoginAt']);
        $this->assertNotNull($row['createdAt']);
    }

    // ===================================================================
    // Per-user activity — the existing audit trail, scoped server-side
    // ===================================================================

    public function test_admin_sees_only_the_selected_users_activity(): void
    {
        $admin = $this->actingAdmin();
        $target = User::factory()->create(['username' => 'target', 'role' => User::ROLE_ENCODER]);

        AuditLog::create([
            'user_id' => $target->id,
            'action' => 'UPDATE',
            'module' => 'incidents',
            'description' => 'Updated case CDARS-1',
        ]);
        AuditLog::create([
            'user_id' => $admin->id,
            'action' => 'UPDATE',
            'module' => 'incidents',
            'description' => 'Updated case CDARS-2',
        ]);

        $response = $this->getJson("/api/users/{$target->id}/activity")->assertOk();

        $descriptions = collect($response->json('data'))->pluck('details');
        $this->assertTrue($descriptions->contains('Updated case CDARS-1'));
        $this->assertFalse($descriptions->contains('Updated case CDARS-2'));
    }

    public function test_viewing_a_users_activity_is_itself_audited(): void
    {
        $admin = $this->actingAdmin();
        $target = User::factory()->create(['username' => 'target', 'role' => User::ROLE_ENCODER]);

        $this->getJson("/api/users/{$target->id}/activity")->assertOk();

        $log = AuditLog::where('action', 'VIEW')->where('module', 'users')->first();
        $this->assertNotNull($log);
        $this->assertSame($admin->id, $log->user_id);
        $this->assertStringContainsString('target', $log->description);
    }

    public function test_encoder_cannot_read_another_users_activity(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $target = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($encoder);

        $this->getJson("/api/users/{$target->id}/activity")->assertForbidden();
    }

    public function test_activity_is_capped_so_it_can_never_return_an_unbounded_history(): void
    {
        $this->actingAdmin();
        $target = User::factory()->create(['username' => 'busy', 'role' => User::ROLE_ENCODER]);

        for ($i = 0; $i < 60; $i++) {
            AuditLog::create([
                'user_id' => $target->id,
                'action' => 'UPDATE',
                'module' => 'incidents',
                'description' => "Change {$i}",
            ]);
        }

        $response = $this->getJson("/api/users/{$target->id}/activity")->assertOk();

        $this->assertCount(50, $response->json('data'));
    }

    // ===================================================================
    // Deactivation — reversible, and never destructive
    // ===================================================================

    public function test_deactivation_destroys_no_records_and_no_audit_history(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);

        $incident = Incident::factory()->create(['reported_by' => $encoder->id]);
        $history = AuditLog::create([
            'user_id' => $encoder->id,
            'action' => 'LOGIN',
            'module' => 'auth',
            'description' => 'User signed in',
        ]);

        $this->putJson("/api/users/{$encoder->id}/status", ['isActive' => false])->assertOk();

        // The account is disabled, never removed, and nothing it touched is
        // deleted or detached — this is the whole reason deactivation exists
        // instead of a delete endpoint.
        $this->assertDatabaseHas('users', ['id' => $encoder->id]);
        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'reported_by' => $encoder->id]);
        $this->assertDatabaseHas('audit_logs', ['id' => $history->id, 'user_id' => $encoder->id]);
    }

    public function test_a_deactivated_account_can_be_reactivated(): void
    {
        $this->actingAdmin();
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER, 'is_active' => false]);

        $this->putJson("/api/users/{$encoder->id}/status", ['isActive' => true])
            ->assertOk()
            ->assertJsonPath('data.isActive', true);

        $this->assertTrue($encoder->fresh()->is_active);
    }

    // ===================================================================
    // Password reset — audit only; no credential ever crosses this backend
    // ===================================================================

    public function test_password_reset_is_recorded_without_storing_any_credential(): void
    {
        $admin = $this->actingAdmin();
        $target = User::factory()->create(['username' => 'resetme', 'role' => User::ROLE_ENCODER]);

        $this->postJson("/api/users/{$target->id}/password-reset-audit")->assertOk();

        $log = AuditLog::where('module', 'users')
            ->where('description', 'like', '%password reset%')
            ->first();

        $this->assertNotNull($log);
        $this->assertSame($admin->id, $log->user_id);
        // The target's stored password is untouched and still empty — this
        // backend has no password to reset and never acquires one.
        $this->assertNull($target->fresh()->password);
    }

    // The two halves of the post-creation setup email, from the API's side.
    //
    // The send itself is a browser-to-Supabase call
    // (supabase.auth.resetPasswordForEmail) and cannot be exercised from here
    // — this project has no frontend test runner. What IS this backend's
    // responsibility, and what these two cover, is that a brand-new account is
    // immediately eligible for that email, and that a failure to send one
    // never costs the account.

    public function test_a_newly_created_account_can_immediately_be_sent_its_setup_email(): void
    {
        $admin = $this->actingAdmin();
        $this->fakeSupabaseAdmin();

        $created = $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertCreated()->json('data');

        // Exactly what the UI does next, with no intervening step: the account
        // has no password anyone knows, so it is unusable until this is sent.
        $this->postJson("/api/users/{$created['id']}/password-reset-audit")
            ->assertOk();

        $log = AuditLog::where('module', 'users')
            ->where('description', 'like', '%password reset%')
            ->first();

        $this->assertNotNull($log);
        $this->assertSame($admin->id, $log->user_id);
        $this->assertStringContainsString('msantos', $log->description);
    }

    public function test_a_created_account_survives_when_its_setup_email_is_never_sent(): void
    {
        $this->actingAdmin();
        $this->fakeSupabaseAdmin();

        $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertCreated();

        // The email step fails in the browser, so password-reset-audit is
        // never reached. Nothing about the account may be undone by that: it
        // is correctly provisioned in both systems and the administrator can
        // retry the email from the Reset Password action.
        $survivor = User::where('username', 'msantos')->first();
        $this->assertNotNull($survivor);
        $this->assertTrue($survivor->is_active);
        $this->assertNotNull($survivor->supabase_user_id, 'the Supabase half must survive too');

        // The compensating delete belongs to a FAILED CREATION only. A failed
        // email must never reach it, or a working account would be destroyed
        // over a recoverable delivery problem.
        Http::assertNotSent(fn ($request) => $request->method() === 'DELETE');

        // And no audit row claims an email that was never sent.
        $this->assertDatabaseMissing('audit_logs', [
            'module' => 'users',
            'description' => 'Sent a password reset email to msantos',
        ]);
    }

    public function test_encoder_cannot_trigger_a_password_reset_record(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $target = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($encoder);

        $this->postJson("/api/users/{$target->id}/password-reset-audit")->assertForbidden();
    }

    // ===================================================================
    // Role permissions — read back from the route middleware, not declared
    // ===================================================================

    public function test_role_permissions_matrix_reflects_the_actual_route_middleware(): void
    {
        $this->actingAdmin();

        $response = $this->getJson('/api/role-permissions')->assertOk();

        $modules = collect($response->json('data.modules'))->keyBy('id');

        // User Management is role:badac_admin on every verb.
        $this->assertSame('full', $modules['user-management']['access'][User::ROLE_BADAC_ADMIN]);
        $this->assertSame('none', $modules['user-management']['access'][User::ROLE_ENCODER]);
        $this->assertSame('none', $modules['user-management']['access'][User::ROLE_BADAC_READONLY]);

        // Audit Logs was narrowed to admin-only (Checkpoint 38).
        $this->assertSame('none', $modules['audit-logs']['access'][User::ROLE_BADAC_READONLY]);

        // BADAC reads the dashboard but writes nothing there.
        $this->assertSame('view', $modules['dashboard']['access'][User::ROLE_BADAC_READONLY]);

        // Encoder writes incidents.
        $this->assertSame('full', $modules['incident-feed']['access'][User::ROLE_ENCODER]);

        // System Settings is administrator-only, even though GET
        // /crime-types (which shares a URI prefix with the admin-only
        // crime-type writes) is deliberately open to every role. Counting
        // that read would report Encoder and BADAC as having "view" access to
        // a module neither can open.
        $this->assertSame('full', $modules['settings']['access'][User::ROLE_BADAC_ADMIN]);
        $this->assertSame('none', $modules['settings']['access'][User::ROLE_ENCODER]);
        $this->assertSame('none', $modules['settings']['access'][User::ROLE_BADAC_READONLY]);

        // /incidents/map belongs to Crime Mapping, not Crime Data Collection,
        // even though its URI sits under the incidents prefix.
        $this->assertSame('view', $modules['mapping']['access'][User::ROLE_ENCODER]);

        // Every row cites the endpoints it was derived from.
        $this->assertNotEmpty($modules['user-management']['endpoints']);
    }

    public function test_encoder_cannot_read_the_role_permissions_matrix(): void
    {
        $encoder = User::factory()->create(['role' => User::ROLE_ENCODER]);
        $this->actingAsSupabase($encoder);

        $this->getJson('/api/role-permissions')->assertForbidden();
    }

    // NOTE: the previous test_deactivated_user_cannot_log_in() test asserted
    // against a local /api/login endpoint that no longer exists (Supabase
    // Auth is the only authentication system — see AUTH_MIGRATION_STATUS.md)
    // and hardcoded a password. It has been removed as obsolete rather than
    // rewritten: the real guarantee it was meant to cover — that a
    // deactivated user's Supabase-authenticated requests are rejected (see
    // App\Services\SupabaseTokenValidator::resolve(), which checks
    // is_active) — is not exercisable via $this->actingAs(), which bypasses
    // token resolution entirely. Covering it properly needs a test that
    // exercises SupabaseTokenValidator with a stubbed/mocked JWT, which is
    // a genuinely new test rather than a cleanup of this one.
}
