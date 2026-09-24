import { Icons } from '../icons';
import SystemPreview from './SystemPreview';

// Every figure in the trust strip is a property of the system, not a crime
// statistic: the five analytics modules, the four roles in ROLES
// (utils/constants.js), mandatory two-factor sign-in, and the rule that only
// validated records reach the analytics.
const TRUST = [
  { value: '5', label: 'Analytics modules' },
  { value: '4', label: 'Governance roles' },
  { value: '2FA', label: 'On every account' },
  { value: 'Validated', label: 'Official data only' },
];

export default function HeroSection() {
  return (
    <section id="home" className="landing-hero">
      <div className="landing-hero-bg" aria-hidden="true" />
      <div className="landing-hero-inner">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">
            <Icons.ShieldCheck size={14} strokeWidth={2.25} />
            Barangay 178 &middot; North Caloocan &middot; BADAC
          </span>

          <h1>
            Crime Data Analytics
            <br />
            <span className="landing-hero-accent">and Reporting System</span>
          </h1>

          <p className="landing-hero-appname">
            <span className="landing-acronym">CDARS</span>
            BADAC Analytics
          </p>

          <p className="landing-hero-desc">
            CDARS turns Barangay 178&rsquo;s validated crime records into
            dashboards, maps, statistics and trend reports, giving the Barangay
            Anti-Drug Abuse Council one trusted source of crime data for
            planning and decision-making.
          </p>

          {/* In-page navigation only. The page keeps a single sign-in entry
              point (the Login action in the navbar) plus the closing
              call-to-action. */}
          <div className="landing-hero-cta">
            <a href="#modules" className="btn btn-primary landing-hero-cta-primary">
              Explore the System{' '}
              <Icons.ArrowRight size={16} strokeWidth={2.25} />
            </a>
            <a href="#workflow" className="btn btn-secondary">
              How It Works
            </a>
          </div>

          <ul className="landing-hero-points">
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Validated
              data only
            </li>
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Two-factor
              sign-in
            </li>
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Full audit
              trail
            </li>
          </ul>
        </div>

        <div className="landing-hero-visual">
          <SystemPreview />
        </div>
      </div>

      <dl className="landing-trust">
        {TRUST.map((t) => (
          <div className="landing-trust-item" key={t.label}>
            <dt>{t.label}</dt>
            <dd>{t.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
