import { Icons } from '../icons';

// The five CDARS analytics modules, named exactly as the sidebar names them
// (NAV_ITEMS in utils/constants.js), and the three governance modules. Each
// description states only what that module does today.
const MODULES = [
  {
    icon: Icons.ClipboardList,
    title: 'Crime Data Collection',
    desc: 'Encoders record incidents with case details, the people involved, evidence items and a map-pinned location. The street and sitio are looked up automatically from the pin.',
  },
  {
    icon: Icons.LayoutDashboard,
    title: 'Crime Reporting Dashboard',
    desc: 'Headline figures, crime type and sitio breakdowns, hotspot locations and recent incidents, with an embedded interactive dashboard.',
  },
  {
    icon: Icons.MapPin,
    title: 'Crime Mapping and Visualization',
    desc: 'Official incidents plotted inside the Barangay 178 boundary as markers, a heatmap or clusters, filtered by crime type, category, sitio and status.',
  },
  {
    icon: Icons.BarChart3,
    title: 'Statistical Analysis',
    desc: 'Monthly and yearly distributions, category, gender and age breakdowns, statistical measures and a category × sitio cross-tabulation.',
  },
  {
    icon: Icons.TrendingUp,
    title: 'Trend and Pattern Detection',
    desc: 'Daily, weekly and seasonal trends, peak crime hours, a moving-average forecast and hotspot detection by sitio.',
  },
];

const GOVERNANCE = [
  {
    icon: Icons.ScrollText,
    title: 'Audit Logs',
    desc: 'Sign-ins, record changes, validations and exports, filterable and exportable.',
  },
  {
    icon: Icons.Users,
    title: 'User Management',
    desc: 'Accounts and two-factor enrolment, with each tier managing the tier below it.',
  },
  {
    icon: Icons.Settings,
    title: 'System Settings',
    desc: 'Crime types, alert thresholds, Metabase embedding status and external integrations.',
  },
];

export default function FeatureSection() {
  return (
    <section id="modules" className="landing-section landing-features">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <span className="landing-eyebrow landing-eyebrow-muted">
            System Modules
          </span>
          <h2>Five analytics modules, one source of truth</h2>
          <p>
            Every module reads the same validated records, so a figure on the
            dashboard, a point on the map and a line on a trend chart always
            agree with each other.
          </p>
        </div>

        <div className="landing-feature-grid">
          {MODULES.map((m, i) => (
            <article className="landing-feature-card" key={m.title}>
              <div className="landing-feature-top">
                <div className="landing-feature-icon">
                  <m.icon size={22} strokeWidth={2} />
                </div>
                <span className="landing-feature-index">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3>{m.title}</h3>
              <p>{m.desc}</p>
            </article>
          ))}
        </div>

        <div className="landing-governance">
          <h3 className="landing-governance-title">
            <Icons.ShieldCheck size={16} strokeWidth={2.25} /> System
            governance
          </h3>
          <div className="landing-governance-grid">
            {GOVERNANCE.map((g) => (
              <div className="landing-governance-item" key={g.title}>
                <g.icon size={18} strokeWidth={2} />
                <div>
                  <strong>{g.title}</strong>
                  <p>{g.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
