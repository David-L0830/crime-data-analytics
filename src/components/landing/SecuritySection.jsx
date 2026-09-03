import { Icons } from '../icons';

const SECURITY_POINTS = [
  {
    icon: Icons.Lock,
    title: 'Authenticated Access',
    // Two-factor is per-account and opt-in, but for an account that has
    // opted in it is genuinely required at sign-in — hence "optional ...
    // enforced ... for accounts that enrol" rather than either extreme.
    desc: 'Every session requires sign-in, with optional two-factor authentication enforced at login for accounts that enrol.',
  },
  {
    icon: Icons.Users,
    title: 'Role-Based Authorization',
    desc: 'Personnel only see the modules their role is permitted to access.',
  },
  {
    icon: Icons.ShieldCheck,
    title: 'Protected Records',
    desc: 'Crime, criminal, and victim data are safeguarded behind the login wall.',
  },
  {
    icon: Icons.ScrollText,
    title: 'Audit Logging',
    desc: 'Key actions are tracked to support accountability and oversight.',
  },
];

export default function SecuritySection() {
  return (
    <section id="security" className="landing-section landing-security">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <span className="landing-eyebrow landing-eyebrow-muted">
            Trust &amp; Safety
          </span>
          <h2>Built for Secure Public Safety Data Management</h2>
          <p>
            Crime and resident data are sensitive — the system is designed
            around that from the ground up.
          </p>
        </div>

        <div className="landing-security-grid">
          {SECURITY_POINTS.map((s) => (
            <div className="landing-security-card" key={s.title}>
              <div className="landing-security-icon">
                <s.icon size={20} strokeWidth={2.25} />
              </div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
