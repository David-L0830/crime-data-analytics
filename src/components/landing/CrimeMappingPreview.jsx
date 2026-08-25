import { Icons } from '../icons';

// Stylized, static markers only — never real coordinates or live data.
// This is a design mock of the authenticated Mapping module (see
// src/pages/Mapping.jsx, which renders the real Leaflet map behind login).
const MOCK_MARKERS = [
  { top: '28%', left: '34%', kind: 'high' },
  { top: '46%', left: '58%', kind: 'medium' },
  { top: '62%', left: '30%', kind: 'high' },
  { top: '38%', left: '72%', kind: 'low' },
  { top: '70%', left: '62%', kind: 'medium' },
  { top: '20%', left: '60%', kind: 'low' },
];

export default function CrimeMappingPreview() {
  return (
    <section className="landing-section landing-mapping">
      <div className="landing-section-inner landing-mapping-inner">
        <div className="landing-section-heading landing-mapping-heading">
          <span className="landing-eyebrow landing-eyebrow-muted">
            GIS Mapping
          </span>
          <h2>See Where Crime Happens</h2>
          <p>
            Authorized personnel can visualize incident locations across
            Barangay 178 — spotting hotspots, streets, and sitios that need
            attention at a glance.
          </p>
          <ul className="landing-benefit-list landing-mapping-list">
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Barangay-wide
              boundary view
            </li>
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Heatmap-style
              risk visualization
            </li>
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Street &amp;
              sitio-level detail
            </li>
          </ul>
        </div>

        <div
          className="landing-map-panel"
          role="img"
          aria-label="Stylized preview of the BADAC Analytics crime mapping module with sample markers"
        >
          <div className="landing-map-panel-header">
            <span>
              <Icons.MapPin size={15} strokeWidth={2.25} /> Barangay 178
              &middot; Sample View
            </span>
            <span className="landing-preview-badge">
              <Icons.Info size={12} strokeWidth={2.5} /> System Preview
            </span>
          </div>
          <div className="landing-map-canvas">
            <div className="landing-map-grid" aria-hidden="true" />
            <div className="landing-map-boundary" aria-hidden="true" />
            {MOCK_MARKERS.map((m, i) => (
              <span
                key={i}
                className={`landing-map-marker landing-map-marker-${m.kind}`}
                style={{ top: m.top, left: m.left }}
                aria-hidden="true"
              />
            ))}
          </div>
          <div className="landing-map-legend">
            <span>
              <i className="landing-legend-dot landing-legend-high" /> High risk
            </span>
            <span>
              <i className="landing-legend-dot landing-legend-medium" /> Medium
            </span>
            <span>
              <i className="landing-legend-dot landing-legend-low" /> Low
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
