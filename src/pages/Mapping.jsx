import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import 'leaflet.heat';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import { usePendingAction } from '../hooks/usePendingAction';
import { incidentService } from '../services/incidentService';
import { exportWorkbook } from '../utils/exportWorkbook';
import { exportCsv } from '../utils/exportCsv';
import { auditLogService } from '../services/auditLogService';
import {
  filterRecords,
  formatDate,
  formatTime,
  countBy,
  today,
} from '../utils/helpers';
import { COLORS, SITIOS, STATUSES } from '../utils/constants';
import {
  BARANGAY_178_BOUNDARY,
  barangay178LatLngBounds,
  isValidCoordinate,
  isWithinBarangay178,
} from '../utils/geo';
import { BASEMAPS } from '../utils/basemaps';
import {
  geolocationSupported,
  locationPermission,
  requestCurrentPosition,
} from '../utils/browserLocation';
import { Icons } from '../components/icons';
import Button from '../components/ui/Button';

// Leaflet's default marker icon URLs break under Vite bundling — point them at the CDN instead.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Marker colour for a crime type whose colour the server has not supplied.
// In practice this only shows for the instant before /crime-types resolves, or
// for a record whose crime type was deleted outright — a visible neutral grey
// is the honest answer there, rather than borrowing another type's colour and
// misreporting what the marker is.
const UNKNOWN_TYPE_COLOR = '#94A3B8';

// Marker colour for an incident whose coordinate is real but is NOT inside
// Barangay 178. Deliberately not a crime-type colour: these must not read as
// ordinary barangay incidents, because they are not ones this system has
// jurisdiction over. See the classification block in the component.
const OUT_OF_AREA_COLOR = '#94A3B8';

// The viewer's own position. Not a crime-type colour and not the boundary's
// green — but colour is NOT what distinguishes it, and it cannot be: crime
// type colours are allocated by the server from an eighteen-hue palette (see
// CrimeTypeColorAllocator) that leaves no hue permanently free, so any colour
// chosen here could one day be issued to a crime type.
//
// What actually makes this marker unmistakable is its FORM. It is the only
// thing on the map drawn as a small solid dot inside a soft accuracy disc,
// the only marker with a white ring, and there is never more than one of it.
// A crime marker is an 8px circle with a thin white stroke and no disc around
// it. The two cannot be confused even if the palette collides, and the
// tooltip says "Your current location" outright.
const USER_LOCATION_COLOR = '#6366F1';

// How far outside the barangay the viewport may be dragged, in degrees —
// roughly 1.3 km on each side.
//
// The map is restricted, not imprisoned. Zero padding would clamp the
// viewport exactly to the boundary box, which makes the edges of the barangay
// impossible to inspect (they would always be flush against the frame) and
// makes the map feel broken when it hits the stop. This is enough room to see
// what is immediately around the barangay and to pan comfortably along its
// edge, and far too little to wander across Metro Manila.
const BOUNDS_PADDING_DEG = 0.012;

// Zoom floor. At the barangay's ~2.6 km extent this keeps the whole boundary
// comfortably in frame at the widest allowed zoom, and stops a scroll-wheel
// flick from zooming out to the whole of Luzon, which is the other half of
// "the map is about Barangay 178".
const MIN_ZOOM = 13;


// ---------------------------------------------------------------------------
// COLOUR MEANS CRIME TYPE. NOTHING ELSE.
// ---------------------------------------------------------------------------
// This module used to colour markers by CATEGORY, from a hard-coded object
// literal in this file, using a four-colour palette in which several different
// categories shared the same colour — so two differently coloured dots could
// mean the same thing and two identical dots could mean different things.
//
// Colour is now bound to crime type and to nothing else, and the binding lives
// in the database (crime_types.color), which is what makes it stable across
// refreshes, sessions, users and machines, and what lets an Administrator add
// a crime type in System Settings and have it appear here, coloured and in the
// legend, with no code change.
//
// Status and priority are still shown — in the popup, where they belong. They
// deliberately do not affect colour: one visual channel carrying two meanings
// is what made the old map hard to read.

// Escapes text before it goes into the popup's HTML string. Leaflet's
// bindPopup takes raw HTML, so a case description or street name containing
// `<` would otherwise be parsed as markup.
function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );
}

// The hover card.
//
// Shown on mouseover via Leaflet's tooltip, so the information appears without
// a click — see makeMarker(). It carries the same fields the click-popup does
// minus the directions link, because a link inside a tooltip that disappears
// when the pointer leaves it is a link nobody can reach.
//
// It observes exactly the same privacy rule as the popup below: case
// identification, classification, time and place, and nothing that names a
// person. The map payload itself does not contain victim, complainant or
// suspect details (see IncidentController::map), so that rule is enforced a
// layer deeper than this file as well.
function tooltipContent(r, color) {
  const row = (label, value) =>
    value
      ? `<div class="map-tip-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
      : '';

  // The out-of-area banner is the whole reason an out-of-boundary incident is
  // allowed on screen at all: it is shown, but it is never shown as though it
  // were an ordinary Barangay 178 incident.
  const outOfArea =
    r.coordinateState === 'outside'
      ? '<div class="map-tip-warning">Recorded location is outside Barangay 178</div>'
      : '';

  return `<div class="map-tip">
    <div class="map-tip-head">
      <span class="map-tip-swatch" style="background:${escapeHtml(color)}"></span>
      <strong>${escapeHtml(r.caseNumber || r.incidentCode || 'Incident')}</strong>
    </div>
    <div class="map-tip-type">${escapeHtml(r.crimeType || '—')}</div>
    ${outOfArea}
    ${row('Incident Code', r.incidentCode)}
    ${row('Category', r.category)}
    ${row('Date', formatDate(r.date))}
    ${row('Time', formatTime(r.time))}
    ${row('Sitio', r.sitio)}
    ${row('Location', r.location)}
    ${row('Status', r.status)}
    ${row('Priority', r.priority)}
  </div>`;
}

function popupContent(r, color) {
  const row = (label, value) =>
    `<div class="map-popup-row"><span>${label}</span><strong>${escapeHtml(value || '—')}</strong></div>`;

  // Case number, crime type, date, time, sitio, status and priority — what an
  // officer needs to identify and triage the case from the map.
  //
  // Victim, complainant and suspect names are deliberately absent. A map is a
  // public-facing surface that can be projected in a barangay hall or printed;
  // pinning a named individual to a house on it is a disclosure this module
  // has no reason to make, and the full record is one click away in Crime Data
  // Collection for anyone authorised to see it.
  return `<div class="map-popup">
    <div class="map-popup-head">
      <span class="map-popup-swatch" style="background:${escapeHtml(color)}"></span>
      <strong>${escapeHtml(r.caseNumber)}</strong>
    </div>
    <div class="map-popup-type">${escapeHtml(r.crimeType)}</div>
    ${row('Date', formatDate(r.date))}
    ${row('Time', formatTime(r.time))}
    ${row('Sitio', r.sitio)}
    ${row('Location', r.location)}
    ${row('Status', r.status)}
    ${row('Priority', r.priority)}
    <a class="map-popup-link" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${r.latitude},${r.longitude}`)}" target="_blank" rel="noreferrer">Route to incident →</a>
  </div>`;
}

