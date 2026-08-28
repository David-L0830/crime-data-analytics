import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import 'leaflet.heat';
import { useData } from '../hooks/useData';
import {
  filterRecords,
  formatDate,
  formatTime,
  countBy,
} from '../utils/helpers';
import {
  COLORS,
  SITIOS,
  STATUSES,
  BARANGAY_178_CENTER,
} from '../utils/constants';
import { Icons } from '../components/icons';

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
    ${row('Location', r.street)}
    ${row('Status', r.status)}
    ${row('Priority', r.priority)}
    <a class="map-popup-link" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${r.latitude},${r.longitude}`)}" target="_blank" rel="noreferrer">Route to incident →</a>
  </div>`;
}

export default function Mapping() {
  const { records, CRIME_TYPES, CATEGORIES, crimeTypeColors } = useData();
  const [filters, setFilters] = useState({});
  const [vizType, setVizType] = useState('markers');

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerRef = useRef(null);
  const boundaryDrawn = useRef(false);

  const colorFor = useMemo(
    () => (crimeType) => crimeTypeColors[crimeType] || UNKNOWN_TYPE_COLOR,
    [crimeTypeColors],
  );

  const filtered = useMemo(
    () =>
      filterRecords(
        records.filter(
          (r) => r.status !== 'Archived' && r.latitude && r.longitude,
        ),
        {
          crimeType: filters['map-crimeType'],
          category: filters['map-category'],
          sitio: filters['map-sitio'],
          status: filters['map-status'],
          dateFrom: filters['map-dateFrom'],
          dateTo: filters['map-dateTo'],
        },
      ),
    [records, filters],
  );

  // The legend lists the crime types actually plotted on the map right now,
  // in descending count, rather than every configured type — a legend full of
  // entries that appear nowhere on the map is noise. It is generated from the
  // data and the configured colours, so a crime type an Administrator adds
  // shows up here the first time an incident uses it, with no code change.
  const legend = useMemo(() => {
    const counts = countBy(filtered, 'crimeType');
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count, color: colorFor(name) }));
  }, [filtered, colorFor]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current).setView(
      [BARANGAY_178_CENTER.lat, BARANGAY_178_CENTER.lng],
      15,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapInstance.current);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (!boundaryDrawn.current) {
      L.circle([BARANGAY_178_CENTER.lat, BARANGAY_178_CENTER.lng], {
        radius: 500,
        color: COLORS.green,
        fillColor: COLORS.greenLight,
        weight: 2,
        dashArray: '5, 10',
      })
        .addTo(map)
        .bindTooltip('Barangay 178');
      boundaryDrawn.current = true;
    }

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    // One marker factory for both the plain and the clustered layer, so
    // clustering cannot drift into using a different colour rule than the
    // markers do. Clustering itself is unchanged — L.markerClusterGroup still
    // receives ordinary circleMarkers, which is what it clusters.
    const makeMarker = (r) => {
      const color = colorFor(r.crimeType);
      const marker = L.circleMarker([r.latitude, r.longitude], {
        radius: 8,
        fillColor: color,
        color: COLORS.white,
        weight: 1.5,
        fillOpacity: 0.85,
      });
      marker.bindPopup(popupContent(r, color));
      return marker;
    };

    if (vizType === 'heatmap') {
      const heatData = filtered.map((r) => [r.latitude, r.longitude, 0.5]);
      layerRef.current = L.heatLayer(heatData, {
        radius: 25,
        blur: 15,
        maxZoom: 17,
      }).addTo(map);
    } else if (vizType === 'cluster') {
      const cluster = L.markerClusterGroup();
      filtered.forEach((r) => cluster.addLayer(makeMarker(r)));
      layerRef.current = cluster;
      map.addLayer(cluster);
    } else {
      layerRef.current = L.layerGroup(filtered.map(makeMarker)).addTo(map);
    }

    if (filtered.length) {
      const bounds = L.latLngBounds(
        filtered.map((r) => [r.latitude, r.longitude]),
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }

    setTimeout(() => map.invalidateSize(), 200);
  }, [filtered, vizType, colorFor]);

  const bySitio = countBy(filtered, 'sitio');
  const topSitio = Object.entries(bySitio).sort((a, b) => b[1] - a[1])[0];

  // Filters apply automatically on every change — no Apply Filters button.
  const setFilter = (id, value) =>
    setFilters((prev) => ({ ...prev, [id]: value }));

  // Crime Type comes from the configured, enabled vocabulary (see
  // DataContext), not a hard-coded list — an Administrator adding a crime type
  // in System Settings makes it filterable here immediately.
  const fields = [
    { id: 'map-crimeType', label: 'Crime Type', options: CRIME_TYPES },
    { id: 'map-category', label: 'Category', options: CATEGORIES },
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
                <label>{f.label}</label>
                <select
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
              <label>From</label>
              <input
                type="date"
                value={filters['map-dateFrom'] || ''}
                onChange={(e) => setFilter('map-dateFrom', e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label>To</label>
              <input
                type="date"
                value={filters['map-dateTo'] || ''}
                onChange={(e) => setFilter('map-dateTo', e.target.value)}
              />
            </div>
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
              <Icons.Flame size={14} strokeWidth={2} /> Heatmap
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
              rather than crime type, so it is not shown there. */}
          {vizType !== 'heatmap' && (
            <>
              <h3>Crime Type</h3>
              <div className="map-legend">
                {legend.length === 0 && (
                  <div className="map-legend-empty">
                    No incidents match these filters.
                  </div>
                )}
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
          )}

          <h3>Statistics</h3>
          <div className="map-stats">
            <div className="stat-row">
              <span>Total Markers</span>
              <strong>{filtered.length}</strong>
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
          <div id="crime-map" ref={mapRef} />
        </div>
      </div>
    </section>
  );
}
