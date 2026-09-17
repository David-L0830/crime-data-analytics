<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * MFA Option B — the Administrator chooses each new account's MFA method.
 *
 *   email_otp         -> users.mfa_method = 'email_otp'
 *   authenticator_app -> users.mfa_method stays NULL, and the Supabase identity
 *                        is created with app_metadata.mfa_required = true
 *
 * There is no "none". These tests pin the backend validation, the Supabase
 * interaction, the RBAC boundary, and the order in which MFA and the
 * temporary-password requirement are enforced for an account created this way.
 *
 * Supabase is faked statefully: an identity created through the Admin API keeps
 * the app_metadata it was created with, factors can be added by the test, and
 * GoTrue's session-liveness endpoint answers with the token's own subject.
 */
class MfaMethodSelectionTest extends TestCase
{
    use RefreshDatabase;

    private const NEW_SUPABASE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    private const SESSION = '44444444-4444-4444-8444-444444444444';

    private const TEMP_PASSWORD = 'Temp-Pass-2026!';

    /** @var array<string, mixed> app_metadata stored on the created identity */
    private array $appMetadata = [];

    /** @var array<int, array<string, string>> */
    private array $factors = [];

    /** When false, Supabase silently drops app_metadata on create. */
    private bool $supabaseAppliesAppMetadata = true;

    private int $createdIdentities = 0;

    protected function setUp(): void
    {
        parent::setUp();

        config(['supabase.service_role_key' => 'test-only-service-role-key']);

        Http::fake(function (HttpRequest $request) {
            $url = $request->url();
            $method = $request->method();

            if (str_ends_with($url, '/auth/v1/admin/users') && $method === 'POST') {
                if ($this->supabaseAppliesAppMetadata) {
                    $this->appMetadata = $request->data()['app_metadata'] ?? [];
                }

                // The first identity gets the fixed id; later ones a fresh id,
                // as Supabase would.
                $id = $this->createdIdentities++ === 0
                    ? self::NEW_SUPABASE_ID
                    : sprintf('aaaaaaaa-bbbb-4ccc-8ddd-%012d', $this->createdIdentities);

                return Http::response(['id' => $id, 'app_metadata' => $this->appMetadata], 200);
            }

            if (str_contains($url, '/auth/v1/admin/users/') && $method === 'DELETE' && ! str_contains($url, '/factors/')) {
                return Http::response([], 200);
            }

            if (str_contains($url, '/auth/v1/admin/users/') && $method === 'PUT') {
                $this->appMetadata = $request->data()['app_metadata'] ?? [];

                return Http::response(['app_metadata' => $this->appMetadata], 200);
            }

            if (str_contains($url, '/auth/v1/admin/users/')) {
                return Http::response([
                    'factors' => $this->factors,
                    'app_metadata' => $this->appMetadata,
                ], 200);
            }

            if (str_ends_with($url, '/auth/v1/user')) {
                $parts = explode('.', str_replace('Bearer ', '', $request->header('Authorization')[0] ?? ''));
                $claims = (array) json_decode(base64_decode(strtr($parts[1] ?? '', '-_', '+/')), true);

                return Http::response(['id' => $claims['sub'] ?? null], 200);
            }

            return Http::response(['message' => 'unexpected Supabase call in test'], 500);
        });
    }

    private function actingAdmin(): User
    {
        $admin = User::factory()->create([
            'username' => 'admin',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-admin',
        ]);
        $this->actingAsSupabase($admin);

        return $admin;
    }

