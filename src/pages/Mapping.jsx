import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import 'leaflet.heat';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import { incidentService } from '../services/incidentService';
import {
  filterRecords,
  formatDate,
  formatTime,
  countBy,
} from '../utils/helpers';
import { COLORS, SITIOS, STATUSES } from '../utils/constants';
import {
  BARANGAY_178_BOUNDARY,
  barangay178LatLngBounds,
  isValidCoordinate,
  isWithinBarangay178,
} from '../utils/geo';
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

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
    </section>
  );
}
