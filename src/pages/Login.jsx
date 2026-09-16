import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../hooks/useToast';
import { defaultRouteForRole } from '../utils/constants';
import {
  RESEND_COOLDOWN_MS,
  classifyEmailMfaSend,
  emailMfaAutoSend,
  resendSecondsRemaining,
} from '../utils/emailMfaAutoSend';
import { Icons } from '../components/icons';
import logo from '../assets/images/barangay178-logo.png';
import hallPhoto from '../assets/images/barangay178-hall.png';
import PrivacyPolicyModal from '../components/legal/PrivacyPolicyModal';
import TermsOfUseModal from '../components/legal/TermsOfUseModal';
import HelpDeskModal from '../components/support/HelpDeskModal';

// Final auth migration — Supabase Auth is the only sign-in path this app
// has (see AUTH_MIGRATION_STATUS.md). There is no more username/password
// form against this Laravel backend and no Laravel-side Google OAuth
// redirect — only Supabase email/password. Google OAuth remains implemented
// in AuthContext but is temporarily not offered on this screen (see the note
// in the form below).
//
// This screen has TWO steps. The second one — the TOTP challenge — appears
// only when AuthContext reports a pending second factor (`pendingMfa`), which
// happens for an account with a verified authenticator whose session has not
// satisfied it yet. Password entry alone never signs such an account in: the
// challenge is not a screen this page decides to show, it is the shape of a
// session that is not finished. See AuthContext.jsx.
export default function Login() {
  const {
    loginWithEmail,
    authInitError,
    currentUser,
    pendingMfa,
    pendingMfaEnrollment,
    pendingEmailMfa,
    sendEmailMfaCode,
    verifyEmailMfaCode,
    startMfaEnrollment,
    verifyMfaChallenge,
    cancelMfaChallenge,
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

  const [legalModal, setLegalModal] = useState(null); // 'privacy' | 'terms' | 'help' | null

  // Step two. Kept separate from `error` so a failed code attempt does not
  // repaint the password step's message, and vice versa.
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Step two(b) — forced enrolment, for an account an administrator has
  // required MFA of that has nothing enrolled yet.
  const [enrollData, setEnrollData] = useState(null);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollCode, setEnrollCode] = useState('');
  const [enrollError, setEnrollError] = useState('');

  // Step two(c) — email MFA, for an account configured to receive a one-time
  // code by email instead of using an authenticator app. The code itself is
  // never held here beyond the input's own value.
  const [emailCode, setEmailCode] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailInfo, setEmailInfo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  // Resend cooldown mirrors the server's one-code-a-minute limit so the
  // button is not offered when the server would refuse it anyway. The server
  // remains the authority — a 429 is still handled.
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!resendAt || resendAt <= Date.now()) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  const resendSeconds = resendSecondsRemaining(resendAt, now);

  useEffect(() => {
    if (currentUser) {
      const dest =
        location.state?.from?.pathname || defaultRouteForRole(currentUser.role);
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
    if (!result.success) {
      setError(result.error);
      return;
    }

    setError('');

    // `success` does NOT mean signed in. An MFA-enrolled account gets here
    // with mfaRequired, and AuthContext has left currentUser null — the
    // challenge step renders below instead of the app opening. Clearing the
    // password immediately means it is not sitting in state (or in a
    // re-rendered input) for the whole time the code is being typed.
    if (result.mfaRequired) {
      setPassword('');
      setTotpCode('');
      setTotpError('');
      return;
    }

    showToast(`Welcome back, ${result.user.fullName}!`, 'success');
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    const code = totpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setTotpError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setVerifying(true);
    const result = await verifyMfaChallenge(code);
    setVerifying(false);
    // TOTP accepted, but this account also owes an emailed code: AuthContext
    // has moved to the email step, and nobody is signed in yet.
    if (result.success && result.mfaRequired) {
      setTotpError('');
      setTotpCode('');
      return;
    }
    if (result.success) {
      setTotpError('');
      setTotpCode('');
      showToast(`Welcome back, ${result.user.fullName}!`, 'success');
    } else {
      setTotpCode('');
      setTotpError(result.error);
    }
  };

  // Starts enrolment as soon as the login flow says one is required. Guarded
  // on enrollData/enrollLoading so a re-render cannot enrol twice and leave a
  // discarded factor behind.
  useEffect(() => {
    if (!pendingMfaEnrollment || enrollData || enrollLoading) return;
    let cancelled = false;
    setEnrollLoading(true);
    setEnrollError('');
    startMfaEnrollment()
      .then((data) => {
        if (!cancelled) setEnrollData(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setEnrollError(
            err?.message ||
              'Could not start two-factor setup. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setEnrollLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMfaEnrollment]);

  const handleEnrollVerify = async (e) => {
    e.preventDefault();
    const code = enrollCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setEnrollError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (!enrollData?.id) {
      setEnrollError('Setup is not ready yet. Please wait a moment.');
      return;
    }
    setVerifying(true);
    // Same verification path the challenge step uses — Supabase checks the
    // code and, on success, the backend is re-asked whether this session is
    // really aal2 before anybody is signed in.
    const result = await verifyMfaChallenge(code, enrollData.id);
    setVerifying(false);
    // Same handoff as the challenge step: an emailed code is still owed.
    if (result.success && result.mfaRequired) {
      setEnrollError('');
      setEnrollCode('');
      setEnrollData(null);
      return;
    }
    if (result.success) {
      setEnrollError('');
      setEnrollCode('');
      setEnrollData(null);
      showToast(`Welcome back, ${result.user.fullName}!`, 'success');
    } else {
      setEnrollCode('');
      setEnrollError(result.error);
    }
  };

  const sendEmailCode = async ({ automatic }) => {
    setEmailSending(true);
    setEmailError('');
    const result = await sendEmailMfaCode();
    setEmailSending(false);
    const outcome = classifyEmailMfaSend(result, { automatic });
    if (outcome === 'sent') {
      setEmailCodeSent(true);
      setEmailCode('');
      setEmailInfo(
        `A 6-digit code was sent to your email address. It expires in ${Math.round(
          result.expiresInSeconds / 60,
        )} minutes.`,
      );
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    } else if (outcome === 'already_sent') {
      // The automatic send met the server's send throttle: a code went out
      // moments ago (typically just before a page reload) and is still valid.
      setEmailCodeSent(true);
      setEmailInfo(
        'A verification code was sent to your email address moments ago. Enter it below, or request a new code when the timer ends.',
      );
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    } else {
      if (result.rateLimited) {
        setResendAt(Date.now() + RESEND_COOLDOWN_MS);
        setNow(Date.now());
      }
      setEmailError(result.error);
    }
  };

  // Manual send / resend. Deliberately NOT routed through emailMfaAutoSend,
  // so the button always works; the server's throttle is the only limit.
  const handleSendEmailCode = () => sendEmailCode({ automatic: false });

  // Sends the first code as soon as the email step is reached, once per
  // episode. emailMfaAutoSend absorbs re-renders, StrictMode's double effect
  // run, and remounts of this page; AuthContext resets it when the step ends.
  // No cancellation on cleanup: under StrictMode the first run is the one
  // that sends, and its result must still reach the screen.
  useEffect(() => {
    if (!pendingEmailMfa) return;
    emailMfaAutoSend.trigger(() => sendEmailCode({ automatic: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEmailMfa]);

  const handleVerifyEmailCode = async (e) => {
    e.preventDefault();
    const code = emailCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setEmailError('Enter the 6-digit code from your email.');
      return;
    }
    setVerifying(true);
    const result = await verifyEmailMfaCode(code);
    setVerifying(false);
    if (result.success) {
      setEmailError('');
      setEmailInfo('');
      setEmailCode('');
      setEmailCodeSent(false);
      showToast(`Welcome back, ${result.user.fullName}!`, 'success');
    } else {
      setEmailCode('');
      setEmailError(result.error);
    }
  };

  const handleCancelMfa = async () => {
    setEmailCode('');
    setEmailError('');
    setEmailInfo('');
    setEmailCodeSent(false);
    setResendAt(0);
    setTotpCode('');
    setTotpError('');
    setEnrollCode('');
    setEnrollError('');
    setEnrollData(null);
    setPassword('');
    await cancelMfaChallenge();
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
            <div className="badac-left-divider" />
            <div className="badac-left-links">
              <button
                type="button"
                className="badac-left-link"
                onClick={() => setLegalModal('privacy')}
              >
                Privacy Policy
              </button>
              <span className="badac-left-link-sep" aria-hidden="true">
                •
              </span>
              <button
                type="button"
                className="badac-left-link"
                onClick={() => setLegalModal('terms')}
              >
                Terms of Use
              </button>
              <span className="badac-left-link-sep" aria-hidden="true">
                •
              </span>
              <button
                type="button"
                className="badac-left-link"
                onClick={() => setLegalModal('help')}
              >
                Help Desk
              </button>
            </div>
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

            {/* STEP TWO — the TOTP challenge. Rendered INSTEAD of the
                password form, not alongside it, so there is no state in which
                a half-authenticated session is looking at a form that would
                start a second sign-in. Reuses the .two-factor-* rules already
                in global.css alongside the same .login-form / .form-group /
                .btn-login chrome as the password step, so it inherits the
                card's light/dark theming with no new styles. */}
            {/* STEP TWO(b) — FORCED ENROLMENT. Shown when a second factor is
                owed and the account has none yet, so there is nothing to
                challenge and the only way in is to enrol. Rendered instead of
                both other forms, for the same reason the challenge is: a
                half-authenticated session must never be looking at something
                that starts another sign-in.

                The WORDING depends on why we are here, because the two reasons
                are not the same claim. pendingMfaEnrollment carries that
                reason (see AuthContext.resolveSupabaseSession):

                  'admin_required'  an administrator really did require MFA of
                                    this account (mfaRequiredByAdmin === true).
                  'status_unknown'  the backend could not verify the account's
                                    security status, and fails closed. We must
                                    NOT dress that up as an administrator
                                    policy — on 2026-09-03 a rejected Supabase
                                    credential put every unenrolled user on
                                    this screen and told each of them their
                                    administrator had required MFA, which was
                                    false for all of them.

                Enforcement is unchanged: both reasons still block sign-in.

                The QR code and secret come straight from Supabase to this
                browser and go no further — no administrator ever sees
                either. */}
            {pendingMfaEnrollment ? (
              <form
                className="login-form"
                autoComplete="off"
                onSubmit={handleEnrollVerify}
              >
                <div className="two-factor-heading">
                  <Icons.ShieldCheck size={18} strokeWidth={2} />
                  <h2>Set Up Two-Factor Authentication</h2>
                </div>
                {pendingMfaEnrollment === 'admin_required' ? (
                  <p className="two-factor-instructions">
                    Your administrator requires two-factor authentication on
                    this account. Scan the code below with your authenticator
                    app (Google Authenticator, Microsoft Authenticator,
                    1Password, or similar), then enter the 6-digit code it
                    shows.
                  </p>
                ) : (
                  <p className="two-factor-instructions">
                    We could not verify this account&apos;s security status, so
                    sign-in is being held until a second factor is set up. This
                    is usually temporary. If you were not expecting this, stop
                    here and contact your administrator before continuing —
                    otherwise scan the code below with your authenticator app
                    (Google Authenticator, Microsoft Authenticator, 1Password,
                    or similar), then enter the 6-digit code it shows.
                  </p>
                )}

                {enrollLoading ? (
                  <div className="empty-state" style={{ padding: 24 }}>
                    <div className="spinner" />
                  </div>
                ) : (
                  enrollData && (
                    <>
                      {enrollData.totp?.qr_code && (
                        <div
                          style={{
                            background: '#fff',
                            padding: 12,
                            borderRadius: 8,
                            maxWidth: 190,
                            margin: '0 auto 12px',
                          }}
                        >
                          <img
                            src={enrollData.totp.qr_code}
                            alt="QR code for enrolling this account in your authenticator app"
                            style={{ display: 'block', width: '100%' }}
                          />
                        </div>
                      )}
                      <p
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--login-text-subtitle)',
                          margin: '0 0 4px',
                        }}
                      >
                        Can&apos;t scan it? Enter this key manually:
                      </p>
                      <div className="two-factor-secret-box">
                        <code>{enrollData.totp?.secret}</code>
                      </div>
                    </>
                  )
                )}

                <div className="form-group">
                  <label htmlFor="enroll-code">Authentication code</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.Lock size={16} strokeWidth={2} />
                    </span>
                    <input
                      type="text"
                      id="enroll-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      value={enrollCode}
                      onChange={(e) => setEnrollCode(e.target.value)}
                      aria-invalid={enrollError ? true : undefined}
                      aria-describedby={
                        enrollError ? 'enroll-error' : undefined
                      }
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-login"
                  disabled={verifying || enrollLoading || !enrollData}
                  aria-busy={verifying}
                  style={{ marginTop: 8 }}
                >
                  <span>
                    {verifying ? 'Verifying...' : 'Enable and Sign In'}
                  </span>
                </button>
                {enrollError && (
                  <div className="login-error" role="alert" id="enroll-error">
                    {enrollError}
                  </div>
                )}
                <div className="two-factor-actions">
                  <button
                    type="button"
                    className="two-factor-link login-forgot-link"
                    onClick={handleCancelMfa}
                    disabled={verifying}
                  >
                    Cancel and sign in as someone else
                  </button>
                </div>
              </form>
            ) : pendingMfa ? (
              <form
                className="login-form"
                autoComplete="off"
                onSubmit={handleVerify}
              >
                <div className="two-factor-heading">
                  <Icons.ShieldCheck size={18} strokeWidth={2} />
                  <h2>Two-Factor Verification</h2>
                </div>
                <p className="two-factor-instructions">
                  Your password was accepted. Enter the current 6-digit code
                  from your authenticator app to finish signing in.
                </p>
                <div className="form-group">
                  <label htmlFor="totp-code">Authentication code</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.Lock size={16} strokeWidth={2} />
                    </span>
                    <input
                      type="text"
                      id="totp-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      /* eslint-disable-next-line jsx-a11y/no-autofocus */
                      autoFocus
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      aria-invalid={totpError ? true : undefined}
                      aria-describedby={totpError ? 'totp-error' : undefined}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-login"
                  disabled={verifying}
                  aria-busy={verifying}
                  style={{ marginTop: 8 }}
                >
                  <span>{verifying ? 'Verifying...' : 'Verify'}</span>
                </button>
                {/* Same announcement treatment as the password step's error:
                    without role="alert" a rejected code appears silently. */}
                {totpError && (
                  <div className="login-error" role="alert" id="totp-error">
                    {totpError}
                  </div>
                )}
                <div className="two-factor-actions">
                  <button
                    type="button"
                    className="two-factor-link login-forgot-link"
                    onClick={handleCancelMfa}
                    disabled={verifying}
                  >
                    Cancel and sign in as someone else
                  </button>
                </div>
              </form>
            ) : pendingEmailMfa ? (
              /* STEP TWO(c) — EMAIL MFA. Same placement rule as the other
                 second-factor steps: rendered instead of the password form.
                 Every rejected code shows the same message, because the
                 server deliberately does not distinguish wrong, expired,
                 reused or locked-out codes either. */
              <form
                className="login-form"
                autoComplete="off"
                onSubmit={handleVerifyEmailCode}
              >
                <div className="two-factor-heading">
                  <Icons.ShieldCheck size={18} strokeWidth={2} />
                  <h2>Email Verification</h2>
                </div>
                <p className="two-factor-instructions">
                  Your password was accepted. To finish signing in, enter the
                  one-time code sent to the email address on this account.
                </p>

                <button
                  type="button"
                  className="btn-login"
                  onClick={handleSendEmailCode}
                  disabled={emailSending || verifying || resendSeconds > 0}
                  aria-busy={emailSending}
                >
                  <span>
                    {emailSending
                      ? 'Sending...'
                      : resendSeconds > 0
                        ? `Resend code in ${resendSeconds}s`
                        : emailCodeSent
                          ? 'Resend code'
                          : 'Send code'}
                  </span>
                </button>

                {emailInfo && (
                  <p
                    className="two-factor-instructions"
                    role="status"
                    style={{ marginTop: 12 }}
                  >
                    {emailInfo}
                  </p>
                )}

                <div className="form-group" style={{ marginTop: 12 }}>
                  <label htmlFor="email-mfa-code">Verification code</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.Lock size={16} strokeWidth={2} />
                    </span>
                    <input
                      type="text"
                      id="email-mfa-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value)}
                      aria-invalid={emailError ? true : undefined}
                      aria-describedby={
                        emailError ? 'email-mfa-error' : undefined
                      }
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-login"
                  disabled={verifying}
                  aria-busy={verifying}
                  style={{ marginTop: 8 }}
                >
                  <span>{verifying ? 'Verifying...' : 'Verify'}</span>
                </button>
                {emailError && (
                  <div
                    className="login-error"
                    role="alert"
                    id="email-mfa-error"
                  >
                    {emailError}
                  </div>
                )}
                <div className="two-factor-actions">
                  <button
                    type="button"
                    className="two-factor-link login-forgot-link"
                    onClick={handleCancelMfa}
                    disabled={verifying}
                  >
                    Cancel and sign in as someone else
                  </button>
                </div>
              </form>
            ) : (
              <form
                className="login-form"
                autoComplete="off"
                onSubmit={handleSubmit}
              >
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.User size={16} strokeWidth={2} />
                    </span>
                    <input
                      type="email"
                      id="email"
                      placeholder="Enter your email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? 'login-error' : undefined}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="password">Password</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Icons.Lock size={16} strokeWidth={2} />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? 'login-error' : undefined}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      title={showPassword ? 'Hide password' : 'Show password'}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? (
                        <Icons.EyeOff size={16} strokeWidth={2} />
                      ) : (
                        <Icons.Eye size={16} strokeWidth={2} />
                      )}
                    </button>
                  </div>
                  <div style={{ textAlign: 'right', marginTop: 6 }}>
                    <Link to="/forgot-password" className="login-forgot-link">
                      Forgot Password?
                    </Link>
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-login"
                  disabled={submitting}
                  aria-busy={submitting}
                  style={{ marginTop: 8 }}
                >
                  <span>{submitting ? 'Authenticating...' : 'Sign In'}</span>
                </button>
                {/* role="alert" announces a failed sign-in the moment it
                  appears; the id is what the two fields above reference
                  through aria-describedby, so the reason is also reachable
                  from the field itself rather than only in the one-off
                  announcement. Without either, the message appears silently
                  and a non-sighted user is left with no feedback that the
                  attempt failed. */}
                {error && (
                  <div className="login-error" role="alert" id="login-error">
                    {error}
                  </div>
                )}
              </form>
            )}

            {/* "Continue with Google" is TEMPORARILY hidden from this page,
                pending a decision on two-factor authentication. Only the UI was
                removed — the whole Google path is intact and unreferenced, not
                deleted: AuthContext still exposes loginWithGoogle(), still runs
                the onAuthStateChange listener that finishes an OAuth return,
                and still sets authInitError when a Google account has no linked
                BADAC user (that error is still surfaced by the effect above).
                supabaseClient.js keeps detectSessionInUrl. Restoring this is a
                UI-only change: re-add the divider and button markup below, and
                take loginWithGoogle back off useAuth() together with the
                googleLoading state and handleGoogleLogin handler. The
                .login-divider / .btn-google / .btn-google-spinner rules are
                deliberately left in global.css for the same reason. */}

            <div className="badac-security-notice">
              <span className="badac-security-icon">
                <Icons.Lock size={16} strokeWidth={2} />
              </span>
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

      <PrivacyPolicyModal
        open={legalModal === 'privacy'}
        onClose={() => setLegalModal(null)}
      />
      <TermsOfUseModal
        open={legalModal === 'terms'}
        onClose={() => setLegalModal(null)}
      />
      <HelpDeskModal
        open={legalModal === 'help'}
        onClose={() => setLegalModal(null)}
      />
    </div>
  );
}
