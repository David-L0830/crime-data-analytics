<?php

namespace App\Http\Resources;

use App\Services\SupabaseAdminService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

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
            'avatar' => strtoupper(substr($this->name, 0, 1)),
            // Checkpoint 25 — Profile Settings avatar upload. Null when no
            // picture has been uploaded (the vast majority of accounts, and
            // every account before this checkpoint); the sidebar/profile UI
            // fall back to the initial-letter `avatar` above whenever this
            // is null, so no existing call site needed to change.
            'avatarUrl' => $this->avatar_path ? Storage::disk('public')->url($this->avatar_path) : null,
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
            'twoFactorEnabled' => $this->supabase_user_id
                ? (function () {
                    try {
                        return count(app(SupabaseAdminService::class)->listFactors($this->supabase_user_id)) > 0;
                    } catch (\Throwable $e) {
                        return false;
                    }
                })()
                : false,
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
        ];
    }
}
