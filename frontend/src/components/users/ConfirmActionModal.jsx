import Modal from '../ui/Modal';
import Button from '../ui/Button';

// One confirmation dialog shared by the three actions on this page that
// should never happen on a single stray click: deactivating an account,
// sending a password-reset email, and clearing someone's enrolled second
// factor.
//
// It replaces window.confirm(), which the previous version of this screen
// used. That mattered for more than appearance: a native confirm cannot say
// WHICH account is affected in any structured way, cannot state what will and
// will not be destroyed, and cannot render the destructive action differently
// from the safe one. All three are things an administrator acting on someone
// else's account in a crime-records system should see before they commit.
//
// `variant` styles the confirm button only. The cancel action is always the
// plain, unemphasised one, so the destructive path is never the easiest thing
// to hit by reflex.
export default function ConfirmActionModal({
  open,
  title,
  confirmLabel,
  busyLabel,
  variant = 'primary',
  busy = false,
  error = '',
  onConfirm,
  onClose,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && <div className="login-error">{error}</div>}
    </Modal>
  );
}
