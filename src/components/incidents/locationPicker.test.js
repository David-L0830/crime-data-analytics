import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guards for the incident LocationPicker (Checkpoint 2).
 *
 * WHY THESE ARE SOURCE-LEVEL AND NOT A MOUNT. Vitest runs in a Node
 * environment with no jsdom (see vitest.config.js), and Leaflet touches
 * `window` at module scope — importing the component here would not merely fail
 * to render it, it would fail to load. So this suite asserts the properties
 * that are decidable from the source and that would otherwise only be caught by
 * a person remembering them, in the same style as
 * scheduledReportsModule.test.js and incidentSubmission.test.js.
 *
 * WHAT THIS SUITE DOES NOT PROVE. Nothing about Leaflet's runtime behaviour —
 * that a click really places a pin, that a drag really snaps back, that two
 * maps really coexist. Those need a browser, and are Checkpoint 3's business.
 * Passing here is not browser verification and must never be reported as such.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), 'utf8');

const picker = read('LocationPicker.jsx');
const mapping = read('..', '..', 'pages', 'Mapping.jsx');

/** The picker with comments stripped: assertions are about code, not prose. */
const code = picker
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** One `// ===== Heading =====` section of the component, up to the next one. */
function section(heading) {
  const start = picker.indexOf(`// ===== ${heading} =====`);
  expect(start, `${heading} section not found`).toBeGreaterThan(-1);
  const next = picker.indexOf('\n  // ===== ', start + 1);
  return picker.slice(start, next === -1 ? picker.indexOf('\n  return (') : next);
}

describe('LocationPicker — it owns exactly one map, and takes it with it', () => {
  it('creates a single Leaflet map', () => {
    expect(code.match(/L\.map\(/g)).toHaveLength(1);
  });

  it('builds the map in an effect that does not depend on the coordinates', () => {
    // The whole reason the map is not rebuilt on every keystroke: a new
    // coordinate moves the marker, it does not build a new map.
    const init = section('The map itself');
    expect(init).toContain('useEffect(() => {');
    expect(init.trimEnd().endsWith('}, [offerCandidate]);')).toBe(true);
    expect(init).not.toMatch(/\}, \[[^\]]*latitude/);
  });

  it('guards against building a second map into the same container', () => {
    expect(code).toContain('if (!containerRef.current || mapInstance.current) return');
  });

  it('destroys the map and clears every ref it owns', () => {
    const init = section('The map itself');
    for (const line of [
      'map.remove();',
      'mapInstance.current = null;',
      'markerRef.current = null;',
      'basemapLayerRef.current = null;',
      'boundaryLayerRef.current = null;',
      'lastValidPin.current = null;',
    ]) {
      expect(init, line).toContain(line);
    }
  });

  it('removes both listeners it registered', () => {
    const init = section('The map itself');
    expect(init).toContain("map.on('click', handleMapClick);");
    expect(init).toContain("map.off('click', handleMapClick);");
    // The marker's dragend handler goes with it.
    expect(init).toContain('markerRef.current?.off();');
    expect(code).toContain('markerRef.current.off();');
  });

  it('disconnects the resize observer it created', () => {
    expect(code).toContain('resizeObserver?.disconnect();');
  });
});

