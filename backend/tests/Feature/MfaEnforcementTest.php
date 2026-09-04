<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

// Login-time MFA enforcement — App\Http\Middleware\EnsureSupabaseAal2.
//
// The rule under test is adaptive, so it has to be pinned in BOTH directions.
// Getting it wrong either way is a serious defect with opposite symptoms:
// too strict and every account that never enrolled an authenticator (today,
// nearly all of them) is locked out of the whole application; too lax and the
// feature does nothing while claiming to protect people, which is the exact
// state commit cba66bf documented and this change exists to end.
//
// Every test here fakes Supabase's Admin API rather than reaching it. The
// fake is registered per-test rather than in setUp() because Laravel merges
// Http::fake() stubs and the FIRST matching stub wins — a shared stub would
// silently shadow the per-scenario ones and assert the same scenario
// repeatedly.
//
// GET /dashboard is used as the representative protected route. It is an
// ordinary member of the largest middleware group in routes/api.php and
// carries 'supabase.mfa' the same way every other protected route does; the
// point being tested is the middleware, not any one controller.
class MfaEnforcementTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'username' => 'admin1',
            'name' => 'Test Administrator',
            'email' => 'admin1@example.com',
            'role' => User::ROLE_BADAC_ADMIN,
            'supabase_user_id' => 'supabase-mfa-test-user',
        ]);
    }

    /**
     * An ordinary Encoder — the role the 2026-09-03 incident actually hurt.
     *
     * Every other subject in this file is an administrator, which left the
     * most common account shape in the system uncovered. Enforcement is
     * role-agnostic by design (EnsureSupabaseAal2 reads no role at all), and
     * these tests exist to keep it that way.
     */
    private function encoder(): User
    {
        return User::factory()->create([
            'username' => 'encoder1',
            'name' => 'Test Encoder',
            'email' => 'encoder1@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-mfa-test-encoder',
        ]);
    }

    /**
     * Stubs the Admin API user lookup that hasVerifiedFactor() reads.
     *
     * @param  array<int, array<string, string>>  $factors
     */
    private function fakeFactors(array $factors): void
    {
        Http::fake([
            '*/auth/v1/admin/users/*' => Http::response(['factors' => $factors], 200),
        ]);
    }

    // --- The account has NOT enrolled: nothing changes for it ---------------

    public function test_aal1_session_without_any_factor_is_allowed(): void
    {
        $user = $this->admin();
        $this->fakeFactors([]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertOk();
    }

    // An unverified factor is an ABANDONED enrolment. It cannot satisfy a
    // challenge, so treating it as "enrolled" would lock its owner out of the
    // application with no way back in — the same verified-only rule the
    // frontend's selectActiveTotpFactor and UserResource already apply.
    public function test_aal1_session_with_only_an_unverified_factor_is_allowed(): void
    {
        $user = $this->admin();
        $this->fakeFactors([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'unverified']]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertOk();
    }

    // --- The account HAS enrolled: aal1 is no longer enough -----------------

    public function test_aal1_session_with_a_verified_factor_is_rejected_as_mfa_required(): void
    {
        $user = $this->admin();
        $this->fakeFactors([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true]);
    }

    public function test_aal2_session_with_a_verified_factor_is_allowed(): void
    {
        $user = $this->admin();
        // No Http::fake at all: an aal2 session must short-circuit before the
        // lookup. If the middleware ever stops doing that, this test fails by
        // attempting a real network call rather than passing quietly.
        $this->actingAsSupabase($user, 'aal2')
            ->getJson('/api/dashboard')
            ->assertOk();
    }

    // --- Failure modes -----------------------------------------------------

    // Fail closed. Allowing here would mean a Supabase outage silently
    // switches enforcement off for exactly the accounts it protects.
    public function test_aal1_session_is_rejected_when_the_enrolment_lookup_fails(): void
    {
        $user = $this->admin();
        Http::fake([
            '*/auth/v1/admin/users/*' => Http::response(['message' => 'boom'], 500),
        ]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401);
    }

    // A failed lookup must not be remembered as a denial: Cache::remember()
    // does not cache a thrown exception, so the very next request retries.
    //
    // ONE closure-driven fake reading a mutable variable, not two successive
    // Http::fake() calls. Successive calls APPEND stubs and the first matching
    // one wins, so a second fake for the same URL never takes effect — the
    // request would keep getting the 500 and this test would "prove" the
    // opposite of what it claims while still passing its first assertion.
    public function test_a_failed_lookup_is_not_cached_as_a_denial(): void
    {
        $user = $this->admin();
        $failing = true;

        Http::fake([
            '*/auth/v1/admin/users/*' => function () use (&$failing) {
                return $failing
                    ? Http::response(['message' => 'boom'], 500)
                    : Http::response(['factors' => []], 200);
            },
        ]);

        $this->actingAsSupabase($user, 'aal1')->getJson('/api/dashboard')->assertStatus(401);

        $failing = false;

        // Required before a SECOND request inside one test, and worth knowing
        // about: Laravel's RequestGuard memoises the user it resolved, so a
        // second call never re-enters SupabaseTokenValidator::resolveUser() --
        // which means the verified 'supabase_aal' request attribute is never
        // set, and this middleware correctly (and confusingly) fails closed
        // with a plain "Unauthenticated." that looks nothing like the scenario
        // under test. This is an artifact of reusing one application instance
        // across two fake requests; a real deployment handles each request in
        // a fresh one and never hits it.
        Auth::forgetGuards();

        $this->actingAsSupabase($user, 'aal1')->getJson('/api/dashboard')->assertOk();
    }

    // --- Enrolling must take effect immediately ----------------------------

    /**
     * REGRESSION. This is the exact sequence that defeated enforcement in
     * production, and it defeated it completely rather than partially.
     *
     * Enrolment happens client-side, straight from the browser to Supabase, so
     * this backend never observes it and has nothing to invalidate a cached
     * answer on. While BOTH answers were cached, a `false` written moments
     * before someone enrolled stayed authoritative for the rest of its TTL:
     * the middleware read it and allowed every protected route at aal1, and
     * GET /user read the same value and told the frontend there was nothing to
     * challenge. The two layers agreed with each other and were both wrong, so
     * the account simply walked in — no challenge, and no failed request to
     * hint that anything was amiss.
     *
     * Both assertions matter. The 401 pins the middleware; the mfaRequired
     * pins the signal the login flow actually branches on. Fixing one without
     * the other would leave either a user who is challenged but then let in,
     * or one who is silently blocked with no way to satisfy the block.
     */
    public function test_enrolling_takes_effect_on_the_next_sign_in_without_waiting_for_a_cache_to_expire(): void
    {
        $user = $this->admin();

        $factors = [];
        Http::fake(['*/auth/v1/admin/users/*' => function () use (&$factors) {
            return Http::response(['factors' => $factors], 200);
        }]);

        // Signed in before enrolling. This is what poisoned the cache.
        $this->actingAsSupabase($user, 'aal1')->getJson('/api/dashboard')->assertOk();

        // Enrols an authenticator. Supabase now holds a verified factor; this
        // backend is not, and cannot be, notified.
        $factors = [['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']];

        // Signs out and back in — a brand new aal1 session, immediately.
        Auth::forgetGuards();
        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true]);

        Auth::forgetGuards();
        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true);
    }

    // The other half of the asymmetry: a POSITIVE answer may be cached,
    // because it only ever demands more verification. Proving it is cached
    // keeps someone from "fixing" the bug above by disabling caching wholesale
    // and quietly adding a Supabase round trip to every request an enrolled
    // account makes.
    public function test_a_verified_factor_is_cached_rather_than_re_fetched(): void
    {
        $user = $this->admin();
        $calls = 0;

        Http::fake(['*/auth/v1/admin/users/*' => function () use (&$calls) {
            $calls++;

            return Http::response(['factors' => [
                ['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified'],
            ]], 200);
        }]);

        $this->actingAsSupabase($user, 'aal1')->getJson('/api/dashboard')->assertStatus(401);
        Auth::forgetGuards();
        $this->actingAsSupabase($user, 'aal1')->getJson('/api/dashboard')->assertStatus(401);

        $this->assertSame(1, $calls, 'A verified factor must be cached, not re-fetched per request.');
    }

    // GET /user is exempt from the middleware, so it is the ONE authenticated
    // route that still answers when the enrolment lookup is broken. What it
    // answers decides whether the frontend opens the app, so it must not
    // report "nothing owed" simply because it could not find out.
    public function test_user_endpoint_reports_mfa_required_when_the_lookup_fails(): void
    {
        $user = $this->admin();
        Http::fake(['*/auth/v1/admin/users/*' => Http::response(['message' => 'boom'], 500)]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true)
            // The badge beside it may still shrug — it is a badge, not a gate.
            ->assertJsonPath('data.twoFactorEnabled', false);
    }

    // --- Administrator-required MFA ----------------------------------------
    //
    // An account can owe a second factor for either of two reasons, and these
    // cover the one that has no factor to challenge yet: an administrator has
    // set app_metadata.mfa_required on the Supabase identity. Such a session
    // must be refused exactly like an enrolled one, because the alternative --
    // letting it in because there is nothing to verify -- would make the whole
    // feature decorative.

    /**
     * Stubs the Admin API user lookup with both facts it now carries.
     *
     * @param  array<int, array<string, string>>  $factors
     */
    private function fakeAccount(array $factors, bool $mfaRequired = false): void
    {
        Http::fake([
            '*/auth/v1/admin/users/*' => Http::response([
                'factors' => $factors,
                'app_metadata' => ['provider' => 'email', 'mfa_required' => $mfaRequired],
            ], 200),
        ]);
    }

    public function test_admin_required_account_cannot_reach_protected_routes_at_aal1(): void
    {
        $user = $this->admin();
        $this->fakeAccount([], true);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true]);
    }

    // The account has nothing enrolled, so there is no challenge to offer --
    // GET /user has to say a factor is owed anyway, because that pairing
    // (mfaRequired with twoFactorEnabled false) is precisely what tells the
    // frontend to put the person through enrolment instead of signing them in.
    public function test_user_endpoint_signals_enrolment_for_an_admin_required_account(): void
    {
        $user = $this->admin();
        $this->fakeAccount([], true);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true)
            ->assertJsonPath('data.twoFactorEnabled', false)
            ->assertJsonPath('data.mfaRequiredByAdmin', true);
    }

    // Enrolling in response to that requirement is what gets them in: once the
    // session is aal2 it is admitted, whether the obligation came from the
    // requirement flag or from the factor they just created.
    public function test_admin_required_account_is_admitted_once_it_reaches_aal2(): void
    {
        $user = $this->admin();
        $this->fakeAccount([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']], true);

        $this->actingAsSupabase($user, 'aal2')
            ->getJson('/api/dashboard')
            ->assertOk();
    }

    // The flag is an ADDITIONAL obligation, never a replacement: an account
    // that enrolled voluntarily is still challenged with the flag off. Without
    // this, a regression that read only the flag would look correct in every
    // other test here.
    public function test_a_voluntarily_enrolled_account_is_still_challenged_without_the_flag(): void
    {
        $user = $this->admin();
        $this->fakeAccount([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']], false);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true]);
    }

    // And the ordinary account -- no factor, no requirement -- is untouched by
    // all of this. This is the regression that would lock every existing user
    // out of the application, so it is asserted against the new response shape
    // rather than assumed from the older test above.
    public function test_an_account_with_neither_a_factor_nor_a_requirement_is_unaffected(): void
    {
        $user = $this->admin();
        $this->fakeAccount([], false);

        $this->actingAsSupabase($user, 'aal1')->getJson('/api/dashboard')->assertOk();

        Auth::forgetGuards();
        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', false)
            ->assertJsonPath('data.mfaRequiredByAdmin', false);
    }

    // Same asymmetry as for factors: an obligation may be remembered, the
    // absence of one may not. A cached "not required" would let an account
    // walk in for a full TTL after an administrator required MFA of it.
    public function test_requiring_mfa_takes_effect_without_waiting_for_a_cache_to_expire(): void
    {
        $user = $this->admin();

        $required = false;
        Http::fake(['*/auth/v1/admin/users/*' => function () use (&$required) {
            return Http::response([
                'factors' => [],
                'app_metadata' => ['mfa_required' => $required],
            ], 200);
        }]);

        $this->actingAsSupabase($user, 'aal1')->getJson('/api/dashboard')->assertOk();

        $required = true;

        Auth::forgetGuards();
        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401)
            ->assertJson(['mfaRequired' => true]);
    }

    // --- The two deliberate exemptions -------------------------------------

    // GET /user is what the login flow reads to DISCOVER that a challenge is
    // owed. Gating it behind the challenge would make the challenge
    // unreachable, so it must answer at aal1 — and it must say so.
    public function test_user_endpoint_answers_at_aal1_and_reports_mfa_required(): void
    {
        $user = $this->admin();
        $this->fakeFactors([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true)
            ->assertJsonPath('data.authAssuranceLevel', 'aal1')
            ->assertJsonPath('data.twoFactorEnabled', true);
    }

    public function test_user_endpoint_reports_no_mfa_owed_once_the_session_is_aal2(): void
    {
        $user = $this->admin();
        $this->fakeFactors([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']]);

        $this->actingAsSupabase($user, 'aal2')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', false)
            ->assertJsonPath('data.authAssuranceLevel', 'aal2');
    }

    public function test_user_endpoint_reports_no_mfa_owed_for_an_account_without_a_factor(): void
    {
        $user = $this->admin();
        $this->fakeFactors([]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', false);
    }

    // Abandoning the challenge screen signs out — that must work from a
    // session that has not completed its second factor, or the person is
    // stranded on it.
    public function test_logout_is_reachable_at_aal1_with_a_verified_factor(): void
    {
        $user = $this->admin();
        $this->fakeFactors([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']]);

        $this->actingAsSupabase($user, 'aal1')
            ->postJson('/api/logout')
            ->assertOk();
    }

    // --- Coverage: no protected route may quietly opt out ------------------

    /**
     * Every authenticated API route carries the MFA gate, with exactly two
     * named exceptions.
     *
     * Attaching middleware route-by-route is explicit and greppable, but it
     * fails open by omission: a route added later that lists 'auth:supabase'
     * and forgets 'supabase.mfa' is reachable by an enrolled account that
     * never completed its challenge, and nothing about it looks wrong. This
     * reads the registered route table rather than the source text, so it
     * cannot be satisfied by a comment or by a route whose middleware is
     * assembled some other way.
     *
     * Adding a genuinely exempt route means adding it to this list on
     * purpose, with a reason — which is the point.
     */
    // -----------------------------------------------------------------------
    // Regression: the 2026-09-03 production incident.
    //
    // The backend's Supabase service-role credential was rejected, so every
    // Admin API lookup returned 401. The existing coverage faked a 500, which
    // takes the same `! successful()` branch — so the behaviour was correct
    // and tested, and the incident still happened. What was missing was a test
    // pinning the SHAPE of the response under a failed lookup, because that
    // shape is what the login screen misread: it announced an administrator
    // policy that did not exist, to accounts that had none.
    //
    // These fix the credential-rejection case specifically and pin the pair of
    // fields that together mean "status unknown".
    // -----------------------------------------------------------------------

    public function test_a_rejected_credential_401_fails_closed_like_any_other_failure(): void
    {
        // A 401 is not a "no" from Supabase, it is "I could not ask". It must
        // never be read as "this account owes nothing".
        //
        // Note what the middleware does NOT say: it refuses with "could not be
        // verified" and deliberately omits the mfaRequired flag it sets when an
        // obligation is genuinely established. The middleware has always told
        // these two cases apart correctly — it is GET /user (exempt from this
        // gate, so the login screen can reach it) that reports them through one
        // fail-closed boolean. That asymmetry is asserted in the next test.
        $user = $this->admin();
        Http::fake(['*/auth/v1/admin/users/*' => Http::response(['msg' => 'unauthorized'], 401)]);

        $response = $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/dashboard')
            ->assertStatus(401);

        $response->assertJsonMissingPath('mfaRequired');
        $this->assertStringContainsString(
            'could not be verified',
            (string) $response->json('message'),
        );
    }

    public function test_a_rejected_credential_401_does_not_invent_an_administrator_requirement(): void
    {
        // THE incident, stated as an assertion. Under a failed lookup the two
        // fields disagree ON PURPOSE — mfaRequired fails closed,
        // mfaRequiredByAdmin fails soft — and that disagreement is the signal
        // meaning "unknown". Reporting mfaRequiredByAdmin: true here would
        // make the login screen's old claim retroactively true and hide the
        // bug; reporting mfaRequired: false would unlock the door.
        $user = $this->admin();
        Http::fake(['*/auth/v1/admin/users/*' => Http::response(['msg' => 'unauthorized'], 401)]);

        $this->actingAsSupabase($user, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', true)
            ->assertJsonPath('data.mfaRequiredByAdmin', false)
            ->assertJsonPath('data.twoFactorEnabled', false);
    }

    public function test_a_verified_factor_is_still_reported_as_enrolled_when_the_lookup_succeeds(): void
    {
        // The other half of the incident: with the lookup broken, User
        // Management showed every account — including three with verified
        // factors — as "Not enrolled". This is the canary for that.
        $user = $this->admin();
        $this->fakeFactors([['id' => 'f1', 'factor_type' => 'totp', 'status' => 'verified']]);

        $this->actingAsSupabase($user, 'aal2')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.twoFactorEnabled', true);
    }

    public function test_a_non_mfa_encoder_signs_in_normally(): void
    {
        // Luiza Perez's account shape: an Encoder with no factor and no
        // administrator requirement. She must reach the application with no
        // second factor asked of her at all.
        $encoder = $this->encoder();
        $this->fakeFactors([]);

        $this->actingAsSupabase($encoder, 'aal1')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.mfaRequired', false)
            ->assertJsonPath('data.mfaRequiredByAdmin', false)
            ->assertJsonPath('data.role', User::ROLE_ENCODER);

        // And is not blocked from the routes their role allows.
        $this->actingAsSupabase($encoder, 'aal1')
            ->getJson('/api/incidents')
            ->assertOk();
    }

    public function test_a_non_mfa_encoder_is_still_refused_when_the_lookup_fails(): void
    {
        // Fail-closed applies to Encoders exactly as it does to
        // administrators. This is the behaviour that was CORRECT during the
        // incident — only the explanation shown to the user was wrong — so it
        // must not be softened while fixing the wording.
        $encoder = $this->encoder();
        Http::fake(['*/auth/v1/admin/users/*' => Http::response(['msg' => 'unauthorized'], 401)]);

        $this->actingAsSupabase($encoder, 'aal1')
            ->getJson('/api/incidents')
            ->assertStatus(401);
    }

    public function test_every_authenticated_api_route_is_gated_except_the_named_exemptions(): void
    {
        $exempt = [
            'api/user',   // must answer at aal1 so the challenge is discoverable
            'api/logout', // an unfinished session must still be able to end itself
        ];

        $ungated = [];

        foreach (Route::getRoutes() as $route) {
            $middleware = $route->gatherMiddleware();

            if (! in_array('auth:supabase', $middleware, true)) {
                continue;
            }

            if (in_array($route->uri(), $exempt, true)) {
                continue;
            }

            if (! in_array('supabase.mfa', $middleware, true)) {
                $ungated[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        $this->assertSame([], array_values(array_unique($ungated)),
            'These authenticated routes are missing the supabase.mfa gate. Add it, or add the route to the $exempt list in this test with a reason.');
    }

    // The exemptions must stay exemptions on purpose, not by accident: if one
    // ever gains the gate, the login flow breaks in a way that is hard to
    // trace back here.
    public function test_the_exempt_routes_are_still_exempt(): void
    {
        foreach (['api/user', 'api/logout'] as $uri) {
            $route = collect(Route::getRoutes())->first(fn ($r) => $r->uri() === $uri);

            $this->assertNotNull($route, "Route {$uri} no longer exists.");
            $this->assertNotContains('supabase.mfa', $route->gatherMiddleware(),
                "Route {$uri} must stay reachable at aal1 — see routes/api.php.");
        }
    }

    // --- RBAC is unchanged and independent ---------------------------------

    // MFA is layered on top of role authorization, not merged with it: an
    // aal2 session still cannot reach a route its role does not admit.
    public function test_role_authorization_still_applies_to_a_fully_verified_session(): void
    {
        $encoder = User::factory()->create([
            'username' => 'encoder1',
            'name' => 'Test Encoder',
            'email' => 'encoder1@example.com',
            'role' => User::ROLE_ENCODER,
            'supabase_user_id' => 'supabase-mfa-test-encoder',
        ]);

        $this->actingAsSupabase($encoder, 'aal2')
            ->getJson('/api/users')
            ->assertStatus(403);
    }
}
