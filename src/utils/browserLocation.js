// Browser geolocation — the layer that answers "where am I?" for the one
// deliberate feature that asks it (My Location, in Crime Mapping).
//
// WHAT THIS IS FOR, AND WHAT IT DELIBERATELY DOES NOT DO
//
// It obtains a coordinate from the browser and hands it back to the caller.
// That is all. Nothing here writes to Laravel, Supabase or the audit log, and
// nothing here persists a coordinate anywhere — not in localStorage, not in a
// module-level variable that outlives the call. A position exists for as long
// as the component holding it is mounted, and is gone when the page is.
//
// This is a privacy decision, not an oversight. Showing somebody their own
// position on a map needs the coordinate in the browser for the length of one
// render; storing it server-side would create a location history of barangay
// staff that the application has no requirement for and no policy covering.
//
// WHY PERMISSION READS ARE ASYNCHRONOUS HERE AND NOT IN browserNotifications
//
// Notification.permission is a synchronous property. Geolocation has no
// equivalent: the only way to read the stored decision without triggering a
// prompt is navigator.permissions.query(), which returns a promise and does
// not exist everywhere. So locationPermission() is async, and every caller has
// to treat the state as something that arrives rather than something it can
// read during render.
//
// THE FOUR STATES ARE THE SAME FOUR browserNotifications SPEAKS
//
// 'unsupported' | 'prompt' | 'granted' | 'denied'. The middle name differs
// from the Notification API's ('default') because these are the Permissions
// API's own names and this module reports what that API says. The UI layer
// translates both vocabularies into the same four labels.

/**
 * How long to wait for a fix before giving up.
 *
 * Ten seconds because this runs on barangay laptops and phones indoors, where
 * a first GPS/wifi fix is genuinely slow. Shorter reads as "broken" on a
 * machine that would have answered; much longer leaves somebody staring at a
 * spinner with no way to tell whether anything is happening.
 */
const POSITION_TIMEOUT_MS = 10000;

/**
 * How stale a cached fix may be and still be reused, in milliseconds.
 *
 * Not 0. Forcing a fresh acquisition on every click is, on the hardware above,
 * the difference between an instant answer and a ten-second wait — for a
 * question ("where am I standing?") whose answer does not meaningfully change
 * in thirty seconds.
 */
const POSITION_MAX_AGE_MS = 30000;

/**
 * The messages a user is allowed to see.
 *
 * Keyed by this module's own codes rather than by the Geolocation API's
 * numeric ones, so no caller ever has to know that 1 means denied. Raw browser
 * error text ("User denied Geolocation", "Network location provider at
 * 'https://www.googleapis.com/'...") never reaches the interface: it is
 * inconsistent between browsers, occasionally names a third-party endpoint,
 * and tells somebody logging a crime report nothing they can act on.
 */
const MESSAGES = {
  unsupported: 'This browser cannot provide your location.',
  denied:
    'Location access is blocked for this site. To use it, allow location for this site in your browser settings (usually via the icon at the left of the address bar), then try again.',
  unavailable:
    'Your location could not be determined right now. This usually means no GPS, Wi-Fi or network position was available.',
  timeout: 'Finding your location took too long. Please try again.',
};

/**
 * A location failure with a code the UI can branch on and a message it can
 * show verbatim.
 *
 * An Error subclass rather than a returned result object, so a caller using
 * await/try-catch cannot accidentally treat a failure as a position — the two
 * shapes are different enough that forgetting the check is a crash in
 * development rather than a marker drawn at undefined, undefined.
 */
export class LocationError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.unavailable);
    this.name = 'LocationError';
    this.code = code;
  }
}

/** The live navigator, read at call time so tests can substitute one. */
function nav() {
  return typeof globalThis !== 'undefined' ? globalThis.navigator : undefined;
}

/** Whether this browser has the Geolocation API at all. */
export function geolocationSupported() {
  const n = nav();
  return Boolean(n && typeof n.geolocation?.getCurrentPosition === 'function');
}

/**
 * The stored permission decision, WITHOUT prompting:
 * 'unsupported' | 'prompt' | 'granted' | 'denied'.
 *
 * Reading this never shows the user anything. That is the whole reason it is
 * separate from requestCurrentPosition() — the Permissions UI has to display a
 * status without the act of displaying it triggering a prompt.
 *
 * FALLS BACK TO 'prompt', WHICH IS NOT A GUESS AT THE ANSWER.
 * navigator.permissions is absent in older WebKit, and Safari has historically
 * thrown on the 'geolocation' name specifically. In both cases the honest
 * position is "the browser has not told us, so asking may or may not prompt",
 * and 'prompt' is the state that produces exactly the right UI for that: an
 * enabled button that finds out by asking. Claiming 'granted' would render a
 * status that might be false; claiming 'denied' would hide a working feature.
 */
