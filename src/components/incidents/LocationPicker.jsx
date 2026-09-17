import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BARANGAY_178_BOUNDARY, barangay178LatLngBounds } from '../../utils/geo';
import { BASEMAPS } from '../../utils/basemaps';
import { COLORS } from '../../utils/constants';
import { PIN_STATUS, pinStateFor } from './locationPickerState';

// A map the encoder points at, instead of two boxes they type coordinates into.
//
// WHAT THIS COMPONENT KNOWS, AND WHAT IT DELIBERATELY DOES NOT
//
// It knows about a latitude, a longitude and a boundary. It knows nothing about
// incidents, forms, sitios, services, roles, Supabase or the API — it takes two
// values and reports two values back. That is what makes it reviewable on its
// own and reusable anywhere a Barangay 178 point has to be picked.
//
// IT IS NOT A VALIDATOR. The authoritative check is server-side, in
// StoreIncidentRequest / UpdateIncidentRequest through the
// ValidatesIncidentLocation concern, which parses its own copy of the boundary
// and never trusts a client claim. Everything here exists so the encoder is
// told immediately rather than after a round trip.
//
// IT NEVER MOVES A COORDINATE. No snapping, no clamping, no nearest-point-on-
// the-boundary. A point outside Barangay 178 is refused and explained; a stored
// point outside the barangay is shown as-is and left alone. The backend forbids
// silent correction for the same reason — a crime record whose location the
// system edited on its own is worse than one that visibly failed to save,
// because nothing afterwards reveals that it happened.
//
// IT OWNS EVERY LEAFLET OBJECT IT CREATES, AND ONLY THOSE. Crime Mapping has
// its own map, and the two must be able to exist at once. So: no module-level
// Leaflet mutation (see the icon note below), no shared refs, no global state,
// no `id` on the container — everything is reached through this component's own
// refs and torn down with it.

/**
 * The pin, as a divIcon rather than Leaflet's default marker.
 *
 * WHY NOT THE DEFAULT. Leaflet's default icon is three PNG URLs that break
 * under Vite bundling, which src/pages/Mapping.jsx works around by deleting
 * `L.Icon.Default.prototype._getIconUrl` and merging CDN URLs into
 * `L.Icon.Default` — a mutation of GLOBAL Leaflet state, at module scope.
 *
 * That workaround is correct there and is not this component's to rely on:
 * depending on it would make this picker silently dependent on whether the
 * Mapping page happens to have been imported, and would mean the pin needs a
 * network round trip to unpkg.com to appear at all. A divIcon is drawn by CSS,
 * needs no image and no CDN, touches no global Leaflet state, and works with an
 * offline barangay laptop.
 *
 * Declared as plain options and turned into an icon inside the effect, so this
 * module calls nothing on Leaflet while it is being imported.
 */
const PIN_ICON_OPTIONS = {
  className: 'location-picker-pin',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
};

/**
 * How far outside the barangay the viewport may be dragged, in degrees, and the
 * furthest out it may be zoomed.
 *
 * The same values Crime Mapping uses, for the same reason: an explicit degree
 * margin keeps the allowance the same real-world distance whatever the boundary
 * measures, which `bounds.pad()` — a ratio of the box's size — would not.
 * Copied rather than imported because Mapping.jsx is a page, not a module this
 * may reach into, and this checkpoint must not modify it.
 */
const BOUNDS_PADDING_DEG = 0.012;
const MIN_ZOOM = 13;

/**
 * What the encoder is told when a location cannot be pinned.
 *
 * One message per status, phrased to fit both cases a status arrives from: a
 * point the encoder just clicked, and a coordinate already on the record. Each
 * one says plainly that nothing was changed, because the single most important
 * property of this picker is that it does not quietly edit a location.
 *
 * INCOMPLETE cannot arise from a click — a click always carries both halves —
 * so it is only ever the description of a half-written record. It is handled
 * anyway, because "cannot normally happen" is not "cannot happen".
 */
const NOTICES = {
  [PIN_STATUS.OUTSIDE]: {
    tone: 'warning',
    text: 'That location is outside Barangay 178. This system records incidents inside the barangay only. Nothing has been moved — choose a point inside the boundary.',
  },
  [PIN_STATUS.INCOMPLETE]: {
    tone: 'warning',
    text: 'This record holds only half a location. Choose a point on the map to set both coordinates, or clear the location.',
  },
  [PIN_STATUS.INVALID]: {
    tone: 'error',
    text: 'That is not a usable location. Nothing has been changed — choose a point inside the boundary.',
  },
};

