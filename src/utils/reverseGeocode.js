// Turning a pinned coordinate into the street it sits on — and refusing to turn
// it into anything the map cannot actually establish.
//
// WHY THIS EXISTS
//
// The incident form asks for a Sitio and a street as well as a pin. Typing all
// three is duplicated work when two of them are already implied by the third,
// and a hand-typed street is where "Narra St." and "Narra Street" come from.
// So once a pin is placed inside Barangay 178, this module asks OpenStreetMap
// what is at that exact point and offers the answer back to the form.
//
// WHAT IT WILL NOT DO
//
// It never guesses. A point with no named way at it yields `street: null`, and
// the form leaves the field alone rather than filling in the nearest plausible
// road — a crime record that names a street the report did not is worse than
// one with the field blank, because nothing afterwards reveals which it was.
//
// The same rule is why the Sitio side is so narrow. NOTHING in this repository
// maps a coordinate to a Sitio: there is no sitio boundary file, `SITIOS` in
// src/utils/constants.js is the placeholder list `Sitio 1`..`Sitio 7`, and
// src/utils/mockData.js picks a sitio at random with no relation to the point
// it generates. A sitio is therefore accepted ONLY when OpenStreetMap names an
// area that EXACTLY matches one the form's own dropdown already offers. With
// today's placeholder names that will essentially never match, and that is the
// correct outcome — the alternative is fabricating an administrative division.
// If the barangay's real sitio names are ever put into `SITIOS`, or a sitio
// polygon file is added, this begins answering without any change here.
//
// IT IS NOT A VALIDATOR, AND IT IS NOT THE BOUNDARY
//
// Whether a point may be recorded at all is decided by src/utils/geo.js on the
// client and by ValidatesIncidentLocation / Barangay178Boundary on the server,
// both reading the stored polygon. This module is asked only about points that
// have already passed that test, and it neither performs nor weakens it. A
// lookup that fails, times out or is blocked changes nothing about what can be
// saved.
//
// WHY A NETWORK CALL IS ACCEPTABLE HERE, WHEN IT IS NOT FOR THE BOUNDARY
//
// src/utils/geo.js explains at length why the boundary is stored in the repo
// rather than fetched: the map must draw the right barangay on a barangay
// laptop with a bad connection. Street names are the opposite kind of thing —
// they are a convenience that saves typing, and their absence costs the encoder
// a few seconds rather than making the form wrong. So this is allowed to be a
// request, and every failure is silent: the fields stay as they were and stay
// editable, exactly as they are today.

/**
 * OpenStreetMap's public reverse-geocoding endpoint.
 *
 * The same project the boundary polygon and the street base map already come
 * from, so the street this returns is the street drawn under the pin rather
 * than a second vendor's opinion of it. No API key, for the same reason
 * src/utils/basemaps.js carries none: a credential here would be a published
 * secret and one more way for the form to fail on a barangay laptop.
 *
 * Nominatim's usage policy requires an identifiable caller. A browser cannot
 * set User-Agent, but it sends Referer automatically, which is what the policy
 * accepts from browser applications. The call is also made at most once per
 * placed pin, which is far below the one-request-per-second ceiling.
 */
export const NOMINATIM_REVERSE_ENDPOINT =
  'https://nominatim.openstreetmap.org/reverse';

/**
 * How long a lookup may take before it is abandoned.
 *
 * Eight seconds, slightly less than browserLocation.js allows a GPS fix,
 * because this is a convenience running behind a pin that is already placed:
 * the encoder can type the street in less time than a slow answer takes to
 * arrive, and a request left hanging would keep the "looking up" line on screen
 * long after it stopped meaning anything.
 */
export const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Nominatim zoom level for the query. 18 is "building / street address" — the
 * level at which the response's `road` is the way the point is actually on,
 * rather than the district it falls in.
 */
const LOOKUP_ZOOM = 18;

/**
 * The address keys that can carry a street name, in the order they are tried.
 *
 * `road` covers almost everything. The other three are what Nominatim returns
 * when the named way is not tagged `highway=residential`-and-friends — a
 * pedestrian street, a footpath or an alley — which in a dense barangay is a
 * large share of the addresses that exist at all. Anything not in this list is
 * not a street and is not used as one.
 */
