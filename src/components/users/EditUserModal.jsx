import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { validateAccountFields } from './userValidation';

// Edit User.
//
// Same two fields the previous version of this screen saved — full name and
// username — and for the same documented reasons, unchanged here:
//
//  - Email is shown but read-only. Supabase Auth is authoritative for sign-in
//    identity, and this backend has no verified path to change an address
//    there as well (see UpdateUserRequest's Checkpoint 31 comment). Letting
//    it be edited would silently desync the address someone signs in with
//    from the one recorded here. It is displayed rather than hidden because
//    an administrator legitimately needs to read it.
//
//  - Role is not editable. Changing the role of a live identity is privilege
//    escalation, and the backend refuses it regardless of what is submitted
//    (`role` is not in UpdateUserRequest::rules(), and is not mass-assignable
//    — see test_role_field_is_not_mass_assignable_through_update). The role
//    is chosen once, at creation.
//
// What is new is the handling around them: per-field validation before the
// request, and a failure message that shows the backend's actual field errors
// instead of one generic sentence.
export default function EditUserModal({ user, open, onClose, onSave, saving }) {
  const [form, setForm] = useState({ fullName: '', username: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!user) return;
    setForm({ fullName: user.fullName, username: user.username });
    setErrors({});
    setFormError('');
  }, [user]);

  const set = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async () => {
    const found = validateAccountFields(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    // Nothing actually changed — no request, no misleading "updated"
    // confirmation, and no pointless audit row.
    if (
      form.fullName.trim() === user.fullName &&
      form.username.trim() === user.username
    ) {
      onClose();
      return;
    }

    setFormError('');
    const failure = await onSave({
      fullName: form.fullName.trim(),
      username: form.username.trim(),
    });
    if (failure) setFormError(failure);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `Edit ${user.fullName}` : 'Edit User'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="form-group">
        <label htmlFor="edit-full-name">Full Name</label>
        <input
          id="edit-full-name"
          type="text"
          value={form.fullName}
          aria-invalid={Boolean(errors.fullName)}
          onChange={(e) => set('fullName', e.target.value)}
        />
        {errors.fullName && <p className="field-error">{errors.fullName}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="edit-username">Username</label>
        <input
          id="edit-username"
          type="text"
          value={form.username}
          aria-invalid={Boolean(errors.username)}
          onChange={(e) => set('username', e.target.value)}
        />
        {errors.username && <p className="field-error">{errors.username}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="edit-email">Email</label>
        <input
          id="edit-email"
          type="email"
          value={user?.email ?? ''}
          readOnly
        />
        <p className="form-hint">
          Managed by Supabase Auth. The sign-in address cannot be changed from
          here without it drifting out of step with the account that actually
          authenticates.
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="edit-role">Role</label>
        <input
          id="edit-role"
          type="text"
          value={user?.roleLabel ?? ''}
          readOnly
        />
        <p className="form-hint">
          Roles are set when the account is created. Changing the role of an
          existing account is not supported from this screen.
        </p>
      </div>

      {formError && <div className="login-error">{formError}</div>}
    </Modal>
  );
}
