import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Icons } from '../icons';
import { copyToClipboard, maskPassword } from '../../utils/temporaryPassword';
import { formatDateTime } from '../../utils/helpers';

// The one-time display of a temporary password, shown right after it was set
// by Create User or Reissue.
//
// The password shown here is the value the administrator's own browser just
// submitted — it is NOT fetched from the server, and no endpoint can return it.
// The parent owns `credential` and sets it to null in onClose, which is what
// removes the password from memory; once closed it cannot be shown again.
//
// `credential`: { password, expiresAt, accountName, reissued }
export default function OneTimeCredentialModal({ credential, onClose, onNotice }) {
  const [visible, setVisible] = useState(false);

  // Always starts masked, for every new credential.
  useEffect(() => {
    setVisible(false);
  }, [credential]);

  const copy = async () => {
    const copied = await copyToClipboard(credential?.password ?? '');
    onNotice?.(
      copied ? 'Temporary password copied.' : 'Could not copy. Select and copy it manually.',
      copied ? 'success' : 'error',
    );
  };

  const expires = formatDateTime(credential?.expiresAt);

  return (
    <Modal
      open={Boolean(credential)}
      onClose={onClose}
      title={credential?.reissued ? 'Temporary Password Reissued' : 'Account Created'}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <p className="confirm-lead">
        Temporary password for <strong>{credential?.accountName}</strong>
      </p>

      <div className="one-time-credential">
        <span className="one-time-credential-label" id="one-time-credential-label">
          Temporary Password
        </span>
        <div className="temp-password-row">
          <code
            className="one-time-credential-value"
            aria-labelledby="one-time-credential-label"
          >
            {visible ? credential?.password : maskPassword(credential?.password)}
          </code>
          <Button
            variant="secondary"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-label={visible ? 'Hide temporary password' : 'Show temporary password'}
          >
            {visible ? (
              <Icons.EyeOff size={14} strokeWidth={2} />
            ) : (
              <Icons.Eye size={14} strokeWidth={2} />
            )}{' '}
            {visible ? 'Hide' : 'Show'}
          </Button>
          <Button variant="secondary" onClick={copy}>
            Copy
          </Button>
        </div>
        <p className="form-hint">
          Expires: <strong>{expires ?? 'in 72 hours'}</strong>
        </p>
      </div>

      <p className="confirm-note" role="note">
        <strong>This password will not be shown again after this window is closed.</strong>{' '}
        Give it to the account holder privately. They must change it the first
        time they sign in, after completing any required two-factor
        verification.
      </p>
    </Modal>
  );
}
