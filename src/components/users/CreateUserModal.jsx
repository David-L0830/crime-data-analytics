import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TemporaryPasswordInput from './TemporaryPasswordInput';
import { validateAccountFields } from './userValidation';
import { validateTemporaryPassword } from '../../utils/temporaryPassword';
import { MFA_METHOD_OPTIONS } from '../../utils/mfaStatus';

// Encoder stays the default wherever the viewer may create one (the most
// common account); otherwise the least-privileged role on offer.
const defaultRole = (roleOptions) =>
  roleOptions.some((option) => option.value === 'encoder')
    ? 'encoder'
    : (roleOptions[0]?.value ?? '');

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
//  2. MFA Method (required). Every account an administrator creates has a
//     second factor, so the choice is Email OTP or Authenticator App and
//     there is no "none". Nothing is pre-selected: the administrator makes the
//     choice deliberately. The backend validates it (StoreUserRequest) and
//     stores it — this form is not the control. Choosing Authenticator App
//     does NOT enrol anything: the person scans their own QR code at first
//     sign-in, so no administrator ever sees their secret.
//
//  3. Role. Only the roles the viewer may assign (`roleOptions`, from
//     assignableRoleOptions): Encoder or Validator for an Administrator,
//     Administrator for a Super Administrator. Super Administrator is never
//     offered — that account is created by a database seeder only.
export default function CreateUserModal({
  open,
  onClose,
  onCreate,
  saving,
  onNotice,
  roleOptions = [],
}) {
  const [form, setForm] = useState({
    fullName: '',
    username: '',
    email: '',
    role: defaultRole(roleOptions),
    isActive: true,
    mfaMethod: '',
  });
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const reset = () => {
    setForm({
      fullName: '',
      username: '',
      email: '',
      role: defaultRole(roleOptions),
      isActive: true,
      mfaMethod: '',
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
    if (!MFA_METHOD_OPTIONS.some((option) => option.value === form.mfaMethod)) {
      found.mfaMethod = 'Choose an MFA method.';
    }
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
      mfaMethod: form.mfaMethod,
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
          {roleOptions.map((role) => (
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
        <label id="create-mfa-method-label">MFA Method *</label>
        <div
          className="radio-row radio-row-stacked"
          role="radiogroup"
          aria-labelledby="create-mfa-method-label"
          aria-required="true"
          aria-invalid={Boolean(errors.mfaMethod)}
          aria-describedby={
            errors.mfaMethod ? 'create-mfa-method-error' : 'create-mfa-method-hint'
          }
        >
          {MFA_METHOD_OPTIONS.map((option) => (
            <label className="radio-option radio-option-described" key={option.value}>
              <input
                type="radio"
                name="create-mfa-method"
                value={option.value}
                checked={form.mfaMethod === option.value}
                onChange={() => set('mfaMethod', option.value)}
                disabled={saving}
              />
              <span>
                <span className="radio-option-title">{option.label}</span>
                <span className="radio-option-description">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.mfaMethod && (
          <p className="field-error" id="create-mfa-method-error">
            {errors.mfaMethod}
          </p>
        )}
        <p className="form-hint" id="create-mfa-method-hint">
          Required for every account. An authenticator app is set up by the
          person on their own device — you never see its secret or QR code.
        </p>
      </div>

      {formError && <div className="login-error">{formError}</div>}
    </Modal>
  );
}
