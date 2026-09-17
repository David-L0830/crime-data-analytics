<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsurePasswordChanged;
use App\Models\AuditLog;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;
use Throwable;

/**
 * Temporary passwords — Phase 3: administrator reissue and account status.
 *
 * POST /api/users/{user}/temporary-password, the administrator-only
 * temporaryCredentialStatus on account records, and the create path's
 * interaction with them. The same rule as every earlier phase applies
 * throughout: the password reaches Supabase Auth and nothing else.
 */
class TemporaryPasswordReissueTest extends TestCase
{
    use RefreshDatabase;

    private const TEMP = 'Reissue-Kx9#qLw2-178';

    /** @var array<int, string> */
    private array $logged = [];

    /**
     * ok | weak | refused (definite 4xx) | timeout | network | error (500)
     * | bad_gateway (502) | gateway_timeout (504) | rate_limited (429)
     */
    private string $setOutcome = 'ok';

    /** Snapshots taken inside the fake Supabase password update. */
    private array $atSupabaseCall = [];

    /** Runs inside the fake Supabase password update, before it answers. */
    private ?\Closure $duringSupabaseCall = null;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-09-17 10:00:00');
        config(['supabase.service_role_key' => 'test-only-service-role-key']);

        Event::listen(MessageLogged::class, function (MessageLogged $e) {
            $context = collect($e->context)->map(
                fn ($v) => $v instanceof Throwable ? (string) $v : json_encode($v)
            )->implode(' ');
            $this->logged[] = $e->message.' '.$context;
        });

