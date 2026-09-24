import { Icons } from '../icons';

// Claims only what the system enforces: two-factor is mandatory for every
// account (Email OTP or an authenticator app), the four roles are enforced by
// server-side middleware, the BADAC Validator is served no contact numbers or
// addresses, and sign-ins, record changes, validations and exports are
// audited.
const SECURITY_POINTS = [
  {
    icon: Icons.Lock,
    title: 'Two-factor sign-in on every account',
    desc: 'A password plus a second factor, either an emailed code or an authenticator app, for every user.',
  },
  {
    icon: Icons.Users,
    title: 'Four governance roles',
    desc: 'Super Administrator, Administrator, BADAC Validator and Encoder each reach only what their role allows, checked by the server on every request.',
  },
  {
    icon: Icons.ShieldCheck,
    title: 'Least-privilege records',
    desc: 'Contact numbers and addresses are withheld from roles that do not need them, and records are archived rather than deleted.',
  },
  {
    icon: Icons.ScrollText,
    title: 'Complete audit trail',
    desc: 'Sign-ins, record changes, validations and exports are logged for accountability and oversight.',
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
          <h2>Built for sensitive public safety data</h2>
          <p>
            Crime, victim and complainant records are sensitive. CDARS is
            designed around that and handles personal data in line with the
            Data Privacy Act of 2012 (RA 10173).
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
