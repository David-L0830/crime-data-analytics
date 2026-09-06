import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasAnnounced,
  isSystemAlertWorthy,
  notificationPermission,
  notificationsSupported,
  rememberAnnounced,
  requestNotificationPermission,
  resetAnnouncedNotifications,
  showSystemNotification,
} from './browserNotifications';

// The suite runs on Vitest's `node` environment, which the config keeps
// deliberately free of jsdom/happy-dom (see vitest.config.js). The module under
// test touches exactly two browser globals — window.Notification and
// window.localStorage — so those two are stubbed here rather than pulling a
// whole DOM implementation into the dependency tree for them.
//
// The localStorage stub is a real read/write store, not a spy: these tests
// assert what SURVIVES a reload, which needs a store that actually retains.
function createLocalStorage() {
  const data = new Map();

  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

function installWindow() {
  globalThis.window = { localStorage: createLocalStorage() };
  return globalThis.window;
}

// A stand-in for the browser's Notification constructor. Records every
// construction so the tests can assert how MANY notifications were shown, which
// is the whole question duplicate prevention answers.
function installNotification({ permission = 'default', requestResult } = {}) {
  const shown = [];

  const Ctor = vi.fn(function NotificationMock(title, options) {
    shown.push({ title, options });
    this.close = vi.fn();
  });

  Ctor.permission = permission;
  Ctor.requestPermission = vi.fn(async () => {
    Ctor.permission = requestResult ?? permission;
    return Ctor.permission;
  });

  window.Notification = Ctor;

  return { Ctor, shown };
}

describe('browser notification permission', () => {
  beforeEach(() => {
    installWindow();
    resetAnnouncedNotifications();
  });

  afterEach(() => {
    resetAnnouncedNotifications();
    delete globalThis.window;
  });

  it('reports "unsupported" when the browser has no Notification API', () => {
    // window exists (the page is running) but the API is absent — the case in
    // some embedded webviews.
    delete window.Notification;

    expect(notificationsSupported()).toBe(false);
    // Part of the same enum as the three real states, so the UI cannot offer a
    // "turn on notifications" button in a browser that has none.
    expect(notificationPermission()).toBe('unsupported');
  });

  it('reports each of the three real permission states', () => {
    installNotification({ permission: 'default' });
    expect(notificationPermission()).toBe('default');

    installNotification({ permission: 'granted' });
    expect(notificationPermission()).toBe('granted');

    installNotification({ permission: 'denied' });
    expect(notificationPermission()).toBe('denied');
  });

  it('asks the browser exactly once when the state is default', async () => {
    const { Ctor } = installNotification({
      permission: 'default',
      requestResult: 'granted',
    });

    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(Ctor.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('does not re-ask once permission has been granted', async () => {
    const { Ctor } = installNotification({ permission: 'granted' });

    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(Ctor.requestPermission).not.toHaveBeenCalled();
  });

  it('does not re-ask once permission has been denied', async () => {
    // "Do not repeatedly ask" matters most here: a denied site is never
    // re-prompted by the browser, so calling requestPermission again would be a
    // silent no-op that looks like a broken button.
    const { Ctor } = installNotification({ permission: 'denied' });

    await expect(requestNotificationPermission()).resolves.toBe('denied');
    expect(Ctor.requestPermission).not.toHaveBeenCalled();
  });
});

describe('system notifications', () => {
  beforeEach(() => {
    installWindow();
    resetAnnouncedNotifications();
  });

  afterEach(() => {
    resetAnnouncedNotifications();
    delete globalThis.window;
  });

  it('shows a notification carrying the title, message and app icon', () => {
    const { shown } = installNotification({ permission: 'granted' });

    expect(
      showSystemNotification({
        id: '1',
        title: 'New Incident',
        message: 'Case CN-2026-0001 was logged in Sitio 4.',
      }),
    ).toBe(true);

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('New Incident');
    expect(shown[0].options.body).toBe('Case CN-2026-0001 was logged in Sitio 4.');
    expect(shown[0].options.icon).toBe('/favicon.png');
    // The tag is a second line of defence: the browser itself collapses
    // same-tag notifications rather than stacking duplicates.
    expect(shown[0].options.tag).toBe('badac-1');
  });

  it('shows nothing when permission has not been granted', () => {
    const { shown } = installNotification({ permission: 'default' });

    expect(
      showSystemNotification({ id: '1', title: 'New Incident', message: 'x' }),
    ).toBe(false);
    expect(shown).toHaveLength(0);
  });

  it('shows nothing when permission is denied', () => {
    const { shown } = installNotification({ permission: 'denied' });

    expect(
      showSystemNotification({ id: '1', title: 'New Incident', message: 'x' }),
    ).toBe(false);
    expect(shown).toHaveLength(0);
  });

  it('shows nothing, and does not throw, when the API is absent', () => {
    delete window.Notification;

    expect(() =>
      showSystemNotification({ id: '1', title: 'New Incident', message: 'x' }),
    ).not.toThrow();
    expect(
      showSystemNotification({ id: '1', title: 'New Incident', message: 'x' }),
    ).toBe(false);
  });

  it('never shows the same notification twice', () => {
    // The core requirement: a re-render, a re-poll or a route change must not
    // re-announce a notification that has already been announced.
    const { shown } = installNotification({ permission: 'granted' });

    const payload = { id: '123', title: 'New Incident', message: 'Sitio 4' };

    expect(showSystemNotification(payload)).toBe(true);
    expect(showSystemNotification(payload)).toBe(false);
    expect(showSystemNotification(payload)).toBe(false);

    expect(shown).toHaveLength(1);
  });

  it('remembers announced ids across a page reload', () => {
    // localStorage rather than an in-memory array, deliberately: an in-memory
    // guard is emptied by a reload, and a system notification that re-fired on
    // every reload would be genuinely intrusive.
    installNotification({ permission: 'granted' });

    showSystemNotification({ id: '77', title: 'New Incident', message: 'x' });

    expect(window.localStorage.getItem('badac.announcedNotificationIds')).toContain(
      '77',
    );
    expect(hasAnnounced('77')).toBe(true);
  });

  it('stores only ids, never notification content', () => {
    // A crime notification's message names a case and a sitio. None of it has
    // any reason to persist in browser storage.
    installNotification({ permission: 'granted' });

    showSystemNotification({
      id: '88',
      title: 'New Incident',
      message: 'Case CN-2026-0009 was logged in Sitio 4.',
    });

    const stored = window.localStorage.getItem('badac.announcedNotificationIds');
    expect(stored).not.toContain('CN-2026-0009');
    expect(stored).not.toContain('Sitio 4');
    expect(stored).not.toContain('New Incident');
  });

  it('treats different ids as different notifications', () => {
    const { shown } = installNotification({ permission: 'granted' });

    showSystemNotification({ id: '1', title: 'New Incident', message: 'a' });
    showSystemNotification({ id: '2', title: 'New Incident', message: 'b' });

    expect(shown).toHaveLength(2);
  });

  it('routes a click through the supplied handler', () => {
    const { shown } = installNotification({ permission: 'granted' });
    const onClick = vi.fn();

    showSystemNotification({ id: '5', title: 't', message: 'm', onClick });

    // The mock records constructions; the instance is what carries onclick, so
    // reach it the way the browser would.
    const instance = window.Notification.mock.instances[0];
    instance.onclick();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(shown).toHaveLength(1);
  });

  it('does not retry a notification whose construction threw', () => {
    // A platform that refuses to construct a Notification (Chrome on Android
    // requires a Service Worker) will refuse every time. Recording the id
    // before the attempt is what stops every subsequent poll from retrying it.
    window.Notification = vi.fn(() => {
      throw new Error('requires a service worker');
    });
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = vi.fn();

    expect(
      showSystemNotification({ id: '9', title: 't', message: 'm' }),
    ).toBe(false);
    expect(hasAnnounced('9')).toBe(true);
    expect(window.Notification).toHaveBeenCalledTimes(1);

    showSystemNotification({ id: '9', title: 't', message: 'm' });
    expect(window.Notification).toHaveBeenCalledTimes(1);
  });

  it('ignores a missing id rather than treating every one of them as the same notification', () => {
    expect(hasAnnounced(undefined)).toBe(false);
    expect(hasAnnounced(null)).toBe(false);
    expect(() => rememberAnnounced(undefined)).not.toThrow();
  });
});

describe('which notifications earn an operating-system alert', () => {
  // THE ALLOW-LIST. These two are time-critical and are about something
  // happening in the barangay right now, so they may interrupt somebody who is
  // in another application. Everything else keeps its in-app pop-up and its
  // bell entry and is read when the bell is next opened.
  it('lets a New Incident interrupt the user', () => {
    expect(isSystemAlertWorthy({ title: 'New Incident' })).toBe(true);
  });

  it('lets a Hotspot Alert interrupt the user', () => {
    expect(isSystemAlertWorthy({ title: 'Hotspot Alert' })).toBe(true);
  });

  it('keeps Case Resolved in the application only', () => {
    expect(isSystemAlertWorthy({ title: 'Case Resolved' })).toBe(false);
  });

  it('keeps New Criminal Record in the application only', () => {
    expect(isSystemAlertWorthy({ title: 'New Criminal Record' })).toBe(false);
  });

  it('keeps New Victim Record in the application only', () => {
    expect(isSystemAlertWorthy({ title: 'New Victim Record' })).toBe(false);
  });

  it('keeps the remaining seeded titles in the application only', () => {
    expect(isSystemAlertWorthy({ title: 'Sync Complete' })).toBe(false);
    expect(isSystemAlertWorthy({ title: 'Overdue Case' })).toBe(false);
    expect(isSystemAlertWorthy({ title: 'Backup Reminder' })).toBe(false);
  });

  it('is an allow-list, so an unrecognised title raises nothing', () => {
    // A title added to the product later must stay silent until it is
    // deliberately listed. The cost of a missed desktop alert is that the user
    // sees the item in the bell a moment later; the cost of an unwanted one is
    // a desktop interruption during unrelated work, repeated every time.
    expect(isSystemAlertWorthy({ title: 'Some Future Notification' })).toBe(
      false,
    );
  });

  it('matches the title exactly, not loosely', () => {
    expect(isSystemAlertWorthy({ title: 'new incident' })).toBe(false);
    expect(isSystemAlertWorthy({ title: 'New Incident Report' })).toBe(false);
  });

  it('does not throw on a missing or malformed notification', () => {
    expect(isSystemAlertWorthy(undefined)).toBe(false);
    expect(isSystemAlertWorthy(null)).toBe(false);
    expect(isSystemAlertWorthy({})).toBe(false);
  });
});
