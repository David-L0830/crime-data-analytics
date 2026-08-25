import { Link } from 'react-router-dom';
import { Icons } from '../icons';

export default function CtaSection() {
  return (
    <section className="landing-cta">
      <div className="landing-cta-inner">
        <h2>Ready to access BADAC Analytics?</h2>
        <p>
          Sign in to access the secure crime data management and analytics
          platform.
        </p>
        <Link to="/login" className="btn btn-primary landing-cta-btn">
          Login to BADAC Analytics{' '}
          <Icons.ArrowRight size={17} strokeWidth={2.25} />
        </Link>
      </div>
    </section>
  );
}
