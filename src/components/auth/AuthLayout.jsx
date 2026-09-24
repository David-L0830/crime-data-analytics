import { Link } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';
import { Icons } from '../icons';
import logo from '../../assets/images/barangay178-logo.png';

// The sign-in frame shared by Login, Forgot Password and Reset Password — the
// public safety sub-systems' common layout: seal, system name and a subtitle
// centred above one bordered card on a plain background. Each page supplies
// only its subtitle and the card's contents; `after` renders beneath the card.
// Styled by the .cdars-login-* block in global.css.
export default function AuthLayout({ subtitle, children, after }) {
  const { theme, toggleTheme } = useTheme();
  const toggleLabel =
    theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <div className="cdars-login-page">
      <button
        type="button"
        className="badac-page-theme-toggle"
        title={toggleLabel}
        aria-label={toggleLabel}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? (
          <Icons.Sun size={16} strokeWidth={2} />
        ) : (
          <Icons.Moon size={16} strokeWidth={2} />
        )}
      </button>

      <main className="cdars-login">
        <header className="cdars-login-header">
          <Link
            to="/"
            className="cdars-login-logo-link"
            aria-label="Go to home page"
          >
            <img
              src={logo}
              alt="Barangay 178 Seal — Makabagong Barangay"
              className="cdars-login-logo"
            />
          </Link>
          <h1>Barangay 178 CDARS</h1>
          <p>{subtitle}</p>
        </header>

        <div className="login-card cdars-login-card">{children}</div>

        {after}
      </main>
    </div>
  );
}
