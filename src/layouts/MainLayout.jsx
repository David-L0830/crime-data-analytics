import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import Header from '../components/layout/Header';
import ErrorBoundary from '../components/ErrorBoundary';
import SessionTimeoutModal from '../components/auth/SessionTimeoutModal';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';
import { useToast } from '../hooks/useToast';
import {
  playNotificationChime,
  unlockNotificationAudio,
} from '../utils/notificationSound';
import {
  isSystemAlertWorthy,
  showSystemNotification,
} from '../utils/browserNotifications';
import { notificationTarget } from '../utils/notificationRouting';

// How long the top-edge pulse runs. Kept in sync with the
// `badac-topline-pulse` animation in global.css — the class is removed when
// this elapses so the animation can be retriggered by the next notification
// (re-adding a class that is already present does not restart an animation).
const TOPLINE_PULSE_MS = 1200;

// The one breakpoint at which the sidebar stops being a permanent column and
// becomes an overlay drawer. It has to be known in JavaScript as well as CSS,
// because "is the sidebar currently a drawer" decides three things the
// stylesheet cannot: whether the hamburger toggles the drawer or the desktop
// rail, whether the drawer's contents should be inert, and whether Escape and
// the backdrop should close anything. Kept identical to the `max-width: 768px`
// block in global.css — if one moves, the other must move with it.
const MOBILE_QUERY = '(max-width: 768px)';

