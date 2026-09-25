import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_EVENTS,
  ACTIVITY_THROTTLE_MS,
  IDLE_BEFORE_WARNING_MS,
  INACTIVITY_TIMEOUT_MS,
  WARNING_TIMEOUT_MS,
  createInactivityTimer,
  formatCountdown,
} from './useInactivityTimeout';

// The suite runs on Vitest's `node` environment, which the config keeps
// deliberately free of jsdom/happy-dom (see vitest.config.js). That is why the
// timeout's behaviour lives in createInactivityTimer() rather than inside the
// React hook: the state machine below is exercised for real — real timers
// (faked), real dispatched events, real listener registration — instead of
// being asserted at the source level. The thin React binding that wraps it is
// covered by the source guards at the bottom of this file.
//
// Node's own EventTarget stands in for `window`. It is a real event target, so
// dispatchEvent really does invoke the handler through the same capture/passive
// options the production code registers with; the wrapper only records which
// types were added and removed so listener cleanup can be asserted.
function createTarget() {
  const bus = new EventTarget();
  const added = [];
  const removed = [];

  return {
    added,
    removed,
    addEventListener(type, handler, options) {
      added.push(type);
      bus.addEventListener(type, handler, options);
    },
    removeEventListener(type, handler, options) {
      removed.push(type);
      bus.removeEventListener(type, handler, options);
    },
    fire(type) {
      bus.dispatchEvent(new Event(type));
    },
  };
}

function createTimer(target) {
  const events = {
    onWarn: vi.fn(),
    onCountdown: vi.fn(),
    onDismiss: vi.fn(),
    onExpire: vi.fn(),
  };
  return { events, timer: createInactivityTimer(events, target) };
}

