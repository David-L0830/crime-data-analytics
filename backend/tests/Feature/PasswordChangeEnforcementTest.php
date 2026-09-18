<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\CrimeType;
use App\Models\Criminal;
use App\Models\Incident;
use App\Models\ReportSchedule;
use App\Models\User;
use App\Models\Victim;
use App\Services\SupabaseAdminService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use SensitiveParameter;
use Tests\TestCase;
use Throwable;

/**
 * Temporary passwords — Phase 2: enforcement and the forced password change.
 *
 * Three guarantees, each with its own group below:
 *
 *   1. An account that owes a password change (or whose session predates one)
 *      cannot reach normal application functionality through ANY route — not
 *      just the ones the frontend happens to call.
 *   2. POST /me/password stays reachable, keeps MFA, requires a recent sign-in
 *      and a verified current password, and changes nothing locally unless
 *      Supabase Auth confirms the new password.
 *   3. No password ever reaches the response, the log, the audit trail or the
 *      database.
 */
class PasswordChangeEnforcementTest extends TestCase
{
    use RefreshDatabase;

    private const CURRENT = 'Tmp-Kx9#qLw2-Brgy178';

    private const NEW = 'New-Pz4!tRv8-Caloocan';

    /** Routes allowed without 'password.changed', as "METHOD uri". */
    private const EXEMPT = [
        'GET api/user',
        'POST api/logout',
        'POST api/mfa/email/send',
        'POST api/mfa/email/verify',
        'POST api/me/password',
    ];

    /** @var array<int, string> */
    private array $logged = [];

    /** How the faked Supabase Auth answers, per test. */
    private string $verifyOutcome = 'valid';   // valid | invalid | unreachable | error

    private string $setOutcome = 'ok';          // ok | weak | error

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

        // One callback for the whole test (re-faking merges stubs and the
        // first match keeps winning); it reads this test's own settings.
        Http::fake(function ($request) {
            $url = $request->url();

            if (str_contains($url, '/auth/v1/token')) {
                return match ($this->verifyOutcome) {
                    'valid' => Http::response(['access_token' => 'throwaway-verification-token'], 200),
                    'invalid' => Http::response(['error_code' => 'invalid_credentials', 'msg' => 'Invalid login credentials'], 400),
                    'unreachable' => throw new ConnectionException('cURL error 28: Operation timed out'),
                    default => Http::response(['error_code' => 'over_request_rate_limit'], 429),
                };
            }

            if (str_contains($url, '/auth/v1/logout')) {
                return Http::response(null, 204);
            }

            if ($request->method() === 'PUT' && str_contains($url, '/auth/v1/admin/users/')) {
                return match ($this->setOutcome) {
                    'ok' => Http::response(['id' => 'x'], 200),
                    'weak' => Http::response(['error_code' => 'weak_password', 'weak_password' => ['reasons' => ['length']]], 422),
                    default => Http::response(['msg' => 'internal'], 500),
                };
            }

            // GET /auth/v1/admin/users/{id}: security-state lookups.
            return Http::response(['factors' => [], 'app_metadata' => []], 200);
        });
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private function normalUser(string $role = User::ROLE_BADAC_ADMIN): User
    {
        return User::factory()->create(['role' => $role]);
    }

    private function temporaryPasswordUser(string $role = User::ROLE_BADAC_ADMIN, ?Carbon $expiresAt = null): User
    {
        $user = User::factory()->create(['role' => $role, 'username' => 'temp'.uniqid(), 'email' => uniqid().'@example.com']);
        $user->forceFill([
            'supabase_user_id' => 'sb-'.$user->id,
            'must_change_password' => true,
            'temporary_password_expires_at' => $expiresAt ?? now()->addHours(User::TEMPORARY_PASSWORD_TTL_HOURS),
        ])->save();

        return $user->fresh();
    }

    /**
     * Authenticates as $user with a signed token whose `amr` records a sign-in
     * $signedInSecondsAgo seconds ago (null = omit `amr` entirely).
     */
    private function signedIn(User $user, ?int $signedInSecondsAgo = 30, string $aal = 'aal2', array $extraClaims = []): static
    {
        $claims = $extraClaims;
        if ($signedInSecondsAgo !== null) {
            $claims['amr'] = [['method' => 'password', 'timestamp' => now()->getTimestamp() - $signedInSecondsAgo]];
        }

        return $this->actingAsSupabaseWithClaims($user, $claims, $aal);
    }

