<?php

namespace App\Http\Resources;

use App\Services\EmailMfaService;
use App\Services\SupabaseAdminService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'username' => $this->username,
            'fullName' => $this->name,
            'email' => $this->email,
            'role' => $this->role,
            'roleLabel' => $this->role_label,
            'isActive' => (bool) $this->is_active,
            // Account Administration — the User Details modal shows when an
            // account was provisioned. The column already existed
            // (users.timestamps, since the very first migration); it simply
            // was never exposed. Null-safe because created_at is nullable in
            // the schema, and the frontend renders "Not available" rather
            // than inventing a date when it is null.
            'createdAt' => $this->created_at?->toIso8601String(),
            // Derived from the LOGIN rows in the existing audit trail — see
            // User::lastLoginAt() for why this is not a users.last_login
            // column. Null means "this account has never signed in since
            // LOGIN auditing began", which the frontend renders as "Never" —
            // it is never substituted with a made-up timestamp.
            'lastLoginAt' => $this->lastLoginAt()?->toIso8601String(),
            'avatar' => strtoupper(substr($this->name, 0, 1)),
            // Checkpoint 25 — Profile Settings avatar upload. Null when no
            // picture has been uploaded (the vast majority of accounts, and
            // every account before this checkpoint); the sidebar/profile UI
            // fall back to the initial-letter `avatar` above whenever this
            // is null, so no existing call site needed to change.
            // Resolution moved to User::avatarUrl(). It has to handle two
            // shapes now — a full Supabase Storage URL, or a legacy relative
            // local-disk path — and it also stops a stale APP_URL from
            // producing avatar URLs that point at the viewer's own machine.
            // See that method for both reasons.
            'avatarUrl' => $this->avatarUrl(),
            // Final auth migration — Laravel TOTP is retired; this now
            // reflects whether Supabase has a verified MFA factor on file
            // for this account, via the Admin API (server-side only, see
            // SupabaseAdminService). Deliberately fails soft to `false`
            // (never throws into the surrounding user list/detail
            // response) if the account has never signed in through
            // Supabase yet, or if the Admin API call itself fails/is not
            // configured (SUPABASE_SERVICE_ROLE_KEY unset) — an admin
            // temporarily not seeing an accurate 2FA badge is preferable
            // to the whole User Management page breaking.
            // VERIFIED factors only. listFactors() returns every factor
            // regardless of status — its own docblock says so — so counting
            // them all reported an ABANDONED enrolment as active protection.
            // That produced a real contradiction: an administrator saw
            // "2FA enabled" for an account whose own security panel correctly
            // said "Not enrolled", because the frontend's
            // selectActiveTotpFactor filters on status === 'verified'. The
            // two now agree, and they agree on the stricter reading — a
            // half-finished enrolment protects nobody and must not be
            // displayed as though it does.
            //
            // Now reads through SupabaseAdminService::hasVerifiedFactor(),
            // which applies the same verified-only rule and, unlike the
            // previous inline listFactors() call, caches it — so an
            // administrator opening User Management no longer costs one
            // Admin API round trip per account per render, and this agrees by
            // construction with the enforcement decision EnsureSupabaseAal2
            // makes from the very same cached answer.
            //
            // Still fails SOFT to false here, deliberately, and that is not a
            // contradiction of the middleware's fail-closed stance: this is a
            // badge in a list, not an authorization decision. An administrator
            // briefly seeing an inaccurate badge is preferable to the whole
            // User Management page erroring out, whereas silently admitting an
            // unverified session is not.
            'twoFactorEnabled' => $this->twoFactorEnabled(),
            // Does THIS request's session still owe a second factor?
            //
            // The server-authoritative answer to the question the login flow
            // asks. src/context/AuthContext.jsx also asks supabase-js the same
            // thing client-side (getAuthenticatorAssuranceLevel) to avoid a
            // needless round trip, but this field is what it treats as final:
            // a client-side check is a UI convenience, and a step-up gate must
            // not rest on one.
            //
            // Null for anyone but the caller themselves. Assurance level is a
            // property of the current session, so the question is meaningless
            // for the other rows of an administrator's user list — reporting
            // anything there would invite it being read as "this person needs
            // to do MFA", which is not what it would mean.
            'mfaRequired' => $this->mfaRequiredForSelf($request),
            // Whether an ADMINISTRATOR has required a second factor of this
            // account, as opposed to whether the account has enrolled one.
            // Distinct from twoFactorEnabled above and shown alongside it,
            // because the two together are what an administrator needs to
            // tell apart the three states the User Management row menu acts
            // on: not required and not enrolled, required but not yet
            // enrolled, and enrolled. Fails soft to false like the badge
            // beside it - it labels a menu item and gates nothing.
            'mfaRequiredByAdmin' => $this->mfaRequiredByAdmin(),
            // How an owed second factor is satisfied for this account: null
            // for Supabase TOTP (the default), or 'email_otp' when an
            // administrator explicitly configured email MFA. Lets the login
            // flow show the email-code step instead of authenticator setup.
            // Informational only — EnsureSupabaseAal2 enforces.
            'mfaMethod' => $this->mfa_method,
            // Checkpoint 6 — Supabase MFA coexistence. Only present (non-
            // null) when this request was authenticated via the 'supabase'
            // guard — see SupabaseTokenValidator::resolveUser(), the only
            // place that sets this request attribute. A request resolved
            // some other way (e.g. Laravel's actingAs() test helper, which
            // sets the user directly and never runs through
            // SupabaseTokenValidator — see SupabaseMfaTest.php) never has
            // it, since 'aal' is a Supabase-specific concept read off a
            // verified Supabase JWT. This field is informational for the
            // frontend to route UI (e.g. "prompt for a Supabase MFA
            // step-up"); it is never itself an authorization decision —
            // routes that actually require aal2 enforce that server-side
            // via the 'supabase.mfa' middleware, independent of whatever
            // this response says.
            'authAssuranceLevel' => $request->attributes->get('supabase_aal'),
            // Forced password change — the caller's OWN state only, and absent
            // from every other account's record (an administrator's user list
            // or a newly created account). Informational for the login flow;
            // EnsurePasswordChanged is what actually blocks access. None of
            // these is ever a password or anything derived from one.
            // Temporary-credential status for User Management — only on the
            // accounts the viewer manages (the 'manage-account' Gate: an
            // Administrator's Encoders and Validators, a Super Administrator's
            // Administrators), and never the credential itself (it is not
            // stored anywhere to return). Derived from must_change_password and
            // temporary_password_expires_at; no extra column. Named without
            // the word "password" so account payloads stay free of it.
            //   'pending' — issued, not yet replaced, not yet expired
            //   'expired' — issued, not replaced, and past its expiry
            //   null      — nothing outstanding
            $this->mergeWhen((bool) $request->user()?->can('manage-account', $this->resource), fn () => [
                'temporaryCredentialStatus' => $this->must_change_password
                    ? ($this->resource->temporaryPasswordExpired() ? 'expired' : 'pending')
                    : null,
                'temporaryCredentialExpiresAt' => $this->must_change_password
                    ? $this->temporary_password_expires_at?->toIso8601String()
                    : null,
            ]),
            $this->mergeWhen($this->isCaller($request), fn () => [
                'passwordChangeRequired' => (bool) $this->must_change_password,
                'temporaryPasswordExpired' => $this->resource->temporaryPasswordExpired(),
                'reauthenticationRequired' => $this->resource->sessionPredatesPasswordChange(
                    is_int($at = $request->attributes->get('supabase_session_authenticated_at')) ? $at : null
                ),
            ]),
        ];
    }

    protected function isCaller(Request $request): bool
    {
        return $request->user()?->id === $this->id;
    }

    /**
     * Whether Supabase holds a VERIFIED MFA factor for this account.
     *
     * Verified only — an abandoned, unverified enrolment protects nobody and
     * must not be displayed as though it does. See the commit that introduced
     * this rule for the production case where it mattered.
     */
    protected function twoFactorEnabled(): bool
    {
        if (! $this->supabase_user_id) {
            return false;
        }

        try {
            return app(SupabaseAdminService::class)->hasVerifiedFactor($this->supabase_user_id);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Whether an administrator has required a second factor of this account.
     * Reads the same single cached lookup twoFactorEnabled() does, so showing
     * both costs one Admin API call rather than two.
     */
    protected function mfaRequiredByAdmin(): bool
    {
        if (! $this->supabase_user_id) {
            return false;
        }

        try {
            return app(SupabaseAdminService::class)->mfaRequiredByAdmin($this->supabase_user_id);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * True when the request's own session is authenticated below the level its
     * account requires; null when this resource is not the caller's own record
     * (see the field comment above).
     *
     * FAILS CLOSED, unlike twoFactorEnabled() directly above it, and the two
     * must not be collapsed back together however similar they look. That
     * method answers a question for a badge and may shrug; this one is the
     * signal the login flow gates on, so an unanswerable lookup has to mean
     * "assume a factor is owed", not "assume there is none". Reusing the
     * fail-soft helper here made GET /user report mfaRequired: false whenever
     * Supabase could not be reached -- telling the frontend to let somebody
     * straight in at the exact moment the backend had lost the ability to
     * check. This mirrors EnsureSupabaseAal2, which denies the same request
     * for the same reason, so the two layers now agree in the failure case as
     * well as the ordinary one.
     */
    protected function mfaRequiredForSelf(Request $request): ?bool
    {
        $aal = $request->attributes->get('supabase_aal');

        if ($aal === null || $request->user()?->id !== $this->id) {
            return null;
        }

        // Email-MFA accounts are answered BEFORE the aal2 line below, with the
        // exact rule EnsureSupabaseAal2::handleEmailOtpAccount enforces, so
        // the login flow can never be told "nothing owed" just because the
        // JWT is aal2 while the email code for this session is still missing.
        if ($this->resource->usesEmailOtpMfa()) {
            return $this->emailOtpMfaRequiredForSelf($request, $aal);
        }

        if ($aal === 'aal2') {
            return false;
        }

        if (! $this->supabase_user_id) {
            return false;
        }

        try {
            return app(SupabaseAdminService::class)->requiresAal2($this->supabase_user_id);
        } catch (\Throwable $e) {
            return true;
        }
    }

    /**
     * mfaRequiredForSelf for an account configured with 'email_otp'. Fails
     * closed like its caller.
     */
    protected function emailOtpMfaRequiredForSelf(Request $request, string $aal): bool
    {
        if (! $this->supabase_user_id) {
            return true;
        }

        try {
            $emailMfa = app(EmailMfaService::class);

            // No "nothing owed" answer for these accounts, matching the
            // middleware: the configured method is itself the obligation,
            // independent of Supabase's mfa_required flag.
            if (! $emailMfa->isSessionVerified($request, $this->resource)) {
                return true;
            }

            return app(SupabaseAdminService::class)->hasVerifiedFactor($this->supabase_user_id)
                && $aal !== 'aal2';
        } catch (\Throwable $e) {
            return true;
        }
    }
}