export async function locationPermission() {
  if (!geolocationSupported()) return 'unsupported';

  const n = nav();
  if (typeof n?.permissions?.query !== 'function') return 'prompt';

  try {
    const status = await n.permissions.query({ name: 'geolocation' });
    // Normalised against the enum above: a browser reporting anything else is
    // treated as "we do not know", which is 'prompt'.
    return status?.state === 'granted' ||
      status?.state === 'denied' ||
      status?.state === 'prompt'
      ? status.state
      : 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * Subscribes to permission changes, returning an unsubscribe function.
 *
 * Needed because a permission can be changed from the browser's own site
 * settings while the page is open, and that fires no event on `window`.
 * PermissionStatus is the only thing that reports it, so a status chip that
 * never subscribes keeps showing "Blocked" after somebody has just unblocked
 * it.
 *
 * Returns a no-op unsubscribe when the API is unavailable, so callers can
 * always call the return value in an effect cleanup without checking it first.
 */
export function watchLocationPermission(onChange) {
  const n = nav();
  if (typeof n?.permissions?.query !== 'function') return () => {};

  let status = null;
  let cancelled = false;
  const handler = () => onChange(status?.state ?? 'prompt');

  n.permissions
    .query({ name: 'geolocation' })
    .then((result) => {
      if (cancelled || !result) return;
      status = result;
      // addEventListener where available; onchange is the older shape and is
      // all some browsers implement.
      if (typeof result.addEventListener === 'function') {
        result.addEventListener('change', handler);
      } else {
        result.onchange = handler;
      }
    })
    .catch(() => {
      /* No subscription is possible; the caller keeps its last read. */
    });

  return () => {
    cancelled = true;
    if (!status) return;
    if (typeof status.removeEventListener === 'function') {
      status.removeEventListener('change', handler);
    } else if (status.onchange === handler) {
      status.onchange = null;
    }
  };
}

/**
 * Maps a GeolocationPositionError onto this module's codes.
 *
 * The numeric constants are compared by value rather than read off the error
 * object, because a browser that omits them would otherwise make every
 * comparison undefined === undefined and classify a timeout as a denial —
 * telling the user their permission is blocked when it is not.
 */
function errorCode(error) {
  switch (error?.code) {
    case 1:
      return 'denied';
    case 2:
      return 'unavailable';
    case 3:
      return 'timeout';
    default:
      return 'unavailable';
  }
}

/**
 * Obtains the current position, prompting the user if the browser decides to.
 *
 * THIS IS THE ONLY FUNCTION THAT CAN CAUSE A PROMPT, and it must only ever be
 * called from a real user gesture — the My Location button in Crime Mapping,
 * or Allow Location in the Permissions section. Nothing in this application
 * calls it on mount, on sign-in, on navigation, or on the Mapping page
 * loading. A permission prompt somebody did not ask for is the most reliable
 * way to get "Block" clicked, and Block is effectively permanent.
 *
 * Note that navigator.permissions.query() does NOT prompt — so this is also
 * what the Permissions UI must call when its state is 'prompt', because there
 * is no other way to make the browser ask.
 *
 * @returns {Promise<{latitude:number, longitude:number, accuracy:number|null}>}
 *          Only these three fields. GeolocationPosition also carries altitude,
 *          heading and speed; none are used here, and returning them would be
 *          handing callers data they have no reason to hold.
 * @throws {LocationError} code 'unsupported' | 'denied' | 'unavailable' | 'timeout'
 */
export function requestCurrentPosition() {
  if (!geolocationSupported()) {
    return Promise.reject(new LocationError('unsupported'));
  }

  return new Promise((resolve, reject) => {
    nav().geolocation.getCurrentPosition(
      (position) => {
        const coords = position?.coords;
        if (
          !coords ||
          typeof coords.latitude !== 'number' ||
          typeof coords.longitude !== 'number' ||
          Number.isNaN(coords.latitude) ||
          Number.isNaN(coords.longitude)
        ) {
          // A success callback carrying no usable coordinate is a position
          // that is unavailable, whatever the browser chose to call it.
          reject(new LocationError('unavailable'));
          return;
        }

        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy:
            typeof coords.accuracy === 'number' &&
            !Number.isNaN(coords.accuracy)
              ? coords.accuracy
              : null,
        });
      },
      (error) => reject(new LocationError(errorCode(error))),
      {
        enableHighAccuracy: true,
        timeout: POSITION_TIMEOUT_MS,
        maximumAge: POSITION_MAX_AGE_MS,
      },
    );
  });
}
