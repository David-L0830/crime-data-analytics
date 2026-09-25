import { Icons } from '../icons';

// Reporting inside CDARS and the BPA Level 2 outputs to the two sub-systems.
// The integration paths are the real endpoints in IntegrationController, and
// the "pull" wording is deliberate: CDARS pushes nothing to either module.
const REPORTS = [
  {
    icon: Icons.Download,
    title: 'Excel and CSV exports',
    desc: 'Each export writes a fixed, declared set of report columns, never internal database fields.',
  },
  {
    icon: Icons.Printer,
    title: 'Printable A4 reports',
    desc: 'Formatted on the official Barangay 178, North Caloocan letterhead.',
  },
  {
    icon: Icons.ScrollText,
    title: 'Recorded in the audit trail',
    desc: 'Exports are logged with who ran them and when.',
  },
];

const INTEGRATIONS = [
  {
    icon: Icons.Siren,
    name: 'Security Alert System Module',
    receives: 'Crime hotspots and risk areas by sitio',
    path: '/api/v1/integrations/security-alerts/hotspots',
  },
  {
    icon: Icons.TrendingUp,
    name: 'Campaign Planning Module',
    receives: 'Crime trends by month, type and category',
    path: '/api/v1/integrations/campaign-planning/trends',
  },
];

export default function ReportingSection() {
  return (
    <section id="reporting" className="landing-section landing-reporting">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <span className="landing-eyebrow landing-eyebrow-muted">
            Reporting &amp; Integration
          </span>
          <h2>Reports for the council, data for partner systems</h2>
          <p>
            CDARS produces reports for BADAC personnel and makes aggregated
            figures available to the sub-systems that plan the barangay&rsquo;s
            security alerts and awareness campaigns.
          </p>
        </div>

        <div className="landing-reporting-grid">
          <div className="landing-reporting-list">
            {REPORTS.map((r) => (
              <div className="landing-reporting-item" key={r.title}>
                <span className="landing-feature-icon">
                  <r.icon size={20} strokeWidth={2} />
                </span>
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="landing-integration-panel">
            <div className="landing-integration-source">
              <Icons.Database size={18} strokeWidth={2} />
              <div>
                <strong>CDARS</strong>
                <small>Validated incident records</small>
              </div>
            </div>
            <div className="landing-integration-links">
              {INTEGRATIONS.map((i) => (
                <div className="landing-integration-target" key={i.name}>
                  <span className="landing-integration-connector" aria-hidden="true" />
                  <div className="landing-integration-card">
                    <strong>
                      <i.icon size={16} strokeWidth={2.25} /> {i.name}
                    </strong>
                    <small>{i.receives}</small>
                    <code>GET {i.path}</code>
                  </div>
                </div>
              ))}
            </div>
            <p className="landing-integration-note">
              <Icons.Lock size={13} strokeWidth={2.25} /> Pull-based and
              read-only. Aggregated counts only, with no names, contact details
              or case numbers.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
