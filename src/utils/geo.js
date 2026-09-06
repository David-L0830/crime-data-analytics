// Barangay 178 geography — the single frontend source of truth for where this
// barangay is, how big it is, and whether a coordinate falls inside it.
//
// WHY EVERYTHING HERE IS DERIVED, NOT TYPED IN
//
// The previous implementation hard-coded `BARANGAY_178_CENTER = { lat: 14.7323,
// lng: 121.027 }` and drew a 500 m circle around it labelled "Barangay 178".
// Both numbers were wrong: that point is roughly 4.3 km south-west of the real
// barangay, in the Bagbag/Novaliches part of Quezon City, and the real barangay
// is about 2.6 km across rather than 1 km. Because the centre was a literal and
// the "boundary" was a circle drawn from it, nothing in the codebase could ever
// contradict either value.
//
// So no coordinate is written down here. The centre, the bounds and the
// inside/outside test are all computed from src/data/barangay178.geojson.json —
// the actual boundary polygon. Replacing that file moves the map, the map's
// bounds, the seeder and the validator together, and they cannot drift apart.
//
// BOUNDARY SOURCE
//
// OpenStreetMap relation 11322824, "Barangay 178, Zone 15, Camarin, District 3,
// Caloocan" (ODbL, © OpenStreetMap contributors). Retrieved as GeoJSON from
// polygons.openstreetmap.fr and cross-checked against Nominatim's own
// polygon_geojson output — both returned the identical 186-point ring, so the
// geometry is not an artefact of one service's simplification. Its extent
// (14.7420–14.7656 N, 121.0533–121.0779 E) also agrees with PhilAtlas's
// independently published centroid for Barangay 178 of 14.7572, 121.0576.
//
// The file is stored IN the repository rather than fetched at runtime: the map
// must draw the correct barangay on a barangay laptop with a bad connection,
// and a boundary that depends on a third-party request is a boundary that can
// silently fail to appear. backend/resources/geo/barangay-178.geojson is a
// byte-identical copy, so the backend validates against exactly the polygon the
// frontend draws.
import boundary from '../data/barangay178.geojson.json';

export const BARANGAY_178_BOUNDARY = boundary;

/** The single Feature in the boundary file, for callers that want its metadata. */
export const BARANGAY_178_FEATURE = boundary.features[0];

/**
 * Every linear ring in the boundary, grouped by polygon.
 *
 * Grouped rather than flattened because a point is inside a MultiPolygon when
 * it is inside ANY ONE of its polygons, and inside a polygon when it crosses an
 * odd number of THAT polygon's rings (which is what makes a hole a hole).
 * Flattening the two levels together would answer both questions with one
 * parity count and get holes wrong the moment the boundary gained one.
 *
 * Coordinates are GeoJSON order — [longitude, latitude] — and are kept that way
 * here deliberately. The conversion to Leaflet's [lat, lng] happens once, at the
 * call site that hands them to Leaflet, so there is exactly one place where the
 * order is flipped instead of a convention that has to be remembered.
 *
 * @type {number[][][][]} polygons → rings → points → [lng, lat]
 */
const POLYGONS = (() => {
  const geometry = BARANGAY_178_FEATURE?.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
})();

/**
 * The boundary's bounding box, in degrees.
 *
 * This is the extent of the real polygon, not a rectangle anyone chose. It is
 * what the map opens onto and what maxBounds is padded out from.
 */
export const BARANGAY_178_BOUNDS = (() => {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;

  POLYGONS.forEach((rings) =>
    rings.forEach((ring) =>
      ring.forEach(([lng, lat]) => {
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
      }),
    ),
  );

  return { south, west, north, east };
})();

/**
 * The barangay's centre, as the AREA centroid of its outer ring (the shoelace
 * formula), not the midpoint of its bounding box.
 *
 * The distinction matters for a barangay that is not rectangular: the bounding
 * box's midpoint can sit in a corner the barangay does not actually occupy,
 * whereas the area centroid is a point the shape is genuinely centred on. The
 * map fits the real bounds anyway, so this is used for labelling and for the
 * "how far outside is this?" reporting rather than for the initial viewport.
 */
