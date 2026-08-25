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

// Final auth migration — Laravel TOTP (the old twoFactorService-backed
// system) is retired; Supabase MFA is now the only second factor (see
// AUTH_MIGRATION_STATUS.md). This used to render two independent 2FA
// sections side by side (a legacy Laravel one and this Supabase one) while
// both systems coexisted — now there is only this one, so it no longer
// needs to gate on which credential path authenticated the session; every
// session is a Supabase session.
export default function TwoFactorSelfService() {
  const { showToast } = useToast();
  const { currentUser } = useAuth();

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
  // AuthContext.verifySupabaseMfaChallenge.
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

      closeSetup();
      await loadStatus();
      showToast('Two-factor authentication enabled.', 'success');
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
                  className={`status-badge status-${currentUser?.authAssuranceLevel === 'aal2' ? 'Active' : 'Inactive'}`}
                >
                  {currentUser?.authAssuranceLevel === 'aal2'
                    ? 'Verified (AAL2)'
                    : 'Not verified (AAL1)'}
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
                {factor
                  ? 'Your account requires a code from your authenticator app every time you sign in.'
                  : 'Add an extra layer of security to your account by requiring a code from an authenticator app when you sign in.'}
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
              // Supabase returns an inline SVG QR code string — safe to
              // render directly (Supabase's own response, not user input).
              <div
                style={{
                  background: '#fff',
                  padding: 12,
                  borderRadius: 8,
                  maxWidth: 200,
                  margin: '8px 0',
                }}
                dangerouslySetInnerHTML={{ __html: setupData.totp.qr_code }}
              />
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
          This removes your authenticator-app factor. Your account will no
          longer require a second factor to sign in.
        </p>
        {disableError && <div className="login-error">{disableError}</div>}
      </Modal>
    </>
  );
}
