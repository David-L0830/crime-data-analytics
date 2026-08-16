<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    // Authorization is enforced at the route level (role:badac_admin — see
    // routes/api.php) and re-checked in UserController itself. This request
    // only validates the shape of the input.
    public function authorize(): bool
    {
        return true;
    }

    // Checkpoint 31 — 'email' is deliberately NOT accepted here.
    //
    // Supabase Auth is authoritative for sign-in identity (see
    // AUTH_MIGRATION_STATUS.md); users.email in Laravel is a mirror of the
    // Supabase Auth email, not an independent field. Before this fix,
    // UserController::update() let an admin change users.email directly,
    // which would silently desync it from the email the user actually signs
    // in with at Supabase — a request could succeed here while Supabase
    // Auth still had the old address, with nothing catching the drift.
    //
    // SupabaseAdminService is intentionally scoped to MFA-factor removal
    // only (see its class comment) and does not implement an
    // email-change call against Supabase's Admin API, so wiring that up
    // here could not be verified against a live Supabase project in this
    // environment. Rather than ship an unverified two-system write, admin
    // email editing is removed until a Supabase-Auth-first update path
    // (verify -> update Supabase -> update Laravel only on success) can be
    // implemented and tested against a real Supabase project.
    //
    // If 'email' is submitted anyway, it is silently ignored (not
    // rejected) — see rules() below; only 'fullName' and 'username' are
    // validated/accepted.
    public function rules(): array
    {
        $userId = $this->route('user')?->id;

        return [
            'fullName' => ['sometimes', 'required', 'string', 'max:150'],
            'username' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('users', 'username')->ignore($userId)],
        ];
    }
}
