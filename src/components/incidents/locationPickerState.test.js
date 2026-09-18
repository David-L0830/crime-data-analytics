import { describe, expect, it } from 'vitest';
import {
  COORDINATE_PRECISION,
  PIN_STATUS,
  classifyCoordinate,
  clearedPinState,
  formatCoordinate,
  pinStateFor,
} from './locationPickerState';
import { BARANGAY_178_BOUNDS, BARANGAY_178_CENTER } from '../../utils/geo';

/**
 * The pure half of the incident location picker (Checkpoint 1). No component is
 * rendered here — Vitest runs in a Node environment with no jsdom — and none
 * needs to be: everything that decides where a pin goes lives in these
 * functions.
 *
 * EVERY COORDINATE BELOW IS ONE THE REPOSITORY ALREADY RELIES ON. The inside
 * points are the two independently published centroids src/utils/geo.test.js
 * checks the polygon against, plus the centre geo.js derives from the polygon
 * itself; the outside points are the old hardcoded map centre and the two
 * damaged rows that reached the database under the pre-boundary validation.
 * Nothing is invented, so a boundary refresh that genuinely moved these would
 * fail here and in geo.test.js together rather than only here.
 */

// Nominatim's label point for OSM relation 11322824.
const INSIDE = { lat: 14.7559, lng: 121.0596 };
// PhilAtlas's independently published centroid for Barangay 178.
const INSIDE_ALT = { lat: 14.7572, lng: 121.0576 };
// The old hardcoded map/seeder/factory centre — ~4.3 km away, in Quezon City.
const OUTSIDE = { lat: 14.7323, lng: 121.027 };
// The two out-of-area rows the old worldwide validation allowed in.
const OPEN_SEA = { lat: 14.7305, lng: 117.0282 };
const ANOTHER_CITY = { lat: 14.6121, lng: 121.1324 };

describe('classifyCoordinate', () => {
  it('reports a point inside the barangay as inside', () => {
    expect(classifyCoordinate(INSIDE.lat, INSIDE.lng)).toBe(PIN_STATUS.INSIDE);
    expect(classifyCoordinate(INSIDE_ALT.lat, INSIDE_ALT.lng)).toBe(
      PIN_STATUS.INSIDE,
    );
    expect(
      classifyCoordinate(BARANGAY_178_CENTER.lat, BARANGAY_178_CENTER.lng),
    ).toBe(PIN_STATUS.INSIDE);
  });

  it('reports a real point elsewhere as outside, not as invalid', () => {
    // The distinction this function exists for. An encoder who clicked a
    // neighbouring barangay must be told that, not told their click was not a
    // number.
    for (const point of [OUTSIDE, OPEN_SEA, ANOTHER_CITY]) {
      expect(classifyCoordinate(point.lat, point.lng)).toBe(PIN_STATUS.OUTSIDE);
    }
  });

  it('reports an unusable value as invalid', () => {
    expect(classifyCoordinate('abc', 121.0596)).toBe(PIN_STATUS.INVALID);
    expect(classifyCoordinate(14.7559, 'abc')).toBe(PIN_STATUS.INVALID);
    expect(classifyCoordinate(NaN, 121.0596)).toBe(PIN_STATUS.INVALID);
    expect(classifyCoordinate(95, 121.0596)).toBe(PIN_STATUS.INVALID);
    expect(classifyCoordinate(14.7559, 200)).toBe(PIN_STATUS.INVALID);
    expect(classifyCoordinate(null, null)).toBe(PIN_STATUS.INVALID);
  });

  it('reports 0,0 as invalid rather than as a place', () => {
    // Null island: the classic empty-field artefact, and not a case this
    // barangay records.
    expect(classifyCoordinate(0, 0)).toBe(PIN_STATUS.INVALID);
  });

  it('accepts the numeric strings a form field produces', () => {
    expect(classifyCoordinate('14.7559', '121.0596')).toBe(PIN_STATUS.INSIDE);
    expect(classifyCoordinate('14.7323', '121.027')).toBe(PIN_STATUS.OUTSIDE);
  });

  it('is a polygon test, not a bounding-box test', () => {
    // The south-west corner of the bounding box is not in the barangay. If this
    // ever degraded into a rectangle check, the picker would happily pin a
    // neighbouring barangay as Barangay 178.
    expect(
      classifyCoordinate(
        BARANGAY_178_BOUNDS.south + 0.00001,
        BARANGAY_178_BOUNDS.west + 0.00001,
      ),
    ).toBe(PIN_STATUS.OUTSIDE);
  });
});

