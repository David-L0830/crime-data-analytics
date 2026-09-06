// Browser/system notifications — the layer that reaches the user when they are
// NOT looking at BADAC Analytics.
//
// WHAT THIS IS FOR, AND WHAT IT HONESTLY CANNOT DO
//
// The in-app pop-up and the bell are only visible to somebody who is already
// looking at the page. This module covers the case the barangay actually cares
// about: an encoder logs an incident while the desk officer is in another tab
// or another application entirely, and the alert still has to land.
//
// It uses the Notification API from the page itself. That works whenever the
// page is still loaded — a background tab, a minimised window, another app in
// focus — because a backgrounded page keeps running (throttled, see
// DataContext's polling note). It does NOT work once the tab or the browser is
// closed, and nothing here pretends otherwise. Notifications after the browser
// is closed require a Service Worker plus the Push API plus a push service and
// a subscription store on the server, which this project has none of and does
// not need: see the final report for why that infrastructure was deliberately
// not introduced.
//
// EVERYTHING HERE IS A NO-OP WHEN IT CANNOT WORK
//
// Notification is absent in some embedded webviews and, historically, on iOS
// Safari outside an installed web app. Permission may be denied. The page may
// be running without a window at all (a test environment). Every entry point
// below checks and returns quietly rather than throwing, because the bell and
// the in-app toast already carry the same information — a browser that refuses
// to show a system notification must never turn into an error in front of
// somebody logging a crime report.

const STORAGE_KEY = 'badac.announcedNotificationIds';

// How many ids to remember. Large enough that a busy week cannot roll an id out
// of the window and replay its notification, small enough to stay a trivially
// small localStorage value.
const MAX_REMEMBERED_IDS = 300;

/**
 * Ids already announced, held in memory as well as in localStorage.
 *
 * BOTH, deliberately. The in-memory Set answers the common case without
 * touching storage on every poll; localStorage is what makes the guarantee
 * survive the things an in-memory array cannot — a component remount, a route
 * change that rebuilds the tree, a page refresh, or React Strict Mode's
 * deliberate double-mount in development. An id-keyed check in memory alone
 * would re-announce every unread notification on every reload.
 */
let announced = null;

function readStoredIds() {
  if (announced) return announced;

  announced = new Set();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) parsed.forEach((id) => announced.add(String(id)));
    }
  } catch {
    // Private browsing, disabled storage, or corrupt JSON. An empty set is the
    // safe answer: the worst case is one duplicate notification, whereas
    // throwing here would break the arrival path entirely.
  }

  return announced;
}

function persistIds() {
  try {
    // Only the most recent ids are kept, oldest dropped first. Set preserves
    // insertion order, which is what makes this a window rather than an
    // arbitrary subset.
    const ids = Array.from(announced).slice(-MAX_REMEMBERED_IDS);
    announced = new Set(ids);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage full or unavailable — the in-memory set still dedupes for this
    // session, which is the majority of the protection.
  }
}

/** Whether this browser has the Notification API at all. */
export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * The current permission, as one of four states the UI can speak about:
 * 'unsupported' | 'default' | 'granted' | 'denied'.
 *
 * 'unsupported' is deliberately part of the same enum rather than a separate
 * boolean, so the caller cannot render a "Turn on notifications" button in a
 * browser that has no notifications to turn on.
 */
export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported';

  try {
    return window.Notification.permission;
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks the browser for permission, once.
 *
 * ONLY call this from a real user gesture (the control in the notification
 * panel). Two reasons: Safari requires a gesture and rejects otherwise, and a
 * permission prompt that appears unprompted at sign-in is the single most
 * reliable way to get "Block" clicked forever. Nothing in this application
 * requests permission automatically.
 *
 * Returns the resulting state. Calling it when the state is already 'granted'
 * or 'denied' short-circuits: 'denied' in particular is final, and the browser
 * will not re-prompt — asking again is not a retry, it is a no-op that would
 * only produce a confusing dead button.
 */
export async function requestNotificationPermission() {
  const current = notificationPermission();
  if (current !== 'default') return current;

  try {
    // Both shapes: modern browsers return a promise, older WebKit only takes a
    // callback. Promise.resolve on a possibly-undefined return handles the
    // callback-only case falling through to a re-read below.
    const result = await window.Notification.requestPermission();
    return result || notificationPermission();
  } catch {
    return notificationPermission();
  }
}

/** Whether this notification has already produced a system notification. */
export function hasAnnounced(id) {
  if (id === undefined || id === null) return false;
  return readStoredIds().has(String(id));
}

/** Records that it has, so no later poll or remount can announce it again. */
export function rememberAnnounced(id) {
  if (id === undefined || id === null) return;
  readStoredIds().add(String(id));
  persistIds();
}

/**
 * Shows one system notification, if permission allows and it has not been
 * shown before.
 *
 * DUPLICATE PREVENTION happens here rather than at the call site, so every
 * path into a system notification passes the same gate. The id is checked and
 * recorded in the same call, which is what makes a second call for the same id
 * — from a re-render, a re-poll, a remount, or a reload — a no-op.
 *
 * The `tag` is set to the same id as a second line of defence: even if two
 * calls somehow raced past the check, the browser itself collapses
 * same-tag notifications into one instead of stacking duplicates.
 *
 * Only the title and message already displayed in the app are passed to the
 * browser; nothing is stored beyond the id.
 *
 * @returns {boolean} whether a notification was actually shown.
 */
export function showSystemNotification({ id, title, message, onClick }) {
  if (notificationPermission() !== 'granted') return false;
  if (hasAnnounced(id)) return false;

  // Recorded BEFORE the attempt. If constructing the notification throws on
  // some platform, the right outcome is still "do not try this one again on
  // every subsequent poll" — a notification that fails once will fail every
  // time, and retrying it forever would be the worse failure.
  rememberAnnounced(id);

  try {
    const notification = new window.Notification(title || 'BADAC Analytics', {
      body: message || '',
      // The application's own favicon, so the alert is recognisably from this
      // system rather than a generic browser bubble. Served from the site
      // root by Vite (public/favicon.png).
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag: id !== undefined && id !== null ? `badac-${id}` : undefined,
      // Never silent: this is the case where the user is NOT looking at the
      // page, so the sound the operating system plays is the whole point.
      silent: false,
    });

    if (onClick) {
      notification.onclick = () => {
        try {
          // Bring the application forward before navigating — clicking a
          // system notification while in another app should land you on the
          // record, not merely change a tab you cannot see.
          window.focus();
        } catch {
          /* Some browsers refuse programmatic focus; the click still routes. */
        }
        onClick();
        notification.close();
      };
    }

    return true;
  } catch {
    // Chrome on Android throws here (it requires a Service Worker registration
    // to construct a Notification). The in-app toast and the bell still carry
    // the notification, so this degrades rather than fails.
    return false;
  }
}

/**
 * Forgets the announced-id history.
 *
 * Exported for tests only. It is deliberately NOT called on sign-out: the
 * history is what stops a notification being re-announced after a reload, and
 * clearing it on every sign-out would replay the whole unread backlog to
 * anybody who signed back in.
 */
export function resetAnnouncedNotifications() {
  announced = new Set();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