describe('inactivity timeout policy', () => {
  it('is 60 minutes with a 5-minute warning', () => {
    // Pinned so a shortened value used for manual verification can never be
    // the thing that ships.
    expect(INACTIVITY_TIMEOUT_MS).toBe(60 * 60 * 1000);
    expect(WARNING_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(IDLE_BEFORE_WARNING_MS).toBe(55 * 60 * 1000);
  });
});

describe('createInactivityTimer', () => {
  let target;
  let timer;
  let events;

  beforeEach(() => {
    vi.useFakeTimers();
    target = createTarget();
    ({ timer, events } = createTimer(target));
  });

  afterEach(() => {
    timer.stop();
    vi.useRealTimers();
  });

  it('starts the inactivity window for an authenticated session', () => {
    timer.start();

    expect(timer.isRunning()).toBe(true);
    expect(target.added).toEqual([...ACTIVITY_EVENTS]);
  });

  it('does not run until it is started', () => {
    // The unauthenticated case: the hook never starts the timer, so an hour
    // passing must produce nothing at all.
    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS * 2);

    expect(timer.isRunning()).toBe(false);
    expect(target.added).toEqual([]);
    expect(events.onWarn).not.toHaveBeenCalled();
    expect(events.onExpire).not.toHaveBeenCalled();
  });

  it('shows the warning at exactly 55 minutes, and not before', () => {
    timer.start();

    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS - 1);
    expect(events.onWarn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(events.onWarn).toHaveBeenCalledTimes(1);
    // The warning opens on a full five minutes, never a partial one.
    expect(events.onWarn).toHaveBeenCalledWith(WARNING_TIMEOUT_MS);
    expect(timer.isWarning()).toBe(true);
  });

  it('signs out at exactly 60 minutes of inactivity', () => {
    timer.start();

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1);
    expect(events.onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(events.onExpire).toHaveBeenCalledTimes(1);
    // Expiry stops everything before signing out, so nothing can fire against
    // the session that just ended.
    expect(timer.isRunning()).toBe(false);
    expect(target.removed).toEqual([...ACTIVITY_EVENTS]);

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);
    expect(events.onExpire).toHaveBeenCalledTimes(1);
  });

  it.each(ACTIVITY_EVENTS)('resets the timer on %s', (type) => {
    timer.start();

    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS - 1000);
    target.fire(type);

    // The window restarted, so the original deadline passes with nothing shown.
    vi.advanceTimersByTime(1000);
    expect(events.onWarn).not.toHaveBeenCalled();

    // ...and the warning arrives 55 minutes after the interaction instead.
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS - 1000);
    expect(events.onWarn).toHaveBeenCalledTimes(1);
  });

  it('throttles resets to one per second', () => {
    timer.start();

    // Inside the throttle window that start() opened, so this is ignored and
    // the deadline does not move.
    vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS - 1);
    target.fire('scroll');

    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS - (ACTIVITY_THROTTLE_MS - 1));
    expect(events.onWarn).toHaveBeenCalledTimes(1);
  });

  it('does not create competing timers when activity floods in', () => {
    timer.start();

    // A drag or a scroll gesture: hundreds of events, spread past the throttle
    // window so plenty of them really do reset the timer.
    for (let i = 0; i < 200; i += 1) {
      vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS);
      target.fire('pointerdown');
    }

    // Still one listener per event type, and still one deadline.
    expect(target.added).toEqual([...ACTIVITY_EVENTS]);

    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS);
    expect(events.onWarn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WARNING_TIMEOUT_MS);
    expect(events.onExpire).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent', () => {
    timer.start();
    timer.start();
    timer.start();

    expect(target.added).toEqual([...ACTIVITY_EVENTS]);

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);
    expect(events.onWarn).toHaveBeenCalledTimes(1);
    expect(events.onExpire).toHaveBeenCalledTimes(1);
  });

  it('counts down once a second while the warning is visible', () => {
    timer.start();
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS);
    events.onCountdown.mockClear();

    vi.advanceTimersByTime(1000);
    expect(events.onCountdown).toHaveBeenLastCalledWith(4 * 60 * 1000 + 59000);

    vi.advanceTimersByTime(27000);
    expect(events.onCountdown).toHaveBeenLastCalledWith(4 * 60 * 1000 + 32000);
    expect(formatCountdown(events.onCountdown.mock.lastCall[0])).toBe('4:32');

    // 4:59 down to 4:32 is 28 ticks, one per second — no more, no less.
    expect(events.onCountdown).toHaveBeenCalledTimes(28);
  });

  it('emits no countdown ticks before the warning', () => {
    timer.start();

    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS - 1);

    // Nothing updates for the first 55 minutes, which is what keeps the
    // ordinary case free of re-renders.
    expect(events.onCountdown).not.toHaveBeenCalled();
  });

  it('reset() dismisses the warning and restores the full hour', () => {
    // "Stay Signed In".
    timer.start();
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS + 90000); // 1:30 into the warning

    timer.reset();

    expect(events.onDismiss).toHaveBeenCalledTimes(1);
    expect(timer.isWarning()).toBe(false);
    // The countdown interval is gone with it.
    events.onCountdown.mockClear();
    vi.advanceTimersByTime(10000);
    expect(events.onCountdown).not.toHaveBeenCalled();

    // The remaining 3:30 of the old warning passes without a sign-out...
    vi.advanceTimersByTime(WARNING_TIMEOUT_MS);
    expect(events.onExpire).not.toHaveBeenCalled();

    // ...and the next warning is a fresh 55 minutes away.
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS - WARNING_TIMEOUT_MS - 10000);
    expect(events.onWarn).toHaveBeenCalledTimes(2);
  });

  it('lets genuine activity during the warning keep the session', () => {
    timer.start();
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS + 4 * 60 * 1000); // 4:00 in

    // Not "Stay Signed In" — just somebody carrying on working. The remaining
    // minute must not sign them out from under what they are doing.
    target.fire('keydown');

    expect(events.onDismiss).toHaveBeenCalledTimes(1);
    expect(timer.isWarning()).toBe(false);

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1);
    expect(events.onExpire).not.toHaveBeenCalled();
  });

  it('bypasses the throttle for activity during the warning', () => {
    timer.start();
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS);

    // Two interactions inside one throttle window, the first of which lands in
    // the same millisecond the warning opened. Neither may be dropped.
    target.fire('pointerdown');
    expect(events.onDismiss).toHaveBeenCalledTimes(1);
    expect(timer.isWarning()).toBe(false);
  });

  it('stop() cancels a pending sign-out and removes every listener', () => {
    // Both the "Sign Out" button and the hook's cleanup on an auth-state
    // change take this path.
    timer.start();
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS + 60000);

    timer.stop();

    expect(timer.isRunning()).toBe(false);
    expect(timer.isWarning()).toBe(false);
    expect(target.removed).toEqual([...ACTIVITY_EVENTS]);
    expect(target.removed).toHaveLength(target.added.length);

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS * 2);
    expect(events.onExpire).not.toHaveBeenCalled();
    expect(events.onCountdown).toHaveBeenCalledTimes(60);
  });

  it('ignores activity after it has been stopped', () => {
    timer.start();
    timer.stop();

    target.fire('keydown');
    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);

    expect(events.onWarn).not.toHaveBeenCalled();
    expect(events.onExpire).not.toHaveBeenCalled();
  });

  it('keeps the countdown honest across a suspended tab', () => {
    // A background tab has its intervals throttled, so ticks are lost. The
    // countdown is driven off a fixed deadline, so the next tick to run
    // reports the real time left rather than one second less than the last.
    timer.start();
    vi.advanceTimersByTime(IDLE_BEFORE_WARNING_MS);

    vi.advanceTimersByTime(WARNING_TIMEOUT_MS - 1000);
    expect(events.onCountdown).toHaveBeenLastCalledWith(1000);

    vi.advanceTimersByTime(1000);
    expect(events.onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('formatCountdown', () => {
  it('renders m:ss', () => {
    expect(formatCountdown(5 * 60 * 1000)).toBe('5:00');
    expect(formatCountdown(4 * 60 * 1000 + 32000)).toBe('4:32');
    expect(formatCountdown(9000)).toBe('0:09');
    expect(formatCountdown(1)).toBe('0:01');
  });

  it('never renders a negative or blank value', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5000)).toBe('0:00');
  });
});