const STREET_KEYS = ['road', 'pedestrian', 'footway', 'path'];

/**
 * The address keys that can carry a sitio-sized area, in the order they are
 * tried.
 *
 * Which key a Philippine sitio lands in depends on how the local mapper tagged
 * it, so all four are read. NONE of them is trusted on its own — see
 * matchKnownSitio: a value here is only ever used if the form already offers
 * that exact name.
 */
const SITIO_KEYS = ['neighbourhood', 'quarter', 'suburb', 'village'];

/**
 * A barangay designation, in the spellings OpenStreetMap actually carries.
 *
 * Captures the number so "Barangay 178", "Brgy. 178" and "Bgy 0178" are all
 * recognised as the same barangay, and so "Zone 15" and "Camarin" — which are
 * the zone and the district, not a barangay — match nothing.
 */
const BARANGAY_NAME = /^(?:barangay|brgy|bgy)\.?\s*0*(\d{1,4})$/i;

/** The only barangay this system records incidents for. */
const BARANGAY_NUMBER = '178';

/**
 * What makes a name a STREET name rather than the name of a thing that happens
 * to stand on one.
 *
 * WHY THIS IS NEEDED AT ALL. Nominatim's `address.road` is not always a road.
 * When the matched object is a facility it can carry the FACILITY's name: a
 * point over a school sports hall in Barangay 178 returns
 * `road: "North Elementary"` with `category: "leisure"`, and without this guard
 * "North Elementary" is written into Location / Street as though a street by
 * that name existed.
 *
 * WHY THE TEST IS THE NAME AND NOT THE CATEGORY. `category` looks like the
 * obvious discriminator and is not one: the same `leisure` category that
 * produced "North Elementary" also produced the perfectly real
 * "T. M. Kalaw Street" and "Buri Palm Street" for points beside a pitch, and
 * `building/house` produced "Ascencion Street". Categories describe the object
 * the geocoder matched, not the field it filled in. The NAME is what actually
 * separates the two, because a street in this barangay is spelled like one.
 *
 * Checked against every street name the live service returned for points
 * inside the boundary: all twenty are kept, and the one facility name is the
 * only thing rejected.
 *
 * THIS FAILS SAFE, AND THAT IS THE POINT. A genuinely named way with no
 * street-type word in it is refused and the field is left blank for the
 * encoder, which is this module's standing preference over writing something
 * that might not be a street.
 */
const STREET_TYPE =
  /\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|highway|hwy|lane|ln|alley|extension|ext|circle|court|ct|place|pl|terrace|way|walk|walkway|path|footpath|paseo|calle|callejon|daang|kalye)\.?$/i;

/**
 * The URL for one reverse lookup.
 *
 * Separate from the fetch so the query — the part that silently returns the
 * wrong level of detail when it is wrong — can be asserted in a test without a
 * network.
 */
export function buildReverseUrl(latitude, longitude) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: String(LOOKUP_ZOOM),
    addressdetails: '1',
  });

  return `${NOMINATIM_REVERSE_ENDPOINT}?${params.toString()}`;
}

