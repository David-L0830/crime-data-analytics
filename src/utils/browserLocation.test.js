import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocationError,
  geolocationSupported,
  locationPermission,
  requestCurrentPosition,
  watchLocationPermission,
} from './browserLocation';

// The suite runs on Vitest's `node` environment, which the config keeps
// deliberately free of jsdom/happy-dom (see vitest.config.js). The module
// under test touches exactly one browser global — navigator, for its
// `geolocation` and `permissions` members — so that one is stubbed here rather
// than pulling a whole DOM implementation into the dependency tree for it.
//
// vi.stubGlobal rather than a plain assignment: Node defines its own
// globalThis.navigator, and on some versions it is a getter-only property that
// a direct assignment cannot replace. vi.unstubAllGlobals in afterEach puts
// the real one back, so no test can leak a fake navigator into another file.

/**
 * Builds a navigator with the pieces each test cares about.
 *
 * Passing `geolocation: null` models a browser with no Geolocation API, and
 * `permissions: null` a browser with no Permissions API — the two support
 * gaps that behave differently and are asserted separately below.
 */
function installNavigator({ geolocation, permissions } = {}) {
  const nav = {};
  if (geolocation !== null) nav.geolocation = geolocation ?? { getCurrentPosition: vi.fn() };
  if (permissions !== null) nav.permissions = permissions ?? { query: vi.fn() };
  vi.stubGlobal('navigator', nav);
  return nav;
}

/** A permissions object whose query resolves to the given state. */
function permissionsReturning(state) {
  return { query: vi.fn(async () => ({ state })) };
}

/** A geolocation whose getCurrentPosition calls back with a position. */
function geolocationResolving(coords) {
  return {
    getCurrentPosition: vi.fn((success) => success({ coords })),
  };
}