    /** @param  array<string, mixed>  $overrides */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'fullName' => 'Maria Santos',
            'username' => 'msantos',
            'email' => 'msantos@example.com',
            'role' => User::ROLE_ENCODER,
            'mfaMethod' => User::MFA_METHOD_EMAIL_OTP,
        ], $overrides);
    }

    private function createdSupabasePayload(): ?array
    {
        $sent = collect(Http::recorded())->first(
            fn ($pair) => $pair[0]->method() === 'POST' && str_ends_with($pair[0]->url(), '/auth/v1/admin/users')
        );

        return $sent ? $sent[0]->data() : null;
    }

    private function signedIn(User $user, string $aal = 'aal1'): static
    {
        return $this->actingAsSupabaseWithClaims($user, ['session_id' => self::SESSION], $aal);
    }

    // ---------------------------------------------------------------
    // A. Email OTP
    // ---------------------------------------------------------------

    public function test_email_otp_saves_the_method_and_sets_no_supabase_requirement(): void
    {
        $this->actingAdmin();

        $this->postJson('/api/users', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.mfaMethod', 'email_otp');

        $this->assertSame(User::MFA_METHOD_EMAIL_OTP, User::where('username', 'msantos')->first()->mfa_method);
        // The create request is exactly the pre-existing shape.
        $this->assertArrayNotHasKey('app_metadata', $this->createdSupabasePayload());
    }

    // ---------------------------------------------------------------
    // B. Authenticator App
    // ---------------------------------------------------------------

    public function test_authenticator_app_creates_the_identity_with_the_requirement_and_leaves_mfa_method_null(): void
    {
        $this->actingAdmin();

        $this->postJson('/api/users', $this->payload(['mfaMethod' => 'authenticator_app']))
            ->assertCreated()
            ->assertJsonPath('data.mfaMethod', null)
            ->assertJsonPath('data.mfaRequiredByAdmin', true)
            ->assertJsonPath('data.twoFactorEnabled', false);

        $this->assertNull(User::where('username', 'msantos')->first()->mfa_method);
        $this->assertSame(['mfa_required' => true], $this->createdSupabasePayload()['app_metadata']);
    }

    public function test_authenticator_app_account_is_not_created_when_supabase_does_not_confirm_the_requirement(): void
    {
        $this->actingAdmin();
        $this->supabaseAppliesAppMetadata = false;

        $this->postJson('/api/users', $this->payload(['mfaMethod' => 'authenticator_app']))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Supabase did not confirm the authenticator app requirement, so the account was not created. Please try again.');

        // Neither half survives: no local row, and the new identity is removed.
        $this->assertNull(User::where('username', 'msantos')->first());
        Http::assertSent(fn ($request) => $request->method() === 'DELETE'
            && str_ends_with($request->url(), '/admin/users/'.self::NEW_SUPABASE_ID));
        $this->assertDatabaseMissing('audit_logs', ['module' => 'users', 'action' => 'CREATE']);
    }

    // ---------------------------------------------------------------
    // C. Backend validation
    // ---------------------------------------------------------------

    public function test_the_mfa_method_is_required(): void
    {
        $this->actingAdmin();
        $payload = $this->payload();
        unset($payload['mfaMethod']);

        $this->postJson('/api/users', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('mfaMethod');

        $this->assertNull(User::where('username', 'msantos')->first());
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/admin/users'));
    }

    public function test_unsupported_or_malformed_mfa_methods_are_rejected(): void
    {
        $this->actingAdmin();

        $invalid = [
            'none', 'None', 'sms', 'totp', 'totp2', 'email', 'whatever', 'EMAIL_OTP',
            'Authenticator App', 'email_otp,authenticator_app', '', null, 1, true, false,
            ['email_otp'], ['authenticator_app' => true],
        ];

        foreach ($invalid as $value) {
            $this->postJson('/api/users', $this->payload(['mfaMethod' => $value]))
                ->assertUnprocessable()
                ->assertJsonValidationErrors('mfaMethod');
        }

        $this->assertNull(User::where('username', 'msantos')->first());
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/admin/users'));
    }

    // ---------------------------------------------------------------
    // D. RBAC / IDOR / direct API manipulation
    // ---------------------------------------------------------------

    public function test_non_administrators_cannot_create_an_account_with_any_mfa_method(): void
    {
        foreach ([User::ROLE_ENCODER, User::ROLE_BADAC_VALIDATOR] as $role) {
            $actor = User::factory()->create(['role' => $role]);
            $this->actingAsSupabase($actor);

            foreach (User::MFA_METHOD_CHOICES as $method) {
                $this->postJson('/api/users', $this->payload([
                    'username' => "x-{$role}-{$method}",
                    'email' => "x-{$role}-{$method}@example.com",
                    'role' => User::ROLE_BADAC_ADMIN,
                    'mfaMethod' => $method,
                ]))->assertForbidden();
            }
        }

        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/admin/users'));
        $this->assertSame(0, User::where('username', 'like', 'x-%')->count());
    }

    public function test_an_unauthenticated_caller_cannot_create_an_account(): void
    {
        $this->postJson('/api/users', $this->payload())->assertUnauthorized();
        $this->assertNull(User::where('username', 'msantos')->first());
    }

    public function test_the_mfa_method_cannot_be_changed_through_any_account_update_endpoint(): void
    {
        $admin = $this->actingAdmin();
        $target = User::factory()->create([
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-target',
            'mfa_method' => User::MFA_METHOD_EMAIL_OTP,
        ]);

        // An administrator editing another account.
        $this->putJson("/api/users/{$target->id}", [
            'fullName' => 'Renamed',
            'mfaMethod' => 'authenticator_app',
            'mfa_method' => null,
        ])->assertOk();
        $this->assertSame(User::MFA_METHOD_EMAIL_OTP, $target->fresh()->mfa_method);

        // An administrator editing their own profile.
        $this->putJson('/api/me', ['fullName' => 'Admin', 'mfaMethod' => 'email_otp', 'mfa_method' => 'email_otp'])
            ->assertOk();
        $this->assertNull($admin->fresh()->mfa_method);

        // The account holder editing their own profile, fully signed in.
        $code = $this->emailMfaSessionFor($target);
        $this->assertNotEmpty($code);
        $this->signedIn($target)->putJson('/api/me', ['fullName' => 'Target', 'mfa_method' => null, 'mfaMethod' => 'authenticator_app'])
            ->assertOk();
        $this->assertSame(User::MFA_METHOD_EMAIL_OTP, $target->fresh()->mfa_method);
    }

    // ---------------------------------------------------------------
    // E. No secret material anywhere
    // ---------------------------------------------------------------

    public function test_no_factor_secret_or_credential_is_returned_stored_or_audited(): void
    {
        $this->actingAdmin();

        foreach (['email_otp' => 'msantos', 'authenticator_app' => 'jdelacruz'] as $method => $username) {
            $this->appMetadata = [];
            $response = $this->postJson('/api/users', $this->payload([
                'username' => $username,
                'email' => "{$username}@example.com",
                'mfaMethod' => $method,
                'temporaryPassword' => self::TEMP_PASSWORD,
            ]))->assertCreated();

            $body = strtolower($response->getContent());
            foreach (['secret', 'totp', 'qr_code', 'otpauth', 'factor_id', strtolower(self::TEMP_PASSWORD)] as $needle) {
                $this->assertStringNotContainsString($needle, $body);
            }

            // Only the account-creation request goes to Supabase: nothing
            // enrols a factor on the person's behalf.
            Http::assertNotSent(fn ($request) => str_contains($request->url(), '/factors'));
        }

        $descriptions = AuditLog::where('module', 'users')->pluck('description')->implode("\n");
        $this->assertStringContainsString('(MFA method: Email OTP)', $descriptions);
        $this->assertStringContainsString('(MFA method: Authenticator App)', $descriptions);
        $this->assertStringNotContainsString(self::TEMP_PASSWORD, $descriptions);
        $this->assertStringNotContainsString(self::TEMP_PASSWORD, User::all()->toJson());
    }

    // ---------------------------------------------------------------
    // F. Cross-feature: MFA + temporary password + role
    // ---------------------------------------------------------------

    public function test_email_otp_read_only_account_with_temporary_password_owes_mfa_before_the_password_change(): void
    {
        $this->actingAdmin();

        $this->postJson('/api/users', $this->payload([
            'role' => User::ROLE_BADAC_VALIDATOR,
            'mfaMethod' => 'email_otp',
            'temporaryPassword' => self::TEMP_PASSWORD,
        ]))->assertCreated()->assertJsonPath('data.temporaryCredentialStatus', 'pending');

        $user = User::where('username', 'msantos')->firstOrFail();
        $this->assertTrue($user->must_change_password);

        // First: MFA. Neither the temporary-password state nor an aal2 token
        // lets the session past the email code.
        foreach (['aal1', 'aal2'] as $aal) {
            $this->signedIn($user, $aal)->getJson('/api/dashboard')
                ->assertStatus(401)
                ->assertJson(['mfaRequired' => true, 'mfaMethod' => 'email_otp']);
        }
        $this->signedIn($user)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true)
            ->assertJsonPath('data.mfaMethod', 'email_otp')
            ->assertJsonPath('data.passwordChangeRequired', true);

        // Then: the password change. Completing MFA does not skip it.
        $this->emailMfaSessionFor($user);
        $this->signedIn($user)->getJson('/api/dashboard')
            ->assertStatus(403)
            ->assertJson(['passwordChangeRequired' => true]);

        // And the role is unchanged: still read-only, still no admin surface.
        $this->assertSame(User::ROLE_BADAC_VALIDATOR, $user->fresh()->role);
        $this->signedIn($user)->getJson('/api/users')->assertStatus(403);
    }

    public function test_authenticator_app_account_with_temporary_password_must_enrol_before_the_password_change(): void
    {
        $this->actingAdmin();

        $this->postJson('/api/users', $this->payload([
            'mfaMethod' => 'authenticator_app',
            'temporaryPassword' => self::TEMP_PASSWORD,
        ]))->assertCreated();

        $user = User::where('username', 'msantos')->firstOrFail();

        // Nothing enrolled yet: refused at aal1 with a generic MFA answer, and
        // GET /user tells the login flow an administrator required it, which is
        // what routes the person to enrolment.
        $this->signedIn($user)->getJson('/api/incidents')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true])
            ->assertJsonMissing(['mfaMethod' => 'email_otp']);
        $this->signedIn($user)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true)
            ->assertJsonPath('data.mfaRequiredByAdmin', true)
            ->assertJsonPath('data.passwordChangeRequired', true);

        // After enrolling and verifying (aal2), the password change is next.
        $this->factors = [['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']];
        $this->signedIn($user, 'aal1')->getJson('/api/incidents')->assertStatus(401);
        $this->signedIn($user, 'aal2')->getJson('/api/incidents')
            ->assertStatus(403)
            ->assertJson(['passwordChangeRequired' => true]);
    }

    /**
     * Completes email MFA for self::SESSION through the real endpoints and
     * returns the code that was used. The code is read from the array mailer
     * (phpunit.xml), exactly as EmailMfaTest does.
     */
    private function emailMfaSessionFor(User $user): string
    {
        $this->signedIn($user)->postJson('/api/mfa/email/send')->assertStatus(202);

        $body = Mail::mailer()->getSymfonyTransport()->messages()->last()->getOriginalMessage()->getTextBody();
        $this->assertMatchesRegularExpression('/^ {4}(\d{6})$/m', $body);
        preg_match('/^ {4}(\d{6})$/m', $body, $m);

        $this->signedIn($user)->postJson('/api/mfa/email/verify', ['code' => $m[1]])->assertOk();

        return $m[1];
    }
}
