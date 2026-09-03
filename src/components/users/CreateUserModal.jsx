import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ROLE_OPTIONS, validateAccountFields } from './userValidation';

// Create New User.
//
// Two things are deliberately absent from this form:
//
//  1. There is no password field, and there never can be one. Supabase Auth
//     owns every credential in this system; the backend provisions the
//     Supabase identity with the service-role key (server-side only) and the
//     new user then sets their own password from a recovery email. An
//     administrator never chooses, sees, or transmits someone else's
//     password.
//
//  2. "Require 2FA" is present but disabled, and says why. Enrolling a factor
//     is self-service in Supabase and this application does not challenge for
//     a factor at sign-in, so there is nothing a checkbox here could switch
//     on. Rendering it as a working control would be a promise the system
//     cannot keep — showing it plainly unavailable is the honest version of
//     the same information.
export default function CreateUserModal({ open, onClose, onCreate, saving }) {
  const [form, setForm] = useState({
    fullName: '',
    username: '',
    email: '',
    role: 'encoder',
    isActive: true,
  });
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
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setFormError('');
    const failure = await onCreate({
      fullName: form.fullName.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      role: form.role,
      isActive: form.isActive,
    });

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
          onChange={(e) => set('fullName', e.target.value)}
        />
        {errors.fullName && <p className="field-error">{errors.fullName}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="create-username">Username</label>
        <input
          id="create-username"
          type="text"
          value={form.username}
          aria-invalid={Boolean(errors.username)}
          onChange={(e) => set('username', e.target.value)}
        />
        {errors.username && <p className="field-error">{errors.username}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="create-email">Email</label>
        <input
          id="create-email"
          type="email"
          value={form.email}
          aria-invalid={Boolean(errors.email)}
          onChange={(e) => set('email', e.target.value)}
        />
        {errors.email && <p className="field-error">{errors.email}</p>}
        <p className="form-hint">
          The account is created in Supabase with this address, and the person
          receives an email to set their own password.
        </p>
      </div>

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
