import { Icons } from '../icons';

// Hero illustration: the five CDARS analytics modules and the path a record
// takes through them. It deliberately shows no figures. The previous preview
// displayed invented KPIs ("1,248 incidents") under a Demo Data badge, and a
// made-up number on the public face of a crime reporting system reads as a
// real statistic no matter how it is labelled.
const MODULES = [
  {
    icon: Icons.ClipboardList,
    name: 'Crime Data Collection',
    desc: 'Incidents encoded with a map-pinned location',
  },
  {
    icon: Icons.LayoutDashboard,
    name: 'Crime Reporting Dashboard',
    desc: 'Headline figures and recent official incidents',
  },
  {
    icon: Icons.MapPin,
    name: 'Crime Mapping and Visualization',
    desc: 'Markers, heatmap and clusters across the barangay',
  },
  {
    icon: Icons.BarChart3,
    name: 'Statistical Analysis',
    desc: 'Distributions, measures and cross-tabulations',
  },
  {
    icon: Icons.TrendingUp,
    name: 'Trend and Pattern Detection',
    desc: 'Trends, peak hours, forecasts and hotspots',
  },
];

const PIPELINE = ['Encode', 'Validate', 'Analyze', 'Report'];

export default function SystemPreview() {
  return (
    <div
      className="landing-preview-panel"
      role="img"
      aria-label="Overview of the five CDARS analytics modules: Crime Data Collection, Crime Reporting Dashboard, Crime Mapping and Visualization, Statistical Analysis, and Trend and Pattern Detection"
    >
      <div className="landing-preview-header">
        <div className="landing-preview-header-title">
          <Icons.Cluster size={16} strokeWidth={2.25} />
          <span>CDARS Analytics Modules</span>
        </div>
        <span className="landing-preview-badge">System Overview</span>
      </div>

      <ol className="landing-module-stack">
        {MODULES.map((m, i) => (
          <li key={m.name}>
            <span className="landing-module-index">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="landing-module-icon">
              <m.icon size={18} strokeWidth={2} />
            </span>
            <span className="landing-module-text">
              <strong>{m.name}</strong>
              <small>{m.desc}</small>
            </span>
          </li>
        ))}
      </ol>

      <div className="landing-preview-footer">
        <div className="landing-pipeline">
          {PIPELINE.map((step, i) => (
            <span key={step} className="landing-pipeline-step">
              {step}
              {i < PIPELINE.length - 1 && (
                <Icons.ChevronRight size={14} strokeWidth={2.25} />
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
