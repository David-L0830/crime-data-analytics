import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';
import { Icons } from '../icons';
import logo from '../../assets/images/barangay178-logo.png';

const NAV_LINKS = [
  { href: '#home', label: 'Home' },
  { href: '#features', label: 'Features' },
  { href: '#analytics', label: 'Analytics' },
  { href: '#about', label: 'About' },
  { href: '#contact', label: 'Contact' },
];

// Public-facing navbar for the landing page only — intentionally separate
// from the authenticated Header/Sidebar (components/layout) since it must
// never expose internal module links (Incident Feed, Records, Audit Logs,
// etc). Only the single Login action goes anywhere near authentication —
// the duplicate in-menu Login and the "Access System" CTA were removed so
// the landing page presents exactly one sign-in entry point. This Link sits
// in .landing-navbar-controls, which is NOT collapsed into the mobile menu,
// so it stays reachable at every viewport width.
export default function LandingNavbar() {
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleNavClick = () => setOpen(false);

  return (
    <header
      className={`landing-navbar${scrolled ? ' landing-navbar-scrolled' : ''}`}
    >
      <div className="landing-navbar-inner">
        <a href="#home" className="landing-brand" onClick={handleNavClick}>
          <img
            src={logo}
            alt="Barangay 178 Seal"
            className="landing-brand-logo"
          />
          <span className="landing-brand-text">
            <strong>BADAC Analytics</strong>
            <small>Barangay 178 &middot; North Caloocan</small>
          </span>
        </a>

        <nav
          className={`landing-nav-links${open ? ' landing-nav-links-open' : ''}`}
          aria-label="Primary"
        >
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={handleNavClick}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="landing-navbar-controls">
          <button
            type="button"
            className="landing-icon-btn"
            aria-label={
              theme === 'dark'
                ? 'Switch to light theme'
                : 'Switch to dark theme'
            }
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <Icons.Sun size={18} strokeWidth={2} />
            ) : (
              <Icons.Moon size={18} strokeWidth={2} />
            )}
          </button>
          <Link to="/login" className="btn btn-secondary btn-sm landing-navbar-login">
            Login
          </Link>
          <button
            type="button"
            className="landing-icon-btn landing-menu-toggle"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <Icons.Close size={20} strokeWidth={2} />
            ) : (
              <Icons.Menu size={20} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