/**
 * Pick a point inside Barangay 178.
 *
 * FULLY CONTROLLED. The marker's position is a function of the `latitude` and
 * `longitude` props and of nothing else: an accepted click or drag calls
 * `onChange` and then waits to be told. That is what makes an update loop
 * impossible — the component never calls `onChange` because a prop changed,
 * only because a person acted on the map — and it means the pin can never show
 * a location the parent does not hold.
 *
 * A parent that ignores `onChange` will therefore see no pin appear. That is
 * the controlled contract working, not a bug.
 *
 * @param {number|string|null} latitude   The current latitude, as stored.
 * @param {number|string|null} longitude  The current longitude, as stored.
 * @param {(latitude: number, longitude: number) => void} onChange
 *        Called ONLY with a point inside the barangay, and ONLY in response to
 *        a click or a completed drag.
 */
export default function LocationPicker({ latitude, longitude, onChange }) {
  const containerRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const basemapLayerRef = useRef(null);
  const boundaryLayerRef = useRef(null);

  // The pin's last accepted position, so a refused drag has somewhere to go
  // back to. Written only where the marker itself is placed.
  const lastValidPin = useRef(null);

  // `onChange` read through a ref, so the map's click listener is registered
  // once and never has to be torn down and re-registered because the parent
  // re-rendered with a new function identity.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const [basemap, setBasemap] = useState('street');
  const [notice, setNotice] = useState(null);

  /**
   * The single gate every candidate point passes through, whether it came from
   * a click or from the end of a drag.
   *
   * There is deliberately no second copy of the boundary logic here: it asks
   * pinStateFor (Checkpoint 1), which asks src/utils/geo.js, which reads the
   * one GeoJSON file the backend also validates against. Stable across renders
   * because it touches only refs and a state setter.
   *
   * @returns {boolean} whether the point was accepted.
   */
  const offerCandidate = useCallback((lat, lng) => {
    const next = pinStateFor(lat, lng);

    if (next.status === PIN_STATUS.INSIDE) {
      setNotice(null);
      onChangeRef.current?.(next.pin.lat, next.pin.lng);
      return true;
    }

    setNotice(NOTICES[next.status] ?? NOTICES[PIN_STATUS.INVALID]);
    return false;
  }, []);

  // ===== The map itself =====
  //
  // Created once and never rebuilt. Its dependency list is empty on purpose:
  // a new coordinate moves the marker (below), it does not build a new map.
  //
  // StrictMode-safe, the same way Crime Mapping's is: the map, its boundary and
  // its click listener are all created here and all destroyed by this effect's
  // own cleanup, so a development mount/unmount/remount cycle produces one live
  // map with one boundary and one listener rather than leftovers of either.
  useEffect(() => {
    if (!containerRef.current || mapInstance.current) return undefined;

    const boundaryBounds = L.latLngBounds(barangay178LatLngBounds());
    const pannableBounds = L.latLngBounds(
      [
        boundaryBounds.getSouth() - BOUNDS_PADDING_DEG,
        boundaryBounds.getWest() - BOUNDS_PADDING_DEG,
      ],
      [
        boundaryBounds.getNorth() + BOUNDS_PADDING_DEG,
        boundaryBounds.getEast() + BOUNDS_PADDING_DEG,
      ],
    );

    const map = L.map(containerRef.current, {
      maxBounds: pannableBounds,
      maxBoundsViscosity: 0.9,
      minZoom: MIN_ZOOM,
      maxZoom: 19,
    });

    // Leaflet needs a view before any layer is added. Fitted to the real
    // polygon's bounds rather than set from a centre and a zoom, so the picker
    // opens on exactly the barangay and follows the boundary file if it is ever
    // updated.
    map.fitBounds(boundaryBounds, { padding: [16, 16] });

    // The boundary the encoder is picking inside. Drawn from the same GeoJSON
    // the backend validates against — this component holds no geometry of its
    // own and does not modify what it draws.
    //
    // interactive: false is load-bearing here in a way it is not on the Mapping
    // page: a polygon that swallowed clicks would eat every click inside the
    // barangay, which is every click this component exists to receive.
    boundaryLayerRef.current = L.geoJSON(BARANGAY_178_BOUNDARY, {
      interactive: false,
      style: {
        color: COLORS.green,
        fillColor: COLORS.greenLight,
        fillOpacity: 0.12,
        weight: 2.5,
        dashArray: '6, 8',
      },
    }).addTo(map);

    const handleMapClick = (event) => {
      offerCandidate(event.latlng.lat, event.latlng.lng);
    };

    map.on('click', handleMapClick);

    // A map built inside a hidden or animating container measures itself as
    // zero and renders a strip of grey where the tiles should be. Watching the
    // container is what makes this component safe to drop into a modal that
    // fades in, which is exactly where it is going.
    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => map.invalidateSize());
      resizeObserver.observe(containerRef.current);
    }

    mapInstance.current = map;

    return () => {
      resizeObserver?.disconnect();
      // Explicit, though remove() would also drop them: the listeners this
      // component added are the listeners this component takes away.
      map.off('click', handleMapClick);
      markerRef.current?.off();
      map.remove();

      mapInstance.current = null;
      markerRef.current = null;
      basemapLayerRef.current = null;
      boundaryLayerRef.current = null;
      lastValidPin.current = null;
    };
  }, [offerCandidate]);

  // ===== Base map =====
  //
  // The only place a tile layer is added or removed, so switching base maps
  // cannot leave two stacked on top of each other. `basemap` is this
  // component's own state — Crime Mapping keeps its own, and neither can see
  // or change the other's.
  //
  // Tiles live in Leaflet's tilePane, underneath the overlayPane that holds the
  // boundary and the marker pane that holds the pin, so replacing them cannot
  // disturb either.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return undefined;

    if (basemapLayerRef.current) {
      map.removeLayer(basemapLayerRef.current);
      basemapLayerRef.current = null;
    }

    const config = BASEMAPS[basemap] ?? BASEMAPS.street;
    basemapLayerRef.current = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
    }).addTo(map);

    return () => {
      if (basemapLayerRef.current && mapInstance.current) {
        mapInstance.current.removeLayer(basemapLayerRef.current);
      }
      basemapLayerRef.current = null;
    };
  }, [basemap]);

  // ===== The pin =====
  //
  // Driven entirely by the props. Every case the picker can be handed is
  // decided by pinStateFor, and only INSIDE produces a marker:
  //
  //   INSIDE      pin at that point.
  //   NONE        no pin, no notice — a location is optional, and not having
  //               one is not a problem to report.
  //   OUTSIDE     no pin, explained. The stored values are untouched.
  //   INCOMPLETE  no pin, explained.
  //   INVALID     no pin, explained.
  //
  // Nothing here calls onChange. The parent is the one that changed these
  // props, and answering it with the value it just sent is how a render loop
  // starts.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const state = pinStateFor(latitude, longitude);

    if (state.status !== PIN_STATUS.INSIDE) {
      if (markerRef.current) {
        markerRef.current.off();
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      lastValidPin.current = null;
      setNotice(state.status === PIN_STATUS.NONE ? null : NOTICES[state.status]);
      return;
    }

    const position = [state.pin.lat, state.pin.lng];

    if (markerRef.current) {
      markerRef.current.setLatLng(position);
    } else {
      const marker = L.marker(position, {
        draggable: true,
        icon: L.divIcon(PIN_ICON_OPTIONS),
        keyboard: true,
        title: 'Incident location — drag to adjust',
      }).addTo(map);

      // A refused drag must not leave the pin where it was dropped, and must
      // not be pulled to the nearest point on the boundary either. It goes back
      // to the last position that was actually accepted.
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        if (!offerCandidate(lat, lng) && lastValidPin.current) {
          marker.setLatLng(lastValidPin.current);
        }
      });

      markerRef.current = marker;
    }

    lastValidPin.current = position;
    setNotice(null);
  }, [latitude, longitude, offerCandidate]);

  return (
    <div className="location-picker">
      <div className="location-picker-toolbar">
        <span className="location-picker-hint">
          Click the map to set the incident location.
        </span>

        {/* Rendered from BASEMAPS so this control cannot offer a base map the
            picker does not implement, or omit one it does. The tile URLs stay
            in src/utils/basemaps.js and are not repeated here. */}
        <div className="location-picker-basemaps" role="group" aria-label="Base map">
          {Object.entries(BASEMAPS).map(([key, config]) => (
            <button
              key={key}
              type="button"
              className={basemap === key ? 'is-active' : undefined}
              aria-pressed={basemap === key}
              onClick={() => setBasemap(key)}
            >
              {config.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="location-picker-map" />

      {notice && (
        <p className={`location-picker-notice ${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}
    </div>
  );
}
