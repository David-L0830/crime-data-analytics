import { useCallback, useEffect, useState } from 'react';
import {
  notificationPermission,
  requestNotificationPermission,
} from '../../utils/browserNotifications';
import {
  locationPermission,
  requestCurrentPosition,
  watchLocationPermission,
} from '../../utils/browserLocation';
import { Icons } from '../icons';

// The unified Permissions block, shown inside Profile Settings.
//
// WHY IT LIVES IN THE PROFILE MODAL AND NOT IN SYSTEM SETTINGS
//
// System Settings is Administrator-only (route guard plus role:badac_admin
// middleware on every endpoint it calls) and holds business configuration for
// the whole barangay. Browser permissions are neither: they are per-person and
// per-browser — the same account signing in from a different machine has a
// different answer — and every role has them. Profile Settings is the one
// per-user surface every role can open, so that is where a person goes to see
// what this site has been allowed to do.
//
// THERE IS NO SECOND SOURCE OF TRUTH
//
// This component stores no permission of its own. Every value it renders is
// read from the browser — Notification.permission and
// navigator.permissions.query({name:'geolocation'}) — at the moment the panel
// opens, and re-read when the browser reports a change. The control in the
// notification bell reads the same two APIs the same way and remains in place;
// because neither surface caches, they cannot disagree, and a permission
// changed in one is already correct in the other the next time it is shown.
// Nothing about permission state is written to localStorage or to the server.

// The Permissions API and the Notification API name the "not yet asked" state
// differently ('prompt' vs 'default'). Both are normalised here, once, so the
// rest of the component branches on a single vocabulary and the interface can
// never show two different words for the same situation.
const LABELS = {
  granted: 'Allowed',
  denied: 'Blocked',
  prompt: 'Not requested',
  unsupported: 'Not supported',
};

function normalise(state) {
  return state === 'default' ? 'prompt' : state;
}

/**
 * One permission row: heading, purpose, action, status.
 *
 * Presentational only — it holds no permission state and decides no policy.
 * Both rows render through it so the two cannot drift into different layouts,
 * different status wording, or different behaviour when blocked.
 */
function PermissionRow({
  icon,
  title,
  purpose,
  state,
  busy,
  busyLabel,
  actionLabel,
  onRequest,
  blockedHelp,
  error,
}) {
  const label = LABELS[state] || LABELS.prompt;

  return (
    <div className="permission-row">
      <div className="permission-row-head">
        {icon}
        <span className="permission-row-title">{title}</span>
        {/* The status is a live read of the browser's own answer, so it is
            stated plainly rather than as something the user set here. */}
        <span className={`permission-status permission-status-${state}`}>
          <span className="permission-status-dot" aria-hidden="true" />
          {label}
        </span>
      </div>

      <p className="permission-row-purpose">{purpose}</p>

      {/* The button exists ONLY when pressing it can do something. Once the
          answer is 'granted' there is nothing to ask for; once it is 'denied'
          the browser resolves any further request straight back to denied
          without ever showing a prompt, so a retry button would be a control
          that visibly does nothing. 'unsupported' has no API to call at all. */}
      {state === 'prompt' && (
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={onRequest}
          disabled={busy}
        >
          {busy ? busyLabel : actionLabel}
        </button>
      )}

      {state === 'denied' && (
        <p className="permission-row-help">{blockedHelp}</p>
      )}

      {state === 'unsupported' && (
        <p className="permission-row-help">
          This browser does not support {title.toLowerCase()} for websites.
        </p>
      )}

      {/* A request that was allowed but still failed — no GPS fix, a timeout.
          Distinct from the blocked case, because the user's action here is to
          try again rather than to change a browser setting. */}
      {error && <p className="permission-row-error">{error}</p>}
    </div>
  );
}

