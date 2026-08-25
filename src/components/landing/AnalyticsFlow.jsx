import { Icons } from '../icons';

const FLOW_STEPS = [
  {
    icon: Icons.Database,
    label: 'Data',
    desc: 'Incidents & records are logged',
  },
  {
    icon: Icons.BarChart3,
    label: 'Analysis',
    desc: 'Patterns & trends surfaced',
  },
  {
    icon: Icons.TrendingUp,
    label: 'Insights',
    desc: 'Hotspots & risks identified',
  },
  {
    icon: Icons.CheckCircle2,
    label: 'Better Decisions',
    desc: 'Evidence-based action',
  },
];

const BENEFITS = [
  'Identify crime trends over time',
  'Detect recurring patterns across categories',
  'Understand high-risk locations',
  'Monitor changes month to month',
  'Support evidence-based decisions',
  'Improve reporting efficiency',
];

export default function AnalyticsFlow() {
  return (
    <section id="analytics" className="landing-section landing-analytics">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <span className="landing-eyebrow landing-eyebrow-muted">
            Data-Driven
          </span>
          <h2>Turn Crime Records Into Actionable Insights</h2>
          <p>
            BADAC Analytics transforms collected crime records into insight the
            council can act on.
          </p>
        </div>

        <div className="landing-flow">
          {FLOW_STEPS.map((step, i) => (
            <div className="landing-flow-step" key={step.label}>
              <div className="landing-flow-node">
                <step.icon size={20} strokeWidth={2.25} />
              </div>
              <strong>{step.label}</strong>
              <span>{step.desc}</span>
              {i < FLOW_STEPS.length - 1 && (
                <span className="landing-flow-arrow" aria-hidden="true">
                  <Icons.ArrowRight size={18} strokeWidth={2} />
                </span>
              )}
            </div>
          ))}
        </div>

        <ul className="landing-benefit-list">
          {BENEFITS.map((b) => (
            <li key={b}>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} />
              {b}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
