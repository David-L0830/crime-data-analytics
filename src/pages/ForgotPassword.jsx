import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Icons } from '../components/icons';
import logo from '../assets/images/barangay178-logo.png';
import hallPhoto from '../assets/images/barangay178-hall.png';

// Final auth migration — password reset is handled entirely by Supabase
// Auth's own client-side flow (supabase.auth.resetPasswordForEmail());
// this backend never sends a reset email and never sees the reset token —
// see ResetPassword.jsx for the other half of this flow. Public route (see
// AppRoutes.jsx — not wrapped in ProtectedRoute). Mirrors Login.jsx's
// screen chrome (illustration, card, dark-mode toggle, branding) so it
// doesn't look like a bolted-on page.
export default function ForgotPassword() {
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Shown after a successful call regardless of whether the email actually
  // matched an account — Supabase intentionally behaves the same way
  // either way, so the frontend mirrors that instead of branching on
  // "found" vs "not found".
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your registered email address.');
      return;
    }
    if (!isSupabaseConfigured) {
      setError(
        'Password reset is not configured. Please contact your Administrator.',
      );
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${window.location.origin}/reset-password` },
      );
      if (resetError) throw resetError;
      setSent(true);
    } catch {
      // Generic on purpose: never reveal whether the address matched an
      // account, and never surface the raw Supabase error (e.g. a 429).
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="badac-login-page">
      <button
        type="button"
        className="badac-page-theme-toggle"
        title={
          theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
        }
        aria-label={
          theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
        }
        onClick={toggleTheme}
      >
        {theme === 'dark' ? (
          <Icons.Sun size={16} strokeWidth={2} />
        ) : (
          <Icons.Moon size={16} strokeWidth={2} />
        )}
      </button>

      <div className="badac-login-body">
        <div
          className="badac-login-left"
          style={{ backgroundImage: `url(${hallPhoto})` }}
        >
          <div className="badac-login-left-decor" aria-hidden="true">
            <span className="badac-decor-shield">
              <Icons.ShieldCheck size={22} strokeWidth={2} />
            </span>
            <svg
              className="badac-decor-bars"
              viewBox="0 0 200 120"
              preserveAspectRatio="none"
            >
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
              <img
                src={logo}
                alt="Barangay 178 Seal — Makabagong Barangay"
                className="badac-left-seal"
              />
            </Link>
            <h1 className="badac-left-title">BARANGAY 178</h1>
            <div className="badac-left-locality">
              <span className="badac-left-line" aria-hidden="true" />
              NORTH CALOOCAN
              <span className="badac-left-line" aria-hidden="true" />
            </div>
            <h2 className="badac-left-appname">BADAC ANALYTICS</h2>
            <p className="badac-left-tagline">
              Crime Data Analytics &amp; Reporting System
            </p>
          </div>
        </div>

        <div className="badac-login-right">
          <div className="login-card badac-login-card">
            <div className="login-header">
              <div className="login-brand">
                <img
                  src={logo}
                  alt=""
                  className="brand-logo-img login-brand-logo"
                />
                <div>
                  <h1>BADAC Analytics</h1>
                  <p className="subtitle">
                    Crime Data Analytics &amp; Reporting System
                  </p>
                </div>
              </div>
              <div className="badac-badge-row">
                <span className="badac-badge-line" aria-hidden="true" />
                <span className="badac-badge-text">
                  Barangay 178&nbsp;&nbsp;•&nbsp;&nbsp;North Caloocan
                </span>
                <span className="badac-badge-line" aria-hidden="true" />
              </div>
            </div>

            {sent ? (
              <div className="login-form">
                <div className="login-success" role="status">
                  If an account exists for that email, a password reset link has
                  been sent. Check your inbox (and spam folder) for further
                  instructions.
                </div>
                <Link
                  to="/login"
                  className="btn-login"
                  style={{
                    marginTop: 16,
                    textAlign: 'center',
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  <span>Back to Sign In</span>
                </Link>
              </div>
            ) : (
              <form
                className="login-form"
                autoComplete="off"
                onSubmit={handleSubmit}
              >
                <p className="subtitle" style={{ marginBottom: 20 }}>
                  Enter the email address on your account and we&apos;ll send
                  you a link to reset your password.
                </p>
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.User size={16} strokeWidth={2} />
                    </span>
                    <input
                      type="email"
                      id="email"
                      placeholder="you@barangay178.gov.ph"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-login"
                  disabled={submitting}
                  style={{ marginTop: 8 }}
                >
                  <span>{submitting ? 'Sending…' : 'Send Reset Link'}</span>
                </button>
                {error && <div className="login-error">{error}</div>}
                <p style={{ textAlign: 'center', marginTop: 16 }}>
                  <Link to="/login" className="login-forgot-link">
                    Back to Sign In
                  </Link>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
