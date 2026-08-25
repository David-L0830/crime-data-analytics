import { Link } from 'react-router-dom';
import { Icons } from '../icons';
import DashboardPreview from './DashboardPreview';

export default function HeroSection() {
  return (
    <section id="home" className="landing-hero">
      <div className="landing-hero-inner">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">
            <Icons.ShieldCheck size={14} strokeWidth={2.25} />
            Barangay 178 &middot; North Caloocan
          </span>

          <h1>
            Smarter Crime Data.
            <br />
            <span className="landing-hero-accent">Safer Communities.</span>
          </h1>

          <p className="landing-hero-appname">
            BADAC Analytics — Crime Data Analytics &amp; Reporting System
          </p>

          <p className="landing-hero-desc">
            A centralized platform for managing, analyzing, visualizing, and
            reporting crime-related data for Barangay 178, North Caloocan —
            built to help the Barangay Anti-Drug Abuse Council turn records into
            safer, data-driven decisions.
          </p>

          <div className="landing-hero-cta">
            <Link
              to="/login"
              className="btn btn-primary landing-hero-cta-primary"
            >
              Access System <Icons.ArrowRight size={17} strokeWidth={2.25} />
            </Link>
            <a href="#features" className="btn btn-secondary">
              Explore Features
            </a>
          </div>

          <ul className="landing-hero-points">
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Manage crime
              records
            </li>
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Analyze trends
              &amp; patterns
            </li>
            <li>
              <Icons.CheckCircle2 size={16} strokeWidth={2.25} /> Visualize
              crime locations
            </li>
          </ul>
        </div>

        <div className="landing-hero-visual">
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}