    /** @param  array<string, mixed>  $overrides */
    private function changePayload(array $overrides = []): array
    {
        return array_merge([
            'current_password' => self::CURRENT,
            'password' => self::NEW,
            'password_confirmation' => self::NEW,
        ], $overrides);
    }

    private function assertNoPasswordLeaked(string $haystack, string $where): void
    {
        foreach ([self::CURRENT, self::NEW] as $secret) {
            $this->assertStringNotContainsString($secret, $haystack, "A password leaked into {$where}.");
        }
    }

    private function assertNoPasswordAnywhere(?string $responseBody = null): void
    {
        if ($responseBody !== null) {
            $this->assertNoPasswordLeaked($responseBody, 'the API response');
        }
        foreach ($this->logged as $line) {
            $this->assertNoPasswordLeaked($line, 'the application log');
        }
        $this->assertNoPasswordLeaked(DB::table('users')->get()->toJson(), 'the users table');
        $this->assertNoPasswordLeaked(DB::table('audit_logs')->get()->toJson(), 'the audit_logs table');
    }

    private function assertStateUnchanged(User $before): void
    {
        $after = $before->fresh();
        $this->assertSame($before->must_change_password, $after->must_change_password);
        $this->assertEquals($before->temporary_password_expires_at, $after->temporary_password_expires_at);
        $this->assertEquals($before->password_changed_at, $after->password_changed_at);
        $this->assertNull($after->password);
    }

    private function assertNoPasswordSentToSupabase(): void
    {
        Http::assertNotSent(fn ($request) => $request->method() === 'PUT');
    }

    /**
     * Supabase Auth calls that involve a credential: verifying the current
     * password, revoking the verification session, and setting a password.
     * Excludes the JWKS fetch every token check makes and read-only
     * security-state lookups, which carry no credential.
     *
     * @return array<int, mixed>
     */
    private function credentialCalls(): array
    {
        return Http::recorded(fn ($request) => str_contains($request->url(), '/auth/v1/token')
            || str_contains($request->url(), '/auth/v1/logout')
            || $request->method() === 'PUT'
        )->all();
    }

    private function assertNoCredentialCalls(): void
    {
        $this->assertSame([], $this->credentialCalls(), 'Supabase must not be asked to verify or set a password.');
    }

    /** @return array<int, RoutingRoute> */
    private function authenticatedApiRoutes(): array
    {
        return collect(Route::getRoutes()->getRoutes())
            ->filter(fn (RoutingRoute $r) => str_starts_with($r->uri(), 'api/')
                && in_array('auth:supabase', $r->gatherMiddleware(), true))
            ->values()
            ->all();
    }

    private function routeKey(RoutingRoute $route): string
    {
        $methods = array_values(array_diff($route->methods(), ['HEAD', 'OPTIONS']));

        return $methods[0].' '.$route->uri();
    }

    // ---------------------------------------------------------------
    // A. Normal accounts are unaffected
    // ---------------------------------------------------------------

    public function test_a_normal_account_keeps_normal_access_with_or_without_amr(): void
    {
        $user = $this->normalUser();
        Incident::factory()->create();

        $this->signedIn($user, 30)->getJson('/api/incidents')->assertOk();
        $this->signedIn($user, null)->getJson('/api/incidents')->assertOk();

        $this->signedIn($user)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.passwordChangeRequired', false)
            ->assertJsonPath('data.temporaryPasswordExpired', false)
            ->assertJsonPath('data.reauthenticationRequired', false);
    }

    public function test_a_normal_account_can_change_its_password_under_the_same_rules(): void
    {
        $user = $this->normalUser();
        $user->forceFill(['supabase_user_id' => 'sb-normal-'.$user->id])->save();

        $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())
            ->assertOk()
            ->assertJsonPath('passwordChanged', true);