describe('formatCoordinate', () => {
  it('shows the seven decimal places the column stores', () => {
    // incidents.latitude / longitude are decimal(10,7). Fewer would show a
    // value the record does not hold; more would show precision it cannot keep.
    expect(COORDINATE_PRECISION).toBe(7);
    expect(formatCoordinate(14.7559)).toBe('14.7559000');
    expect(formatCoordinate(121.0596)).toBe('121.0596000');
  });

  it('formats a negative coordinate', () => {
    // Barangay 178 is north and east of zero, so this never arises in practice
    // — but the helper is generic and must not mangle a sign if it ever does.
    expect(formatCoordinate(-14.7559)).toBe('-14.7559000');
    expect(formatCoordinate(-121.0596)).toBe('-121.0596000');
  });

  it('accepts the numeric strings a form field produces', () => {
    expect(formatCoordinate('14.7559')).toBe('14.7559000');
  });

  it('returns an empty string when there is nothing to show', () => {
    // Not a dash: the caller owns its own placeholder, the way the incident
    // detail view already writes `{r.latitude ?? '—'}`.
    expect(formatCoordinate(null)).toBe('');
    expect(formatCoordinate(undefined)).toBe('');
    expect(formatCoordinate('')).toBe('');
    expect(formatCoordinate('   ')).toBe('');
    expect(formatCoordinate('abc')).toBe('');
    expect(formatCoordinate(NaN)).toBe('');
  });

  it('treats 0 as a value rather than an absence', () => {
    expect(formatCoordinate(0)).toBe('0.0000000');
  });

  it('rounds only what is displayed, never the value itself', () => {
    // A string comes back, so there is nothing here that could be written to
    // the record by accident. More places than the column keeps are rounded for
    // display; fewer are padded.
    const stored = 14.75591234567;
    expect(formatCoordinate(stored)).toBe('14.7559123');
    expect(stored).toBe(14.75591234567);
  });
});

