import { useCallback, useEffect, useRef, useState } from 'react';

// AUTHENTICATED-SESSION INACTIVITY TIMEOUT
//
// Sixty minutes without user interaction ends the session; the last five of
// those minutes are spent showing a warning the person can dismiss.
//
//   0:00 – 54:59  nothing on screen, nothing re-rendering
//   55:00         SessionTimeoutModal appears with a 5:00 countdown
//   55:00 – 59:59 countdown ticks once a second
//   60:00         the existing AuthContext logout() runs
//
// WHAT THIS IS MEASURING is inactivity, not session age. Every reset restarts
// the whole sixty minutes, so somebody working continuously is never signed
// out, and somebody who walks away is signed out an hour later regardless of
// how long they had already been signed in.
//
// NOTHING HERE IS PERSISTED OR TRANSMITTED. No timestamp reaches Supabase,
// PostgreSQL, audit_logs, Laravel, localStorage, sessionStorage or a cookie;
// no request is made to record activity. The only durable effect of the whole
// mechanism is the sign-out at the end, which goes through the application's
// existing Supabase Auth logout and nothing else. What is observed is *that*
// an interaction happened, never what it was — no coordinates, no key values,
// no history of which pages were touched. Every value below lives in a
// closure that the browser discards with the tab.
//
// MULTI-TAB is deliberately not synchronised, because the session it guards is
// already per-tab: supabaseClient.js persists the Supabase session in
// sessionStorage, so each tab holds its own and a second tab is a second
// sign-in, not a shared one. Cross-tab coordination would also require a
// shared store, which the privacy rule above forbids. What *is* guaranteed is
// one timer per rendered application: the hook is mounted once, in
// MainLayout — the single authenticated layout every module renders inside.

export const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
export const WARNING_TIMEOUT_MS = 5 * 60 * 1000;

// How long the session may sit idle before the warning appears: 55 minutes.
// Derived rather than written out again so the two published values above stay
// the only numbers that define the policy.
export const IDLE_BEFORE_WARNING_MS = INACTIVITY_TIMEOUT_MS - WARNING_TIMEOUT_MS;

// One reset per second at most. Without this, a scroll or a pointer drag would
// tear down and rebuild the idle timer for every frame's worth of events; with
// it, the cost of an active user is one comparison per event and one timer
// swap per second. The imprecision it buys is bounded at one second out of
// 3600, which no part of this policy can notice.
export const ACTIVITY_THROTTLE_MS = 1000;

export const COUNTDOWN_INTERVAL_MS = 1000;

