import { Icons } from '../icons';

// The path every record takes, as the application actually enforces it:
// encoded as pending, validated or returned by a BADAC Validator or an
// Administrator, and only then counted by the analytics (Incident::official()).
const STEPS = [
  {
    icon: Icons.ClipboardList,
    label: 'Encode',
    role: 'Encoder',
    desc: 'The incident is logged with its details and a pinned location. It starts as pending review.',
  },
  {
    icon: Icons.ShieldCheck,
    label: 'Validate',
    role: 'BADAC Validator or Administrator',
    desc: 'The record is approved, or returned to the encoder with a reason for correction.',
  },
  {
    icon: Icons.BarChart3,
    label: 'Analyze',
    role: 'Dashboards, maps and charts',
    desc: 'Only validated, non-archived records reach the analytics modules.',
  },
  {
    icon: Icons.Report,
    label: 'Report',
    role: 'Exports and integrations',
    desc: 'Figures are exported, printed on the Barangay 178 letterhead, or pulled by partner systems.',
  },
];

export default function AnalyticsFlow() {
  return (
    <section id="workflow" className="landing-section landing-analytics">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <span className="landing-eyebrow landing-eyebrow-muted">
            How It Works
          </span>
          <h2>From encoded record to official figure</h2>
          <p>
            A record counts in CDARS only after someone other than its encoder
            has reviewed it. Unreviewed encodings never move a number that the
            council acts on.
          </p>
        </div>

        <ol className="landing-flow">
          {STEPS.map((step, i) => (
            <li className="landing-flow-step" key={step.label}>
              <div className="landing-flow-node">
                <step.icon size={20} strokeWidth={2.25} />
              </div>
              <span className="landing-flow-number">Step {i + 1}</span>
              <strong>{step.label}</strong>
              <em>{step.role}</em>
              <span>{step.desc}</span>
              {i < STEPS.length - 1 && (
                <span className="landing-flow-arrow" aria-hidden="true">
                  <Icons.ArrowRight size={18} strokeWidth={2} />
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
