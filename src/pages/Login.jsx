import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../hooks/useToast';
import { defaultRouteForRole } from '../utils/constants';
import { Icons } from '../components/icons';
import logo from '../assets/images/barangay178-logo.png';
import hallPhoto from '../assets/images/barangay178-hall.png';
import PrivacyPolicyModal from '../components/legal/PrivacyPolicyModal';
import TermsOfUseModal from '../components/legal/TermsOfUseModal';
import HelpDeskModal from '../components/support/HelpDeskModal';

// Final auth migration — Supabase Auth is the only sign-in path this app
// has (see AUTH_MIGRATION_STATUS.md). There is no more username/password
// form against this Laravel backend, no Laravel-side Google OAuth
// redirect, and no Laravel-TOTP challenge screen — only Supabase
// email/password, Supabase Google OAuth, and (when the account has a
// verified factor) the Supabase MFA step-up screen below.
export default function Login() {
  const {
    loginWithEmail,
    loginWithGoogle,
    authInitError,
    currentUser,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [legalModal, setLegalModal] = useState(null); // 'privacy' | 'terms' | 'help' | null

  useEffect(() => {
    if (currentUser) {
      const dest = location.state?.from?.pathname || defaultRouteForRole(currentUser.role);
      navigate(dest, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Surfaces a failed Google sign-in (see the onAuthStateChange listener in
  // AuthContext.jsx, which is what actually detects this on return from
  // Google).
  useEffect(() => {
    if (authInitError) {
      setError(authInitError);
    }
  }, [authInitError]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setSubmitting(true);
    const result = await loginWithEmail(email.trim(), password);
    setSubmitting(false);
    if (result.success) {
      setError('');
      // Two-factor authentication has been removed from the login flow —
      // a successful result here always means the user is fully signed in,
      // never a pending MFA step-up.
      showToast(`Welcome back, ${result.user.fullName}!`, 'success');
    } else {
      setError(result.error);
    }
  };

  const handleGoogleLogin = async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    setError('');
    const result = await loginWithGoogle();
    if (!result.success) {
      setGoogleLoading(false);
      setError(result.error);
    }
    // On success the browser is already navigating to Google; leave the
    // loading state on so the button stays disabled until that happens.
  };

  return (
    <div className="badac-login-page">
      <button
        type="button"
        className="badac-page-theme-toggle"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <Icons.Sun size={16} strokeWidth={2} /> : <Icons.Moon size={16} strokeWidth={2} />}
      </button>

      <div className="badac-login-body">
        <div className="badac-login-left" style={{ backgroundImage: `url(${hallPhoto})` }}>
          <div className="badac-login-left-decor" aria-hidden="true">
            <span className="badac-decor-shield"><Icons.ShieldCheck size={22} strokeWidth={2} /></span>
            <svg className="badac-decor-bars" viewBox="0 0 200 120" preserveAspectRatio="none">
              <rect x="0" y="90" width="16" height="30" rx="2" />
              <rect x="24" y="72" width="16" height="48" rx="2" />
              <rect x="48" y="54" width="16" height="66" rx="2" />
              <rect x="72" y="36" width="16" height="84" rx="2" />
              <rect x="96" y="18" width="16" height="102" rx="2" />
              <rect x="120" y="2" width="16" height="118" rx="2" />
            </svg>
          </div>

          <div className="badac-login-left-content">
            <Link
              to="/"
              className="badac-left-seal-link"
              aria-label="Go to home page"
            >
              <img src={logo} alt="Barangay 178 Seal — Makabagong Barangay" className="badac-left-seal" />
            </Link>
            <h1 className="badac-left-title">BARANGAY 178</h1>
            <div className="badac-left-locality">
              <span className="badac-left-line" aria-hidden="true" />
              NORTH CALOOCAN
              <span className="badac-left-line" aria-hidden="true" />
            </div>
            <h2 className="badac-left-appname">BADAC ANALYTICS</h2>
            <p className="badac-left-tagline">Crime Data Analytics &amp; Reporting System</p>
            <div className="badac-left-divider" />
            <div className="badac-left-links">
              <button type="button" className="badac-left-link" onClick={() => setLegalModal('privacy')}>
                Privacy Policy
              </button>
              <span className="badac-left-link-sep" aria-hidden="true">•</span>
              <button type="button" className="badac-left-link" onClick={() => setLegalModal('terms')}>
                Terms of Use
              </button>
              <span className="badac-left-link-sep" aria-hidden="true">•</span>
              <button type="button" className="badac-left-link" onClick={() => setLegalModal('help')}>
                Help Desk
              </button>
            </div>
          </div>
        </div>

        <div className="badac-login-right">
          <div className="login-card badac-login-card">
            <div className="login-header">
              <div className="login-brand">
                <img src={logo} alt="" className="brand-logo-img login-brand-logo" />
                <div>
                  <h1>BADAC Analytics</h1>
                  <p className="subtitle">Crime Data Analytics &amp; Reporting System</p>
                </div>
              </div>
              <div className="badac-badge-row">
                <span className="badac-badge-line" aria-hidden="true" />
                <span className="badac-badge-text">Barangay 178&nbsp;&nbsp;•&nbsp;&nbsp;North Caloocan</span>
                <span className="badac-badge-line" aria-hidden="true" />
              </div>
            </div>

            {/* Two-factor authentication has been removed from the login
                flow — only the standard email/password and Google sign-in
                paths render here now. */}
            <form className="login-form" autoComplete="off" onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label htmlFor="email">Email</label>
                    <div className="input-wrapper">
                      <span className="input-icon"><Icons.User size={16} strokeWidth={2} /></span>
                      <input
                        type="email"
                        id="email"
                        placeholder="Enter your email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="password">Password</label>
                    <div className="input-wrapper">
                      <span className="input-icon"><Icons.Lock size={16} strokeWidth={2} /></span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        id="password"
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        title={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((s) => !s)}
                      >
                        {showPassword ? <Icons.EyeOff size={16} strokeWidth={2} /> : <Icons.Eye size={16} strokeWidth={2} />}
                      </button>
                    </div>
                    <div style={{ textAlign: 'right', marginTop: 6 }}>
                      <Link to="/forgot-password" className="login-forgot-link">Forgot Password?</Link>
                    </div>
                  </div>
                  <button type="submit" className="btn-login" disabled={submitting} style={{ marginTop: 8 }}>
                    <span>{submitting ? 'Authenticating...' : 'Sign In'}</span>
                  </button>
                  {error && <div className="login-error">{error}</div>}
            </form>

            <div className="login-divider" role="separator">
              <span>or</span>
            </div>

            <button
              type="button"
              className="btn-google"
              disabled={googleLoading}
              onClick={handleGoogleLogin}
              aria-label="Continue with Google"
            >
              {googleLoading ? (
                <span className="btn-google-spinner" aria-hidden="true" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.71-1.57 2.69-3.88 2.69-6.64z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
                  <path fill="#FBBC05" d="M3.97 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.34z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
                </svg>
              )}
              <span>{googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}</span>
            </button>

            <div className="badac-security-notice">
              <span className="badac-security-icon"><Icons.Lock size={16} strokeWidth={2} /></span>
              <div>
                <strong>Authorized personnel only</strong>
                <p>
                  This system contains protected government information.
                  <br />
                  Unauthorized access is prohibited.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PrivacyPolicyModal open={legalModal === 'privacy'} onClose={() => setLegalModal(null)} />
      <TermsOfUseModal open={legalModal === 'terms'} onClose={() => setLegalModal(null)} />
      <HelpDeskModal open={legalModal === 'help'} onClose={() => setLegalModal(null)} />
    </div>
  );
}