describe('pinStateFor — an existing incident', () => {
  it('pins a record whose coordinate is inside the barangay', () => {
    expect(pinStateFor(INSIDE.lat, INSIDE.lng)).toEqual({
      status: PIN_STATUS.INSIDE,
      pin: { lat: INSIDE.lat, lng: INSIDE.lng },
      latitude: INSIDE.lat,
      longitude: INSIDE.lng,
    });
  });

  it('places no pin for a record with no coordinate', () => {
    // Coordinates are optional by policy: a report with a street and a sitio
    // and no GPS reading is a normal report, not an incomplete one.
    const expected = {
      status: PIN_STATUS.NONE,
      pin: null,
      latitude: null,
      longitude: null,
    };

    expect(pinStateFor(null, null)).toEqual(expected);
    expect(pinStateFor(undefined, undefined)).toEqual(expected);
    // What the edit modal's pre-fill produces: `incident.latitude ?? ''`.
    expect(pinStateFor('', '')).toEqual(expected);
    expect(pinStateFor('   ', '   ')).toEqual(expected);
  });

  it('reports a record holding only a latitude as incomplete', () => {
    expect(pinStateFor(INSIDE.lat, null)).toEqual({
      status: PIN_STATUS.INCOMPLETE,
      pin: null,
      latitude: INSIDE.lat,
      longitude: null,
    });
    expect(pinStateFor(INSIDE.lat, '')).toMatchObject({
      status: PIN_STATUS.INCOMPLETE,
      longitude: null,
    });
  });

  it('reports a record holding only a longitude as incomplete', () => {
    expect(pinStateFor(null, INSIDE.lng)).toEqual({
      status: PIN_STATUS.INCOMPLETE,
      pin: null,
      latitude: null,
      longitude: INSIDE.lng,
    });
    expect(pinStateFor('', INSIDE.lng)).toMatchObject({
      status: PIN_STATUS.INCOMPLETE,
      latitude: null,
    });
  });

  it('reports a record whose coordinate is outside the barangay, and keeps it', () => {
    // The two damaged rows that are still in the table. Opening one must say
    // so — and must hand the stored coordinate straight back, because the
    // picker is not allowed to tidy the record on the encoder's behalf.
    expect(pinStateFor(OPEN_SEA.lat, OPEN_SEA.lng)).toEqual({
      status: PIN_STATUS.OUTSIDE,
      pin: null,
      latitude: OPEN_SEA.lat,
      longitude: OPEN_SEA.lng,
    });
    expect(pinStateFor(ANOTHER_CITY.lat, ANOTHER_CITY.lng)).toMatchObject({
      status: PIN_STATUS.OUTSIDE,
      pin: null,
    });
  });

  it('reports an unusable stored coordinate as invalid, and keeps it too', () => {
    expect(pinStateFor('abc', 121.0596)).toEqual({
      status: PIN_STATUS.INVALID,
      pin: null,
      latitude: 'abc',
      longitude: 121.0596,
    });
    expect(pinStateFor(0, 0)).toEqual({
      status: PIN_STATUS.INVALID,
      pin: null,
      latitude: 0,
      longitude: 0,
    });
  });

  it('never moves, clamps or snaps a coordinate it cannot pin', () => {
    // The rule the backend enforces for the same reason: a crime record whose
    // location the system edited on its own is worse than one that visibly
    // failed to save, because nothing afterwards reveals that it happened.
    for (const point of [OUTSIDE, OPEN_SEA, ANOTHER_CITY]) {
      const state = pinStateFor(point.lat, point.lng);
      expect(state.pin).toBeNull();
      expect(state.latitude).toBe(point.lat);
      expect(state.longitude).toBe(point.lng);
    }
  });

  it('carries a pin only when the point is inside the barangay', () => {
    expect(pinStateFor(INSIDE.lat, INSIDE.lng).pin).not.toBeNull();

    for (const [lat, lng] of [
      [null, null],
      [INSIDE.lat, null],
      [null, INSIDE.lng],
      [OUTSIDE.lat, OUTSIDE.lng],
      ['abc', 121.0596],
      [0, 0],
    ]) {
      expect(pinStateFor(lat, lng).pin).toBeNull();
    }
  });

  it('is also what a map click produces, so the two cannot drift apart', () => {
    // A click is just a complete, finite pair. Checkpoint 2 needs no second
    // function for it.
    const clicked = pinStateFor(INSIDE_ALT.lat, INSIDE_ALT.lng);

    expect(clicked.status).toBe(PIN_STATUS.INSIDE);
    expect(clicked.pin).toEqual({ lat: INSIDE_ALT.lat, lng: INSIDE_ALT.lng });
  });
});

describe('clearedPinState', () => {
  it('is an empty location with both coordinates null', () => {
    // Exactly what coordinatePayload sends for an emptied field, and what the
    // server accepts: clearing a location is a legitimate outcome.
    expect(clearedPinState()).toEqual({
      status: PIN_STATUS.NONE,
      pin: null,
      latitude: null,
      longitude: null,
    });
  });

  it('agrees with the state of a record that never had a coordinate', () => {
    expect(clearedPinState()).toEqual(pinStateFor(null, null));
  });

  it('returns a fresh object, so one caller cannot mutate another caller\'s', () => {
    expect(clearedPinState()).not.toBe(clearedPinState());
  });
});
