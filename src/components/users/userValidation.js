// Shared client-side validation for the Create/Edit account forms.
//
// This is a courtesy layer, not a control. The backend validates the same
// fields independently (StoreUserRequest / UpdateUserRequest) and owns the
// checks this cannot honestly make — uniqueness of a username or email is a
// property of the database, not of the form, so it is never guessed at here.
// Everything below is about telling someone what is wrong before they wait
// for a round trip.

// Deliberately permissive. A stricter pattern rejects addresses that are
// perfectly valid (new TLDs, plus-addressing, longer subdomains) and the only
// authority on whether an address works is whether mail to it arrives —
// Supabase will find out, and the form should not pre-emptively refuse a real
// address.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors User::ROLE_LABELS on the backend. Ordered least- to
// most-privileged so the default selection in a new-account form is never the
// most powerful role by accident.
export const ROLE_OPTIONS = [
  { value: 'badac_readonly', label: 'BADAC (read-only)' },
  { value: 'encoder', label: 'Encoder' },
  { value: 'badac_admin', label: 'Administrator' },
];

export function validateAccountFields(form, { requireEmail = false } = {}) {
  const errors = {};

  if (!form.fullName?.trim()) {
    errors.fullName = 'Full name is required.';
  } else if (form.fullName.trim().length > 150) {
    errors.fullName = 'Full name must be 150 characters or fewer.';
  }

  if (!form.username?.trim()) {
    errors.username = 'Username is required.';
  } else if (form.username.trim().length > 50) {
    errors.username = 'Username must be 50 characters or fewer.';
  }

  if (requireEmail) {
    if (!form.email?.trim()) {
      errors.email = 'Email address is required.';
    } else if (!EMAIL_PATTERN.test(form.email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
  }

  return errors;
}

// Turns a rejected request into something an administrator can act on.
//
// Laravel's 422 responses carry a per-field `errors` object; those messages
// are written for end users (StoreUserRequest::messages() supplies the ones
// that matter here) and are the most useful thing to show. Anything else
// falls back to the ApiError message, which api.js has already reduced to a
// safe sentence per status code — raw server internals never reach the UI.
export function describeApiFailure(err, fallback) {
  if (err?.errors) {
    const messages = Object.values(err.errors).flat();
    if (messages.length > 0) return messages.join(' ');
  }
  return err?.message || fallback;
}
