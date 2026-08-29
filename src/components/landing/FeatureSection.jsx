import { Icons } from '../icons';

const FEATURES = [
  {
    icon: Icons.Database,
    title: 'Crime Data Management',
    desc: 'Centralize and organize incident and crime-related records in one secure, searchable system.',
  },
  {
    icon: Icons.BarChart3,
    title: 'Crime Analytics',
    desc: 'Analyze crime frequency, categories, trends, and patterns to understand what is happening and where.',
  },
  {
    icon: Icons.MapPin,
    title: 'GIS-Based Crime Mapping',
    desc: 'Visualize crime incidents based on their geographic locations within Barangay 178.',
  },
  {
    icon: Icons.LayoutDashboard,
    title: 'Interactive Dashboards',
    desc: 'Clear, visual summaries that make crime data faster to read and easier to act on.',
  },
  {
    icon: Icons.Report,
    title: 'Crime Reporting',
    desc: 'Generate organized, exportable reports for authorized BADAC personnel and stakeholders.',
  },
  {
    icon: Icons.ShieldCheck,
    title: 'Secure Access',
    // "two-factor login" was inaccurate — sign-in performs no second-factor
    // challenge. Authenticator enrolment is real and available; enforcement
    // at login is not implemented, so this no longer claims it.
    desc: 'Protect sensitive records with verified sign-in, server-enforced role-based access control, and a full audit trail.',
  },
];

export default function FeatureSection() {
  return (
    <section id="features" className="landing-section landing-features">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <span className="landing-eyebrow landing-eyebrow-muted">
            Capabilities
          </span>
          <h2>Everything BADAC needs in one platform</h2>
          <p>
            Purpose-built modules for managing, understanding, and reporting on
            crime data across the barangay.
          </p>
        </div>

        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <div className="landing-feature-card" key={f.title}>
              <div className="landing-feature-icon">
                <f.icon size={22} strokeWidth={2} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="landing-stat-strip">
          <div className="landing-stat">
            <strong>5</strong>
            <span>Core Modules</span>
          </div>
          <div className="landing-stat">
            <strong>GIS</strong>
            <span>Crime Mapping</span>
          </div>
          <div className="landing-stat">
            <strong>Auto</strong>
            <span>Generated Reports</span>
          </div>
          <div className="landing-stat">
            <strong>RBAC</strong>
            <span>Role-Based Access</span>
          </div>
        </div>
      </div>
    </section>
  );
}
