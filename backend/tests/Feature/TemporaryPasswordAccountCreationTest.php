<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\SupabaseAdminService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use RuntimeException;
use SensitiveParameter;
use Tests\TestCase;
use Throwable;

/**
 * Temporary passwords for administrator-created accounts — Phase 1.
 *
 * Covers the backend only: the schema, validation, provisioning Supabase with
 * the supplied password, and the local state recorded around it. Enforcing the
 * change on next sign-in is a later phase and is not tested here.
 *
 * The property every test below protects is the same: the password passes
 * THROUGH this application to Supabase and nowhere else — not the response,
 * the database, the audit trail, an exception message, or the log.
 */
class TemporaryPasswordAccountCreationTest extends TestCase
{
    use RefreshDatabase;

    private const NEW_SUPABASE_ID = '11111111-2222-3333-4444-555555555555';

    /** Distinctive, so a leak anywhere is unambiguous. */
    private const TEMP_PASSWORD = 'Tmp-Kx9#qLw2-Brgy178';

    /** @var array<int, string> every log line written during the test */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();

        config(['supabase.service_role_key' => 'test-only-service-role-key']);

        // Capture message AND context, with exceptions rendered in full —
        // including their stack traces, which is where a password passed as a
        // plain argument would otherwise surface.
        Event::listen(MessageLogged::class, function (MessageLogged $e) {
            $context = collect($e->context)->map(
                fn ($v) => $v instanceof Throwable ? (string) $v : json_encode($v)
            )->implode(' ');
            $this->logged[] = $e->message.' '.$context;
        });
    }

    private function admin(): User
    {
        $admin = User::factory()->create(['username' => 'admin', 'role' => User::ROLE_BADAC_ADMIN]);
        $this->actingAsSupabase($admin);

        return $admin;
    }

    /** @param  array<string, mixed>  $errorPayload */
    private function fakeSupabase(int $createStatus = 200, array $errorPayload = []): void
    {
        Http::fake([
            '*/auth/v1/admin/users' => Http::response(
                $createStatus === 200 ? ['id' => self::NEW_SUPABASE_ID] : $errorPayload,
                $createStatus
            ),
            '*/auth/v1/admin/users/*' => Http::response(['factors' => []], 200),
        ]);
    }

    /** @param  array<string, mixed>  $overrides */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'fullName' => 'Maria Santos',
            'username' => 'msantos2026',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
            'temporaryPassword' => self::TEMP_PASSWORD,
        ], $overrides);
    }

    private function assertNotLeaked(string $secret, string $haystack, string $where): void
    {
        $this->assertStringNotContainsString($secret, $haystack, "The password leaked into {$where}.");
    }

    private function assertNotInLogs(string $secret): void
    {
        foreach ($this->logged as $line) {
            $this->assertNotLeaked($secret, $line, 'the application log');
        }
    }

    private function assertNotInDatabase(string $secret): void
    {
        $this->assertNotLeaked($secret, DB::table('users')->get()->toJson(), 'the users table');
        $this->assertNotLeaked($secret, DB::table('audit_logs')->get()->toJson(), 'the audit_logs table');
    }

    // ---------------------------------------------------------------
    // A. Creating an account with a temporary password
    // ---------------------------------------------------------------

    public function test_admin_can_create_an_account_with_a_temporary_password(): void
    {
        Carbon::setTestNow('2026-09-17 09:00:00');
        $admin = $this->admin();
        $this->fakeSupabase();

        $response = $this->postJson('/api/users', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.username', 'msantos2026')
            ->assertJsonPath('data.role', User::ROLE_ENCODER);

        // Supabase received exactly the supplied password, untrimmed and
        // unchanged, through the Admin API boundary.
        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_ends_with($request->url(), '/auth/v1/admin/users')
            && $request['email'] === 'msantos@example.com'
            && $request['password'] === self::TEMP_PASSWORD
            && $request['email_confirm'] === true);

        $user = User::where('username', 'msantos2026')->firstOrFail();
        $this->assertTrue($user->must_change_password);
        $this->assertTrue($user->temporary_password_expires_at->equalTo(Carbon::parse('2026-09-20 09:00:00')));
        $this->assertSame($admin->id, $user->temporary_password_issued_by);
        $this->assertNull($user->password_changed_at);
        $this->assertNull($user->password);
        $this->assertSame(self::NEW_SUPABASE_ID, $user->supabase_user_id);

        // F. Nowhere else.
        $this->assertNotLeaked(self::TEMP_PASSWORD, $response->getContent(), 'the API response');
        $this->assertNotInDatabase(self::TEMP_PASSWORD);
        $this->assertNotInLogs(self::TEMP_PASSWORD);

        $audit = AuditLog::where('module', 'users')->where('action', 'CREATE')->firstOrFail();
        $this->assertSame($admin->id, $audit->user_id);
        $this->assertSame('Created Encoder account msantos2026 with a temporary password', $audit->description);
    }

    public function test_a_password_with_surrounding_spaces_reaches_supabase_exactly_as_typed(): void
    {
        $this->admin();
        $this->fakeSupabase();
        $withSpaces = '  Spaced-Pass-2026  ';

        $this->postJson('/api/users', $this->payload(['temporaryPassword' => $withSpaces]))->assertCreated();

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && $request['password'] === $withSpaces);
    }

    // ---------------------------------------------------------------
    // B. The original path is unchanged
    // ---------------------------------------------------------------

    public function test_creating_an_account_without_a_temporary_password_keeps_the_original_path(): void
    {
        $this->admin();
        $this->fakeSupabase();

        $payload = $this->payload();
        unset($payload['temporaryPassword']);

        $this->postJson('/api/users', $payload)->assertCreated();

        // Supabase still gets a random 48-character password nobody knows.
        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && is_string($request['password'])
            && strlen($request['password']) === 48);

        $user = User::where('username', 'msantos2026')->firstOrFail();
        $this->assertFalse($user->must_change_password);
        $this->assertNull($user->temporary_password_expires_at);
        $this->assertNull($user->temporary_password_issued_by);
        $this->assertNull($user->password);

        $this->assertSame(
            'Created Encoder account msantos2026',
            AuditLog::where('module', 'users')->where('action', 'CREATE')->firstOrFail()->description
        );
    }

    // ---------------------------------------------------------------
    // C. Validation
    // ---------------------------------------------------------------

    /** @return array<string, array{0: mixed}> */
    public static function invalidTemporaryPasswords(): array
    {
        return [
            'empty string' => [''],
            'null' => [null],
            'too short' => ['Ab3#xyz'],
            'too long (73 ASCII bytes)' => [str_repeat('Lp9#', 18).'Z'],
            'too long in bytes though short in characters' => [str_repeat('ñÑ', 19)],
            'only spaces' => ['          '],
            'same as username' => ['msantos2026'],
            'same as username, different case' => ['MSANTOS2026'],
            'same as email' => ['msantos@example.com'],
            'same as email, different case' => ['MSantos@Example.com'],
            'not a string (integer)' => [12345678901],
            'not a string (array)' => [['Tmp-Kx9#qLw2']],
        ];
    }

    #[DataProvider('invalidTemporaryPasswords')]
    public function test_an_invalid_temporary_password_is_rejected_safely(mixed $value): void
    {
        $this->admin();
        $this->fakeSupabase();

        $response = $this->postJson('/api/users', $this->payload(['temporaryPassword' => $value]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('temporaryPassword');

        // The rejected value is never echoed back.
        if (is_string($value) && trim($value) !== '') {
            $this->assertNotLeaked($value, json_encode($response->json('errors')), 'the validation errors');
            $this->assertNotInLogs($value);
        }

        // Nothing was provisioned anywhere.
        $this->assertNull(User::where('username', 'msantos2026')->first());
        Http::assertNothingSent();
    }

    public function test_the_minimum_length_and_byte_limit_accept_their_boundary_values(): void
    {
        $this->admin();

        // Two creations in one test need two DIFFERENT Supabase ids; handing
        // back the same one twice would (correctly) trip the controller's
        // "already linked to another account" guard.
        $ids = ['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002'];
        Http::fake(function ($request) use (&$ids) {
            return $request->method() === 'POST'
                ? Http::response(['id' => array_shift($ids)], 200)
                : Http::response(['factors' => []], 200);
        });

        // Exactly the minimum length.
        $this->postJson('/api/users', $this->payload(['temporaryPassword' => 'Ab3#xyzQ']))->assertCreated();

        // Exactly the 72-byte limit.
        $this->postJson('/api/users', $this->payload([
            'username' => 'second2026',
            'email' => 'second@example.com',
            'temporaryPassword' => str_repeat('Lp9#', 18),
        ]))->assertCreated();
    }

    // ---------------------------------------------------------------
    // D. Supabase rejects the password
    // ---------------------------------------------------------------

    public function test_a_password_supabase_rejects_as_weak_is_a_safe_422_with_nothing_left_behind(): void
    {
        $this->admin();
        $this->fakeSupabase(422, [
            'code' => 422,
            'error_code' => 'weak_password',
            'msg' => 'Password should be at least 12 characters.',
            'weak_password' => ['reasons' => ['length']],
        ]);

        $response = $this->postJson('/api/users', $this->payload())
            ->assertStatus(422)
            ->assertJsonPath('message', SupabaseAdminService::WEAK_PASSWORD_MESSAGE);

        // Not misreported as a duplicate, even though Supabase used HTTP 422.
        $this->assertStringNotContainsString('already registered', $response->getContent());

        $this->assertNotLeaked(self::TEMP_PASSWORD, $response->getContent(), 'the API response');
        $this->assertNotInLogs(self::TEMP_PASSWORD);
        $this->assertNotInDatabase(self::TEMP_PASSWORD);

        // No orphaned local user, and no Supabase user to clean up: creation
        // was refused, so nothing was deleted either.
        $this->assertNull(User::where('username', 'msantos2026')->first());
        Http::assertNotSent(fn ($request) => $request->method() === 'DELETE');
        $this->assertSame(0, AuditLog::where('module', 'users')->where('action', 'CREATE')->count());
    }

    public function test_the_weak_password_code_is_honoured_whatever_the_http_status(): void
    {
        $this->admin();
        $this->fakeSupabase(400, ['error_code' => 'weak_password', 'msg' => 'Password is known to be weak.']);

        $this->postJson('/api/users', $this->payload())
            ->assertStatus(422)
            ->assertJsonPath('message', SupabaseAdminService::WEAK_PASSWORD_MESSAGE);

        $this->assertNull(User::where('username', 'msantos2026')->first());
    }

    // ---------------------------------------------------------------
    // Failure paths: compensation preserved, password never exposed
    // ---------------------------------------------------------------

    public function test_a_local_failure_after_provisioning_rolls_back_and_removes_the_supabase_user(): void
    {
        $this->admin();
        $this->fakeSupabase();

        Event::listen('eloquent.updating: '.User::class, function () {
            throw new RuntimeException('simulated local failure after Supabase provisioning');
        });

        $response = $this->postJson('/api/users', $this->payload())->assertStatus(422);

        $this->assertNull(User::where('username', 'msantos2026')->first());
        Http::assertSent(fn ($request) => $request->method() === 'DELETE'
            && str_contains($request->url(), '/admin/users/'.self::NEW_SUPABASE_ID));

        $this->assertNotLeaked(self::TEMP_PASSWORD, $response->getContent(), 'the API response');
        $this->assertNotInLogs(self::TEMP_PASSWORD);
        $this->assertNotInDatabase(self::TEMP_PASSWORD);
    }

    public function test_an_unexpected_server_fault_after_provisioning_never_logs_the_password(): void
    {
        $this->admin();
        $this->fakeSupabase();

        // Not a RuntimeException, so the controller re-throws it and it is
        // REPORTED — logged with a full stack trace.
        Event::listen('eloquent.updating: '.User::class, function () {
            throw new \LogicException('simulated database fault');
        });

        $response = $this->postJson('/api/users', $this->payload())->assertStatus(500);

        $this->assertNull(User::where('username', 'msantos2026')->first());
        Http::assertSent(fn ($request) => $request->method() === 'DELETE');

        $this->assertNotEmpty($this->logged, 'The fault should have been reported to the log.');
        $this->assertNotLeaked(self::TEMP_PASSWORD, $response->getContent(), 'the API response');
        $this->assertNotInLogs(self::TEMP_PASSWORD);
    }

    public function test_an_unreachable_supabase_is_a_safe_422_and_never_logs_the_password(): void
    {
        $this->admin();
        Http::fake(function () {
            throw new ConnectionException('cURL error 28: Operation timed out');
        });

        $response = $this->postJson('/api/users', $this->payload())
            ->assertStatus(422)
            ->assertJsonPath('message', 'Supabase could not be reached while creating an account. Please try again.');

        $this->assertNull(User::where('username', 'msantos2026')->first());
        $this->assertNotLeaked(self::TEMP_PASSWORD, $response->getContent(), 'the API response');
        $this->assertNotInLogs(self::TEMP_PASSWORD);
    }

    public function test_the_password_arguments_are_marked_sensitive_so_stack_traces_redact_them(): void
    {
        $sensitive = fn (string $method, string $parameter) => collect(
            (new ReflectionMethod(SupabaseAdminService::class, $method))->getParameters()
        )->firstWhere('name', $parameter)?->getAttributes(SensitiveParameter::class);

        $this->assertNotEmpty($sensitive('createUser', 'password'));
        $this->assertNotEmpty($sensitive('setPassword', 'password'));
        $this->assertNotEmpty($sensitive('send', 'payload'));
    }

    // ---------------------------------------------------------------
    // SupabaseAdminService::setPassword() (groundwork, no route yet)
    // ---------------------------------------------------------------

    public function test_set_password_sends_the_password_to_the_admin_api_only(): void
    {
        Http::fake(['*/auth/v1/admin/users/*' => Http::response(['id' => self::NEW_SUPABASE_ID], 200)]);

        app(SupabaseAdminService::class)->setPassword(self::NEW_SUPABASE_ID, self::TEMP_PASSWORD);

        Http::assertSent(fn ($request) => $request->method() === 'PUT'
            && str_ends_with($request->url(), '/auth/v1/admin/users/'.self::NEW_SUPABASE_ID)
            && $request['password'] === self::TEMP_PASSWORD);
        $this->assertNotInLogs(self::TEMP_PASSWORD);
    }

    public function test_set_password_failures_carry_fixed_messages_and_never_the_password(): void
    {
        // One callback for the whole test: re-calling Http::fake() merges stubs
        // and the first match keeps winning, so each case is served in turn.
        $responses = [
            Http::response(['error_code' => 'weak_password'], 422),
            Http::response(['msg' => 'boom'], 500),
        ];
        Http::fake(function () use (&$responses) {
            return array_shift($responses);
        });

        $expectedMessages = [
            SupabaseAdminService::WEAK_PASSWORD_MESSAGE,
            'Supabase could not update the password right now. Please try again.',
        ];

        foreach ($expectedMessages as $expected) {
            try {
                app(SupabaseAdminService::class)->setPassword(self::NEW_SUPABASE_ID, self::TEMP_PASSWORD);
                $this->fail('setPassword() should have thrown.');
            } catch (RuntimeException $e) {
                $this->assertSame($expected, $e->getMessage());
                $this->assertNull($e->getPrevious());
                $this->assertNotLeaked(self::TEMP_PASSWORD, (string) $e, 'the exception');
            }
        }

        $this->assertNotInLogs(self::TEMP_PASSWORD);
    }

    // ---------------------------------------------------------------
    // G. Existing accounts are unaffected
    // ---------------------------------------------------------------

    public function test_existing_accounts_default_to_no_password_change_and_still_authenticate(): void
    {
        $existing = User::factory()->create(['role' => User::ROLE_ENCODER]);

        $fresh = $existing->fresh();
        $this->assertFalse($fresh->must_change_password);
        $this->assertNull($fresh->temporary_password_expires_at);
        $this->assertNull($fresh->password_changed_at);
        $this->assertNull($fresh->temporary_password_issued_by);

        // Creating a temporary-password account for someone else changes
        // nothing about this one.
        $this->admin();
        $this->fakeSupabase();
        $this->postJson('/api/users', $this->payload())->assertCreated();
        $this->assertFalse($existing->fresh()->must_change_password);

        // And it still signs in exactly as before.
        $this->actingAsSupabase($existing)->getJson('/api/user')->assertOk();
    }

    public function test_the_state_columns_cannot_be_mass_assigned(): void
    {
        $user = User::factory()->create();

        $user->fill([
            'must_change_password' => true,
            'temporary_password_expires_at' => now(),
            'password_changed_at' => now(),
            'temporary_password_issued_by' => $user->id,
        ])->save();

        $fresh = $user->fresh();
        $this->assertFalse($fresh->must_change_password);
        $this->assertNull($fresh->temporary_password_expires_at);
        $this->assertNull($fresh->password_changed_at);
        $this->assertNull($fresh->temporary_password_issued_by);
    }

    // ---------------------------------------------------------------
    // H. Migration
    // ---------------------------------------------------------------

    public function test_the_migration_rolls_back_and_reapplies_without_touching_existing_users(): void
    {
        $migration = require database_path('migrations/2026_09_17_000002_add_temporary_password_state_to_users_table.php');
        $columns = ['must_change_password', 'temporary_password_expires_at', 'password_changed_at', 'temporary_password_issued_by'];

        $existing = User::factory()->create(['username' => 'keepme', 'email' => 'keepme@example.com']);
        $this->assertTrue(Schema::hasColumns('users', $columns));

        $migration->down();
        foreach ($columns as $column) {
            $this->assertFalse(Schema::hasColumn('users', $column), "{$column} should be dropped on rollback.");
        }
        $this->assertSame('keepme', DB::table('users')->where('id', $existing->id)->value('username'));

        $migration->up();
        $this->assertTrue(Schema::hasColumns('users', $columns));

        $row = DB::table('users')->where('id', $existing->id)->first();
        $this->assertSame('keepme@example.com', $row->email);
        $this->assertFalse((bool) $row->must_change_password);
        $this->assertNull($row->temporary_password_expires_at);
        $this->assertNull($row->password_changed_at);
        $this->assertNull($row->temporary_password_issued_by);
    }
}
