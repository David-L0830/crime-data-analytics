import { Icons } from '../icons';
import hallPhoto from '../../assets/images/barangay178-hall.png';

export default function AboutSection() {
  return (
    <section id="about" className="landing-section landing-about">
      <div className="landing-section-inner landing-about-inner">
        <div className="landing-about-photo">
          <img src={hallPhoto} alt="Barangay 178 Hall, North Caloocan" />
        </div>
        <div className="landing-about-copy">
          <span className="landing-eyebrow landing-eyebrow-muted">
            <Icons.Building2 size={14} strokeWidth={2.25} /> About
          </span>
          <h2>About BADAC Analytics</h2>
          <p>
            BADAC Analytics is a Crime Data Analytics and Reporting System
            designed to help authorized personnel of Barangay 178, North
            Caloocan manage crime-related information and transform collected
            records into meaningful analytical insights.
          </p>
          <p>
            The system supports data management, visualization, analytics,
            mapping, and reporting to assist public safety planning and
            decision-making for the Barangay Anti-Drug Abuse Council (BADAC).
          </p>
        </div>
      </div>
    </section>
  );
}
