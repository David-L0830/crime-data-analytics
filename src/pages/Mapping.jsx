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
  CRIME_TYPES,
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

const CATEGORY_COLORS = {
  'Violent Crime': COLORS.orange,
  'Property Crime': COLORS.green,
  'Drug-Related': COLORS.green,
  'Financial Crime': COLORS.orange,
  Cybercrime: COLORS.black,
  'Public Order': 'rgba(42, 191, 117, 0.55)',
};

function popupContent(r) {
  return `<div style="min-width:200px;font-size:13px">
    <strong>${r.caseNumber}</strong><br>
    <b>${r.crimeType}</b> — ${r.category}<br>
    ${formatDate(r.date)} ${formatTime(r.time)}<br>
    ${r.street}, ${r.sitio}<br>
    Officer: ${r.reportingOfficer || '—'}<br>
    Status: <b>${r.status}</b><br>
    <a href="https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}" target="_blank" rel="noreferrer">Route to incident →</a>
  </div>`;
}

export default function Mapping() {
  const { records, CATEGORIES } = useData();
  const [filters, setFilters] = useState({});
  const [vizType, setVizType] = useState('markers');

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerRef = useRef(null);
  const boundaryDrawn = useRef(false);

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

    if (vizType === 'heatmap') {
      const heatData = filtered.map((r) => [r.latitude, r.longitude, 0.5]);
      layerRef.current = L.heatLayer(heatData, {
        radius: 25,
        blur: 15,
        maxZoom: 17,
      }).addTo(map);
    } else if (vizType === 'cluster') {
      const cluster = L.markerClusterGroup();
      filtered.forEach((r) => {
        const marker = L.circleMarker([r.latitude, r.longitude], {
          radius: 8,
          fillColor: CATEGORY_COLORS[r.category] || COLORS.green,
          color: COLORS.white,
          weight: 1.5,
          fillOpacity: 0.8,
        });
        marker.bindPopup(popupContent(r));
        cluster.addLayer(marker);
      });
      layerRef.current = cluster;
      map.addLayer(cluster);
    } else {
      const markers = filtered.map((r) => {
        const m = L.circleMarker([r.latitude, r.longitude], {
          radius: 8,
          fillColor: CATEGORY_COLORS[r.category] || COLORS.green,
          color: COLORS.white,
          weight: 1.5,
          fillOpacity: 0.8,
        });
        m.bindPopup(popupContent(r));
        return m;
      });
      layerRef.current = L.layerGroup(markers).addTo(map);
    }

    if (filtered.length) {
      const bounds = L.latLngBounds(
        filtered.map((r) => [r.latitude, r.longitude]),
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }

    setTimeout(() => map.invalidateSize(), 200);
  }, [filtered, vizType]);

  const bySitio = countBy(filtered, 'sitio');
  const topSitio = Object.entries(bySitio).sort((a, b) => b[1] - a[1])[0];
  const categoriesCount = Object.keys(countBy(filtered, 'category')).length;

  // Filters apply automatically on every change — no Apply Filters button.
  const setFilter = (id, value) =>
    setFilters((prev) => ({ ...prev, [id]: value }));

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
                  <option value="">All</option>
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
              <span>Categories</span>
              <strong>{categoriesCount}</strong>
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
