<?php

namespace App\Http\Requests;

use App\Models\User;
use App\Rules\AcceptablePassword;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

// Account Administration — administrator-created accounts (POST /api/users).
//
// Who may create accounts at all is enforced at the route level
// (role:badac_admin,super_admin — see routes/api.php). WHICH role the new
// account may have is decided here, from the caller's own
// User::manageableRoles(): an Administrator may create Encoders and
// Validators, a Super Administrator may create Administrators, and no caller
// may create a Super Administrator — that role is in nobody's list, so it can
// only ever come from SuperAdminSeeder. A refused role fails validation before
// Supabase Auth is contacted, so nothing is provisioned anywhere.
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
// 'temporaryPassword' is OPTIONAL. Without it, account creation is exactly as
// before: Supabase is given a random password nobody knows and the new user
// sets their own from the recovery email. With it, the administrator supplies a
// temporary password the new user signs in with once and must then replace
// (see UserController::store).
//
// Either way the value only ever passes THROUGH this application on its way to
// Supabase Auth. It is never stored, returned, audited or logged, and the
// validation messages below never contain it: every message names the rule,
// never the input. The field is also excluded from TrimStrings in
// bootstrap/app.php, so the password Supabase receives is exactly the one the
// administrator typed.
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
            'role' => ['required', Rule::in($this->user()?->manageableRoles() ?? [])],
            'isActive' => ['sometimes', 'boolean'],
            // REQUIRED, and limited to the supported methods. Every account an
            // administrator creates gets a second factor; there is no "none",
            // and anything else (sms, totp, an array, a different case) is
            // refused here rather than trusted from the form.
            'mfaMethod' => ['required', 'string', Rule::in(User::MFA_METHOD_CHOICES)],
            // `sometimes` + `required`: omitting the key keeps the original
            // recovery-email path, but sending it empty or null is an error
            // rather than a silent fall-back to that other path.
            'temporaryPassword' => [
                'sometimes',
                'required',
                'string',
                'min:'.User::TEMPORARY_PASSWORD_MIN_LENGTH,
                new AcceptablePassword(
                    'the temporary password',
                    is_string($this->input('username')) ? $this->input('username') : null,
                    is_string($this->input('email')) ? $this->input('email') : null,
                ),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'username.unique' => 'That username is already taken.',
            'email.unique' => 'An account with that email address already exists.',
            'role.in' => 'Choose a valid role.',
            'mfaMethod.required' => 'Choose an MFA method: Email OTP or Authenticator App.',
            'mfaMethod.string' => 'Choose an MFA method: Email OTP or Authenticator App.',
            'mfaMethod.in' => 'Choose an MFA method: Email OTP or Authenticator App.',
            'temporaryPassword.required' => 'Enter a temporary password, or leave the field out to send a password setup email instead.',
            'temporaryPassword.string' => 'The temporary password must be text.',
            'temporaryPassword.min' => 'The temporary password must be at least '.User::TEMPORARY_PASSWORD_MIN_LENGTH.' characters.',
        ];
    }
}
