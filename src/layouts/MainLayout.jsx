import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import Header from '../components/layout/Header';
import ErrorBoundary from '../components/ErrorBoundary';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import { playNotificationChime } from '../utils/notificationSound';
import { notificationTarget } from '../utils/notificationRouting';

// How long the top-edge pulse runs. Kept in sync with the
// `badac-topline-pulse` animation in global.css — the class is removed when
// this elapses so the animation can be retriggered by the next notification
// (re-adding a class that is already present does not restart an animation).
const TOPLINE_PULSE_MS = 1200;

export default function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
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
      showNotificationToast({
        title: n.title,
        message: n.message,
        type: n.type,
        // Acting on the pop-up does what acting on the same entry in the bell's
        // panel does: mark it read for this user, then go to the record. The
        // rules come from the one shared module so the two cannot diverge.
        onClick: target
          ? () => {
              markNotificationRead(n.id);
              navigate(
                target.path,
                target.state ? { state: target.state } : undefined,
              );
            }
          : undefined,
      });
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

  const handleMenuToggle = () => {
    if (window.innerWidth <= 768) {
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
      <Sidebar
        open={mobileOpen}
        collapsed={sidebarCollapsed}
        onNavigate={() => setMobileOpen(false)}
      />
      <main className="main-content">
        {/* The bell pulses on the same signal as the top-edge line, so the
            two read as one arrival rather than two unrelated events. */}
        <Header onMenuToggle={handleMenuToggle} bellPulse={toplinePulsing} />
        <div className="content-area">
          {errorMessage && (
            <div className="login-error" style={{ margin: '0 0 16px' }}>
              {errorMessage}
            </div>
          )}
          {loading ? (
            <div
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
    </div>
  );
}
