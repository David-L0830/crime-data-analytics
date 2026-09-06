import { describe, expect, it } from 'vitest';
import {
  BARANGAY_178_BOUNDS,
  BARANGAY_178_CENTER,
  barangay178LatLngBounds,
  isValidCoordinate,
  isWithinBarangay178,
} from './geo';
import { BARANGAY_178_CENTER as CENTER_FROM_CONSTANTS } from './constants';

// The frontend half of the geography. The backend has its own equivalent suite
// (Barangay178BoundaryTest) asserting the same facts about the same polygon —
// the two files are byte-identical and one of those tests checks that.

describe('Barangay 178 boundary', () => {
  it('reports the published extent of the barangay', () => {
    // OpenStreetMap relation 11322824's extent. Four decimal places is ~11 m:
    // tight enough that swapping the file for a different place fails, loose
    // enough that a legitimate boundary refresh does not fail on rounding.
    expect(BARANGAY_178_BOUNDS.south).toBeCloseTo(14.742, 4);
    expect(BARANGAY_178_BOUNDS.north).toBeCloseTo(14.7656, 4);
    expect(BARANGAY_178_BOUNDS.west).toBeCloseTo(121.0533, 4);
    expect(BARANGAY_178_BOUNDS.east).toBeCloseTo(121.0779, 4);
  });

  it('places the derived centre inside the barangay', () => {
    // The centre is computed from the polygon rather than typed in, so this
    // also proves the centroid maths did not produce something outside the
    // shape it was computed from.
    expect(
      isWithinBarangay178(BARANGAY_178_CENTER.lat, BARANGAY_178_CENTER.lng),
    ).toBe(true);
  });

  it('agrees with two independently published centroids', () => {
    // Neither of these was used to build the boundary file: Nominatim's own
    // label point for the relation, and PhilAtlas's published centroid for
    // Barangay 178. If the stored polygon were some other place, neither would
    // land inside it.
    expect(isWithinBarangay178(14.7559, 121.0596)).toBe(true);
    expect(isWithinBarangay178(14.7572, 121.0576)).toBe(true);
  });

  it('does not contain the old hardcoded map centre', () => {
    // The regression guard. 14.7323, 121.027 was the map centre, the seeder's
    // centre and the factory's centre; it is ~4.3 km away, in Quezon City.
    expect(isWithinBarangay178(14.7323, 121.027)).toBe(false);
  });

  it('exports a centre derived from the boundary rather than the old literal', () => {
    // constants.js re-exports geo.js's value now. This fails if anyone
    // reintroduces a hardcoded pair there.
    expect(CENTER_FROM_CONSTANTS).toBe(BARANGAY_178_CENTER);
    expect(CENTER_FROM_CONSTANTS.lat).not.toBeCloseTo(14.7323, 4);
  });

  it('is a polygon test, not a bounding-box test', () => {
    // The south-west corner of the bounding box is not inside the barangay. If
    // isWithinBarangay178 ever degraded into a rectangle check, this would
    // start passing and the map would call a neighbouring barangay "Barangay
    // 178".
    expect(
      isWithinBarangay178(
        BARANGAY_178_BOUNDS.south + 0.00001,
        BARANGAY_178_BOUNDS.west + 0.00001,
      ),
    ).toBe(false);
  });

  it('rejects the out-of-area coordinates that reached the database', () => {
    // The real damaged rows the old worldwide validation allowed in.
    expect(isWithinBarangay178(14.7305, 117.0282)).toBe(false); // open sea
    expect(isWithinBarangay178(14.6121, 121.1324)).toBe(false); // another city
  });

  it('returns Leaflet-ordered bounds', () => {
    // GeoJSON is [lng, lat] and Leaflet is [lat, lng]. This is the one place
    // the order is flipped, so it is the one place worth asserting.
    const [[south, west], [north, east]] = barangay178LatLngBounds();

    expect(south).toBeCloseTo(BARANGAY_178_BOUNDS.south, 7);
    expect(west).toBeCloseTo(BARANGAY_178_BOUNDS.west, 7);
    expect(north).toBeCloseTo(BARANGAY_178_BOUNDS.north, 7);
    expect(east).toBeCloseTo(BARANGAY_178_BOUNDS.east, 7);
    // Latitudes around 14.7 and longitudes around 121 — if the pair were
    // reversed these would be the wrong way round entirely.
    expect(south).toBeLessThan(20);
    expect(west).toBeGreaterThan(100);
  });
});

describe('isValidCoordinate', () => {
  it('accepts real coordinates, including numeric strings', () => {
    expect(isValidCoordinate(14.7559, 121.0596)).toBe(true);
    // The API returns numbers, but a form field returns a string; both have to
    // work or an incident edited through the modal would be dropped from the
    // map.
    expect(isValidCoordinate('14.7559', '121.0596')).toBe(true);
  });

  it('rejects missing, unparseable and out-of-range values', () => {
    expect(isValidCoordinate(null, null)).toBe(false);
    expect(isValidCoordinate(undefined, 121.06)).toBe(false);
    expect(isValidCoordinate('', '')).toBe(false);
    expect(isValidCoordinate('abc', '121.06')).toBe(false);
    expect(isValidCoordinate(NaN, 121.06)).toBe(false);
    expect(isValidCoordinate(95, 121.06)).toBe(false);
    expect(isValidCoordinate(14.75, 200)).toBe(false);
  });

  it('rejects 0,0 as an empty field rather than a place', () => {
    // Null island. The old map predicate happened to drop this via a truthiness
    // check; it is now an explicit rule with a reason.
    expect(isValidCoordinate(0, 0)).toBe(false);
  });

  it('is separate from the boundary test', () => {
    // A coordinate can be perfectly valid and still be somewhere else — the map
    // says different things about those two cases, so they stay two functions.
    expect(isValidCoordinate(14.7323, 121.027)).toBe(true);
    expect(isWithinBarangay178(14.7323, 121.027)).toBe(false);
  });

  it('treats an invalid coordinate as not inside the barangay', () => {
    expect(isWithinBarangay178(null, null)).toBe(false);
    expect(isWithinBarangay178('abc', '121.06')).toBe(false);
    expect(isWithinBarangay178(0, 0)).toBe(false);
  });
});

// NOTE ON src/utils/mockData.js
//
// That module is the third generator that carried the wrong centre (alongside
// IncidentSeeder and IncidentFactory, both covered by the backend's
// Barangay178BoundaryTest) and it has been corrected the same way, so no
// centre-plus-radius coordinate generator survives anywhere in this repository.
//
// It is NOT asserted here. The module is dead code — nothing imports it — and
// buildMockDataset() already throws for an unrelated, pre-existing reason: it
// still destructures RESIDENT_STATUSES from constants.js, which stopped
// exporting it when the residents table was dropped. Fixing that is a separate
// question about whether the module should exist at all, and is deliberately
// not bundled into this change.
