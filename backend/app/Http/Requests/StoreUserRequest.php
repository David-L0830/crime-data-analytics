<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

// Account Administration — administrator-created accounts (POST /api/users).
//
// Authorization is enforced at the route level (role:badac_admin — see
// routes/api.php); this request only validates the shape of the input.
//
// 'email' IS accepted here, unlike UpdateUserRequest (see its Checkpoint 31
// comment). The reason those two differ is not inconsistency: on CREATE the
// address is what the Supabase Auth account is provisioned WITH, so the two
// systems are written from the same value in the same request and cannot
// drift. On UPDATE there is no verified path to change the address in
// Supabase Auth too, which is exactly why it stays read-only there.
//
// 'role' IS accepted here, also unlike UpdateUserRequest. Choosing the role
// of an account that does not exist yet is account provisioning; changing
// the role of an existing account is privilege escalation on a live
// identity. Only the first is offered, and only to an administrator, and it
// is written to the audit trail.
//
// No password field exists anywhere in this request. The administrator never
// chooses, sees, or transmits the new user's password — Supabase Auth owns
// every credential, and the new user sets their own via the recovery email
// (see UserController::store).
class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fullName' => ['required', 'string', 'max:150'],
            'username' => ['required', 'string', 'max:50', Rule::unique('users', 'username')],
            'email' => ['required', 'string', 'email', 'max:190', Rule::unique('users', 'email')],
            'role' => ['required', Rule::in(array_keys(User::ROLE_LABELS))],
            'isActive' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'username.unique' => 'That username is already taken.',
            'email.unique' => 'An account with that email address already exists.',
            'role.in' => 'Choose a valid role.',
        ];
    }
}