export default function Mapping() {
  const { CRIME_TYPES, crimeTypeColors } = useData();
  const { showToast } = useToast();
  const [filters, setFilters] = useState({});
  const [vizType, setVizType] = useState('markers');
  // Which base map is drawn underneath everything else. Street by default: it
  // is the view that names the roads an incident report refers to, and the one
  // whose survey the boundary polygon comes from.
  const [basemap, setBasemap] = useState('street');

  // MY LOCATION. All three pieces of this are session state that dies with the
  // component — nothing here is written to localStorage, to Laravel, or to
  // Supabase. See utils/browserLocation for why that is deliberate.
  //
  // `userLocation` is the coordinate to draw, or null for "not located".
  // `locating` disables the button while a fix is being acquired, which can
  // legitimately take several seconds indoors.
  // `locationNotice` is what the sidebar says about the last attempt: a
  // failure, or the outside-the-barangay case, which is not a failure at all.
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState(null);
  // Whether incidents whose recorded location is outside the barangay are drawn
  // at all. On by default: hiding data by default is how a known problem
  // becomes an invisible one. The control exists because an officer reading the
  // barangay's own crime picture is entitled to a view containing only it.
  const [showOutOfArea, setShowOutOfArea] = useState(true);

  // Crime Mapping reads GET /incidents/map rather than the shared `records`
  // slice, which carries the full incident payload — victim, suspect and
  // complainant names, contacts and addresses, and the narrative description.
  // None of that is used by this page, and a map is a surface that gets
  // projected in a barangay hall or printed, so it has no business receiving
  // identifying details at all. The endpoint returns eleven fields and filters
  // out archived and uncoordinated incidents server-side.
  //
  // Fetched here rather than through DataContext because this is the only
  // consumer: adding a context slice would pull map data on every login,
  // including for people who never open this page.
  const [mapIncidents, setMapIncidents] = useState([]);
  const [mapLoading, setMapLoading] = useState(true);
  // Separate from `mapLoading` because a settled request and a successful one
  // are not the same thing. Without this the sidebar cannot tell a failed load
  // apart from a barangay with nothing to plot — both leave `mapIncidents`
  // empty — and it would state the second when the first is what happened.
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    incidentService
      .map()
      .then((data) => {
        if (cancelled) return;
        setMapIncidents(data || []);
        setMapLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // A failed request must not read as "no crimes here". The map would be
        // empty either way, so the difference has to be said out loud — by the
        // toast, and by the sidebar message, which unlike the toast does not
        // disappear after 3.5 seconds and leave the failure looking like zero.
        // Only set here: the request is made once and there is no retry, so
        // there is no path back from this flag.
        setMapLoading(false);
        setMapError(true);
        showToast('Could not load crime mapping data.', 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerRef = useRef(null);
  const basemapLayerRef = useRef(null);
  // The viewer's own position, on its OWN reference.
  //
  // This is the whole reason My Location survives everything else the map
  // does. layerRef is torn down and rebuilt on every filter change, every
  // visualization switch and every crime-colour change; basemapLayerRef is
  // torn down and rebuilt on every base-map switch. Each of those effects
  // removes only the layer held in its own ref, so a location marker kept
  // here is untouched by all of them — and conversely, nothing in this
  // location effect can disturb the markers, clusters, heatmap or tiles.
  const userLocationRef = useRef(null);

  const colorFor = useMemo(
    () => (crimeType) => crimeTypeColors[crimeType] || UNKNOWN_TYPE_COLOR,
    [crimeTypeColors],
  );

  // COORDINATE CLASSIFICATION — three outcomes, not two.
  //
  // The old predicate was `r.latitude && r.longitude`, which is a truthiness
  // test standing in for a validity test. It silently dropped a coordinate of
  // exactly 0 (correctly, as it happens, but by accident) and silently ACCEPTED
  // a numeric string, a value out of range, or a point in the South China Sea —
  // and the database contains an example of the last one, because the API used
  // to validate coordinates only as "somewhere on Earth".
  //
  // Each incident is now labelled:
  //   'invalid'  no coordinate, or not a usable one. Not plotted at all. This
  //              is NOT dropped silently: the sidebar states how many there
  //              are, because an incident missing from a map with no
  //              explanation is worse than one that is missing with one.
  //   'outside'  a real point, but not inside Barangay 178. Plotted — but
  //              visibly differently, and captioned as out of area, so it can
  //              never be read as an ordinary barangay incident. Its stored
  //              coordinates are never altered to make the map look tidier.
  //   'inside'   a real point inside the barangay.
  const classified = useMemo(
    () =>
      mapIncidents.map((r) => ({
        ...r,
        coordinateState: !isValidCoordinate(r.latitude, r.longitude)
          ? 'invalid'
          : isWithinBarangay178(r.latitude, r.longitude)
            ? 'inside'
            : 'outside',
      })),
    [mapIncidents],
  );

  // Everything the map could plot if no filter were set. This predicate used to
  // live inline inside `filtered` below; it is lifted out — same predicate, same
  // result, `filtered` unchanged — because the sidebar has to tell "nothing was
  // recorded" apart from "the filters excluded everything", and only the
  // unfiltered base can answer that.
  const plottable = useMemo(
    () =>
      classified.filter(
        (r) => r.status !== 'Archived' && r.coordinateState !== 'invalid',
      ),
    [classified],
  );

  // Counts for the sidebar. Derived from the unfiltered base on purpose: "how
  // much of this barangay's data cannot be shown on a barangay map" is a fact
  // about the records, not about the filter currently applied.
  const coordinateCounts = useMemo(() => {
    const live = classified.filter((r) => r.status !== 'Archived');

    return {
      inside: live.filter((r) => r.coordinateState === 'inside').length,
      outside: live.filter((r) => r.coordinateState === 'outside').length,
      invalid: live.filter((r) => r.coordinateState === 'invalid').length,
    };
  }, [classified]);

  // No category filter. The map payload deliberately does not carry `category`,
  // and filterRecords compares it strictly — passing an undefined field against
  // a selected value would exclude every incident and render an empty map with
  // no explanation. Crime Type, Sitio, Status and the date range are unchanged.
  const filtered = useMemo(
    () =>
      filterRecords(plottable, {
        crimeType: filters['map-crimeType'],
        sitio: filters['map-sitio'],
        status: filters['map-status'],
        dateFrom: filters['map-dateFrom'],
        dateTo: filters['map-dateTo'],
      }),
    [plottable, filters],
  );

  // What is actually drawn: the filtered set, minus out-of-area incidents when
  // the viewer has chosen to exclude them. Kept separate from `filtered` so the
  // sidebar can still report how many exist while none of them is on screen.
  const visible = useMemo(
    () =>
      showOutOfArea
        ? filtered
        : filtered.filter((r) => r.coordinateState !== 'outside'),
    [filtered, showOutOfArea],
  );

  // The legend lists the crime types actually plotted on the map right now,
  // in descending count, rather than every configured type — a legend full of
  // entries that appear nowhere on the map is noise. It is generated from the
  // data and the configured colours, so a crime type an Administrator adds
  // shows up here the first time an incident uses it, with no code change.
  //
  // Built from the incidents INSIDE the barangay only. The legend is a key to
  // the map's colours, and out-of-area incidents are deliberately not drawn in
  // a crime-type colour, so counting them here would put a number beside a
  // swatch that matches nothing on screen — and would quietly report an
  // incident from another barangay as part of this barangay's crime picture.
  const legend = useMemo(() => {
    const counts = countBy(
      visible.filter((r) => r.coordinateState === 'inside'),
      'crimeType',
    );
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count, color: colorFor(name) }));
  }, [visible, colorFor]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // THE VIEWPORT IS DERIVED FROM THE BOUNDARY, not from a centre and a zoom.
    //
    // It used to be setView(14.7323, 121.027, 15) — a hardcoded point about
    // 4.3 km south-west of the barangay, in the Bagbag/Novaliches part of
    // Quezon City. Fitting the real polygon's bounds instead means the map
    // opens on exactly the barangay, at whatever zoom actually frames it, and
    // that both follow automatically if the boundary file is ever updated.
    const boundaryBounds = L.latLngBounds(barangay178LatLngBounds());

    // Panning is limited to the barangay plus a fixed margin.
    //
    // Written out rather than using Leaflet's bounds.pad(), which takes a RATIO
    // of the box's size — that would make the allowance scale with whatever
    // boundary is loaded, so a smaller barangay would get a proportionally
    // smaller margin. An explicit degree margin keeps the allowance the same
    // real-world distance whatever the boundary's dimensions are.
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

    const map = L.map(mapRef.current, {
      maxBounds: pannableBounds,
      // Firm but not rigid: a drag past the edge resists and springs back
      // rather than stopping dead, which reads as a deliberate limit rather
      // than a broken map.
      maxBoundsViscosity: 0.9,
      minZoom: MIN_ZOOM,
      maxZoom: 19,
    });

    // Leaflet requires a view before any layer is added, so this is not
    // redundant with the fit in the layer effect below — it is what makes the
    // map valid at all on first render.
    map.fitBounds(boundaryBounds, { padding: [24, 24] });

    // The base map is NOT added here. It is owned by the effect below, which
    // keyed on `basemap` is the only thing that adds or removes a tile layer —
    // so there is exactly one code path that can put tiles on this map, and
    // switching base maps cannot leave two stacked on top of each other.

    // THE REAL BOUNDARY, replacing a 500 m circle drawn around a point in
    // another city.
    //
    // The circle was wrong twice over: wrong place, and wrong shape at the
    // wrong scale — Barangay 178 is roughly 2.6 km across and is not a disc.
    // This is OpenStreetMap relation 11322824 rendered as-is (ODbL,
    // © OpenStreetMap contributors), stored in the repository so it draws
    // correctly with no third-party request at view time. See src/utils/geo.js
    // for the provenance and the cross-check.
    //
    // interactive: false so the polygon never swallows a click or a hover meant
    // for a marker sitting on top of it.
    //
    // ADDED HERE, WITH THE TILE LAYER, and not in the marker effect below.
    // It used to live there behind a `boundaryDrawn` ref that was set once and
    // never reset. That ref belongs to the COMPONENT, but the map belongs to
    // THIS EFFECT — and React Strict Mode (enabled in main.jsx) mounts,
    // unmounts and remounts every effect in development. The unmount ran this
    // effect's cleanup, destroying the map and its boundary, while the ref
    // survived on the same component instance and reported "already drawn" —
    // so on the second mount the boundary was never added to the new map and
    // simply did not appear at all in development. Browser verification caught
    // it. Tying the boundary to the map's own lifecycle removes the
    // possibility: a new map always gets a new boundary, and a destroyed map
    // takes its boundary with it.
    L.geoJSON(BARANGAY_178_BOUNDARY, {
      interactive: false,
      style: {
        color: COLORS.green,
        fillColor: COLORS.greenLight,
        fillOpacity: 0.12,
        weight: 2.5,
        dashArray: '6, 8',
      },
    }).addTo(map);

    mapInstance.current = map;

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  // BASE-MAP SWAP — the only place a tile layer is added or removed.
  //
  // Declared after the effect that creates the map, so on first render the map
  // already exists by the time this runs (effects run in declaration order and
  // mapInstance.current is assigned synchronously above). On a StrictMode
  // remount React runs every cleanup and then every effect again, so the map is
  // rebuilt and this puts a fresh tile layer on the fresh map.
  //
  // ONLY THE BASE LAYER CHANGES. The boundary, markers, clusters and heat layer
  // live in Leaflet's overlayPane and marker pane; tiles live in the tilePane
  // underneath. Removing and adding a tile layer therefore cannot disturb any
  // overlay — they are not touched here, and the map's view, maxBounds and zoom
  // limits belong to the map object itself, which this effect never recreates.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Remove the outgoing layer BEFORE adding the incoming one, so the two are
    // never both attached — stacked semi-transparent tiles would otherwise
    // render as a muddy blend of street and imagery.
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
      // Guarded: by the time this runs on unmount the init effect's cleanup may
      // already have destroyed the map, taking its layers with it.
      if (basemapLayerRef.current && mapInstance.current) {
        mapInstance.current.removeLayer(basemapLayerRef.current);
      }
      basemapLayerRef.current = null;
    };
  }, [basemap]);

  // THE VIEWER'S OWN POSITION — its own layer, its own effect, its own ref.
  //
  // Keyed on `userLocation` alone. It therefore does not re-run when filters,
  // visualization type, crime colours or the base map change, which is exactly
  // what "the location marker survives a map refresh" means in practice: the
  // marker is not redrawn because it is never removed. On a StrictMode
  // remount React runs every cleanup and then every effect again, so the map
  // is rebuilt and this puts the marker back on the fresh map, the same way
  // the base-map effect above puts back its tiles.
  //
  // NO fitBounds, NO setView, NO maxBounds. This effect only adds and removes
  // an overlay. Moving the view is the click handler's decision, made once per
  // click and only when the position is inside the barangay — a view change
  // here would fight the marker effect's own fit on every filter change.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return undefined;

    if (userLocationRef.current) {
      map.removeLayer(userLocationRef.current);
      userLocationRef.current = null;
    }

    if (!userLocation) return undefined;

    const { latitude, longitude, accuracy } = userLocation;

    // The accuracy disc is drawn first so the dot sits on top of it. It is a
    // real radius in metres, not decoration: a fix accurate to 2 km and a fix
    // accurate to 8 m are very different claims about where somebody is, and
    // a bare dot asserts the precise one regardless. Omitted when the browser
    // reports no accuracy, rather than invented.
    const parts = [];

    if (typeof accuracy === 'number' && accuracy > 0) {
      parts.push(
        L.circle([latitude, longitude], {
          radius: accuracy,
          color: USER_LOCATION_COLOR,
          weight: 1,
          opacity: 0.45,
          fillColor: USER_LOCATION_COLOR,
          fillOpacity: 0.12,
          // Not interactive: it can be hundreds of metres across, and a
          // clickable disc that size would swallow every incident marker
          // underneath it.
          interactive: false,
        }),
      );
    }

    const dot = L.circleMarker([latitude, longitude], {
      radius: 6,
      fillColor: USER_LOCATION_COLOR,
      color: COLORS.white,
      weight: 3,
      fillOpacity: 1,
    });

    dot.bindTooltip('<div class="map-tip"><strong>Your current location</strong></div>', {
      direction: 'auto',
      offset: [0, 0],
      opacity: 1,
      sticky: false,
      className: 'map-hover-tip',
    });

    parts.push(dot);

    userLocationRef.current = L.layerGroup(parts).addTo(map);

    return () => {
      // Guarded the same way the base-map cleanup is: by the time this runs on
      // unmount the init effect's cleanup may already have destroyed the map,
      // taking its layers with it.
      if (userLocationRef.current && mapInstance.current) {
        mapInstance.current.removeLayer(userLocationRef.current);
      }
      userLocationRef.current = null;
    };
  }, [userLocation]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    // One marker factory for both the plain and the clustered layer, so
    // clustering cannot drift into using a different colour rule than the
    // markers do. Clustering itself is unchanged — L.markerClusterGroup still
    // receives ordinary circleMarkers, which is what it clusters.
    const makeMarker = (r) => {
      const outside = r.coordinateState === 'outside';
      // Colour means crime type — unless the incident is not in this barangay,
      // in which case saying anything about its crime type in the map's own
      // colour language would assert it as a Barangay 178 statistic. Those are
      // drawn hollow and neutral instead: present, findable, and visibly not
      // part of the picture the legend describes.
      const color = outside ? OUT_OF_AREA_COLOR : colorFor(r.crimeType);

      const marker = L.circleMarker([r.latitude, r.longitude], {
        radius: outside ? 7 : 8,
        fillColor: color,
        color: outside ? OUT_OF_AREA_COLOR : COLORS.white,
        weight: outside ? 2 : 1.5,
        fillOpacity: outside ? 0.15 : 0.85,
        dashArray: outside ? '3, 3' : undefined,
      });

      // HOVER. The information appears on mouseover with no click required —
      // this is what the click-only bindPopup could not do.
      //
      // A Leaflet tooltip rather than opening the popup on mouseover, for three
      // reasons that all matter here: Leaflet manages exactly one visible
      // tooltip at a time, so passing the pointer across a dense cluster of
      // pins cannot leave a trail of open cards behind; it closes itself on
      // mouseout without any bookkeeping; and it does not steal the popup, so
      // clicking still opens the fuller card with its directions link.
      //
      // Bound per marker and created lazily by Leaflet, so this is NOT "one
      // permanent popup for every marker" — nothing is rendered until a pointer
      // actually enters a pin.
      //
      // sticky: false anchors the card above the pin rather than chasing the
      // cursor; on a map where pins can be a few pixels apart, a card that
      // follows the pointer covers the neighbouring pins you are trying to
      // reach.
      // direction: 'auto' places the card BESIDE the pin — left or right
      // depending on which half of the map the pin is in — rather than above it.
      //
      // 'top' was tried first and clipped. Leaflet renders tooltips inside the
      // map pane, which clips at the container edge and has no auto-pan for
      // tooltips the way popups do, so a card roughly 200px tall above a pin
      // within 200px of the top edge loses its first several rows — including
      // the case number. Browser verification caught exactly that. Placed
      // beside the pin the card is vertically centred instead, so it only needs
      // ~100px of clearance above and below, which the viewport always has.
      marker.bindTooltip(tooltipContent(r, color), {
        direction: 'auto',
        offset: [0, 0],
        opacity: 1,
        sticky: false,
        className: 'map-hover-tip',
      });

      marker.bindPopup(popupContent(r, color));
      return marker;
    };

    if (vizType === 'heatmap') {
      // Density of BARANGAY incidents only. A heatmap has no per-point
      // labelling, so an out-of-area point folded into it would become an
      // indistinguishable part of a hotspot reading — the one place these
      // records genuinely cannot be shown honestly is a surface that averages
      // them together. They are counted in the sidebar instead.
      const heatData = visible
        .filter((r) => r.coordinateState === 'inside')
        .map((r) => [r.latitude, r.longitude, 0.5]);
      layerRef.current = L.heatLayer(heatData, {
        radius: 25,
        blur: 15,
        maxZoom: 17,
      }).addTo(map);
    } else if (vizType === 'cluster') {
      const cluster = L.markerClusterGroup();
      visible.forEach((r) => cluster.addLayer(makeMarker(r)));

      // Hovering a CLUSTER says how many incidents it stands for. Without this
      // the hover interaction would simply stop working wherever pins are dense
      // enough to be grouped — which is exactly where an officer most wants to
      // know what is underneath. The individual markers keep their own hover
      // cards, which appear once the cluster is zoomed into or spiderfied.
      cluster.on('clustermouseover', (e) => {
        const count = e.layer.getAllChildMarkers().length;
        e.layer
          .bindTooltip(
            `<div class="map-tip"><strong>${count} incident${count === 1 ? '' : 's'}</strong>` +
              '<div class="map-tip-type">Zoom in or click to see each one</div></div>',
            { direction: 'top', offset: [0, -12], opacity: 1, className: 'map-hover-tip' },
          )
          .openTooltip();
      });
      cluster.on('clustermouseout', (e) => e.layer.closeTooltip());

      layerRef.current = cluster;
      map.addLayer(cluster);
    } else {
      layerRef.current = L.layerGroup(visible.map(makeMarker)).addTo(map);
    }

    // Fit to the incidents that are actually IN the barangay.
    //
    // Fitting to every plotted point would let one incident recorded kilometres
    // away drag the viewport off the barangay entirely — and since the map is
    // now clamped by maxBounds, the fit would be silently clipped and land
    // somewhere neither the data nor the boundary justifies. With nothing
    // inside to fit, the map simply stays on the barangay, which is the honest
    // default for a barangay map with no barangay incidents to show.
    const insideVisible = visible.filter((r) => r.coordinateState === 'inside');

    if (insideVisible.length) {
      map.fitBounds(
        L.latLngBounds(insideVisible.map((r) => [r.latitude, r.longitude])),
        { padding: [40, 40], maxZoom: 17 },
      );
    } else {
      map.fitBounds(L.latLngBounds(barangay178LatLngBounds()), {
        padding: [24, 24],
      });
    }

    setTimeout(() => map.invalidateSize(), 200);
  }, [visible, vizType, colorFor]);

  // The four states an empty map can be in, said out loud rather than left to
  // an unexplained blank. Kept inline because nothing outside this sidebar
  // consumes the decision.
  //
  // The order is the point. A request that is still running and a request that
  // failed both leave the data empty, so testing emptiness first would report
  // "No incidents have been recorded" about incidents nobody has looked for
  // yet, or about a load that never returned. Filters are only a truthful
  // explanation once incidents actually arrived, which is why that case reads
  // `plottable` — the unfiltered base — rather than `filtered`. Null when there
  // is something on the map, so nothing is said when nothing needs saying.
  let mapStatus = null;
  if (mapLoading) mapStatus = 'Loading incidents…';
  else if (mapError) mapStatus = 'Could not load incidents.';
  else if (!plottable.length) mapStatus = 'No incidents have been recorded.';
  else if (!filtered.length) mapStatus = 'No incidents match these filters.';
  // A fifth case, which did not exist while the map's own centre was wrong:
  // records exist and pass the filters, but none of them was recorded inside
  // the barangay. Saying "no incidents match these filters" there would be
  // false, and saying nothing would leave an empty map unexplained.
  else if (!visible.some((r) => r.coordinateState === 'inside'))
    mapStatus = 'No incidents were recorded inside Barangay 178.';

  // Held once so the two branches below render the same node rather than two
  // copies of the same markup that could drift apart.
  const statusNode = mapStatus ? (
    <div className="map-legend-empty">{mapStatus}</div>
  ) : null;

  // "Top Sitio" is a claim about this barangay, so it is computed from the
  // incidents actually inside it — a hotspot figure that included a case from
  // another city would be a wrong answer to the question the panel asks.
  const bySitio = countBy(
    visible.filter((r) => r.coordinateState === 'inside'),
    'sitio',
  );
  const topSitio = Object.entries(bySitio).sort((a, b) => b[1] - a[1])[0];

  // Filters apply automatically on every change — no Apply Filters button.
  const setFilter = (id, value) =>
    setFilters((prev) => ({ ...prev, [id]: value }));

  // MY LOCATION — the only path in this application that can ask for the
  // browser's location, and it runs only from the button's click.
  //
  // The permission is READ before anything is requested, because a decision
  // that is already 'denied' must produce an explanation rather than another
  // request. Re-asking a blocked permission does not re-prompt — the browser
  // rejects it immediately — so the only thing a blind retry would achieve is
  // a spinner followed by the same message, one round-trip later.
  const handleLocate = async () => {
    if (locating) return;
    setLocating(true);
    setLocationNotice(null);

    try {
      const state = await locationPermission();

      if (state === 'unsupported') {
        setLocationNotice({
          tone: 'muted',
          text: 'This browser cannot provide your location.',
        });
        return;
      }

      if (state === 'denied') {
        setLocationNotice({
          tone: 'muted',
          text: 'Location access is blocked for this site. To use My Location, allow location for this site in your browser settings (usually via the icon at the left of the address bar), then reload the page.',
        });
        return;
      }

      // 'granted' and 'prompt' both come here. The browser prompts, or does
      // not, according to what it has already been told — that decision is
      // the browser's to make and this code does not try to second-guess it.
      const position = await requestCurrentPosition();

      if (!isValidCoordinate(position.latitude, position.longitude)) {
        setLocationNotice({
          tone: 'error',
          text: 'Your browser returned a location that is not a usable coordinate.',
        });
        return;
      }

      setUserLocation(position);

      const map = mapInstance.current;
      const inside = isWithinBarangay178(position.latitude, position.longitude);

      if (inside) {
        // setView, never fitBounds. fitBounds belongs to the incident layer
        // and to the initial view; borrowing it here would recompute the
        // viewport from a bounding box that has nothing to do with the data.
        //
        // The zoom never decreases: somebody already looking closely at a
        // street should not be pulled back out by asking where they are.
        if (map) {
          map.setView(
            [position.latitude, position.longitude],
            Math.max(map.getZoom(), 17),
          );
        }
        setLocationNotice(null);
      } else {
        // OUTSIDE THE BARANGAY. The map's restriction is not relaxed for this
        // and the view is not moved — maxBounds stays exactly as configured,
        // and a setView beyond it would only rubber-band back, which reads as
        // a broken button. The marker is still added (it is within the
        // pannable margin often enough to be visible, and drawing it is the
        // honest answer to "where am I"), and the sidebar says plainly why
        // nothing moved.
        setLocationNotice({
          tone: 'warning',
          text: 'Your current location is outside Barangay 178. The map stays on the barangay.',
        });
      }
    } catch (err) {
      // LocationError messages are already written for a user to read; see
      // utils/browserLocation. Raw browser error text never reaches here.
      setLocationNotice({
        tone: err?.code === 'denied' ? 'muted' : 'error',
        text: err?.message || 'Your location could not be determined.',
      });
    } finally {
      setLocating(false);
    }
  };

  const clearUserLocation = () => {
    setUserLocation(null);
    setLocationNotice(null);
  };

  // One definition, consumed by the workbook's metadata line and by the
  // reporting-process record below, so the exported file and the history of
  // the run always describe the same filter state. Same pattern as
  // Dashboard.jsx and Analytics.jsx.
  //
  // No Category row, deliberately: this page cannot filter by category (see
  // `filtered` above), so naming one here would describe a filter that was
  // never applied.
  const filterSummary = [
    `From: ${filters['map-dateFrom'] || 'Any'}`,
    `To: ${filters['map-dateTo'] || 'Any'}`,
    `Crime Type: ${filters['map-crimeType'] || 'All'}`,
    `Sitio: ${filters['map-sitio'] || 'All'}`,
    `Status: ${filters['map-status'] || 'All'}`,
  ].join(' · ');

  // ONE projection, shared by the .xlsx and the .csv below, so the two files
  // can never drift apart: same columns, same order, same labels, same rows.
  //
  // THE COLUMNS ARE BOUNDED BY THE PAYLOAD, NOT BY CONVENIENCE. Every field
  // here comes from GET /incidents/map, which carries a location and a
  // classification and nothing that names a person — see IncidentController::
  // map(), where that rule is stated. No complainant, victim, suspect or
  // officer detail exists in this component to export, and none may be fetched
  // in order to add one: a map export is a record of where crimes happened,
  // and a named individual attached to a coordinate is precisely the
  // disclosure this module exists to avoid.
  //
  // Rows are `filtered`, not `visible`. `visible` differs only by the
  // out-of-area display toggle, which is a choice about what to DRAW; an
  // incident that matched the filters belongs in the export whether or not the
  // viewer has it switched on, and the coordinates say plainly where it is.
  const exportSpec = () => ({
    sheetName: 'Crime Mapping',
    title: 'Crime Mapping and Visualization Report',
    subtitle: 'Crime Data Analytics & Reporting System',
    meta: [`Filters: ${filterSummary}`],
    columns: [
      // The incident's identifier as this system shows it — the same
      // incidentCode the map tooltip prints. NOT the internal database id,
      // which is row plumbing and not a reporting field.
      { header: 'Incident ID', key: 'incidentCode', width: 16 },
      { header: 'Case Number', key: 'caseNumber', width: 16 },
      { header: 'Date', key: 'date', type: 'date', width: 14 },
      {
        header: 'Time',
        key: 'time',
        width: 10,
        align: 'center',
        value: (r) => formatTime(r.time),
      },
      { header: 'Crime Type', key: 'crimeType', width: 20 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Sitio', key: 'sitio', width: 14 },
      { header: 'Street / Location', key: 'location', width: 28, wrap: true },
      { header: 'Status', key: 'status', width: 18, align: 'center' },
      { header: 'Priority', key: 'priority', width: 12, align: 'center' },
      // Written as numbers with six decimals rather than text, so a
      // spreadsheet can plot or join on them. The stored value is exported
      // exactly as recorded — never rounded to tidy the map's own out-of-area
      // points into the barangay.
      {
        header: 'Latitude',
        key: 'latitude',
        type: 'number',
        width: 14,
        numFmt: '0.000000',
      },
      {
        header: 'Longitude',
        key: 'longitude',
        type: 'number',
        width: 14,
        numFmt: '0.000000',
      },
    ],
    rows: filtered,
    onEmpty: () => showToast('No data to export', 'error'),
    onError: () => showToast('Could not export report.', 'error'),
  });

  // The SCOPE of the run, recorded as report execution history (report_runs)
  // — how many rows it covered, over what period, under which filters. Counts
  // and filter text only; never the exported rows themselves.
  //
  // Nothing is invented: the period is whatever the two date inputs hold, so
  // an unbounded export reports no period rather than a fabricated one.
  const exportMeta = () => ({
    rowCount: filtered.length,
    periodFrom: filters['map-dateFrom'] || null,
    periodTo: filters['map-dateTo'] || null,
    filtersSummary: filterSummary,
  });

  // Wrapped in usePendingAction so the button can show that it is working and
  // refuses a second click while it is: exportWorkbook() pulls exceljs in on
  // first use, which is the one operation here slow enough to look broken.
  const [exporting, handleExportExcel] = usePendingAction(async () => {
    const ok = await exportWorkbook({
      filename: `brgy178_crime_mapping_${today()}.xlsx`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Crime mapping data exported to Excel', 'success');
      // Recorded only on success, so neither the audit trail nor the run
      // history ever claims an export that did not happen. Not awaited: a
      // completed download must not wait on, or be failed by, follow-up
      // bookkeeping.
      auditLogService.logExport('mapping', exportMeta());
    }
  });

  // Same projection, same filtered rows, comma-separated. Synchronous because
  // exportCsv needs no dynamic import — see the note there.
  const handleExportCsv = () => {
    const ok = exportCsv({
      filename: `brgy178_crime_mapping_${today()}.csv`,
      ...exportSpec(),
    });
    if (ok) {
      showToast('Crime mapping data exported to CSV', 'success');
      // Same report key as the workbook above: the trail records WHICH report
      // left the system. AuditLogController::REPORTS is the server-side
      // whitelist it must match.
      auditLogService.logExport('mapping', exportMeta());
    }
  };

  // Crime Type comes from the configured, enabled vocabulary (see
  // DataContext), not a hard-coded list — an Administrator adding a crime type
  // in System Settings makes it filterable here immediately.
  const fields = [
    { id: 'map-crimeType', label: 'Crime Type', options: CRIME_TYPES },
    { id: 'map-sitio', label: 'Sitio', options: SITIOS },
    { id: 'map-status', label: 'Status', options: STATUSES },
  ];

  return (
    <section className="module">
      <div className="map-layout">
        <div className="map-sidebar card">
          <h3>
            <Icons.Filter size={16} strokeWidth={2} /> Map Filters
          </h3>
          <div>
            {fields.map((f) => (
              <div className="filter-group" key={f.id}>
                {/* `f.id` doubles as the DOM id: the three ids are literals
                    declared above and are unique on this page. */}
                <label htmlFor={f.id}>{f.label}</label>
                <select
                  id={f.id}
                  value={filters[f.id] || ''}
                  onChange={(e) => setFilter(f.id, e.target.value)}
                >
                  <option value="">
                    {f.id === 'map-crimeType' ? 'All Crime Types' : 'All'}
                  </option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="filter-group">
              <label htmlFor="map-dateFrom">From</label>
              <input
                id="map-dateFrom"
                type="date"
                value={filters['map-dateFrom'] || ''}
                onChange={(e) => setFilter('map-dateFrom', e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label htmlFor="map-dateTo">To</label>
              <input
                id="map-dateTo"
                type="date"
                value={filters['map-dateTo'] || ''}
                onChange={(e) => setFilter('map-dateTo', e.target.value)}
              />
            </div>
            {/* Crime Mapping builds its own filter controls rather than using
                the shared FilterBar, so it needs its own Clear Filters. These
                inputs read `filters` directly — there is no second copy of the
                state to fall out of step — so emptying it clears the controls
                and the map together.

                Visualization type is deliberately untouched: markers, clusters
                and the heatmap are how the same filtered data is drawn, not
                part of what is being filtered. */}
            <Button
              variant="secondary"
              onClick={() => setFilters({})}
              style={{ marginTop: 12, width: '100%' }}
            >
              Clear Filters
            </Button>
          </div>

          {/* BASE MAP. Separate from Visualization on purpose: visualization is
              how the incidents are drawn, base map is what they are drawn over.
              Changing one must never be mistaken for changing the other, and
              they are independent — every visualization works over either base.

              Rendered from BASEMAPS so the control cannot list an option the
              map does not implement, or omit one it does. */}
          <h3>Base Map</h3>
          <div className="map-viz-options">
            {Object.entries(BASEMAPS).map(([key, config]) => (
              <label key={key}>
                <input
                  type="radio"
                  name="base-map"
                  value={key}
                  checked={basemap === key}
                  onChange={() => setBasemap(key)}
                />{' '}
                {key === 'satellite' ? (
                  <Icons.Globe size={14} strokeWidth={2} />
                ) : (
                  <Icons.Map size={14} strokeWidth={2} />
                )}{' '}
                {config.label}
              </label>
            ))}
          </div>

          {/* MY LOCATION. Between Base Map and Visualization because it is
              neither: it is not what the incidents are drawn over, and it is
              not how they are drawn — it is the one control on this page that
              is about the person reading the map rather than the data.

              OPTIONAL, AND NEVER AUTOMATIC. Nothing requests location when
              this page mounts; the request happens inside this button's click
              handler and nowhere else. The coordinate it produces stays in
              this component and is never sent to Laravel or Supabase. */}
          <h3>My Location</h3>
          <div className="map-my-location">
            {geolocationSupported() ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleLocate}
                  disabled={locating}
                  style={{ width: '100%' }}
                >
                  <Icons.Crosshair size={14} strokeWidth={2} />{' '}
                  {locating ? 'Finding you…' : 'Show My Location'}
                </Button>

                {/* Only once there is something to clear. The marker is not
                    removed by anything else on this page, so this is the only
                    way to take it off — which is why it exists. */}
                {userLocation && !locating && (
                  <button
                    type="button"
                    className="map-location-clear"
                    onClick={clearUserLocation}
                  >
                    Hide my location
                  </button>
                )}

                {locationNotice && (
                  <p className={`map-location-notice ${locationNotice.tone}`}>
                    {locationNotice.text}
                  </p>
                )}
              </>
            ) : (
              <p className="map-location-notice muted">
                This browser cannot provide your location.
              </p>
            )}
          </div>

          <h3>Visualization</h3>
          <div className="map-viz-options">
            <label>
              <input
                type="radio"
                name="viz-type"
                value="markers"
                checked={vizType === 'markers'}
                onChange={() => setVizType('markers')}
              />{' '}
              <Icons.Info size={14} strokeWidth={2} /> Pin Markers
            </label>
            <label>
              <input
                type="radio"
                name="viz-type"
                value="heatmap"
                checked={vizType === 'heatmap'}
                onChange={() => setVizType('heatmap')}
              />{' '}
              <Icons.Flame size={14} strokeWidth={2} /> Crime Heatmap
            </label>
            <label>
              <input
                type="radio"
                name="viz-type"
                value="cluster"
                checked={vizType === 'cluster'}
                onChange={() => setVizType('cluster')}
              />{' '}
              <Icons.Cluster size={14} strokeWidth={2} /> Clustered
            </label>
          </div>

          {/* The legend is meaningless for the heatmap, which encodes density
              rather than crime type, so it is not shown there. The state
              message is not meaningless there: a heatmap left blank by a failed
              load has exactly as much to explain as a marker map left blank by
              one, and it used to say nothing at all because the only message on
              this page lived inside the legend that the heatmap suppresses. It
              now renders in both branches. */}
          {vizType !== 'heatmap' ? (
            <>
              <h3>Crime Type</h3>
              <div className="map-legend">
                {statusNode}
                {legend.map((entry) => (
                  <div className="map-legend-item" key={entry.name}>
                    <span
                      className="map-legend-dot"
                      style={{ background: entry.color }}
                      aria-hidden="true"
                    />
                    <span className="map-legend-label">{entry.name}</span>
                    <span className="map-legend-count">{entry.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            statusNode
          )}

          {/* DATA QUALITY. Shown whenever there is something to report, and
              never quietly suppressed: an incident that the map cannot place
              inside the barangay is a fact about the records, and a map that
              silently omitted it would be the thing that hid the problem.

              The counts come from the unfiltered base, so this reports the
              state of the data rather than the state of the current filter. */}
          {!mapLoading &&
            !mapError &&
            (coordinateCounts.outside > 0 || coordinateCounts.invalid > 0) && (
              <>
                <h3>Data Quality</h3>
                <div className="map-data-quality">
                  {coordinateCounts.outside > 0 && (
                    <>
                      <p>
                        <strong>{coordinateCounts.outside}</strong> incident
                        {coordinateCounts.outside === 1 ? ' has' : 's have'} a
                        recorded location outside Barangay 178. They are drawn
                        hollow and grey, are excluded from the Crime Heatmap,
                        the legend and the Top Sitio figure, and their stored
                        coordinates have not been altered.
                      </p>
                      <label className="map-outofarea-toggle">
                        <input
                          type="checkbox"
                          checked={showOutOfArea}
                          onChange={(e) => setShowOutOfArea(e.target.checked)}
                        />{' '}
                        Show out-of-area incidents
                      </label>
                    </>
                  )}
                  {coordinateCounts.invalid > 0 && (
                    <p>
                      <strong>{coordinateCounts.invalid}</strong> incident
                      {coordinateCounts.invalid === 1 ? '' : 's'} cannot be
                      plotted at all — no location was recorded, or the recorded
                      one is not a usable coordinate. They are not placed
                      anywhere on the map.
                    </p>
                  )}
                </div>
              </>
            )}

          <h3>Statistics</h3>
          <div className="map-stats">
            <div className="stat-row">
              <span>Markers in Barangay 178</span>
              {/* A dash until the request settles, so an in-flight fetch is not
                  read as a barangay with zero incidents. Counts what is on the
                  map AND inside the boundary — the number this barangay's crime
                  picture is actually made of. */}
              <strong>
                {mapLoading
                  ? '—'
                  : visible.filter((r) => r.coordinateState === 'inside').length}
              </strong>
            </div>
            <div className="stat-row">
              <span>Top Sitio</span>
              <strong>{topSitio ? topSitio[0] : '—'}</strong>
            </div>
            <div className="stat-row">
              <span>Hotspot Count</span>
              <strong>{topSitio ? topSitio[1] : 0}</strong>
            </div>
            <div className="stat-row">
              <span>Crime Types</span>
              <strong>{legend.length}</strong>
            </div>
          </div>
        </div>
        <div className="map-container card">
          {/* Says what the map is, in the map. The viewport is restricted to
              this barangay, so somebody who cannot pan out to recognise the
              surrounding city has no other way to know what they are looking
              at — and the boundary source is named because a boundary asserted
              without provenance is just another circle drawn on a map. */}
          <div className="map-caption">
            <span className="map-caption-title">
              <Icons.MapPin size={14} strokeWidth={2.25} /> Barangay 178,
              Camarin, North Caloocan
            </span>
            <span className="map-caption-source">
              Boundary: OpenStreetMap relation 11322824 (ODbL)
            </span>
          </div>
          <div id="crime-map" ref={mapRef} />
        </div>
      </div>

      {/* Crime Mapping was the only tabular module with no export at all, so
          reporting from it meant reading figures off the screen. The same
          .export-bar every other module uses, in the same place — below the
          content it exports — so the control is where a user already expects
          it. No Print button: this page's content is a Leaflet canvas, and a
          printed screenshot of a map is not the document PrintReport produces
          elsewhere. */}
      <div className="export-bar">
        <Button
          variant="secondary"
          onClick={handleExportExcel}
          disabled={exporting}
          aria-busy={exporting}
        >
          {exporting ? (
            <>
              <span className="spinner spinner-inline" aria-hidden="true" />{' '}
              Exporting…
            </>
          ) : (
            <>
              <Icons.Download size={15} strokeWidth={2} /> Export Excel
            </>
          )}
        </Button>
        <Button variant="secondary" onClick={handleExportCsv}>
          <Icons.Download size={15} strokeWidth={2} /> Export CSV
        </Button>
      </div>
    </section>
  );
}
