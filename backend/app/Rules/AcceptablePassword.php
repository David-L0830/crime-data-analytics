<?php

namespace App\Rules;

use App\Models\User;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The password checks a built-in rule cannot express without risking the value
 * in its message, shared by every place this application accepts a password:
 * the administrator-supplied temporary password (StoreUserRequest) and the
 * account holder's replacement for it (ChangePasswordRequest).
 *
 *   - not only whitespace;
 *   - at most User::TEMPORARY_PASSWORD_MAX_BYTES bytes (bcrypt, which Supabase
 *     Auth uses, silently ignores anything past 72 bytes);
 *   - not the account's username or email address, ignoring case.
 *
 * The minimum length stays a plain `min:` rule beside this one. Every failure
 * reports a fixed sentence: the value, its length and any fragment of it are
 * never part of a message.
 */
class AcceptablePassword implements ValidationRule
{
    /**
     * @param  string  $label  how the field is named in messages, e.g. "temporary password"
     */
    public function __construct(
        private string $label,
        private ?string $username,
        private ?string $email,
    ) {}

    public function validate(string $attribute, #[\SensitiveParameter] mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            return; // the accompanying 'string' rule reports it
        }

        $label = ucfirst($this->label);

        if (trim($value) === '') {
            $fail("{$label} cannot be only spaces.");

            return;
        }

        if (strlen($value) > User::TEMPORARY_PASSWORD_MAX_BYTES) {
            $fail("{$label} must be at most ".User::TEMPORARY_PASSWORD_MAX_BYTES.' characters (fewer if it uses accented or non-Latin characters).');

            return;
        }

        $comparable = mb_strtolower(trim($value));
        $username = mb_strtolower(trim((string) $this->username));
        $email = mb_strtolower(trim((string) $this->email));

        if ($username !== '' && $comparable === $username) {
            $fail("{$label} cannot be the same as the username.");

            return;
        }

        if ($email !== '' && $comparable === $email) {
            $fail("{$label} cannot be the same as the email address.");
        }
    }
}
