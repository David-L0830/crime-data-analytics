import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TemporaryPasswordInput from './TemporaryPasswordInput';
import { ROLE_OPTIONS, validateAccountFields } from './userValidation';
import { validateTemporaryPassword } from '../../utils/temporaryPassword';

// Create New User.
//
//  1. The password. Supabase Auth owns every credential in this system; the
//     backend provisions the Supabase identity with the service-role key
//     (server-side only). There are two ways to give the new account its
//     first password:
//       - leave Temporary Password blank: the person receives a setup email
//         and sets their own (unchanged behaviour); or
//       - enter or generate a Temporary Password: it is sent once to the
//         backend, which passes it to Supabase Auth and never stores or
//         returns it. The administrator is shown it one time to hand over, and
//         the person must change it at first sign-in.
//     The value lives only in this form's local state and is cleared on
//     success and whenever the dialog closes.
//
//  2. "Require 2FA" is present but disabled, and says why. Enrolling a factor
//     is self-service in Supabase and this application does not challenge for
//     a factor at sign-in, so there is nothing a checkbox here could switch
//     on. Rendering it as a working control would be a promise the system
//     cannot keep — showing it plainly unavailable is the honest version of
//     the same information.
export default function CreateUserModal({
  open,
  onClose,
  onCreate,
  saving,
  onNotice,
}) {
  const [form, setForm] = useState({
    fullName: '',
    username: '',
    email: '',
    role: 'encoder',
    isActive: true,
  });
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const reset = () => {
    setForm({
      fullName: '',
      username: '',
      email: '',
      role: 'encoder',
      isActive: true,
    });
    setTemporaryPassword('');
    setErrors({});
    setFormError('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const set = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clearing the field's own error as it is corrected keeps the message
    // tied to the moment it is still true.
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async () => {
    const found = validateAccountFields(form, { requireEmail: true });
    // Optional: only checked when something was entered.
    if (temporaryPassword !== '') {
      const problem = validateTemporaryPassword(temporaryPassword, {
        username: form.username,
        email: form.email,
      });
      if (problem) found.temporaryPassword = problem;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setFormError('');
    const payload = {
      fullName: form.fullName.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      role: form.role,
      isActive: form.isActive,
    };
    // Sent exactly as typed (never trimmed) and only when present, so a blank
    // field keeps the original setup-email path.
    if (temporaryPassword !== '') payload.temporaryPassword = temporaryPassword;

    const failure = await onCreate(payload);

    if (failure) setFormError(failure);
    else reset();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create New User"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating…' : 'Create User'}
          </Button>
        </>
      }
    >
      <div className="form-group">
        <label htmlFor="create-full-name">Full Name</label>
        <input
          id="create-full-name"
          type="text"
          value={form.fullName}
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={errors.fullName ? 'create-full-name-error' : undefined}
          onChange={(e) => set('fullName', e.target.value)}
        />
        {errors.fullName && (
          <p className="field-error" id="create-full-name-error">
            {errors.fullName}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="create-username">Username</label>
        <input
          id="create-username"
          type="text"
          value={form.username}
          aria-invalid={Boolean(errors.username)}
          aria-describedby={errors.username ? 'create-username-error' : undefined}
          onChange={(e) => set('username', e.target.value)}
        />
        {errors.username && (
          <p className="field-error" id="create-username-error">
            {errors.username}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="create-email">Email</label>
        <input
          id="create-email"
          type="email"
          value={form.email}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'create-email-error' : undefined}
          onChange={(e) => set('email', e.target.value)}
        />
        {errors.email && (
          <p className="field-error" id="create-email-error">
            {errors.email}
          </p>
        )}
        <p className="form-hint">
          {temporaryPassword
            ? 'The account is created in Supabase with this address and the temporary password below. No setup email is sent.'
            : 'The account is created in Supabase with this address, and the person receives an email to set their own password.'}
        </p>
      </div>

      <TemporaryPasswordInput
        id="create-temporary-password"
        label="Temporary Password (optional)"
        value={temporaryPassword}
        onChange={(value) => {
          setTemporaryPassword(value);
          setErrors((prev) => ({ ...prev, temporaryPassword: undefined }));
        }}
        error={errors.temporaryPassword}
        hint="Leave blank to send a password setup email instead. A temporary password expires after 72 hours and must be changed at first sign-in."
        disabled={saving}
        onNotice={onNotice}
      />

      <div className="form-group">
        <label htmlFor="create-role">Role</label>
        <select
          id="create-role"
          value={form.role}
          onChange={(e) => set('role', e.target.value)}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label id="create-status-label">Account Status</label>
        <div
          className="radio-row"
          role="radiogroup"
          aria-labelledby="create-status-label"
        >
          <label className="radio-option">
            <input
              type="radio"
              name="create-status"
              checked={form.isActive}
              onChange={() => set('isActive', true)}
            />
            Active
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="create-status"
              checked={!form.isActive}
              onChange={() => set('isActive', false)}
            />
            Inactive
          </label>
        </div>
      </div>

      <div className="form-group">
        <label className="checkbox-option checkbox-option-disabled">
          <input type="checkbox" disabled checked={false} readOnly />
          Require 2FA
        </label>
        <p className="form-hint">
          Not available. Two-factor authentication IS enforced at sign-in once
          enrolled, but enrolling means scanning a QR code with a device only
          the account holder has, so it can only be done by them from their own
          security panel — never provisioned from here.
        </p>
      </div>

      {formError && <div className="login-error">{formError}</div>}
    </Modal>
  );
}