// ---------------------------------------------------------------------------
// Source guards for the React binding and its integration.
//
// These are structural, not behavioural: with no DOM in this environment the
// hook cannot be rendered, so what is pinned instead is the small number of
// wiring decisions that no unit test could catch and that would silently
// defeat the feature — a second mount point, a persisted timestamp, a state
// update outside the warning. The behavioural proof for those is the manual
// browser pass.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

// Comments are stripped before any of the "must not contain" guards run.
// These files explain at length WHY they do not touch sessionStorage or
// Supabase, and a guard that matched its own rationale would be unfalsifiable
// — it would fail on the documentation and pass the moment someone deleted it.
function codeOf(...segments) {
  return readFileSync(join(srcRoot, ...segments), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

const hookCode = codeOf('hooks', 'useInactivityTimeout.js');
const layoutCode = codeOf('layouts', 'MainLayout.jsx');
const modalCode = codeOf('components', 'auth', 'SessionTimeoutModal.jsx');

/** Every .js/.jsx file under src/, so "who imports this" can be answered. */
function sourceFiles(dir = srcRoot) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('inactivity timeout wiring', () => {
  it('mounts in the authenticated layout, tied to the current user', () => {
    expect(layoutCode).toMatch(/useInactivityTimeout\(/);
    expect(layoutCode).toMatch(/enabled:\s*Boolean\(currentUser\)/);
    // The existing AuthContext sign-out, not a new one.
    expect(layoutCode).toMatch(/onTimeout:\s*logout/);
  });

  it('is mounted in exactly one place', () => {
    // A per-page copy would mean competing timers for one rendered
    // application, and a page that forgot it would have no timeout at all.
    const relative = (file) =>
      file.slice(srcRoot.length + 1).replace(/\\/g, '/');
    const candidates = sourceFiles().filter(
      (file) => !file.endsWith('useInactivityTimeout.test.js'),
    );

    // Who references the module at all: its own definition, the modal (which
    // reads the policy constants so its wording cannot drift), and the layout.
    const referencing = candidates
      .filter((file) => /\buseInactivityTimeout\b/.test(readFileSync(file, 'utf8')))
      .map(relative);
    expect(referencing.sort()).toEqual([
      'components/auth/SessionTimeoutModal.jsx',
      'hooks/useInactivityTimeout.js',
      'layouts/MainLayout.jsx',
    ]);

    // Who actually MOUNTS a timer: the authenticated layout, and only it.
    const callers = candidates
      .filter((file) => !file.endsWith('useInactivityTimeout.js'))
      .filter((file) =>
        /useInactivityTimeout\(\s*\{/.test(readFileSync(file, 'utf8')),
      )
      .map(relative);
    expect(callers).toEqual(['layouts/MainLayout.jsx']);
  });

  it('introduces no authentication or token handling of its own', () => {
    const combined = hookCode + modalCode;
    expect(combined).not.toMatch(/supabase/i);
    expect(combined).not.toMatch(/access_token|refreshSession|setSession/);
    expect(combined).not.toMatch(/\bfetch\(|authService|apiClient/);
  });

  it('persists nothing about the user or their activity', () => {
    const combined = hookCode + modalCode + layoutCode;
    // Not in browser storage, and not in a request. The layout is included
    // because it holds the call site, so an added persistence step there is
    // caught too.
    expect(combined).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(combined).not.toMatch(/geolocation|coords|latitude|longitude/);
  });

  it('re-renders only while the warning is on screen', () => {
    // A setState reachable from ordinary activity would put a state update on
    // every interaction for an hour.
    const stateCalls = hookCode.match(/setWarningRemainingMs/g) ?? [];
    expect(stateCalls.length).toBeGreaterThan(0);
    expect(hookCode).not.toMatch(/onActivity[\s\S]{0,200}setWarningRemaining/);
    // mousemove is expressly excluded from the activity list.
    expect(hookCode).not.toMatch(/'mousemove'/);
  });

  it('gives the warning proper dialog semantics through the shared Modal', () => {
    // role="dialog", aria-modal and aria-labelledby all come from ui/Modal, so
    // what matters is that this component uses it rather than hand-rolling a
    // dialog without them.
    expect(modalCode).toMatch(/from '\.\.\/ui\/Modal'/);
    expect(modalCode).toMatch(/title="Session Expiring"/);
    expect(modalCode).toMatch(/Stay Signed In/);
    expect(modalCode).toMatch(/Sign Out/);
    // Dismissing the dialog by any means other than Sign Out keeps the
    // session; it must never fall through to a silent expiry.
    expect(modalCode).toMatch(/onClose=\{onStaySignedIn\}/);
  });
});