        Http::fake(function ($request) {
            $url = $request->url();

            if ($request->method() === 'PUT' && str_contains($url, '/auth/v1/admin/users/')) {
                $supabaseId = substr($url, strrpos($url, '/') + 1);
                $row = DB::table('users')->where('supabase_user_id', $supabaseId)->first();
                $this->atSupabaseCall[] = [
                    'transactionLevel' => DB::transactionLevel(),
                    'row' => $row,
                    'refusal' => $row ? EnsurePasswordChanged::refusalFor(User::find($row->id), request()) : null,
                ];

                if ($this->duringSupabaseCall) {
                    ($this->duringSupabaseCall)($row);
                }

                return match ($this->setOutcome) {
                    'ok' => Http::response(['id' => 'x'], 200),
                    'weak' => Http::response(['error_code' => 'weak_password', 'weak_password' => ['reasons' => ['length']]], 422),
                    'refused' => Http::response(['error_code' => 'user_not_found', 'msg' => 'refused-raw-body'], 404),
                    'timeout' => throw new ConnectionException('cURL error 28: Operation timed out'),
                    'network' => throw new ConnectionException('cURL error 7: Failed to connect'),
                    'bad_gateway' => Http::response('<html>proxy-raw-body</html>', 502),
                    'gateway_timeout' => Http::response('<html>proxy-raw-body</html>', 504),
                    'rate_limited' => Http::response(['error_code' => 'over_request_rate_limit'], 429),
                    default => Http::response(['msg' => 'internal'], 500),
                };
            }

            if (str_contains($url, '/auth/v1/token')) {
                return Http::response(['access_token' => 'throwaway-verification-token'], 200);
            }

            if (str_contains($url, '/auth/v1/logout')) {
                return Http::response(null, 204);
            }

            if ($request->method() === 'POST' && str_ends_with($url, '/auth/v1/admin/users')) {
                return Http::response(['id' => '11111111-2222-3333-4444-555555555555'], 200);
            }

            return Http::response(['factors' => [], 'app_metadata' => []], 200);
        });
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private function admin(): User
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN, 'username' => 'admin']);
        $this->actingAsSupabase($admin);

        return $admin;
    }

    private function target(array $overrides = []): User
    {
        $user = User::factory()->create(array_merge([
            'role' => User::ROLE_ENCODER,
            'username' => 'encoder01',
            'email' => 'encoder01@example.com',
            'is_active' => true,
        ], $overrides));
        $user->forceFill(['supabase_user_id' => 'sb-target-'.$user->id])->save();

        return $user->fresh();
    }

    private function reissue(User $target, array $body = []): TestResponse
    {
        return $this->postJson("/api/users/{$target->id}/temporary-password", array_merge([
            'temporaryPassword' => self::TEMP,
        ], $body));
    }

    private function supabasePasswordCalls(): array
    {
        return Http::recorded(fn ($request) => $request->method() === 'PUT')->values()->all();
    }

    private function assertNoLeak(?string $responseBody = null): void
    {
        if ($responseBody !== null) {
            $this->assertStringNotContainsString(self::TEMP, $responseBody, 'Password leaked into the API response.');
        }
        foreach ($this->logged as $line) {
            $this->assertStringNotContainsString(self::TEMP, $line, 'Password leaked into the log.');
        }
        $this->assertStringNotContainsString(self::TEMP, DB::table('users')->get()->toJson(), 'Password leaked into users.');
        $this->assertStringNotContainsString(self::TEMP, DB::table('audit_logs')->get()->toJson(), 'Password leaked into audit_logs.');
    }

    private function assertStateUnchanged(User $before): void
    {
        $after = $before->fresh();
        $this->assertSame((bool) $before->must_change_password, (bool) $after->must_change_password);
        $this->assertEquals($before->temporary_password_expires_at, $after->temporary_password_expires_at);
        $this->assertSame($before->temporary_password_issued_by, $after->temporary_password_issued_by);
        $this->assertEquals($before->password_changed_at, $after->password_changed_at);
        $this->assertNull($after->password);
    }

    // ---------------------------------------------------------------
    // C. Reissue
    // ---------------------------------------------------------------

    public function test_an_administrator_reissues_a_temporary_password(): void
    {
        $admin = $this->admin();
        $target = $this->target();
        $target->forceFill(['password_changed_at' => Carbon::parse('2026-09-01 08:00:00')])->save();

        $response = $this->reissue($target)
            ->assertOk()
            ->assertJsonPath('data.id', (string) $target->id)
            ->assertJsonPath('data.temporaryCredentialStatus', 'pending')
            ->assertJsonPath('data.temporaryCredentialExpiresAt', Carbon::parse('2026-09-20 10:00:00')->toIso8601String());

        // Exactly one Supabase password update, on the ROUTE's account.
        $calls = $this->supabasePasswordCalls();
        $this->assertCount(1, $calls);
        [$request] = $calls[0];
        $this->assertStringEndsWith('/auth/v1/admin/users/'.$target->supabase_user_id, $request->url());
        $this->assertSame(self::TEMP, $request['password']);

        $fresh = $target->fresh();
        $this->assertTrue($fresh->must_change_password);
        $this->assertTrue($fresh->temporary_password_expires_at->equalTo(Carbon::parse('2026-09-20 10:00:00')));
        $this->assertSame($admin->id, $fresh->temporary_password_issued_by);
        // The account holder changed nothing, so this is left alone.
        $this->assertTrue($fresh->password_changed_at->equalTo(Carbon::parse('2026-09-01 08:00:00')));
        $this->assertNull($fresh->password);

        $audit = AuditLog::where('module', 'users')->where('action', 'UPDATE')->firstOrFail();
        $this->assertSame($admin->id, $audit->user_id);
        $this->assertSame('Issued a new temporary password to encoder01', $audit->description);

        $this->assertNoLeak($response->getContent());
    }

    public function test_reissuing_resets_an_expired_temporary_password_to_a_fresh_72_hours(): void
    {
        $firstAdmin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $target = $this->target();
        $target->forceFill([
            'must_change_password' => true,
            'temporary_password_expires_at' => Carbon::parse('2026-09-10 10:00:00'),
            'temporary_password_issued_by' => $firstAdmin->id,
        ])->save();

        $admin = $this->admin();
        $this->reissue($target)->assertOk()->assertJsonPath('data.temporaryCredentialStatus', 'pending');

        $fresh = $target->fresh();
        $this->assertTrue($fresh->temporary_password_expires_at->equalTo(now()->addHours(72)));
        $this->assertSame($admin->id, $fresh->temporary_password_issued_by);
    }

    public function test_a_reissue_immediately_blocks_the_accounts_existing_sessions(): void
    {
        $target = $this->target();
        Incident::factory()->create();

        $this->actingAsSupabase($target)->getJson('/api/incidents')->assertOk();

        $this->admin();
        $this->reissue($target)->assertOk();

        $this->actingAsSupabase($target)->getJson('/api/incidents')
            ->assertForbidden()
            ->assertJsonPath('passwordChangeRequired', true);
    }

    /** @return array<string, array{0: string}> */
    public static function nonAdministratorRoles(): array
    {
        return [
            'encoder' => [User::ROLE_ENCODER],
            'read-only BADAC' => [User::ROLE_BADAC_READONLY],
        ];
    }

    #[DataProvider('nonAdministratorRoles')]
    public function test_non_administrators_cannot_reissue(string $role): void
    {
        $target = $this->target();
        $caller = User::factory()->create(['role' => $role]);
        $this->actingAsSupabase($caller);

        $this->reissue($target)->assertForbidden();

        $this->assertCount(0, $this->supabasePasswordCalls());
        $this->assertStateUnchanged($target);
        $this->assertSame(0, AuditLog::where('module', 'users')->count());
    }

    public function test_an_unauthenticated_request_cannot_reissue(): void
    {
        $target = $this->target();

        $this->reissue($target)->assertUnauthorized();

        $this->assertCount(0, $this->supabasePasswordCalls());
        $this->assertStateUnchanged($target);
    }

    public function test_an_administrator_who_owes_a_password_change_cannot_reissue(): void
    {
        $admin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $admin->forceFill(['must_change_password' => true, 'temporary_password_expires_at' => now()->addDay()])->save();
        $target = $this->target();

        $this->actingAsSupabase($admin);
        $this->reissue($target)->assertForbidden()->assertJsonPath('passwordChangeRequired', true);

        $this->assertCount(0, $this->supabasePasswordCalls());
        $this->assertStateUnchanged($target);
    }

    // ---------------------------------------------------------------
    // Inappropriate targets
    // ---------------------------------------------------------------

    public function test_inappropriate_targets_are_refused_before_supabase_is_contacted(): void
    {
        $admin = $this->admin();

        // Your own account.
        $this->postJson("/api/users/{$admin->id}/temporary-password", ['temporaryPassword' => self::TEMP])
            ->assertStatus(422);

        // A deactivated account.
        $inactive = $this->target(['username' => 'inactive01', 'email' => 'inactive01@example.com', 'is_active' => false]);
        $this->reissue($inactive)->assertStatus(422);

        // An account with no Supabase identity.
        $unlinked = User::factory()->create(['role' => User::ROLE_ENCODER, 'supabase_user_id' => null]);
        $this->postJson("/api/users/{$unlinked->id}/temporary-password", ['temporaryPassword' => self::TEMP])
            ->assertStatus(422);

        // An account that does not exist.
        $this->postJson('/api/users/999999/temporary-password', ['temporaryPassword' => self::TEMP])
            ->assertNotFound();

        $this->assertCount(0, $this->supabasePasswordCalls());
        $this->assertSame(0, AuditLog::where('module', 'users')->where('action', 'UPDATE')->count());
        $this->assertNoLeak();
    }

    /** @return array<string, array{0: mixed}> */
    public static function invalidTemporaryPasswords(): array
    {
        return [
            'missing' => [null],
            'empty' => [''],
            'too short' => ['Ab3#xyz'],
            'over 72 bytes' => [str_repeat('Lp9#', 18).'Z'],
            'over 72 bytes in accented characters' => [str_repeat('ñÑ', 19)],
            'only spaces' => ['            '],
            "the target's username" => ['ENCODER01'],
            "the target's email" => ['Encoder01@Example.com'],
            'not a string' => [['x']],
        ];
    }

    #[DataProvider('invalidTemporaryPasswords')]
    public function test_an_invalid_temporary_password_is_rejected_safely(mixed $value): void
    {
        $this->admin();
        $target = $this->target();

        $response = $this->reissue($target, ['temporaryPassword' => $value])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('temporaryPassword');

        if (is_string($value) && trim($value) !== '') {
            $this->assertStringNotContainsString($value, json_encode($response->json('errors')));
        }
        $this->assertCount(0, $this->supabasePasswordCalls());
        $this->assertStateUnchanged($target);
    }

    // ---------------------------------------------------------------
    // D. Fail closed: the committed lock comes first
    // ---------------------------------------------------------------

    private function assertLockedBy(User $target, User $admin): void
    {
        $fresh = $target->fresh();
        $this->assertTrue($fresh->must_change_password, 'The account must stay flagged.');
        $this->assertNotNull($fresh->temporary_password_expires_at);
        $this->assertTrue($fresh->temporary_password_expires_at->lessThanOrEqualTo(now()), 'The lock must already count as expired.');
        $this->assertTrue($fresh->temporaryPasswordExpired());
        $this->assertSame($admin->id, $fresh->temporary_password_issued_by);
        $this->assertNull($fresh->password);
    }

    private function assertNoCdarsAccess(User $target): void
    {
        $this->actingAsSupabase($target)->getJson('/api/notifications')
            ->assertForbidden()
            ->assertJsonPath('temporaryPasswordExpired', true);
        $this->actingAsSupabase($target)->getJson('/api/incidents')
            ->assertForbidden()
            ->assertJsonPath('temporaryPasswordExpired', true);
        $this->actingAsSupabase($target)->postJson('/api/me/password', [
            'current_password' => self::TEMP,
            'password' => 'Another-Rq7#vTm3-178',
            'password_confirmation' => 'Another-Rq7#vTm3-178',
        ])->assertForbidden()->assertJsonPath('temporaryPasswordExpired', true);
    }

    private function assertNoRawSupabaseText(string $body): void
    {
        foreach (['weak_password', 'internal', 'cURL', 'refused-raw-body', 'proxy-raw-body', 'over_request_rate_limit', 'user_not_found'] as $raw) {
            $this->assertStringNotContainsString($raw, $body);
        }
    }

    public function test_the_lock_is_committed_before_supabase_is_called_and_no_transaction_is_open(): void
    {
        $admin = $this->admin();
        $target = $this->target();
        $baseline = DB::transactionLevel(); // RefreshDatabase's own wrapper

        $this->reissue($target)->assertOk();

        $this->assertCount(1, $this->atSupabaseCall);
        ['transactionLevel' => $level, 'row' => $row, 'refusal' => $refusal] = $this->atSupabaseCall[0];

        $this->assertSame($baseline, $level, 'Supabase must not be called inside a database transaction.');
        $this->assertTrue((bool) $row->must_change_password);
        $this->assertTrue(Carbon::parse($row->temporary_password_expires_at)->lessThanOrEqualTo(now()));
        $this->assertSame($admin->id, (int) $row->temporary_password_issued_by);

        // While Supabase is being called, the gate already refuses the account
        // everywhere, /me/password included.
        $this->assertNotNull($refusal);
        $this->assertSame(403, $refusal->getStatusCode());
        $this->assertTrue($refusal->getData(true)['temporaryPasswordExpired'] ?? false);
    }

    public function test_if_the_lock_cannot_be_written_supabase_is_never_called(): void
    {
        $this->admin();
        $target = $this->target();

        Event::listen('eloquent.updating: '.User::class, function (User $user) use ($target) {
            if ($user->id === $target->id) {
                throw new \LogicException('simulated database fault');
            }
        });

        $response = $this->reissue($target)->assertStatus(503);

        $this->assertCount(0, $this->supabasePasswordCalls());
        $this->assertStateUnchanged($target);
        $this->assertSame(0, AuditLog::where('module', 'users')->where('action', 'UPDATE')->count());
        $this->assertStringNotContainsString('simulated database fault', $response->getContent());
        $this->assertNotEmpty($this->logged);
        $this->assertNoLeak($response->getContent());
    }

    // --- Definite refusal: restore exactly --------------------------

    /** @return array<string, array{0: string, 1: bool, 2: string|null, 3: bool}> */
    public static function priorStatesAndDefiniteRefusals(): array
    {
        return [
            'normal account, weak password' => ['weak', false, null, false],
            'pending account, weak password' => ['weak', true, '2026-09-18 09:00:00', true],
            'expired account, weak password' => ['weak', true, '2026-09-10 10:00:00', true],
            'normal account, definite 4xx' => ['refused', false, null, false],
            'pending account, definite 4xx' => ['refused', true, '2026-09-18 09:00:00', true],
            'expired account, definite 4xx' => ['refused', true, '2026-09-10 10:00:00', true],
        ];
    }

    #[DataProvider('priorStatesAndDefiniteRefusals')]
    public function test_a_definite_supabase_refusal_restores_the_exact_previous_state(string $outcome, bool $flagged, ?string $expiresAt, bool $withIssuer): void
    {
        $this->setOutcome = $outcome;
        $firstAdmin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $target = $this->target();
        $target->forceFill([
            'must_change_password' => $flagged,
            'temporary_password_expires_at' => $expiresAt ? Carbon::parse($expiresAt) : null,
            'temporary_password_issued_by' => $withIssuer ? $firstAdmin->id : null,
            'password_changed_at' => Carbon::parse('2026-09-01 08:00:00'),
        ])->save();
        $before = $target->fresh();

        $this->admin();
        $response = $this->reissue($target);

        if ($outcome === 'weak') {
            $response->assertUnprocessable()->assertJsonValidationErrors('temporaryPassword');
        } else {
            $response->assertStatus(502)->assertJsonMissingPath('temporaryPasswordPendingSync');
        }

        // The lock really was taken, then undone.
        $this->assertTrue((bool) $this->atSupabaseCall[0]['row']->must_change_password);
        $this->assertStateUnchanged($before);
        $this->assertSame(0, AuditLog::where('module', 'users')->where('action', 'UPDATE')->count());
        $this->assertNoLeak($response->getContent());
        $this->assertNoRawSupabaseText($response->getContent());
    }

    public function test_a_normal_account_keeps_normal_access_after_a_definite_refusal(): void
    {
        $this->setOutcome = 'weak';
        $this->admin();
        $target = $this->target();

        $this->reissue($target)->assertUnprocessable();

        $this->actingAsSupabase($target)->getJson('/api/notifications')->assertOk();
    }

    public function test_if_restoring_after_a_refusal_fails_the_account_stays_locked(): void
    {
        $this->setOutcome = 'weak';
        $admin = $this->admin();
        $target = $this->target();

        $targetUpdates = 0;
        Event::listen('eloquent.updating: '.User::class, function (User $user) use ($target, &$targetUpdates) {
            // The first update is the lock; the second is the restore.
            if ($user->id === $target->id && ++$targetUpdates === 2) {
                throw new \LogicException('simulated database fault');
            }
        });

        $response = $this->reissue($target)
            ->assertStatus(503)
            ->assertJsonPath('temporaryPasswordPendingSync', true);

        $this->assertLockedBy($target, $admin);
        $this->assertSame(0, AuditLog::where('module', 'users')->where('action', 'UPDATE')->count());
        $this->assertNotEmpty($this->logged);
        $this->assertStringNotContainsString('simulated database fault', $response->getContent());
        $this->assertNoLeak($response->getContent());
        $this->assertNoRawSupabaseText($response->getContent());
    }

    public function test_a_refusal_never_undoes_a_lock_taken_by_another_issuance(): void
    {
        $this->setOutcome = 'weak';
        $this->admin();
        $target = $this->target();
        $otherAdmin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);

        // Another administrator's issuance locks the account while this
        // request is waiting on Supabase.
        $this->duringSupabaseCall = function () use ($target, $otherAdmin) {
            DB::table('users')->where('id', $target->id)->update([
                'must_change_password' => true,
                'temporary_password_expires_at' => now()->addSecond()->format('Y-m-d H:i:s'),
                'temporary_password_issued_by' => $otherAdmin->id,
            ]);
        };

        $this->reissue($target)->assertUnprocessable();

        $fresh = $target->fresh();
        $this->assertTrue($fresh->must_change_password);
        $this->assertSame($otherAdmin->id, $fresh->temporary_password_issued_by);
    }

    // --- Unknown outcome: never restore -----------------------------

    /** @return array<string, array{0: string}> */
    public static function ambiguousSupabaseFailures(): array
    {
        return [
            'timeout' => ['timeout'],
            'network failure' => ['network'],
            'Supabase 500' => ['error'],
            'proxy 502' => ['bad_gateway'],
            'proxy 504' => ['gateway_timeout'],
            'rate limited 429 (request fate unknown)' => ['rate_limited'],
        ];
    }

    #[DataProvider('ambiguousSupabaseFailures')]
    public function test_an_unknown_supabase_outcome_leaves_the_account_locked(string $outcome): void
    {
        $this->setOutcome = $outcome;
        $admin = $this->admin();
        $target = $this->target();
        $target->forceFill(['password_changed_at' => Carbon::parse('2026-09-01 08:00:00')])->save();

        $response = $this->reissue($target)
            ->assertStatus(503)
            ->assertJsonPath('temporaryPasswordPendingSync', true);

        // NOT restored: Supabase may hold the new password.
        $this->assertLockedBy($target, $admin);
        $this->assertTrue($target->fresh()->password_changed_at->equalTo(Carbon::parse('2026-09-01 08:00:00')));
        $this->assertSame(0, AuditLog::where('module', 'users')->where('action', 'UPDATE')->count());

        $this->assertNoLeak($response->getContent());
        $this->assertNoRawSupabaseText($response->getContent());
        $this->assertNoCdarsAccess($target);
    }

    // --- Success, then the final write -------------------------------

    public function test_a_persistent_local_failure_after_supabase_leaves_the_account_locked(): void
    {
        $admin = $this->admin();
        $target = $this->target();

        Event::listen('eloquent.creating: '.AuditLog::class, function () {
            throw new \LogicException('simulated database fault');
        });

        $response = $this->reissue($target)
            ->assertStatus(503)
            ->assertJsonPath('temporaryPasswordPendingSync', true);

        $this->assertCount(1, $this->supabasePasswordCalls(), 'Supabase must not be called again.');
        $this->assertLockedBy($target, $admin);
        $this->assertNotEmpty($this->logged);
        foreach ($this->logged as $line) {
            $this->assertStringNotContainsString('simulated database fault', $line);
        }
        $this->assertStringNotContainsString('simulated database fault', $response->getContent());
        $this->assertNoLeak($response->getContent());
        $this->assertNoCdarsAccess($target);
    }

    public function test_a_transient_local_failure_after_supabase_is_recovered_by_one_retry(): void
    {
        $admin = $this->admin();
        $target = $this->target();

        $failures = 1;
        Event::listen('eloquent.creating: '.AuditLog::class, function () use (&$failures) {
            if ($failures-- > 0) {
                throw new \LogicException('simulated transient fault');
            }
        });

        $this->reissue($target)->assertOk()->assertJsonPath('data.temporaryCredentialStatus', 'pending');

        $fresh = $target->fresh();
        $this->assertTrue($fresh->must_change_password);
        $this->assertSame($admin->id, $fresh->temporary_password_issued_by);
        $this->assertCount(1, $this->supabasePasswordCalls(), 'Supabase must not be called twice.');
        $this->assertSame(1, AuditLog::where('module', 'users')->where('action', 'UPDATE')->count());
        $this->assertTrue($fresh->temporary_password_expires_at->equalTo(now()->addHours(72)));
    }

    // ---------------------------------------------------------------
    // Race: reissue vs. the account holder's own change
    // ---------------------------------------------------------------

    private function changeOwnPassword(User $user): TestResponse
    {
        return $this->actingAsSupabaseWithClaims($user, [
            'amr' => [['method' => 'password', 'timestamp' => now()->getTimestamp() - 30]],
        ], 'aal2')->postJson('/api/me/password', [
            'current_password' => self::TEMP,
            'password' => 'Owner-Chosen-Wq5#nZ8',
            'password_confirmation' => 'Owner-Chosen-Wq5#nZ8',
        ]);
    }

    /** @return array<string, array{0: bool, 1: string}> */
    public static function issuancesDuringAChange(): array
    {
        return [
            'pending account, issuance lock committed mid-change' => [true, 'locked'],
            'pending account, issuance completed mid-change' => [true, 'completed'],
            'normal account, issuance lock committed mid-change' => [false, 'locked'],
            'normal account, issuance completed mid-change' => [false, 'completed'],
        ];
    }

    #[DataProvider('issuancesDuringAChange')]
    public function test_a_password_change_cannot_clear_an_issuance_that_began_while_it_was_in_progress(bool $startsPending, string $issuance): void
    {
        $firstAdmin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $reissuingAdmin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $target = $this->target();
        if ($startsPending) {
            $target->forceFill([
                'must_change_password' => true,
                'temporary_password_expires_at' => now()->addHours(48),
                'temporary_password_issued_by' => $firstAdmin->id,
            ])->save();
        }

        // The administrator's issuance commits while the account holder's
        // own Supabase update is in flight (either Supabase write may land
        // last, so neither password can be trusted).
        $expected = $issuance === 'locked' ? now() : now()->addHours(72);
        $this->duringSupabaseCall = function () use ($target, $reissuingAdmin, $expected) {
            DB::table('users')->where('id', $target->id)->update([
                'must_change_password' => true,
                'temporary_password_expires_at' => $expected->format('Y-m-d H:i:s'),
                'temporary_password_issued_by' => $reissuingAdmin->id,
            ]);
        };

        $response = $this->changeOwnPassword($target->fresh())
            ->assertStatus(409)
            ->assertJsonPath('reauthenticationRequired', true)
            ->assertJsonMissingPath('passwordChanged');

        $fresh = $target->fresh();
        $this->assertTrue($fresh->must_change_password, 'The newer issuance must not be cleared.');
        $this->assertTrue($fresh->temporary_password_expires_at->equalTo($expected));
        $this->assertSame($reissuingAdmin->id, $fresh->temporary_password_issued_by);
        $this->assertNull($fresh->password_changed_at);
        $this->assertSame(0, AuditLog::where('module', 'auth')->count());
        $this->assertStringNotContainsString('Owner-Chosen-Wq5#nZ8', $response->getContent());
        foreach ($this->logged as $line) {
            $this->assertStringNotContainsString('Owner-Chosen-Wq5#nZ8', $line);
        }

        $this->actingAsSupabase($target)->getJson('/api/notifications')->assertForbidden();
    }

    public function test_a_temporary_password_that_expires_during_the_change_is_not_cleared(): void
    {
        $firstAdmin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $target = $this->target();
        $target->forceFill([
            'must_change_password' => true,
            'temporary_password_expires_at' => Carbon::parse('2026-09-17 10:00:05'),
            'temporary_password_issued_by' => $firstAdmin->id,
        ])->save();

        $this->duringSupabaseCall = fn () => Carbon::setTestNow('2026-09-17 10:00:05');

        $this->changeOwnPassword($target->fresh())
            ->assertForbidden()
            ->assertJsonPath('temporaryPasswordExpired', true);

        $fresh = $target->fresh();
        $this->assertTrue($fresh->must_change_password);
        $this->assertTrue($fresh->temporaryPasswordExpired());
        $this->assertNull($fresh->password_changed_at);
    }

    public function test_a_reissue_after_a_completed_password_change_still_takes_effect(): void
    {
        $firstAdmin = User::factory()->create(['role' => User::ROLE_BADAC_ADMIN]);
        $target = $this->target();
        $target->forceFill([
            'must_change_password' => true,
            'temporary_password_expires_at' => now()->addHours(48),
            'temporary_password_issued_by' => $firstAdmin->id,
        ])->save();

        $this->changeOwnPassword($target->fresh())->assertOk()->assertJsonPath('passwordChanged', true);
        $this->assertFalse($target->fresh()->must_change_password);

        Carbon::setTestNow(now()->addMinute());
        $admin = $this->admin();
        $this->reissue($target)->assertOk()->assertJsonPath('data.temporaryCredentialStatus', 'pending');

        $fresh = $target->fresh();
        $this->assertTrue($fresh->must_change_password);
        $this->assertTrue($fresh->temporary_password_expires_at->equalTo(now()->addHours(72)));
        $this->assertSame($admin->id, $fresh->temporary_password_issued_by);

        // The administrator's password was the last one Supabase received.
        $calls = $this->supabasePasswordCalls();
        $this->assertCount(2, $calls);
        $this->assertSame(self::TEMP, $calls[1][0]['password']);
    }

    // ---------------------------------------------------------------
    // E. Status
    // ---------------------------------------------------------------

    /** @return array<string, array{0: bool, 1: string|null, 2: string|null}> */
    public static function statuses(): array
    {
        return [
            'normal account' => [false, null, null],
            'pending' => [true, '2026-09-18 10:00:00', 'pending'],
            'one second before expiry' => [true, '2026-09-17 10:00:01', 'pending'],
            'exactly at expiry' => [true, '2026-09-17 10:00:00', 'expired'],
            'expired' => [true, '2026-09-10 10:00:00', 'expired'],
        ];
    }

    #[DataProvider('statuses')]
    public function test_administrators_see_the_temporary_credential_status(bool $flagged, ?string $expiresAt, ?string $expected): void
    {
        $this->admin();
        $target = $this->target();
        $target->forceFill([
            'must_change_password' => $flagged,
            'temporary_password_expires_at' => $expiresAt ? Carbon::parse($expiresAt) : null,
        ])->save();

        $row = collect($this->getJson('/api/users')->assertOk()->json('data'))->firstWhere('id', (string) $target->id);

        $this->assertSame($expected, $row['temporaryCredentialStatus']);
        $this->assertSame(
            $flagged ? Carbon::parse($expiresAt)->toIso8601String() : null,
            $row['temporaryCredentialExpiresAt']
        );
    }

    public function test_non_administrators_never_receive_the_status(): void
    {
        $encoder = $this->target();
        $encoder->forceFill(['must_change_password' => false])->save();

        $body = $this->actingAsSupabase($encoder)->getJson('/api/user')->assertOk()->json('data');

        $this->assertArrayNotHasKey('temporaryCredentialStatus', $body);
        $this->assertArrayNotHasKey('temporaryCredentialExpiresAt', $body);
    }

    // ---------------------------------------------------------------
    // F. IDOR: the target is the route, never the body
    // ---------------------------------------------------------------

    public function test_the_body_cannot_redirect_the_reissue_to_another_account(): void
    {
        $this->admin();
        $target = $this->target();
        $other = $this->target(['username' => 'other01', 'email' => 'other01@example.com']);

        $this->reissue($target, [
            'user' => $other->id,
            'user_id' => $other->id,
            'id' => $other->id,
            'supabase_user_id' => $other->supabase_user_id,
            'email' => $other->email,
        ])->assertOk()->assertJsonPath('data.id', (string) $target->id);

        Http::assertNotSent(fn ($request) => str_contains($request->url(), $other->supabase_user_id));
        $this->assertTrue($target->fresh()->must_change_password);
        $this->assertStateUnchanged($other);
    }

    // ---------------------------------------------------------------
    // A/B. Create path interaction, G. existing users
    // ---------------------------------------------------------------

    public function test_creating_with_a_temporary_password_reports_pending_status_and_requests_no_setup_email(): void
    {
        $this->admin();

        $response = $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos2026',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
            'temporaryPassword' => self::TEMP,
        ])->assertCreated()
            ->assertJsonPath('data.temporaryCredentialStatus', 'pending')
            ->assertJsonPath('data.temporaryCredentialExpiresAt', now()->addHours(72)->toIso8601String());

        // The backend requests no recovery/setup email of any kind.
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/recover')
            || str_contains($request->url(), '/invite')
            || str_contains($request->url(), '/magiclink'));
        $this->assertNoLeak($response->getContent());
    }

    public function test_creating_without_a_temporary_password_reports_no_pending_status(): void
    {
        $this->admin();

        $this->postJson('/api/users', [
            'fullName' => 'Maria Santos',
            'username' => 'msantos2026',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
        ])->assertCreated()
            ->assertJsonPath('data.temporaryCredentialStatus', null)
            ->assertJsonPath('data.temporaryCredentialExpiresAt', null);
    }

    public function test_other_accounts_are_untouched_by_a_reissue(): void
    {
        $this->admin();
        $target = $this->target();
        $bystanders = collect([
            $this->target(['username' => 'bystander1', 'email' => 'b1@example.com']),
            $this->target(['username' => 'bystander2', 'email' => 'b2@example.com', 'role' => User::ROLE_BADAC_READONLY]),
        ]);

        $this->reissue($target)->assertOk();

        $bystanders->each(fn (User $u) => $this->assertStateUnchanged($u));
    }
}
