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
            BADAC Analytics is the Crime Data Analytics and Reporting System
            (CDARS) of Barangay 178, North Caloocan. It helps authorized
            personnel record crime-related information and turn validated
            records into analysis the barangay can act on.
          </p>
          <p>
            CDARS is an analytics and reporting system. It collects, validates,
            maps, analyzes and reports crime data to support public safety
            planning and decision-making by the Barangay Anti-Drug Abuse
            Council (BADAC).
          </p>
        </div>
      </div>
    </section>
  );
}
