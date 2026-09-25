import Modal from '../ui/Modal';
import Button from '../ui/Button';
import {
  IDLE_BEFORE_WARNING_MS,
  WARNING_TIMEOUT_MS,
  formatCountdown,
} from '../../hooks/useInactivityTimeout';

// Minutes, read off the policy constants rather than written out, so the
// sentence on screen cannot drift away from the timer that produced it.
const IDLE_MINUTES = Math.round(IDLE_BEFORE_WARNING_MS / 60000);
const WARNING_MINUTES = Math.round(WARNING_TIMEOUT_MS / 60000);

// The five-minute warning shown before an idle session is signed out.
//
// It is built on the shared Modal, which already supplies role="dialog",
// aria-modal="true", aria-labelledby pointing at the heading, a focus trap,
// focus restoration on close, and Escape-to-close — so this component adds no
// dialog semantics of its own and cannot diverge from the eleven other modals
// in the application. Its classes (.confirm-lead, .confirm-subject,
// .confirm-note) are the ones the confirmation dialogs already use, so the
// typography, spacing, border radius and both themes come from the same CSS
// variables as everything else. Nothing here is styled as an error: this is a
// routine security measure, not a failure.
//
// EVERY WAY OUT OF THE DIALOG THAT IS NOT "Sign Out" MEANS "stay". Escape, the
// header's close button, and a click on the backdrop all run onStaySignedIn,
// which resets the timer — so a keyboard user who dismisses the dialog the way
// they dismiss every other dialog keeps their session rather than silently
// losing it five minutes later. That is also true of simply carrying on
// working: any interaction while this is open resets the timer and closes it.
export default function SessionTimeoutModal({
  remainingMs,
  onStaySignedIn,
  onSignOut,
}) {
  const open = remainingMs !== null && remainingMs !== undefined;

  return (
    <Modal
      open={open}
      onClose={onStaySignedIn}
      title="Session Expiring"
      footer={
        <>
          <Button variant="secondary" onClick={onSignOut}>
            Sign Out
          </Button>
          <Button variant="primary" onClick={onStaySignedIn}>
            Stay Signed In
          </Button>
        </>
      }
    >
      <p className="confirm-lead">
        You&rsquo;ve been inactive for {IDLE_MINUTES} minutes. For your
        security, you&rsquo;ll be signed out in {WARNING_MINUTES} minutes.
      </p>
      {/* role="timer" carries an implicit aria-live="off", which is what is
          wanted: the remaining time is announced when a screen-reader user
          asks for it, not shouted at them once a second for five minutes. The
          sentence above already states the situation and does not change. */}
      <div className="confirm-subject">
        <strong role="timer">
          Your session will expire in {formatCountdown(remainingMs ?? 0)}.
        </strong>
        <span>Any activity in the application will keep you signed in.</span>
      </div>
    </Modal>
  );
}