        $fresh = $user->fresh();
        $this->assertFalse($fresh->must_change_password);
        $this->assertNotNull($fresh->password_changed_at);
        $this->assertSame('Changed password', AuditLog::where('user_id', $user->id)->where('action', 'UPDATE')->value('description'));
    }

    public function test_other_accounts_records_never_carry_password_state(): void
    {
        $admin = $this->normalUser();
        $this->temporaryPasswordUser(User::ROLE_ENCODER);

        $rows = collect($this->signedIn($admin)->getJson('/api/users')->assertOk()->json('data'));

        $others = $rows->reject(fn ($row) => $row['id'] === (string) $admin->id);
        $this->assertNotEmpty($others);
        foreach ($others as $row) {
            $this->assertArrayNotHasKey('passwordChangeRequired', $row);
            $this->assertArrayNotHasKey('temporaryPasswordExpired', $row);
            $this->assertArrayNotHasKey('reauthenticationRequired', $row);
        }
    }

    // ---------------------------------------------------------------
    // B. A temporary-password account is confined to the change flow
    // ---------------------------------------------------------------

    public function test_a_temporary_password_account_is_blocked_from_normal_routes(): void
    {
        $user = $this->temporaryPasswordUser();

        $this->signedIn($user)->getJson('/api/incidents')
            ->assertForbidden()
            ->assertJsonPath('passwordChangeRequired', true)
            ->assertJsonMissingPath('temporaryPasswordExpired');
    }

    public function test_the_routes_the_change_flow_needs_stay_reachable(): void
    {
        $user = $this->temporaryPasswordUser();

        $this->signedIn($user)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.passwordChangeRequired', true)
            ->assertJsonPath('data.temporaryPasswordExpired', false);

        // Reachable: an empty submission is judged on its content (422), not
        // refused by the gate (403).
        $this->signedIn($user)->postJson('/api/me/password', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['current_password', 'password']);

        $this->signedIn($user)->postJson('/api/logout')->assertOk();
    }

    public function test_every_authenticated_route_is_gated_except_the_change_flow_itself(): void
    {
        $seenExempt = [];

        foreach ($this->authenticatedApiRoutes() as $route) {
            $key = $this->routeKey($route);
            $middleware = $route->gatherMiddleware();

            if (in_array($key, self::EXEMPT, true)) {
                $this->assertNotContains('password.changed', $middleware, "{$key} must stay reachable during a forced change.");
                $seenExempt[] = $key;

                continue;
            }

            $this->assertContains('password.changed', $middleware, "{$key} is missing 'password.changed'.");

            // MFA is decided first, so the existing sign-in flow is unchanged.
            $this->assertGreaterThan(
                array_search('supabase.mfa', $middleware, true),
                array_search('password.changed', $middleware, true),
                "{$key} must run 'password.changed' after 'supabase.mfa'."
            );
        }

        sort($seenExempt);
        $expected = self::EXEMPT;
        sort($expected);
        $this->assertSame($expected, $seenExempt, 'Every exempt route must exist, and no other route may be exempt.');
    }

    // ---------------------------------------------------------------
    // H. Bypass attempts: call every gated route directly
    // ---------------------------------------------------------------

    /** @return array<string, array{0: string}> */
    public static function roles(): array
    {
        return [
            'administrator' => [User::ROLE_BADAC_ADMIN],
            'encoder' => [User::ROLE_ENCODER],
            'BADAC Validator' => [User::ROLE_BADAC_VALIDATOR],
        ];
    }

    #[DataProvider('roles')]
    public function test_no_gated_route_can_be_reached_directly_by_a_temporary_password_account(string $role): void
    {
        $user = $this->temporaryPasswordUser($role);

        // Real records for every bound parameter, so a request is refused by
        // the gate rather than by a 404 on a missing model.
        $parameters = [
            'incident' => Incident::factory()->create()->id,
            'criminal' => Criminal::factory()->create()->id,
            'victim' => Victim::factory()->create()->id,
            'user' => User::factory()->create()->id,
            'notification' => AppNotification::factory()->create()->id,
            'crimeType' => CrimeType::create(['name' => 'Bypass Test Type', 'color' => '#2E8B47', 'is_active' => true])->id,
            'reportSchedule' => ReportSchedule::create([
                'name' => 'Bypass test', 'report_key' => 'incidents', 'period' => 'last_30_days',
                'frequency' => 'weekly', 'hour' => 6, 'day_of_week' => 1,
                'recipients' => ['x@example.test'], 'filters' => [], 'is_active' => true,
            ])->id,
            'dashboardKey' => 'dashboard',
        ];

        $checked = 0;
        foreach ($this->authenticatedApiRoutes() as $route) {
            $key = $this->routeKey($route);
            if (in_array($key, self::EXEMPT, true)) {
                continue;
            }

            [$method, $uri] = explode(' ', $key, 2);
            $path = '/'.preg_replace_callback('/\{(\w+)\??\}/', function ($m) use ($parameters, $key) {
                $this->assertArrayHasKey($m[1], $parameters, "No test record for {{$m[1]}} in {$key}.");

                return $parameters[$m[1]];
            }, $uri);

            $this->signedIn($user)
                ->json($method, $path, ['name' => 'attempted', 'isActive' => true])
                ->assertForbidden()
                ->assertJsonPath('passwordChangeRequired', true);

            $checked++;
        }

        $this->assertGreaterThan(40, $checked, 'Expected to exercise every gated route.');
    }

    public function test_mfa_is_still_decided_before_the_password_change(): void
    {
        $user = $this->temporaryPasswordUser();
        $user->forceFill(['mfa_method' => User::MFA_METHOD_EMAIL_OTP])->save();

        // No email verification for this session: MFA is owed first.
        $this->signedIn($user, 30, 'aal2', ['session_id' => 'session-a'])
            ->getJson('/api/incidents')
            ->assertUnauthorized()
            ->assertJsonPath('mfaRequired', true)
            ->assertJsonPath('mfaMethod', 'email_otp');

        // And the change endpoint itself keeps MFA.
        $this->signedIn($user, 30, 'aal2', ['session_id' => 'session-a'])
            ->postJson('/api/me/password', $this->changePayload())
            ->assertUnauthorized()
            ->assertJsonPath('mfaRequired', true);

        $this->assertNoPasswordSentToSupabase();
        $this->assertTrue($user->fresh()->must_change_password);
    }

    // ---------------------------------------------------------------
    // C. Successful change
    // ---------------------------------------------------------------

    public function test_a_successful_change_updates_supabase_first_then_clears_the_state(): void
    {
        $user = $this->temporaryPasswordUser(User::ROLE_ENCODER);

        $response = $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())
            ->assertOk()
            ->assertJsonPath('passwordChanged', true)
            ->assertJsonPath('reauthenticationRequired', true);

        // The current password was verified with Supabase, and the throwaway
        // verification session revoked...
        Http::assertSent(fn ($request) => str_contains($request->url(), '/auth/v1/token')
            && $request['email'] === $user->email
            && $request['password'] === self::CURRENT);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/auth/v1/logout')
            && $request->hasHeader('Authorization', 'Bearer throwaway-verification-token'));

        // ...and the NEW password was set on THIS account only.
        Http::assertSent(fn ($request) => $request->method() === 'PUT'
            && str_ends_with($request->url(), '/auth/v1/admin/users/'.$user->supabase_user_id)
            && $request['password'] === self::NEW);
        $this->assertCount(3, $this->credentialCalls(), 'Exactly: verify, revoke, set.');

        $fresh = $user->fresh();
        $this->assertFalse($fresh->must_change_password);
        $this->assertNull($fresh->temporary_password_expires_at);
        $this->assertTrue($fresh->password_changed_at->equalTo(now()));
        $this->assertNull($fresh->password);

        $audit = AuditLog::where('user_id', $user->id)->where('module', 'auth')->where('action', 'UPDATE')->firstOrFail();
        $this->assertSame('Replaced temporary password', $audit->description);

        $this->assertNoPasswordAnywhere($response->getContent());
    }

    public function test_after_a_change_old_sessions_are_refused_and_a_fresh_sign_in_is_admitted(): void
    {
        $user = $this->temporaryPasswordUser();
        $signedInAt = 30;

        $this->signedIn($user, $signedInAt)->postJson('/api/me/password', $this->changePayload())->assertOk();

        // The session that made the change — and any other opened before it,
        // e.g. by someone who knew the temporary password — must sign in again.
        $this->signedIn($user, $signedInAt)->getJson('/api/incidents')
            ->assertForbidden()
            ->assertJsonPath('reauthenticationRequired', true);
        $this->signedIn($user, $signedInAt)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.reauthenticationRequired', true);
        // ...and cannot change the password again either.
        $this->signedIn($user, $signedInAt)->postJson('/api/me/password', $this->changePayload())
            ->assertForbidden()
            ->assertJsonPath('reauthenticationRequired', true);

        // A session without a usable sign-in time is refused too (fail closed).
        $this->signedIn($user, null)->getJson('/api/incidents')->assertForbidden();

        // Logout still works for the old session.
        $this->signedIn($user, $signedInAt)->postJson('/api/logout')->assertOk();

        // A fresh sign-in after the change is admitted normally.
        Carbon::setTestNow(now()->addMinutes(2));
        Incident::factory()->create();
        $this->signedIn($user, 5)->getJson('/api/incidents')->assertOk();
    }

    // ---------------------------------------------------------------
    // D. Supabase failures change nothing
    // ---------------------------------------------------------------

    /** @return array<string, array{0: string, 1: string, 2: int, 3: string}> */
    public static function supabaseFailures(): array
    {
        return [
            'new password rejected as weak' => ['valid', 'weak', 422, 'errors.password'],
            'password update fails' => ['valid', 'error', 503, 'passwordUpdateFailed'],
            'current password verification rate-limited' => ['error', 'ok', 503, 'passwordUpdateFailed'],
            'Supabase unreachable during verification' => ['unreachable', 'ok', 503, 'passwordUpdateFailed'],
            'current password is wrong' => ['invalid', 'ok', 422, 'errors.current_password'],
        ];
    }

    #[DataProvider('supabaseFailures')]
    public function test_a_supabase_failure_leaves_the_local_state_untouched(string $verify, string $set, int $status, string $path): void
    {
        $this->verifyOutcome = $verify;
        $this->setOutcome = $set;
        $user = $this->temporaryPasswordUser();

        $response = $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())
            ->assertStatus($status);
        $this->assertNotNull($response->json($path), "Expected {$path} in the response.");

        $this->assertStateUnchanged($user);
        $this->assertSame(0, AuditLog::where('user_id', $user->id)->where('action', 'UPDATE')->count());
        $this->assertNoPasswordAnywhere($response->getContent());

        // The raw Supabase body never reaches the caller.
        foreach (['weak_password', 'invalid_credentials', 'over_request_rate_limit', 'internal', 'cURL'] as $raw) {
            $this->assertStringNotContainsString($raw, $response->getContent());
        }

        // A wrong or unverifiable current password never proceeds to the update.
        if ($verify !== 'valid') {
            $this->assertNoPasswordSentToSupabase();
        }

        // Still blocked from normal access.
        $this->signedIn($user)->getJson('/api/incidents')->assertForbidden();
    }

    // ---------------------------------------------------------------
    // E. Invalid input
    // ---------------------------------------------------------------

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function invalidSubmissions(): array
    {
        return [
            'too short' => [['password' => 'Ab3#xyz', 'password_confirmation' => 'Ab3#xyz'], 'password'],
            'over 72 bytes' => [['password' => str_repeat('Lp9#', 18).'Z', 'password_confirmation' => str_repeat('Lp9#', 18).'Z'], 'password'],
            'over 72 bytes in accented characters' => [['password' => str_repeat('ñÑ', 19), 'password_confirmation' => str_repeat('ñÑ', 19)], 'password'],
            'only spaces' => [['password' => '            ', 'password_confirmation' => '            '], 'password'],
            'confirmation mismatch' => [['password_confirmation' => 'Different-Pass-9#'], 'password'],
            'confirmation missing' => [['password_confirmation' => null], 'password'],
            'reuses the current password' => [['password' => self::CURRENT, 'password_confirmation' => self::CURRENT], 'password'],
            'missing new password' => [['password' => null], 'password'],
            'missing current password' => [['current_password' => null], 'current_password'],
            'new password not a string' => [['password' => ['x'], 'password_confirmation' => ['x']], 'password'],
            'current password not a string' => [['current_password' => 12345678], 'current_password'],
        ];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    #[DataProvider('invalidSubmissions')]
    public function test_invalid_input_is_rejected_before_supabase_is_contacted(array $overrides, string $field): void
    {
        $user = $this->temporaryPasswordUser();

        $response = $this->signedIn($user)->postJson('/api/me/password', $this->changePayload($overrides))
            ->assertUnprocessable()
            ->assertJsonValidationErrors($field);

        $this->assertNoCredentialCalls();
        $this->assertStateUnchanged($user);
        $this->assertNoPasswordAnywhere($response->getContent());
    }

    public function test_the_new_password_cannot_be_the_username_or_email(): void
    {
        $user = $this->temporaryPasswordUser();

        foreach ([$user->email, strtoupper($user->email)] as $value) {
            $this->signedIn($user)->postJson('/api/me/password', $this->changePayload([
                'password' => $value, 'password_confirmation' => $value,
            ]))->assertUnprocessable()->assertJsonValidationErrors('password');
        }

        $this->assertNoCredentialCalls();
    }

    // ---------------------------------------------------------------
    // F. Recent sign-in
    // ---------------------------------------------------------------

    public function test_a_recent_sign_in_is_accepted_up_to_the_window(): void
    {
        $user = $this->temporaryPasswordUser();

        $this->signedIn($user, User::PASSWORD_CHANGE_RECENT_AUTH_SECONDS)
            ->postJson('/api/me/password', $this->changePayload())
            ->assertOk();
    }

    /** @return array<string, array{0: array<string, mixed>|null}> */
    public static function unacceptableSignInTimes(): array
    {
        $now = Carbon::parse('2026-09-17 10:00:00')->getTimestamp();

        return [
            'stale by one second' => [['amr' => [['method' => 'password', 'timestamp' => $now - 901]]]],
            'hours old' => [['amr' => [['method' => 'password', 'timestamp' => $now - 7200]]]],
            'no amr claim' => [null],
            'amr without a timestamp' => [['amr' => [['method' => 'password']]]],
            'non-numeric timestamp' => [['amr' => [['method' => 'password', 'timestamp' => 'yesterday']]]],
            'timestamp in the future' => [['amr' => [['method' => 'password', 'timestamp' => $now + 3600]]]],
            'recent TOTP step-up on an old session' => [['amr' => [
                ['method' => 'totp', 'timestamp' => $now - 10],
                ['method' => 'password', 'timestamp' => $now - 7200],
            ]]],
        ];
    }

    /**
     * @param  array<string, mixed>|null  $claims
     */
    #[DataProvider('unacceptableSignInTimes')]
    public function test_a_session_without_a_recent_verified_sign_in_is_refused(?array $claims): void
    {
        $user = $this->temporaryPasswordUser();

        $this->actingAsSupabaseWithClaims($user, $claims ?? [], 'aal2')
            ->postJson('/api/me/password', $this->changePayload())
            ->assertForbidden()
            ->assertJsonPath('reauthenticationRequired', true);

        $this->assertNoCredentialCalls();
        $this->assertStateUnchanged($user);
    }

    // ---------------------------------------------------------------
    // G. Expiry
    // ---------------------------------------------------------------

    public function test_one_second_before_expiry_the_change_is_allowed(): void
    {
        $user = $this->temporaryPasswordUser(User::ROLE_BADAC_ADMIN, now()->addSecond());

        $this->signedIn($user)->getJson('/api/incidents')->assertJsonMissingPath('temporaryPasswordExpired');
        $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())->assertOk();
    }

    /** @return array<string, array{0: string|null}> */
    public static function expiredMoments(): array
    {
        return [
            'exactly at expiry' => ['2026-09-17 10:00:00'],
            'one second after' => ['2026-09-17 09:59:59'],
            'days after' => ['2026-09-10 10:00:00'],
            'flagged with no expiry recorded' => [null],
        ];
    }

    #[DataProvider('expiredMoments')]
    public function test_an_expired_temporary_password_is_refused_everywhere_and_never_extended(?string $expiresAt): void
    {
        $user = $this->temporaryPasswordUser();
        $user->forceFill(['temporary_password_expires_at' => $expiresAt ? Carbon::parse($expiresAt) : null])->save();
        $user = $user->fresh();

        foreach (['GET /api/incidents', 'POST /api/me/password'] as $call) {
            [$method, $path] = explode(' ', $call);
            $this->signedIn($user)->json($method, $path, $this->changePayload())
                ->assertForbidden()
                ->assertJsonPath('passwordChangeRequired', true)
                ->assertJsonPath('temporaryPasswordExpired', true);
        }

        $this->signedIn($user)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.temporaryPasswordExpired', true);

        $this->assertNoCredentialCalls();
        $this->assertStateUnchanged($user);
    }

    // ---------------------------------------------------------------
    // Hardening
    // ---------------------------------------------------------------

    public function test_the_endpoint_only_ever_acts_on_the_callers_own_account(): void
    {
        $user = $this->temporaryPasswordUser();
        $other = $this->temporaryPasswordUser();

        $this->signedIn($user)->postJson('/api/me/password', $this->changePayload([
            'user_id' => $other->id,
            'supabase_user_id' => $other->supabase_user_id,
            'email' => $other->email,
        ]))->assertOk();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/auth/v1/token') && $request['email'] === $user->email);
        Http::assertNotSent(fn ($request) => str_contains($request->url(), $other->supabase_user_id));
        $this->assertTrue($other->fresh()->must_change_password);
    }

    public function test_attempts_are_rate_limited(): void
    {
        $user = $this->temporaryPasswordUser();
        $this->verifyOutcome = 'invalid';

        for ($i = 0; $i < 5; $i++) {
            $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())->assertUnprocessable();
        }

        $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())->assertStatus(429);
    }

    public function test_credential_arguments_are_marked_sensitive(): void
    {
        $sensitive = fn (string $method, string $parameter) => collect(
            (new ReflectionMethod(SupabaseAdminService::class, $method))->getParameters()
        )->firstWhere('name', $parameter)?->getAttributes(SensitiveParameter::class);

        $this->assertNotEmpty($sensitive('verifyPassword', 'password'));
        $this->assertNotEmpty($sensitive('revokeSession', 'accessToken'));
    }

    /**
     * Supabase accepted the new password, then recording it locally keeps
     * failing. The two systems are not one transaction, so the change cannot
     * be undone: the response says so plainly, the account still owes a change
     * (every session stays blocked), and nothing leaks.
     */
    public function test_a_persistent_local_failure_after_supabase_accepts_the_password_is_reported_honestly(): void
    {
        $user = $this->temporaryPasswordUser();

        Event::listen('eloquent.updating: '.User::class, function () {
            throw new \LogicException('simulated database fault');
        });

        $response = $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())
            ->assertStatus(503)
            ->assertJsonPath('passwordChangedPendingSync', true);

        // Supabase really was updated...
        Http::assertSent(fn ($request) => $request->method() === 'PUT' && $request['password'] === self::NEW);

        // ...but nothing local was recorded, so the requirement still holds.
        $this->assertStateUnchanged($user);
        $this->assertSame(0, AuditLog::where('user_id', $user->id)->where('action', 'UPDATE')->count());

        $this->assertNotEmpty($this->logged, 'The failure must be logged for follow-up.');
        $this->assertNoPasswordAnywhere($response->getContent());
        $this->assertStringNotContainsString('simulated database fault', $response->getContent());

        $this->signedIn($user)->getJson('/api/incidents')->assertForbidden()->assertJsonPath('passwordChangeRequired', true);
    }

    public function test_a_transient_local_failure_after_supabase_accepts_the_password_is_recovered_by_one_retry(): void
    {
        $user = $this->temporaryPasswordUser();

        $failures = 1;
        Event::listen('eloquent.creating: '.AuditLog::class, function () use (&$failures) {
            if ($failures-- > 0) {
                throw new \LogicException('simulated transient fault');
            }
        });

        $this->signedIn($user)->postJson('/api/me/password', $this->changePayload())
            ->assertOk()
            ->assertJsonPath('passwordChanged', true);

        $fresh = $user->fresh();
        $this->assertFalse($fresh->must_change_password);
        $this->assertNotNull($fresh->password_changed_at);
        $this->assertSame(1, AuditLog::where('user_id', $user->id)->where('action', 'UPDATE')->count());
        $this->assertCount(1, Http::recorded(fn ($request) => $request->method() === 'PUT'), 'Supabase must not be called twice.');
        $this->assertNoPasswordAnywhere();
    }
}
