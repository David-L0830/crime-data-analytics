import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { defaultRouteForRole } from '../utils/constants';
import LandingNavbar from '../components/landing/LandingNavbar';
import HeroSection from '../components/landing/HeroSection';
import FeatureSection from '../components/landing/FeatureSection';
import AnalyticsFlow from '../components/landing/AnalyticsFlow';
import CrimeMappingPreview from '../components/landing/CrimeMappingPreview';
import SecuritySection from '../components/landing/SecuritySection';
import AboutSection from '../components/landing/AboutSection';
import CtaSection from '../components/landing/CtaSection';
import LandingFooter from '../components/landing/LandingFooter';
import '../styles/landing.css';

// Public entry point — the flow is Landing ("/") -> Login ("/login") ->
// authenticated app. No auth logic lives here: an already-signed-in visitor
// who lands on "/" is simply sent on to their dashboard (same destination
// the old RootRedirect used), and everyone else sees the marketing page.
export default function Landing() {
  const { currentUser, initializing } = useAuth();

  useEffect(() => {
    document.title = 'BADAC Analytics — Crime Data Analytics and Reporting System';
    // Smooth in-page scrolling for the nav anchors, applied to the document
    // (not just this component) since anchor scrolling happens on the
    // window. Removed on unmount so it never leaks into the authenticated
    // app's pages. Respects prefers-reduced-motion per Task 18.
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = previous;
    };
  }, []);

  if (initializing) return null;

  if (currentUser) {
    return <Navigate to={defaultRouteForRole(currentUser.role)} replace />;
  }

  return (
    <div className="landing-page">
      <LandingNavbar />
      <main>
        <HeroSection />
        <FeatureSection />
        <AnalyticsFlow />
        <CrimeMappingPreview />
        <SecuritySection />
        <AboutSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