export default function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Tracked as state rather than read from window.innerWidth at click time.
  // The old reading was only ever taken inside the toggle handler, so a drawer
  // opened on a phone stayed flagged open after a rotation or a resize to
  // desktop width, and nothing in the layout knew the sidebar had stopped
  // being a drawer.
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(MOBILE_QUERY).matches,
  );
  // The control that opens the drawer, so focus can be handed back to it when
  // the drawer closes. Without this, dismissing the drawer drops focus to the
  // document body and a keyboard user restarts from the top of the page.
  const menuButtonRef = useRef(null);
  const {
    loading,
    error,
    newNotifications,
    consumeNewNotifications,
    markNotificationRead,
  } = useData();
  const navigate = useNavigate();
  // Only used as the ErrorBoundary's key below — remounting the boundary on
  // every navigation is what clears a caught error without the boundary
  // needing reset logic of its own.
  const location = useLocation();
  const { showNotificationToast } = useToast();
  const [toplinePulsing, setToplinePulsing] = useState(false);
  const pulseTimer = useRef(null);
  const { currentUser, logout } = useAuth();

  // THE one place the inactivity timeout is mounted. This layout is the single
  // authenticated shell — every module (Dashboard, Crime Mapping, Incidents,
  // Victims, Criminal Records, Reports, Analytics, Profile) renders through
  // the <Outlet /> below — so mounting it here covers all of them with exactly
  // one timer, and no page holds a competing copy.
  //
  // `enabled` is tied to currentUser rather than left on: ProtectedRoute means
  // this layout only mounts for a signed-in user, but currentUser also drops
  // to null the instant any sign-out completes, and that must tear the timers
  // and listeners down rather than leave them running against a session that
  // no longer exists.
  //
  // onTimeout is AuthContext's own logout — the same function the sidebar's
  // Sign Out calls. It writes the audit entry, ends the Supabase session, and
  // clears currentUser; ProtectedRoute then redirects to /login on its own. No
  // token is touched here, no state is cleared here, and the page is not
  // reloaded.
  const { warningRemainingMs, staySignedIn, signOutNow } = useInactivityTimeout(
    { enabled: Boolean(currentUser), onTimeout: logout },
  );
  // Ids this session has already announced. See the effect below for why
  // clearing the queue is not, by itself, enough to guarantee once-only.
  const announcedIds = useRef(new Set());

  // DataContext only ever sets `error` for a genuine problem now — a
  // 401 (session expired / MFA-required) is handled by signing the
  // person out and sending them back to Login, not by landing here (see
  // DataContext.jsx). So what's left really is: the server couldn't be
  // reached at all ('network'), or it was reached and returned a real
  // problem ('server', 'unknown', etc.) — those get different wording so
  // this banner is never misleading about which one happened.
  const errorMessage = error
    ? error.type === 'network'
      ? `Could not reach the server: ${error.message}`
      : error.message
    : null;

  // The single place a newly arrived notification becomes something the user
  // can perceive: a pop-up, a short chime, and a pulse along the top edge of
  // the application. All three fire from ONE queue that DataContext fills only
  // with notifications this session has never seen, which is what guarantees a
  // given notification announces itself exactly once — refreshing the page,
  // re-polling, or marking it read cannot replay it.
  //
  // The bell's unread count is deliberately NOT driven from here: it is
  // derived from the notification records themselves, so it stays correct
  // across a refresh whether or not the pop-up was ever shown.
  useEffect(() => {
    if (!newNotifications.length) return;

    // IDEMPOTENCY GUARD, keyed on the notification id.
    //
    // Draining the queue with consumeNewNotifications() is a state update, and
    // a state update is not immediate. Any second run of this effect that
    // happens before it flushes still sees the same items. That is not
    // hypothetical: React Strict Mode (enabled in main.jsx) deliberately
    // mounts, unmounts and remounts every effect in development, so without
    // this guard each notification produced two pop-ups and two chimes on a
    // dev build. A dependency changing mid-batch would do the same in
    // production.
    //
    // Filtering on the id makes a repeat run a no-op rather than a repeat
    // announcement, so "once per notification, per session" holds regardless
    // of how many times the effect body executes. It is an id set rather than
    // a timestamp because two notifications can share a timestamp to the
    // second, and a clock is not an identity.
    const unannounced = newNotifications.filter(
      (n) => !announcedIds.current.has(n.id),
    );

    if (unannounced.length === 0) {
      // Everything in the queue has already been announced — just drain it.
      consumeNewNotifications();
      return;
    }

    unannounced.forEach((n) => {
      announcedIds.current.add(n.id);
      const target = notificationTarget(n);

      // Acting on an arrival does what acting on the same entry in the bell's
      // panel does: mark it read for this user, then go to the record. Built
      // once and given to BOTH the in-app pop-up and the system notification,
      // so clicking either lands in the same place. The rules come from the one
      // shared routing module so the surfaces cannot diverge.
      const act = target
        ? () => {
            markNotificationRead(n.id);
            navigate(
              target.path,
              target.state ? { state: target.state } : undefined,
            );
          }
        : undefined;

      showNotificationToast({
        title: n.title,
        message: n.message,
        type: n.type,
        onClick: act,
      });

      // The system notification, for the case the in-app pop-up cannot reach:
      // the user is in another tab or another application entirely.
      //
      // NOT EVERY NOTIFICATION EARNS ONE. isSystemAlertWorthy is the single
      // definition of which titles may interrupt somebody outside the
      // application — currently 'New Incident' and 'Hotspot Alert', the two
      // that are about something happening in the barangay right now. Every
      // other notification still gets the in-app pop-up above and its entry in
      // the bell; it simply does not raise a desktop alert. The rule lives in
      // utils/browserNotifications so this call site holds no copy of it.
      //
      // Fired unconditionally with respect to focus rather than only when
      // document.hidden. A notification that arrives in the instant before
      // someone switches away would otherwise be the one alert they never see,
      // and the operating system already suppresses or quietly stacks a
      // notification for a window that is in focus — so letting the OS make
      // that call is both simpler and better behaved than guessing at it here.
      //
      // Its OWN duplicate guard is keyed on the notification id and backed by
      // localStorage (see utils/browserNotifications), which is deliberately a
      // stronger guarantee than the in-memory `announcedIds` set above: that set
      // is emptied by a page reload or a remount, whereas a system notification
      // that re-fired on every reload would be genuinely intrusive. Returns
      // false and does nothing when permission has not been granted.
      if (isSystemAlertWorthy(n)) {
        showSystemNotification({
          id: n.id,
          title: n.title,
          message: n.message,
          onClick: act,
        });
      }
    });

    // Once per batch of GENUINELY new notifications, not once per
    // notification — three incidents logged in the same minute should not
    // chime three times.
    playNotificationChime();

    setToplinePulsing(true);
    clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(
      () => setToplinePulsing(false),
      TOPLINE_PULSE_MS,
    );

    consumeNewNotifications();
  }, [
    newNotifications,
    showNotificationToast,
    consumeNewNotifications,
    markNotificationRead,
    navigate,
  ]);

  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  // AUTOPLAY UNLOCK.
  //
  // Browsers start an AudioContext 'suspended' and only allow it to resume
  // during a real user interaction. Signing in is an interaction, but it
  // happens on the Login screen — a different React tree — so by the time this
  // layout mounts the browser may still be waiting for a gesture inside it.
  //
  // These listeners take the FIRST click or keypress anywhere in the
  // application and use it to resume the audio context, after which every
  // subsequent chime is allowed. They are `once`, so they cost one dispatch and
  // then remove themselves; `capture` so a handler that stops propagation
  // cannot swallow the gesture before it gets here.
  //
  // This does not defeat the autoplay policy and does not try to: it satisfies
  // it, at the earliest legitimate moment. If a notification somehow arrives
  // before any interaction, the chime is simply skipped — the pop-up, the bell
  // and the system notification all still carry it.
  useEffect(() => {
    const unlock = () => unlockNotificationAudio();
    const options = { once: true, capture: true };

    window.addEventListener('pointerdown', unlock, options);
    window.addEventListener('keydown', unlock, options);

    return () => {
      window.removeEventListener('pointerdown', unlock, options);
      window.removeEventListener('keydown', unlock, options);
    };
  }, []);

  // Keeps `isMobile` honest for the life of the session — a rotation, a window
  // resize or a devtools viewport change all fire this.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => {
      setIsMobile(e.matches);
      // Leaving mobile width turns the drawer back into a permanent column.
      // The overlay state has no meaning there, and leaving it set would keep
      // the backdrop mounted over a desktop layout.
      if (!e.matches) setMobileOpen(false);
    };
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Escape closes the drawer, the same key that closes every other overlay in
  // the application (see Modal). Bound only while the drawer is actually open
  // so it can never swallow an Escape meant for a dialog on the page behind.
  useEffect(() => {
    if (!isMobile || !mobileOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMobile, mobileOpen]);

  // Focus goes back to the hamburger when the drawer closes, so the keyboard
  // user resumes from the control they opened it with rather than from the top
  // of the document. Deliberately not run on the first render — only on a real
  // open→closed transition — so loading a page at phone width does not steal
  // focus to the menu button.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !mobileOpen) {
      const btn = menuButtonRef.current;
      // isConnected guards the case where the button has been unmounted (a
      // sign-out, say) between the drawer closing and this effect running.
      if (btn && btn.isConnected) btn.focus();
    }
    wasOpen.current = mobileOpen;
  }, [mobileOpen]);

  const handleMenuToggle = () => {
    if (isMobile) {
      setMobileOpen((o) => !o);
    } else {
      setSidebarCollapsed((c) => !c);
    }
  };

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Fixed to the very top of the viewport, 3px tall, and
          pointer-events: none — it cannot cover, block or displace anything,
          which is why it is an overlay rather than a bar inserted into the
          layout. Purely decorative, so it is hidden from assistive technology;
          the pop-up above carries the same information in an aria-live region.
          The element is always present and only its class changes, so the
          document's box model never changes and no layout shift is possible. */}
      <div
        className={`badac-topline ${toplinePulsing ? 'pulsing' : ''}`}
        aria-hidden="true"
      />
      {/* First focusable thing in the document, so the very first Tab press on
          any page offers it. Without it a keyboard user re-traverses the whole
          sidebar — a dozen links plus the account control — on every single
          navigation before reaching the page they just opened. Visually hidden
          until it takes focus (see .skip-link in global.css). */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Sidebar
        open={mobileOpen}
        collapsed={sidebarCollapsed}
        isMobile={isMobile}
        onNavigate={() => setMobileOpen(false)}
      />
      {/* Mobile only, and only while the drawer is open. It is what makes
          tapping away from the drawer close it, which is the gesture people
          expect from an overlay panel and which the drawer previously did not
          answer at all. aria-hidden because it carries no information a screen
          reader needs — Escape and the menu button are the accessible ways to
          dismiss the drawer, and a focusable backdrop would just be one more
          stop with nothing to announce. */}
      {isMobile && mobileOpen && (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <main className="main-content">
        {/* The bell pulses on the same signal as the top-edge line, so the
            two read as one arrival rather than two unrelated events. */}
        <Header
          onMenuToggle={handleMenuToggle}
          menuButtonRef={menuButtonRef}
          bellPulse={toplinePulsing}
        />
        {/* id is the skip link's destination, and tabIndex={-1} is what makes
            it a valid one: without it the browser moves the scroll position
            but leaves focus where it was, so the next Tab continues from the
            skip link and the jump accomplishes nothing for the keyboard. -1
            makes the region programmatically focusable without adding it to
            the tab order. aria-busy tells assistive technology that this
            region's content is still being fetched, which is the same fact the
            visible message below carries. */}
        <div className="content-area" id="main-content" tabIndex={-1} aria-busy={loading}>
          {errorMessage && (
            // role="alert" so a failure that appears after the page has
            // rendered is spoken rather than sitting silently at the top of
            // the screen.
            <div className="login-error" role="alert" style={{ margin: '0 0 16px' }}>
              {errorMessage}
            </div>
          )}
          {loading ? (
            <div
              // The message is the status, so the element that holds it is the
              // live region. polite rather than assertive: the arrival of data
              // is not an emergency and should not cut off whatever is being
              // read.
              role="status"
              aria-live="polite"
              style={{
                padding: '48px',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              Loading dashboard data…
            </div>
          ) : (
            // Keyed on the path so navigating to another module remounts the
            // boundary and clears any error it is currently showing. The
            // boundary sits INSIDE .content-area, so Sidebar and Header are
            // its siblings, not its children — a page that throws cannot take
            // the navigation down with it.
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          )}
        </div>
      </main>
      {/* Closed (and rendering nothing) unless warningRemainingMs is non-null.
          Placed at the shell level rather than inside .content-area so it is
          not remounted by navigation and cannot be taken down by a page's
          ErrorBoundary. */}
      <SessionTimeoutModal
        remainingMs={warningRemainingMs}
        onStaySignedIn={staySignedIn}
        onSignOut={signOutNow}
      />
    </div>
  );
}
