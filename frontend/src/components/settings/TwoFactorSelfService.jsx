import { useEffect, useState } from 'react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/authService';
import { supabaseMfaService } from '../../services/supabaseMfaService';
import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import { ApiError } from '../../services/api';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { Icons } from '../icons';

// Supabase MFA is the only second factor (see AUTH_MIGRATION_STATUS.md).
//
// Enrolling here now has real consequences at sign-in: once a factor is
// verified, this account cannot reach the application again without entering
// a code (see AuthContext.jsx for the login gate and
// backend/app/Http/Middleware/EnsureSupabaseAal2.php for the server-side
// enforcement that actually holds the line). The panel below says so plainly,
// and says the opposite of what it said while enrolment was recorded but not
// enforced — a security control that misdescribes itself in either direction
// changes how somebody chooses a password.
export default function TwoFactorSelfService() {
  const { showToast } = useToast();
  const { currentUser, updateCurrentUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [factor, setFactor] = useState(null); // Factor | null (verified TOTP factor, if any)

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupData, setSetupData] = useState(null); // { id, totp: { qr_code, secret, uri } } | null
  const [settingUp, setSettingUp] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [setupError, setSetupError] = useState('');

  const [disableOpen, setDisableOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState('');

  const loadStatus = async () => {
    setLoading(true);
    try {
      const factors = await supabaseMfaService.listFactors();
      setFactor(supabaseMfaService.selectActiveTotpFactor(factors));
    } catch {
      showToast('Could not load two-factor authentication status.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSupabaseConfigured) loadStatus();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSetup = async () => {
    setSetupOpen(true);
    setSetupError('');
    setConfirmCode('');
    setSettingUp(true);
    try {
      // Clean up a dangling unverified factor from an abandoned earlier
      // attempt first — Supabase auto-expires these after ~5 minutes, but
      // don't wait on that (matches Supabase's own documented practice).
      const factors = await supabaseMfaService.listFactors();
      const stale = (factors?.all ?? []).find((f) => f.status === 'unverified');
      if (stale) await supabaseMfaService.unenroll(stale.id).catch(() => {});

      const data = await supabaseMfaService.enroll();
      setSetupData(data);
    } catch (err) {
      setSetupError(err?.message || 'Could not start two-factor setup.');
    } finally {
      setSettingUp(false);
    }
  };

  const closeSetup = () => {
    setSetupOpen(false);
    setSetupData(null);
    setConfirmCode('');
    setSetupError('');
  };

  // The factor is NOT considered enabled just because enroll() returned
  // successfully; only a successful challengeAndVerify() (an actual
  // Supabase-side TOTP check) counts. Even after that, this deliberately
  // re-fetches GET /user and checks the backend's own verified
  // authAssuranceLevel before declaring success — not the client SDK's
  // local session state — same invariant as
  // AuthContext.verifyMfaChallenge, which the login-time challenge uses.
  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(confirmCode.trim())) {
      setSetupError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setConfirming(true);
    setSetupError('');
    try {
      await supabaseMfaService.challengeAndVerify(
        setupData.id,
        confirmCode.trim(),
      );

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('No session after verification.');

      const user = await authService.currentUserViaSupabaseToken(accessToken);
      if (user.authAssuranceLevel !== 'aal2') {
        throw new Error('Verification did not complete. Please try again.');
      }

      // Verifying promoted this session to aal2, so the copy of the user this
      // app has been carrying since sign-in now understates it. Push the
      // fresh one back rather than leaving the panel below to report
      // "Not verified (AAL1)" about the session that just verified.
      updateCurrentUser(user);

      closeSetup();
      await loadStatus();
      // Enforcement at sign-in is real now, so saying so is accurate rather
      // than an overstatement. The wording still names what was proved — a
      // code from the app was checked by Supabase — rather than only the
      // outcome.
      showToast(
        'Two-factor authentication enabled. Future sign-ins will ask for a code.',
        'success',
      );
    } catch (err) {
      setSetupError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'That code is invalid or has expired.',
      );
    } finally {
      setConfirming(false);
    }
  };

  // Supabase's unenroll() API takes only a factorId — it doesn't require a
  // fresh code, since that's how Supabase designed the operation (it
  // already requires an authenticated session to call at all). Not
  // inventing an extra code prompt here that Supabase's own API doesn't
  // ask for or support.
  const handleUnenroll = async () => {
    if (!factor) return;
    setDisabling(true);
    setDisableError('');
    try {
      await supabaseMfaService.unenroll(factor.id);
      setDisableOpen(false);
      setFactor(null);
      showToast('Two-factor authentication disabled.', 'success');
    } catch (err) {
      setDisableError(
        err?.message || 'Could not disable two-factor authentication.',
      );
    } finally {
      setDisabling(false);
    }
  };

  const copySecret = () => {
    if (!setupData?.totp?.secret) return;
    navigator.clipboard?.writeText(setupData.totp.secret).then(
      () => showToast('Secret key copied.', 'success'),
      () => {},
    );
  };

  // The session's assurance level comes from the BACKEND's UserResource,
  // which reads it off the cryptographically verified `aal` JWT claim — not
  // from anything the client decided. This is display only; the enforcement
  // lives in EnsureSupabaseAal2.
  const verifiedSession = currentUser?.authAssuranceLevel === 'aal2';

  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      <Card title="Two-Factor Authentication">
        {!isSupabaseConfigured ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Two-factor authentication is not configured for this deployment.
          </p>
        ) : (
          <div className="two-factor-status-row">
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Factor status:{' '}
                <span
                  className={`status-badge status-${factor ? 'Active' : 'Inactive'}`}
                >
                  {factor ? 'Enrolled' : 'Not enrolled'}
                </span>
              </p>
              <p style={{ margin: '4px 0 0', fontWeight: 600 }}>
                Current session:{' '}
                <span
                  className={`status-badge status-${verifiedSession ? 'Active' : 'Inactive'}`}
                >
                  {verifiedSession ? 'Verified (AAL2)' : 'Not verified (AAL1)'}
                </span>
              </p>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.85rem',
                  marginTop: 6,
                  maxWidth: 480,
                }}
              >
                {/* Three distinct states, each described as what it actually
                    is. The middle one — enrolled, but this session only at
                    AAL1 — is not reachable from inside the application, since
                    a session in that state cannot load any protected data and
                    so never renders this panel. It is stated anyway rather
                    than folded into one of the others, because the two badges
                    above CAN show it and a status line that cannot explain
                    what the badges say is not a status line. */}
                {!factor
                  ? 'Register an authenticator app against your account. Once verified, signing in will require a code from that app in addition to your password.'
                  : verifiedSession
                    ? 'An authenticator app is registered and this session has been verified with it. Signing in on this account requires a code from that app in addition to your password.'
                    : 'An authenticator app is registered to your account, but this session has not been verified with it. Protected data will stay unavailable until the code is entered.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {factor ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setDisableOpen(true);
                    setDisableError('');
                  }}
                >
                  Disable 2FA
                </Button>
              ) : (
                <Button onClick={openSetup}>Enable 2FA</Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Setup flow */}
      <Modal
        open={setupOpen}
        onClose={closeSetup}
        title="Set Up Two-Factor Authentication"
        footer={
          <>
            <Button variant="secondary" onClick={closeSetup}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={confirming || settingUp || !setupData}
            >
              {confirming ? 'Verifying…' : 'Enable 2FA'}
            </Button>
          </>
        }
      >
        {settingUp ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="spinner" />
          </div>
        ) : setupData ? (
          <form onSubmit={handleConfirm}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Scan this QR code with your authenticator app (Google
              Authenticator, Authy, 1Password, etc.):
            </p>
            {setupData.totp?.qr_code && (
              // `totp.qr_code` is a DATA URL, not a bare SVG string — Supabase
              // returns "data:image/svg+xml;utf-8,<svg ...>" and its own docs
              // put it straight into an <img src>. Feeding it to
              // dangerouslySetInnerHTML, as this did, printed the literal
              // "data:image/svg+xml;utf-8," prefix above a QR code that only
              // rendered because the browser parsed the trailing markup.
              //
              // Using <img> also means the value is never interpreted as
              // markup at all, which is the right posture for something this
              // component did not author.
              <div
                style={{
                  background: '#fff',
                  padding: 12,
                  borderRadius: 8,
                  maxWidth: 200,
                  margin: '8px 0',
                }}
              >
                <img
                  src={setupData.totp.qr_code}
                  alt="QR code for enrolling this account in your authenticator app"
                  style={{ display: 'block', width: '100%' }}
                />
              </div>
            )}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Or enter this key manually:
            </p>
            <div className="two-factor-secret-box">
              <code>{setupData.totp?.secret}</code>
              <button
                type="button"
                className="two-factor-link"
                onClick={copySecret}
                title="Copy secret key"
              >
                <Icons.Save size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="form-group">
              <label htmlFor="confirmCode">Verification code</label>
              <input
                type="text"
                id="confirmCode"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                autoComplete="one-time-code"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
              />
            </div>
            {setupError && <div className="login-error">{setupError}</div>}
          </form>
        ) : (
          setupError && <div className="login-error">{setupError}</div>
        )}
      </Modal>

      {/* Disable flow */}
      <Modal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Disable Two-Factor Authentication"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleUnenroll}
              disabled={disabling}
            >
              {disabling ? 'Disabling…' : 'Disable 2FA'}
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          This removes your authenticator-app factor. Your account will go back
          to signing in with a password alone, with no second factor.
        </p>
        {disableError && <div className="login-error">{disableError}</div>}
      </Modal>
    </>
  );
}