export const BARANGAY_178_CENTER = (() => {
  const ring = POLYGONS[0]?.[0];
  if (!ring || ring.length < 4) {
    // A degenerate boundary file would otherwise divide by zero. Falling back
    // to the bounding-box midpoint keeps the map usable and is still derived
    // from the file rather than typed in.
    return {
      lat: (BARANGAY_178_BOUNDS.south + BARANGAY_178_BOUNDS.north) / 2,
      lng: (BARANGAY_178_BOUNDS.west + BARANGAY_178_BOUNDS.east) / 2,
    };
  }

  let twiceArea = 0;
  let lng = 0;
  let lat = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    lng += (x0 + x1) * cross;
    lat += (y0 + y1) * cross;
  }

  if (twiceArea === 0) {
    return {
      lat: (BARANGAY_178_BOUNDS.south + BARANGAY_178_BOUNDS.north) / 2,
      lng: (BARANGAY_178_BOUNDS.west + BARANGAY_178_BOUNDS.east) / 2,
    };
  }

  return { lat: lat / (3 * twiceArea), lng: lng / (3 * twiceArea) };
})();

/**
 * Whether a latitude/longitude pair is a usable coordinate at all.
 *
 * Rejects null/undefined, non-numeric strings, NaN, out-of-range values, and
 * the 0,0 "null island" pair that almost always means "the field was left
 * empty" rather than a point in the Gulf of Guinea. Deliberately separate from
 * isWithinBarangay178: a coordinate can be perfectly valid and still be
 * somewhere else, and the map says different things about those two cases.
 */
export function isValidCoordinate(lat, lng) {
  const latitude = typeof lat === 'string' ? Number(lat) : lat;
  const longitude = typeof lng === 'string' ? Number(lng) : lng;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  if (latitude === 0 && longitude === 0) return false;

  return true;
}

/**
 * Ray casting against one ring. Counts how many times a ray cast east from the
 * point crosses the ring's edges; an odd count means the point is enclosed.
 */
function crossesRing(ring, lat, lng) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    // Only edges that straddle the point's latitude can be crossed by a
    // due-east ray from it. The strict/non-strict comparison pair is what stops
    // a vertex exactly on the ray from being counted twice.
    const straddles = yi > lat !== yj > lat;
    if (!straddles) continue;

    const intersectionLng = xi + ((lat - yi) / (yj - yi)) * (xj - xi);
    if (lng < intersectionLng) inside = !inside;
  }

  return inside;
}

/**
 * Whether a coordinate falls inside the real Barangay 178 boundary.
 *
 * Point-in-polygon against the actual OSM geometry — NOT a bounding-box test.
 * A bounding box would call ~35% more of the surrounding area "Barangay 178"
 * than the barangay actually covers, which is the same class of mistake as the
 * 500 m circle this replaced.
 *
 * Returns false for anything isValidCoordinate rejects, so callers get one
 * answer to "should this be plotted as a Barangay 178 incident".
 */
export function isWithinBarangay178(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return false;

  const latitude = Number(lat);
  const longitude = Number(lng);

  // Bounding box first: it rejects the overwhelming majority of out-of-area
  // points with four comparisons instead of 186 edge tests.
  if (
    latitude < BARANGAY_178_BOUNDS.south ||
    latitude > BARANGAY_178_BOUNDS.north ||
    longitude < BARANGAY_178_BOUNDS.west ||
    longitude > BARANGAY_178_BOUNDS.east
  ) {
    return false;
  }

  return POLYGONS.some((rings) => {
    // Inside the outer ring, and outside every hole: an odd number of ring
    // crossings within this one polygon.
    let inside = false;
    rings.forEach((ring) => {
      if (crossesRing(ring, latitude, longitude)) inside = !inside;
    });
    return inside;
  });
}

/**
 * The boundary as Leaflet [lat, lng] bounds — `[[south, west], [north, east]]`.
 * The one place GeoJSON's [lng, lat] order is flipped for Leaflet.
 */
export function barangay178LatLngBounds() {
  return [
    [BARANGAY_178_BOUNDS.south, BARANGAY_178_BOUNDS.west],
    [BARANGAY_178_BOUNDS.north, BARANGAY_178_BOUNDS.east],
  ];
}