describe('LocationPicker — two-map safety', () => {
  it('mutates no global Leaflet state', () => {
    // Mapping.jsx legitimately patches L.Icon.Default at module scope for the
    // default marker's bundled image URLs. The picker must not depend on that
    // having happened, and must not do it a second time — so it uses a divIcon.
    expect(mapping).toContain('L.Icon.Default.mergeOptions');
    expect(code).not.toContain('L.Icon.Default');
    expect(code).not.toMatch(/delete\s+L\./);
    expect(code).toContain('L.divIcon(PIN_ICON_OPTIONS)');
  });

  it('reaches into no other component', () => {
    for (const forbidden of [
      'pages/Mapping',
      'IncidentModal',
      'incidentService',
      'DataContext',
      'useData',
      'useAuth',
      'browserLocation',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('identifies its container by ref and class, never by a shared id', () => {
    // Two pickers, or a picker beside the Mapping page, must not fight over a
    // document-unique id the way `#crime-map` would.
    expect(code).toContain('ref={containerRef}');
    expect(code).not.toMatch(/<div[^>]*\sid=/);
    expect(mapping).toContain('crime-map');
    expect(code).not.toContain('crime-map');
  });

  it('keeps its own base-map state rather than sharing one', () => {
    expect(code).toContain("const [basemap, setBasemap] = useState('street')");
  });
});

describe('LocationPicker — one boundary, one classifier, no copies', () => {
  it('classifies every candidate through the Checkpoint 1 helper', () => {
    expect(code).toContain("from './locationPickerState'");
    expect(code).toContain('pinStateFor(');
    // No second opinion about where the barangay is.
    expect(code).not.toContain('isWithinBarangay178');
    expect(code).not.toContain('isValidCoordinate');
    // The identifiers a re-implementation of geo.js's ray casting would carry.
    expect(code).not.toMatch(/crossesRing|intersectionLng|POLYGONS/);
  });

  it('draws the repository boundary and holds no geometry of its own', () => {
    expect(code).toContain('BARANGAY_178_BOUNDARY');
    expect(code).toContain('barangay178LatLngBounds()');
    expect(code).toContain("from '../../utils/geo'");
    // No inlined ring, and no second import of the GeoJSON file.
    expect(code).not.toContain('.geojson');
    expect(code).not.toMatch(/\[\s*121\.\d+\s*,\s*14\.\d+\s*\]/);
    expect(code).not.toMatch(/14\.7\d{3}/);
  });

  it('keeps the boundary out of the way of the clicks it exists to receive', () => {
    expect(code).toContain('interactive: false');
  });

  it('reads the base maps from the shared module instead of restating them', () => {
    expect(code).toContain("import { BASEMAPS } from '../../utils/basemaps'");
    expect(code).toContain('Object.entries(BASEMAPS)');
    expect(code).not.toContain('openstreetmap.org');
    expect(code).not.toContain('arcgisonline');
    expect(code).not.toContain('{z}/{x}/{y}');
  });
});

describe('LocationPicker — nothing is ever silently moved', () => {
  it('has no snapping, clamping or nearest-point logic', () => {
    expect(code).not.toMatch(/\bsnap|\bclamp|nearestPoint|closestPoint/i);
    // Leaflet's own way of forcing a point into a box.
    expect(code).not.toContain('.closestLayerPoint');
    expect(code).not.toContain('pannableBounds.contains');
  });

  it('places a marker only for a point inside the barangay', () => {
    const pin = section('The pin');
    expect(pin).toContain('if (state.status !== PIN_STATUS.INSIDE) {');
    expect(pin).toContain('map.removeLayer(markerRef.current);');
    expect(pin).toContain('draggable: true');
  });

  it('returns a refused drag to the last accepted position', () => {
    const pin = section('The pin');
    expect(pin).toContain("marker.on('dragend'");
    // Through the same gate as a click, and back to the previous pin — not to
    // the boundary, and not left where it was dropped.
    expect(pin).toContain('offerCandidate(lat, lng)');
    expect(pin).toContain('marker.setLatLng(lastValidPin.current)');
  });
});

describe('LocationPicker — the controlled contract', () => {
  it('reports a coordinate only in response to a user action', () => {
    // onChange is called from offerCandidate, which only a click or a dragend
    // reaches. The effect that syncs the props must never answer the parent
    // with the value the parent just sent — that is how a render loop starts.
    expect(code.match(/onChangeRef\.current\?\.\(/g)).toHaveLength(1);
    expect(section('The pin')).not.toContain('onChangeRef');
    expect(section('Base map')).not.toContain('onChangeRef');
  });

  it('accepts exactly three props and keeps no coordinate state of its own', () => {
    expect(code).toContain('function LocationPicker({ latitude, longitude, onChange })');
    // The only useState calls are the base map and the notice; the pin's
    // position is derived from the props every time.
    expect(code.match(/useState\(/g)).toHaveLength(2);
    expect(code).not.toMatch(/useState\([^)]*latitude/);
  });

  it('re-derives the pin whenever the parent changes the coordinates', () => {
    expect(section('The pin').trimEnd().endsWith('}, [latitude, longitude, offerCandidate]);')).toBe(true);
  });
});

describe('LocationPicker — the checkpoint boundary', () => {
  it('adds no geolocation, and no fields that belong to the form', () => {
    // Current location is a later checkpoint; sitio, street and the coordinate
    // read-out belong to the modal, not to a reusable map.
    expect(code).not.toContain('geolocation');
    // Whole word: `position` is not a sitio field. There is no matching guard
    // for "street" — that is the BASEMAPS key for the OpenStreetMap layer here,
    // not the incident form's street field.
    expect(code).not.toMatch(/\bsitio\b/i);
    expect(code).not.toMatch(/<input/);
    expect(code).not.toMatch(/Clear location/i);
  });

  it('leaves the Crime Mapping page and its own map untouched', () => {
    // The page still owns everything it did before: its map, its clusters, its
    // heat layer and its own location marker.
    for (const own of [
      'const mapInstance = useRef(null);',
      'const layerRef = useRef(null);',
      'const userLocationRef = useRef(null);',
      'L.markerClusterGroup()',
      'L.heatLayer(',
    ]) {
      expect(mapping, own).toContain(own);
    }
    expect(mapping).not.toContain('LocationPicker');
  });
});