export default function PermissionsSection({ open }) {
  // 'unsupported' until the first async read resolves. Starting pessimistic
  // means the brief moment before navigator.permissions answers renders an
  // inert row rather than an "Allow Location" button that might turn out to be
  // pointless — and it can only ever move to a more capable state, never flash
  // a control and then remove it.
  const [location, setLocation] = useState('unsupported');
  const [notifications, setNotifications] = useState(() =>
    normalise(notificationPermission()),
  );
  const [locating, setLocating] = useState(false);
  const [asking, setAsking] = useState(false);
  const [locationError, setLocationError] = useState(null);

  const refreshLocation = useCallback(() => {
    locationPermission().then((state) => setLocation(normalise(state)));
  }, []);

  // Re-read whenever the modal opens. Both permissions can be changed from the
  // browser's own site settings at any time while this page is loaded, and
  // Notification fires no event at all when that happens — so the moment the
  // panel is opened is the reliable point to ask again, rather than trusting a
  // value read once at mount.
  useEffect(() => {
    if (!open) return undefined;

    setNotifications(normalise(notificationPermission()));
    setLocationError(null);
    refreshLocation();

    // Geolocation, unlike Notification, CAN report a change while open — via
    // PermissionStatus. Subscribing means unblocking the site in another tab
    // is reflected here without the user having to close and reopen.
    return watchLocationPermission((state) => setLocation(normalise(state)));
  }, [open, refreshLocation]);

  const handleAllowLocation = async () => {
    if (locating) return;
    setLocating(true);
    setLocationError(null);
    try {
      // THE COORDINATE IS DISCARDED. navigator.permissions.query() cannot
      // raise a prompt — obtaining a position is the only thing that makes the
      // browser ask — so this call exists purely to put the choice in front of
      // the user from a real gesture. The resolved position is deliberately
      // not read, not stored, and not sent anywhere; showing it is Crime
      // Mapping's job, and this panel has no reason to know where anyone is.
      await requestCurrentPosition();
    } catch (err) {
      // A denial is not an error to report as one: the status chip below is
      // about to say "Blocked", which is the whole message. Anything else
      // (no fix, timeout) is a real failure the user can act on by retrying.
      if (err?.code !== 'denied') {
        setLocationError(err?.message || null);
      }
    } finally {
      setLocating(false);
      // Re-read rather than inferring from the outcome. The browser is the
      // source of truth, and a success does not always mean 'granted' was
      // stored (a one-time allow, for instance).
      refreshLocation();
    }
  };

  const handleEnableNotifications = async () => {
    if (asking) return;
    setAsking(true);
    try {
      setNotifications(normalise(await requestNotificationPermission()));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="permissions-section">
      <h4 className="permissions-heading">Permissions</h4>
      <p className="permissions-intro">
        Both are optional. BADAC Analytics works normally without them, and
        each is remembered by this browser only — granting one here does not
        grant it on another computer.
      </p>

      <PermissionRow
        icon={<Icons.MapPin size={15} strokeWidth={2} />}
        title="Location"
        purpose="Used for location-based mapping features, such as showing where you are on the Crime Mapping page."
        state={location}
        busy={locating}
        busyLabel="Waiting…"
        actionLabel="Allow Location"
        onRequest={handleAllowLocation}
        blockedHelp="Location is blocked for this site. To allow it, change the location setting for this site in your browser (usually via the icon at the left of the address bar), then reopen this panel."
        error={locationError}
      />

      <PermissionRow
        icon={<Icons.Bell size={15} strokeWidth={2} />}
        title="Notifications"
        purpose="Used for important system notifications, so new incidents and hotspot alerts reach you even when this is not the tab you are looking at."
        state={notifications}
        busy={asking}
        busyLabel="Waiting…"
        actionLabel="Enable Notifications"
        onRequest={handleEnableNotifications}
        blockedHelp="Desktop alerts are blocked for this site. To allow them, change the notification setting for this site in your browser (usually via the icon at the left of the address bar), then reload the page."
      />
    </div>
  );
}
