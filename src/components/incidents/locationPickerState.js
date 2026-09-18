// The pure half of the incident location picker: everything it needs to decide
// WHERE a pin goes and WHAT the encoder is told, with no Leaflet, no React and
// no DOM anywhere in it.
//
// WHY THIS IS A SEPARATE MODULE
//
// The same reason incidentSubmission.js next to it is one: Vitest runs in a
// Node environment with no jsdom (see vitest.config.js), so logic living inside
// a component can only be pattern-matched from its source. Lifted out here, the
// decisions that actually matter — is this point inside the barangay, does this
// record already have a usable coordinate, what does a cleared location look
// like — are exercised directly.
//
// WHAT THIS MODULE IS NOT
//
// It is not a validator. The authoritative check is server-side, in
// StoreIncidentRequest / UpdateIncidentRequest through the
// ValidatesIncidentLocation concern, which parses its own copy of the boundary
// and never trusts a client claim. Everything here exists so the encoder is
// told immediately rather than after a round trip; a crafted request bypasses
// all of it and still meets the same polygon test on the server.
//
// It also holds NO geometry. The boundary lives in exactly one place per side
// of the stack — src/utils/geo.js here, Barangay178Boundary.php there, reading
// byte-identical GeoJSON files — and this module asks it questions rather than
// answering them itself.
import { isValidCoordinate, isWithinBarangay178 } from '../../utils/geo';
import { toCoordinate } from './incidentSubmission';

/**
 * How many decimal places a coordinate is shown to.
 *
 * Seven, because that is what `incidents.latitude` / `incidents.longitude`
 * actually store — `decimal(10, 7)`, cast to `decimal:7` on the model — and
 * what src/utils/mockData.js already rounds its generated points to. Showing
 * fewer would display a value the record does not hold; showing more would
 * display precision the column cannot keep. Seven places is roughly a
 * centimetre, far finer than anything a map click needs, so this is about
 * agreeing with the schema rather than about accuracy.
 */
export const COORDINATE_PRECISION = 7;

/**
 * The states a picked location can be in.
 *
 * The middle three names are deliberately the same three
 * src/pages/Mapping.jsx already labels incidents with (`coordinateState`), so
 * the map and the form describe a coordinate in one vocabulary rather than two.
 *
 *   NONE        no coordinate at all. NOT an error — coordinates are optional
 *               by policy, because plenty of reports arrive with a street and
 *               a sitio and no GPS reading, and demanding one pushes encoders
 *               into inventing one.
 *   INCOMPLETE  exactly one of the pair. Its own state rather than part of
 *               INVALID because the server has its own rule and its own
 *               message for it (`required_with` on both fields), and because
 *               "the other half is missing" is a different thing to tell
 *               somebody than "that is not a coordinate".
 *   INVALID     present but not a usable point: non-numeric, out of range, or
 *               the 0,0 empty-field artefact.
 *   OUTSIDE     a real point, but not inside Barangay 178. This system records
 *               incidents for one barangay, so this cannot be pinned — but the
 *               stored value is reported back untouched, never moved.
 *   INSIDE      a real point inside the barangay. The only state that carries
 *               a pin.
 */
export const PIN_STATUS = Object.freeze({
  NONE: 'none',
  INCOMPLETE: 'incomplete',
  INVALID: 'invalid',
  OUTSIDE: 'outside',
  INSIDE: 'inside',
});

/**
 * Where a complete coordinate pair stands: INVALID, OUTSIDE or INSIDE.
 *
 * The two questions are kept apart on purpose, exactly as geo.js keeps
 * isValidCoordinate apart from isWithinBarangay178: "that is not a coordinate"
 * and "that coordinate is somewhere else" need different messages, and
 * collapsing them would leave an encoder who clicked a neighbouring barangay
 * being told their click was not a number.
 *
 * Only ever returns the three states a COMPLETE pair can be in — a map click
 * always produces both halves, so NONE and INCOMPLETE cannot arise from one.
 *
 * @returns {'invalid'|'outside'|'inside'}
 */
export function classifyCoordinate(latitude, longitude) {
  if (!isValidCoordinate(latitude, longitude)) return PIN_STATUS.INVALID;
  return isWithinBarangay178(latitude, longitude)
    ? PIN_STATUS.INSIDE
    : PIN_STATUS.OUTSIDE;
}

/**
 * One coordinate as it should be READ ON SCREEN — never as it is stored.
 *
 * Returns a string, and nothing writes it back: the picker keeps the numeric
 * value it was given and this is only what sits under the map. That separation
 * is what stops a display convention from becoming a rounding step in the save
 * path.
 *
 * Empty input returns an empty string rather than a dash, because the caller
 * owns its own placeholder — the incident detail view already writes
 * `{r.latitude ?? '—'}` and should keep choosing that for itself.
 *
 * @returns {string} e.g. '14.7559000', or '' when there is nothing to show.
 */
export function formatCoordinate(value) {
  const parsed = toCoordinate(value);
  if (parsed === null || !Number.isFinite(parsed)) return '';
  return parsed.toFixed(COORDINATE_PRECISION);
}

/**
 * The picker state for a latitude/longitude pair.
 *
 * Used both when the modal opens on an existing incident and when the encoder
 * clicks the map — a click is just a pair that happens to be complete and
 * finite, so it needs no second function and cannot drift from this one.
 *
 * NOTHING IS MOVED, CLAMPED, SNAPPED OR CORRECTED. `latitude` and `longitude`
 * come back exactly as they went in (a blank is reported as null, which is
 * what a blank means), so a record holding a coordinate outside the barangay
 * opens showing that coordinate and keeps it until a person changes it. The
 * backend forbids silent correction for the same reason — a crime record whose
 * location the system edited on its own is worse than one that visibly failed
 * to save, because nothing afterwards reveals that it happened.
 *
 * `pin` is populated ONLY for INSIDE. An out-of-area or unusable coordinate
 * has no honest position to draw inside a Barangay 178 picker, and drawing one
 * anyway is how a wrong location starts looking like a confirmed one.
 *
 * Emptiness is judged by incidentSubmission.js's toCoordinate — the same
 * function that builds the payload — so what the picker calls "no coordinate"
 * is by construction what the form actually sends as null.
 *
 * @returns {{status: string, pin: {lat: number, lng: number}|null,
 *            latitude: *, longitude: *}}
 */
export function pinStateFor(latitude, longitude) {
  const lat = toCoordinate(latitude);
  const lng = toCoordinate(longitude);

  // Reported back untouched, with only a blank normalised to null.
  const given = {
    latitude: lat === null ? null : latitude,
    longitude: lng === null ? null : longitude,
  };

  if (lat === null && lng === null) {
    return { status: PIN_STATUS.NONE, pin: null, ...given };
  }

  if (lat === null || lng === null) {
    return { status: PIN_STATUS.INCOMPLETE, pin: null, ...given };
  }

  const status = classifyCoordinate(lat, lng);

  return {
    status,
    pin: status === PIN_STATUS.INSIDE ? { lat, lng } : null,
    ...given,
  };
}

/**
 * The state of a location the encoder has cleared.
 *
 * Its own function rather than a shared frozen object, so a caller holding the
 * result cannot mutate the "empty" every other caller is about to receive.
 *
 * Both coordinates are null, which is precisely what coordinatePayload sends
 * for an empty field and what the server accepts — clearing a location is a
 * legitimate outcome, not a failed one.
 */
export function clearedPinState() {
  return { status: PIN_STATUS.NONE, pin: null, latitude: null, longitude: null };
}
