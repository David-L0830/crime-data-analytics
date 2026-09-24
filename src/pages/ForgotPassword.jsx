import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Icons } from '../components/icons';
import AuthLayout from '../components/auth/AuthLayout';

// Final auth migration — password reset is handled entirely by Supabase
// Auth's own client-side flow (supabase.auth.resetPasswordForEmail());
// this backend never sends a reset email and never sees the reset token —
// see ResetPassword.jsx for the other half of this flow. Public route (see
// AppRoutes.jsx — not wrapped in ProtectedRoute). Shares Login.jsx's frame
// (components/auth/AuthLayout.jsx) so it doesn't look like a bolted-on page.
export default function ForgotPassword() {
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
    <AuthLayout subtitle="Reset your password">
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
    </AuthLayout>
  );
}
