import { useCallback, useEffect, useState } from 'react';
import {
  notificationPermission,
  requestNotificationPermission,
} from '../../utils/browserNotifications';
import { Icons } from '../icons';

// The desktop-alert permission control, shown as a footer inside the bell's
// dropdown panel.
//
// WHY IT LIVES HERE AND NOT IN SYSTEM SETTINGS
//
// System Settings is administrator-only and holds business configuration that
// applies to the whole barangay. This is neither: browser notification
// permission is per-person and per-browser — the same account signing in from a
// different machine has a different answer — and every role needs it. The bell
// panel is where somebody already is when they are thinking about
// notifications, so the control is there.
//
// WHY IT NEVER ASKS ON ITS OWN
//
// A permission prompt that appears unprompted at sign-in is the most reliable
// way to get "Block" clicked, and "Block" is permanent — the browser will not
// ask again, and no amount of code can undo it. So the request only ever
// happens from this button, and only when the state is 'default'. Once the
// answer is 'denied' the button is gone entirely and replaced by an
// explanation, because a button that cannot do anything is worse than no button.
export default function NotificationPermissionControl({ open }) {
  const [permission, setPermission] = useState(() => notificationPermission());
  const [asking, setAsking] = useState(false);

  const refresh = useCallback(() => setPermission(notificationPermission()), []);

  // Re-read whenever the panel opens. Permission can be changed from the
  // browser's own site settings at any time, and that change fires no event
  // this page can listen for — so the moment the panel is opened is the
  // reliable point to ask again, rather than trusting a value read at mount.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleEnable = async () => {
    if (asking) return;
    setAsking(true);
    try {
      setPermission(await requestNotificationPermission());
    } finally {
      setAsking(false);
    }
  };

  if (permission === 'unsupported') {
    return (
      <div className="notif-permission notif-permission-muted">
        <Icons.Info size={14} strokeWidth={2} />
        <span>
          This browser can’t show desktop alerts. Notifications still appear
          here and in the bell.
        </span>
      </div>
    );
  }

  if (permission === 'granted') {
    return (
      <div className="notif-permission notif-permission-granted">
        <Icons.CheckCircle2 size={14} strokeWidth={2} />
        <span>
          Desktop alerts are on. You’ll be notified even when BADAC Analytics
          isn’t the tab you’re looking at.
        </span>
      </div>
    );
  }

  if (permission === 'denied') {
    // No retry button on purpose: once blocked, requestPermission() resolves
    // straight back to 'denied' without ever showing a prompt, so a button here
    // would do nothing at all. The only route back is the browser's own site
    // settings, so that is what this says — without inventing a click-path,
    // since it differs by browser.
    return (
      <div className="notif-permission notif-permission-muted">
        <Icons.AlertTriangle size={14} strokeWidth={2} />
        <span>
          Desktop alerts are blocked for this site. To turn them back on, allow
          notifications for this site in your browser’s settings (usually via
          the icon at the left of the address bar), then reload the page.
        </span>
      </div>
    );
  }

  return (
    <div className="notif-permission">
      <Icons.Bell size={14} strokeWidth={2} />
      <div className="notif-permission-body">
        <span>
          Get notified about new incidents even when you’re in another tab or
          application.
        </span>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={handleEnable}
          disabled={asking}
        >
          {asking ? 'Waiting…' : 'Turn on desktop alerts'}
        </button>
      </div>
    </div>
  );
}
