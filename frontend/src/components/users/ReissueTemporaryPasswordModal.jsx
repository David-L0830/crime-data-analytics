import { useEffect, useState } from 'react';
import ConfirmActionModal from './ConfirmActionModal';
import TemporaryPasswordInput from './TemporaryPasswordInput';
import { userService } from '../../services/userService';
import { describeApiFailure } from './userValidation';
import {
  generateTemporaryPassword,
  validateTemporaryPassword,
} from '../../utils/temporaryPassword';

// Reissue Temporary Password — confirmation and entry in one dialog.
//
// The new password is generated in this browser when the dialog opens (and can
// be regenerated or typed over), submitted once to
// POST /users/{id}/temporary-password, and handed to the parent's one-time
// display on success. It is held only in this component's state and cleared
// on success, on cancel, and whenever the dialog closes.
export default function ReissueTemporaryPasswordModal({ user, onClose, onIssued, onNotice }) {
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFieldError('');
    setError('');
    if (!user) {
      setPassword('');
      return;
    }
    try {
      setPassword(generateTemporaryPassword());
    } catch {
      setPassword('');
    }
  }, [user]);

  const close = () => {
    if (busy) return;
    setPassword('');
    onClose();
  };

  const confirm = async () => {
    const problem = validateTemporaryPassword(password, {
      username: user?.username,
      email: user?.email,
    });
    setFieldError(problem ?? '');
    if (problem) return;

    setBusy(true);
    setError('');
    const submitted = password;
    try {
      const updated = await userService.issueTemporaryPassword(user.id, submitted);
      setPassword('');
      onIssued(updated, submitted);
    } catch (err) {
      // Fixed server messages only; the submitted value is never part of them.
      setError(describeApiFailure(err, 'The temporary password could not be issued.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmActionModal
      open={Boolean(user)}
      title="Reissue Temporary Password"
      confirmLabel="Reissue Password"
      busyLabel="Reissuing…"
      variant="danger"
      busy={busy}
      error={error}
      onConfirm={confirm}
      onClose={close}
    >
      <p className="confirm-lead">Issue a new temporary password for:</p>
      <div className="confirm-subject">
        <strong>{user?.fullName}</strong>
        <span>Username: {user?.username}</span>
      </div>
      <p className="confirm-note">
        Their current password stops working immediately and any open sessions
        are blocked. This replaces any temporary password issued before. They
        must change the new one the first time they sign in, within 72 hours.
      </p>
      <TemporaryPasswordInput
        id="reissue-temporary-password"
        value={password}
        onChange={(value) => {
          setPassword(value);
          setFieldError('');
        }}
        error={fieldError}
        disabled={busy}
        onNotice={onNotice}
      />
    </ConfirmActionModal>
  );
}