/** A name reduced to what it is, for comparison only — never for storage. */
function normalise(value) {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * One address value as a usable name, or null.
 *
 * Rejects non-strings, blanks, and values that are nothing but digits — a
 * house number that landed in a street key is not a street name, and writing
 * "12" into Location / Street would read as a real answer.
 */
function toName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

/** The first usable name among `keys`, or null if none of them holds one. */
function firstName(address, keys) {
  for (const key of keys) {
    const name = toName(address[key]);
    if (name !== null) return name;
  }
  return null;
}

/**
 * Whether a response places the point in a barangay that is not 178.
 *
 * WHY THIS EXISTS. The stored boundary polygon and OpenStreetMap's live data do
 * not agree everywhere. Sampling the real service for points inside
 * src/data/barangay178.geojson.json found one in the northern lobe that our own
 * point-in-polygon test accepts as Barangay 178 and that Nominatim attributes
 * to `quarter: "Barangay 187", suburb: "Zone 16"`. A street taken from such a
 * response is a NEIGHBOURING barangay's street written onto a Barangay 178
 * crime record, which is exactly the kind of quietly wrong location this module
 * exists to refuse.
 *
 * Every value in the address is scanned rather than a fixed list of keys,
 * because which key holds the barangay varies with how the area was tagged —
 * it arrives in `quarter` for Barangay 178, and a key whitelist that guessed
 * wrong would silently never fire.
 *
 * ABSENCE IS NOT A MISMATCH. A response that names no barangay at all is
 * accepted, because this is a CROSS-check and not the boundary test. Whether a
 * point may be recorded at all is still decided by src/utils/geo.js here and by
 * ValidatesIncidentLocation / Barangay178Boundary on the server, both reading
 * the stored polygon; this only refuses a lookup that positively contradicts
 * them. Treating silence as a contradiction would throw away usable streets
 * wherever OpenStreetMap simply lacks the administrative tag.
 *
 * @param {Object} address  the response's `address` object.
 * @returns {boolean} true only when a barangay is named and none of them is 178.
 */
export function attributedToAnotherBarangay(address) {
  if (!address || typeof address !== 'object') return false;

  const named = new Set();
  for (const value of Object.values(address)) {
    if (typeof value !== 'string') continue;
    const match = value.trim().match(BARANGAY_NAME);
    // Number() then String() so 178, 0178 and " 178 " are one answer.
    if (match) named.add(String(Number(match[1])));
  }

  if (named.size === 0) return false;
  return !named.has(BARANGAY_NUMBER);
}

/**
 * Whether a value is usable as a street name.
 *
 * Exported so the rule that decides it — see STREET_TYPE — is testable on its
 * own rather than only through a whole response.
 */
export function isStreetName(value) {
  const name = toName(value);
  if (name === null) return false;
  return STREET_TYPE.test(name);
}

/**
 * The first value among the street keys that is actually a street name.
 *
 * Deliberately NOT firstName(address, STREET_KEYS): a `road` holding a facility
 * name must not stop the search, because a later key may still hold the real
 * street. Rejecting the whole address on the first unusable value would lose
 * streets this can still find.
 */
function firstStreet(address) {
  for (const key of STREET_KEYS) {
    if (isStreetName(address[key])) return address[key].trim();
  }
  return null;
}

/**
 * A reported area name matched against the sitios the form actually offers.
 *
 * Returns the caller's OWN spelling of the sitio, not OpenStreetMap's, so the
 * value written into the form is always one the `<select>` contains and the
 * field can never end up holding an option that is not in its own list.
 *
 * Comparison ignores case and runs of whitespace and nothing else. No prefix
 * matching, no "starts with", no fuzzy distance: "Sitio 1" must not match
 * "Sitio 10", and an approximate match to an administrative area is exactly the
 * kind of invention this module exists to avoid.
 *
 * @param {string|null} reported  what OpenStreetMap called the area.
 * @param {string[]} knownSitios  the options the form offers.
 * @returns {string|null} the matching option, or null.
 */
export function matchKnownSitio(reported, knownSitios) {
  if (typeof reported !== 'string' || !Array.isArray(knownSitios)) return null;

  const wanted = normalise(reported);
  if (wanted === '') return null;

  return knownSitios.find((sitio) => normalise(sitio) === wanted) ?? null;
}

/**
 * What a Nominatim response establishes about a point.
 *
 * Pure, and the whole reason the network half is a thin wrapper around it: this
 * is where "reliably determined" is actually defined, and it is exercised
 * directly rather than through a mocked request.
 *
 * Either field may be null, independently. A response that names a street but
 * no recognised sitio fills the street and leaves the sitio alone, which is the
 * ordinary case in Barangay 178 today.
 *
 * @param {unknown} payload        the parsed JSON body.
 * @param {string[]} knownSitios   the sitio options the form offers.
 * @returns {{street: string|null, sitio: string|null}}
 */
export function extractLocation(payload, knownSitios) {
  const address =
    payload && typeof payload === 'object' ? payload.address : null;

  if (!address || typeof address !== 'object') {
    return { street: null, sitio: null };
  }

  // A response attributed to another barangay establishes NOTHING about a
  // Barangay 178 record — not a street and not an area — so it is refused whole
  // rather than mined for the parts that look usable.
  if (attributedToAnotherBarangay(address)) {
    return { street: null, sitio: null };
  }

  return {
    street: firstStreet(address),
    sitio: matchKnownSitio(firstName(address, SITIO_KEYS), knownSitios),
  };
}

/**
 * Ask OpenStreetMap what is at a point.
 *
 * Resolves to `{ street, sitio }` — either or both possibly null — or to null
 * when the question could not be asked or answered at all. The two outcomes are
 * deliberately different: "OpenStreetMap does not name a street here" is an
 * answer the form can report, while "the lookup failed" is not, and telling an
 * encoder that a street does not exist because their laptop is offline would be
 * a lie the interface cannot take back.
 *
 * Never throws, including on abort. A caller that has moved the pin on has no
 * use for a rejected promise from the pin before it.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch, sitios?: string[]}} [options]
 *        `fetchImpl` exists so the wrapper can be tested without a network; it
 *        is never passed in application code.
 * @returns {Promise<{street: string|null, sitio: string|null}|null>}
 */
export async function reverseGeocode(latitude, longitude, options = {}) {
  const { signal, fetchImpl, sitios = [] } = options;
  const request = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!request) return null;

  // The caller's signal and this module's own deadline both have to be able to
  // stop the request, and AbortSignal.any is not available everywhere this
  // runs, so the timeout is wired to its own controller and the caller's signal
  // is forwarded onto it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    const response = await request(buildReverseUrl(latitude, longitude), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response?.ok) return null;

    return extractLocation(await response.json(), sitios);
  } catch {
    // Offline, blocked, rate-limited, aborted, or malformed JSON. All of them
    // mean the same thing to the form — nothing was determined — and none of
    // them is the encoder's problem to read about.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * What the form may write, given what the lookup found and what it wrote last
 * time.
 *
 * THE RULE, per field, and the reason this is a function rather than two lines
 * in an effect:
 *
 *   - A field the encoder typed into is NEVER touched. Their text outranks the
 *     map's, always, in both directions — it is not overwritten by a lookup and
 *     not cleared by one.
 *   - A blank field is filled when the lookup determined a value.
 *   - A field still holding the value THIS feature wrote is replaced when the
 *     pin moves somewhere with a different answer.
 *   - A field still holding the value this feature wrote is CLEARED when the
 *     pin moves somewhere with no answer. The value was the map's claim about a
 *     point the record no longer has; leaving it would have the record assert a
 *     street for a coordinate that never supported it, which is the same defect
 *     as inventing one.
 *
 * Returns the patch to apply and the values to remember as this feature's own.
 * The patch is empty when there is nothing to change, so a caller can apply it
 * unconditionally without causing a render.
 *
 * @param {{street?: *, sitio?: *}} current   what the form holds now.
 * @param {{street: string|null, sitio: string|null}} found  the lookup result.
 * @param {{street: string|null, sitio: string|null}} written
 *        what this feature wrote into those fields last.
 * @returns {{patch: Object, written: {street: string|null, sitio: string|null}}}
 */
export function autofillPatch(current, found, written) {
  const patch = {};
  const nextWritten = { street: null, sitio: null };

  for (const field of ['street', 'sitio']) {
    const held = current?.[field];
    const ours = written?.[field] ?? null;
    const value = found?.[field] ?? null;

    const heldText = typeof held === 'string' ? held.trim() : '';
    const isBlank = heldText === '';
    const isOurs = ours !== null && heldText === ours;

    if (!isBlank && !isOurs) {
      // The encoder's own text. Left exactly as it is, and deliberately not
      // remembered as ours — so if they later clear it, the next lookup treats
      // the field as blank rather than as something it may overwrite.
      continue;
    }

    if (value !== null) {
      if (heldText !== value) patch[field] = value;
      nextWritten[field] = value;
      continue;
    }

    // Nothing determined. Withdraw our own now-unsupported value; leave a
    // blank field blank rather than patching it to the blank it already is.
    if (isOurs) patch[field] = '';
  }

  return { patch, written: nextWritten };
}