/** A geolocation whose getCurrentPosition calls back with an error code. */
function geolocationFailing(code) {
  return {
    getCurrentPosition: vi.fn((_success, failure) => failure({ code })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geolocation support detection', () => {
  it('reports supported when the browser has getCurrentPosition', () => {
    installNavigator();
    expect(geolocationSupported()).toBe(true);
  });

  it('reports unsupported when the browser has no Geolocation API', () => {
    installNavigator({ geolocation: null });
    expect(geolocationSupported()).toBe(false);
  });

  it('reports unsupported when geolocation exists but cannot be called', () => {
    // Some embedded webviews expose the property as a stub without the method.
    // Treating "the object is there" as support would produce a TypeError at
    // the moment the user clicks, rather than a disabled control.
    installNavigator({ geolocation: {} });
    expect(geolocationSupported()).toBe(false);
  });
});

describe('location permission state', () => {
  it('reports "unsupported" when there is no Geolocation API', async () => {
    installNavigator({ geolocation: null });
    await expect(locationPermission()).resolves.toBe('unsupported');
  });

  it('reports "prompt" when the permission has not been decided', async () => {
    installNavigator({ permissions: permissionsReturning('prompt') });
    await expect(locationPermission()).resolves.toBe('prompt');
  });

  it('reports "granted" when the browser has stored an allow', async () => {
    installNavigator({ permissions: permissionsReturning('granted') });
    await expect(locationPermission()).resolves.toBe('granted');
  });

  it('reports "denied" when the browser has stored a block', async () => {
    installNavigator({ permissions: permissionsReturning('denied') });
    await expect(locationPermission()).resolves.toBe('denied');
  });

  it('falls back to "prompt" when the Permissions API is absent', async () => {
    // Older WebKit. The honest answer is "the browser has not told us", and
    // 'prompt' is the state whose UI finds out by asking — claiming 'granted'
    // would show a status that might be false, and 'denied' would hide a
    // feature that works.
    installNavigator({ permissions: null });
    await expect(locationPermission()).resolves.toBe('prompt');
  });

  it('falls back to "prompt" when querying geolocation throws', async () => {
    // Safari has historically thrown a TypeError on this specific permission
    // name. A rejected query must not become an unhandled rejection or a
    // fabricated state.
    installNavigator({
      permissions: {
        query: vi.fn(async () => {
          throw new TypeError('unsupported permission name');
        }),
      },
    });
    await expect(locationPermission()).resolves.toBe('prompt');
  });

  it('normalises an unrecognised state to "prompt"', async () => {
    installNavigator({ permissions: permissionsReturning('something-else') });
    await expect(locationPermission()).resolves.toBe('prompt');
  });

  it('never prompts merely to read the state', async () => {
    // The whole reason locationPermission is separate from
    // requestCurrentPosition: the Permissions UI must be able to display a
    // status without the act of displaying it asking the user anything.
    const geolocation = geolocationResolving({ latitude: 1, longitude: 2 });
    installNavigator({
      geolocation,
      permissions: permissionsReturning('prompt'),
    });

    await locationPermission();

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe('obtaining a position', () => {
  it('resolves with latitude, longitude and accuracy on success', async () => {
    installNavigator({
      geolocation: geolocationResolving({
        latitude: 14.7563,
        longitude: 121.0345,
        accuracy: 25,
      }),
    });

    await expect(requestCurrentPosition()).resolves.toEqual({
      latitude: 14.7563,
      longitude: 121.0345,
      accuracy: 25,
    });
  });

  it('returns only the three fields it needs, never the whole position', async () => {
    // GeolocationPosition also carries altitude, heading and speed. Passing
    // them on would hand callers data they have no reason to hold.
    installNavigator({
      geolocation: geolocationResolving({
        latitude: 14.75,
        longitude: 121.03,
        accuracy: 10,
        altitude: 40,
        heading: 90,
        speed: 1.5,
      }),
    });

    const position = await requestCurrentPosition();

    expect(Object.keys(position).sort()).toEqual([
      'accuracy',
      'latitude',
      'longitude',
    ]);
  });

  it('reports a null accuracy rather than inventing one', async () => {
    installNavigator({
      geolocation: geolocationResolving({ latitude: 14.75, longitude: 121.03 }),
    });

    await expect(requestCurrentPosition()).resolves.toEqual({
      latitude: 14.75,
      longitude: 121.03,
      accuracy: null,
    });
  });

  it('rejects with "unsupported" when there is no Geolocation API', async () => {
    installNavigator({ geolocation: null });

    await expect(requestCurrentPosition()).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('maps PERMISSION_DENIED (1) to "denied"', async () => {
    installNavigator({ geolocation: geolocationFailing(1) });

    await expect(requestCurrentPosition()).rejects.toMatchObject({
      code: 'denied',
    });
  });

  it('maps POSITION_UNAVAILABLE (2) to "unavailable"', async () => {
    installNavigator({ geolocation: geolocationFailing(2) });

    await expect(requestCurrentPosition()).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('maps TIMEOUT (3) to "timeout"', async () => {
    installNavigator({ geolocation: geolocationFailing(3) });

    await expect(requestCurrentPosition()).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('treats an error with no code as unavailable, not as a denial', async () => {
    // THE POINT OF READING THE CODE BY VALUE. A browser that omits the
    // numeric constants would otherwise compare undefined against undefined
    // and classify every failure as denied — telling the user their
    // permission is blocked when it is not, and sending them into browser
    // settings to fix something that is not broken.
    installNavigator({ geolocation: geolocationFailing(undefined) });

    await expect(requestCurrentPosition()).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('treats a success carrying no usable coordinate as unavailable', async () => {
    installNavigator({
      geolocation: geolocationResolving({
        latitude: Number.NaN,
        longitude: 121.03,
      }),
    });

    await expect(requestCurrentPosition()).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('never exposes raw browser error text to the user', async () => {
    // The friendly message is the contract. A browser's own wording is
    // inconsistent between vendors and occasionally names a third-party
    // network-location endpoint, which is not something to show somebody
    // logging a crime report.
    installNavigator({
      geolocation: {
        getCurrentPosition: vi.fn((_success, failure) =>
          failure({ code: 1, message: 'User denied Geolocation' }),
        ),
      },
    });

    await expect(requestCurrentPosition()).rejects.toThrow(LocationError);
    await requestCurrentPosition().catch((err) => {
      expect(err.message).not.toContain('User denied Geolocation');
      expect(err.message).toContain('blocked');
    });
  });

  it('asks for a high-accuracy fix with a bounded timeout', async () => {
    // A request with no timeout can hang indefinitely on a machine with no
    // location provider, leaving the button spinning forever.
    const geolocation = geolocationResolving({ latitude: 1, longitude: 2 });
    installNavigator({ geolocation });

    await requestCurrentPosition();

    const options = geolocation.getCurrentPosition.mock.calls[0][2];
    expect(options.enableHighAccuracy).toBe(true);
    expect(options.timeout).toBeGreaterThan(0);
  });
});

describe('watching for permission changes', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns a callable unsubscribe when the Permissions API is absent', () => {
    installNavigator({ permissions: null });

    const stop = watchLocationPermission(() => {});

    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });

  it('reports a change made from the browser own site settings', async () => {
    // No event fires on window when a permission is changed in browser
    // settings, so PermissionStatus is the only thing that can report it. A
    // status chip that never subscribes keeps saying "Blocked" after somebody
    // has just unblocked the site.
    const listeners = [];
    const status = {
      state: 'denied',
      addEventListener: (_event, handler) => listeners.push(handler),
      removeEventListener: vi.fn(),
    };
    installNavigator({ permissions: { query: vi.fn(async () => status) } });

    const seen = [];
    watchLocationPermission((state) => seen.push(state));

    // Let the query promise settle before the change is simulated.
    await Promise.resolve();
    await Promise.resolve();

    status.state = 'granted';
    listeners.forEach((handler) => handler());

    expect(seen).toEqual(['granted']);
  });
});
