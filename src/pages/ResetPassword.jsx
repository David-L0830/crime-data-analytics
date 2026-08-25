import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../hooks/useToast';
import {
  isAuthApiError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Icons } from '../components/icons';
import logo from '../assets/images/barangay178-logo.png';

// Final auth migration — reached via the link in the Supabase password-
// reset email. Supabase's own client (detectSessionInUrl: true — see
// supabaseClient.js) parses that link's recovery token on page load and
// establishes a short-lived "recovery" session automatically, firing a
// PASSWORD_RECOVERY auth event; this page just waits for that, then calls
// supabase.auth.updateUser({ password }) using it. There is no token/email
// query-param handling here anymore — Supabase owns the whole link format.

// Turns the error updateUser() returns into something the person can act on.
// This used to be a bare `catch` that showed "Something went wrong" for every
// failure, which told someone whose password had been rejected nothing about
// how to succeed — they would simply retry the same password.
//
// supabase-js returns (not throws) a typed AuthWeakPasswordError here when the
// new password fails the project's password policy. Its `reasons` array holds
// one or more of 'length' | 'characters' | 'pwned', where 'pwned' means the
// password appears in a known breach corpus. Note this only fires when the
// relevant Supabase password policy is switched on, so today it is a
// forward-looking branch rather than a reachable one — see the note in the
// commit message.
//
// Any other AuthApiError is a server-side rejection whose message Supabase
// already writes for end users ("New password should be different from the old
// password."), so it is more useful shown than hidden. Network/unknown failures
// keep the original generic wording rather than surfacing "Failed to fetch".
function passwordUpdateMessage(error) {
  if (isAuthWeakPasswordError(error)) {
    return error.reasons?.includes('pwned')
      ? 'That password has appeared in a known data breach. Please choose a different one.'
      : 'That password is not strong enough. Please choose a longer, less predictable one.';
  }
  if (isAuthApiError(error) && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export default function ResetPassword() {
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) setReady(true);
    });

    // The recovery link may already have been processed before this
    // listener attached (detectSessionInUrl runs on client init) — if a
    // session already exists by the time we mount, treat it the same way.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const missingLinkParams = isSupabaseConfigured && !ready;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(passwordUpdateMessage(updateError));
        return;
      }
      showToast('Password reset successfully. Please sign in.', 'success');
      await supabase.auth.signOut().catch(() => {});
      navigate('/login', { replace: true });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="login-illustration">
          <img
            src={logo}
            alt="Barangay 178 Seal — Makabagong Barangay"
            className="login-seal"
          />
          <p className="seal-motto">Faith · Love · Service</p>
          <p className="tagline">
            Public Safety · Data-Driven Justice · Transparent Governance
          </p>
        </div>

        <div className="login-card-wrapper">
          <div className="login-card">
            <button
              type="button"
              className="login-theme-toggle"
              title={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <Icons.Sun size={17} strokeWidth={2} />
              ) : (
                <Icons.Moon size={17} strokeWidth={2} />
              )}
            </button>
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
              <span className="badge">Barangay 178 · North Caloocan</span>
            </div>

            {missingLinkParams ? (
              <div className="login-form">
                <div className="login-error">
                  This reset link is invalid or has expired. Please request a
                  new password reset link.
                </div>
                <Link
                  to="/forgot-password"
                  className="btn-login"
                  style={{
                    marginTop: 16,
                    textAlign: 'center',
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  <span>Request New Link</span>
                </Link>
              </div>
            ) : (
              <form
                className="login-form"
                autoComplete="off"
                onSubmit={handleSubmit}
              >
                <div className="form-group">
                  <label htmlFor="new-password">New Password</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.Lock size={16} strokeWidth={2} />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="new-password"
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      title={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? (
                        <Icons.EyeOff size={16} strokeWidth={2} />
                      ) : (
                        <Icons.Eye size={16} strokeWidth={2} />
                      )}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="confirm-password">Confirm New Password</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.Lock size={16} strokeWidth={2} />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="confirm-password"
                      placeholder="Re-enter new password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-login"
                  disabled={submitting}
                  style={{ marginTop: 8 }}
                >
                  <span>{submitting ? 'Resetting…' : 'Reset Password'}</span>
                </button>
                {error && <div className="login-error">{error}</div>}
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