// The five interactions that count as "a person is using this application".
//
// Deliberately short, and deliberately all user-initiated. `mousemove` is NOT
// here: it fires continuously, it fires for a cursor nudged by a passing hand,
// and a pointer that never presses anything is not a person working. Nothing
// the machine does on its own can appear in this list either — an arriving
// browser notification and a `navigator.geolocation` callback are not events
// on this target and cannot reset anything, which is the point: clicking "My
// Location" resets the timer because the *click* is in this list, not because
// geolocation then ran.
//
// `pointerdown` already covers mouse, touch and pen in every browser this
// application supports, so `mousedown` and `touchstart` are duplicates of it
// there. They are kept for the older engines that dispatch only the legacy
// pair, and cost nothing: the throttle above collapses the duplicate dispatch
// into a single reset.
export const ACTIVITY_EVENTS = [
  'pointerdown',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

// capture:true because `scroll` does not bubble — a scroll inside the incident
// table or the map pane would otherwise never reach a window-level listener.
// passive:true promises the browser these handlers never call
// preventDefault(), which keeps them off the critical path for scrolling and
// touch.
const LISTENER_OPTIONS = { capture: true, passive: true };

// "4:32". Exported for the modal, which must not re-derive it.
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The timeout state machine, with no React in it.
 *
 * Kept separate from the hook so the behaviour that actually matters — when
 * the warning appears, when the sign-out fires, what an interaction does to
 * both — can be tested against real timers and real dispatched events. The
 * Vitest suite runs on the `node` environment with no DOM (see
 * vitest.config.js), so a hook could not otherwise be exercised at all.
 *
 * @param handlers.onWarn      the warning becomes visible; receives ms left
 * @param handlers.onCountdown one countdown tick; receives ms left
 * @param handlers.onDismiss   the warning goes away without signing out
 * @param handlers.onExpire    the inactivity limit was reached
 * @param target               EventTarget to listen on; defaults to `window`
 */
export function createInactivityTimer(handlers = {}, target) {
  const { onWarn, onCountdown, onDismiss, onExpire } = handlers;
  const listenTarget =
    target ?? (typeof window === 'undefined' ? null : window);

  let idleTimer = null; // fires once, at 55 minutes
  let countdown = null; // ticks every second, only while warning
  let deadline = 0; // epoch ms of the sign-out
  let lastReset = 0; // throttle stamp
  let warning = false;
  let running = false;

  function clearTimers() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (countdown !== null) {
      clearInterval(countdown);
      countdown = null;
    }
  }

  function expire() {
    // Order matters: stop() first, so the timers and listeners are already
    // gone before logout runs. A sign-out that re-renders the tree must not be
    // able to land back in a handler belonging to the session it just ended.
    stop();
    onExpire?.();
  }

  function tick() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    onCountdown?.(remaining);
  }

  // The countdown is driven off a fixed deadline rather than by subtracting a
  // second per tick, so a tab that was throttled or suspended while the
  // warning was up resumes with the correct time left instead of the amount it
  // would have had if every tick had run.
  function enterWarning() {
    idleTimer = null;
    warning = true;
    deadline = Date.now() + WARNING_TIMEOUT_MS;
    countdown = setInterval(tick, COUNTDOWN_INTERVAL_MS);
    onWarn?.(WARNING_TIMEOUT_MS);
  }

  /** Restart the full sixty minutes, closing the warning if it is showing. */
  function reset() {
    if (!running) return;
    clearTimers();
    if (warning) {
      warning = false;
      onDismiss?.();
    }
    lastReset = Date.now();
    idleTimer = setTimeout(enterWarning, IDLE_BEFORE_WARNING_MS);
  }

  function onActivity() {
    if (!running) return;
    // The throttle is bypassed while the warning is up. Somebody typing a
    // reply to the dialog must never be a fraction of a second too early to
    // count, and at that point there is exactly one reset to perform anyway.
    if (!warning && Date.now() - lastReset < ACTIVITY_THROTTLE_MS) return;
    reset();
  }

  function start() {
    // Idempotent by design. Two starts must not leave two idle timers racing
    // to show two warnings for one session.
    if (running) return;
    running = true;
    warning = false;
    ACTIVITY_EVENTS.forEach((type) =>
      listenTarget?.addEventListener(type, onActivity, LISTENER_OPTIONS),
    );
    lastReset = Date.now();
    idleTimer = setTimeout(enterWarning, IDLE_BEFORE_WARNING_MS);
  }

  function stop() {
    if (!running) return;
    running = false;
    warning = false;
    clearTimers();
    ACTIVITY_EVENTS.forEach((type) =>
      listenTarget?.removeEventListener(type, onActivity, LISTENER_OPTIONS),
    );
  }

  return {
    start,
    stop,
    reset,
    isRunning: () => running,
    isWarning: () => warning,
  };
}

/**
 * Mount the inactivity timeout for an authenticated session.
 *
 * @param enabled    false tears everything down — pass Boolean(currentUser) so
 *                   the timer cannot outlive the session it belongs to
 * @param onTimeout  called on expiry and on an explicit Sign Out; this is the
 *                   application's existing logout, never a new one
 * @returns warningRemainingMs — null when no warning is showing, which is also
 *          what tells the modal whether to be open
 */
export function useInactivityTimeout({ enabled, onTimeout }) {
  const [warningRemainingMs, setWarningRemainingMs] = useState(null);
  const timerRef = useRef(null);

  // Held in a ref so a caller passing a fresh closure each render cannot
  // restart the timer. Only `enabled` may do that.
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!enabled) {
      setWarningRemainingMs(null);
      return undefined;
    }

    const timer = createInactivityTimer({
      // These are the ONLY state updates the hook performs, and both happen
      // exclusively while the warning is on screen. For the first fifty-five
      // minutes the hook causes no re-render at all: activity is handled
      // entirely inside the closure above.
      onWarn: setWarningRemainingMs,
      onCountdown: setWarningRemainingMs,
      onDismiss: () => setWarningRemainingMs(null),
      onExpire: () => {
        setWarningRemainingMs(null);
        onTimeoutRef.current?.();
      },
    });

    timerRef.current = timer;
    timer.start();

    return () => {
      timer.stop();
      timerRef.current = null;
      setWarningRemainingMs(null);
    };
  }, [enabled]);

  // "Stay Signed In". Purely local: no request is made, and Supabase's own
  // token refresh is left exactly as it is.
  const staySignedIn = useCallback(() => {
    timerRef.current?.reset();
  }, []);

  // "Sign Out" from inside the warning — the same ending as the timeout,
  // without waiting for it.
  const signOutNow = useCallback(() => {
    timerRef.current?.stop();
    setWarningRemainingMs(null);
    onTimeoutRef.current?.();
  }, []);

  return { warningRemainingMs, staySignedIn, signOutNow };
}
