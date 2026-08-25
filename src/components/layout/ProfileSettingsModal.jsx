import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { authService } from '../../services/authService';
import { ApiError } from '../../services/api';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Icons } from '../icons';

// Checkpoint 25 — opened from the "⋮" button on the sidebar's account card.
// Reuses the existing auth/user system end to end: currentUser comes from
// AuthContext (the same session GET /api/user already established), saves
// go through authService (the same api.js client every other page uses),
// and a successful save is pushed back into AuthContext.updateCurrentUser
// so the sidebar's own name/avatar update immediately — no separate mock
// "profile" store.
export default function ProfileSettingsModal({ open, onClose }) {
  const { currentUser, updateCurrentUser, avatarSrc, bumpAvatarVersion } =
    useAuth();
  const { showToast } = useToast();
  const fileInputRef = useRef(null);

  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  // Checkpoint 39 (Task 9.3) — `<img>` had no error handling: if
  // `avatarUrl` pointed at a file that 404s (deleted from storage, a bad
  // URL, etc.), the browser's broken-image icon would show forever instead
  // of falling back to the initials avatar the way "no avatarUrl at all"
  // already does. Reset whenever the underlying image source changes so a
  // fresh upload/URL gets a fresh chance to load.
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    if (open) {
      setFullName(currentUser?.fullName || '');
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentUser?.id]);

  useEffect(() => {
    setAvatarBroken(false);
  }, [preview, currentUser?.avatarUrl]);

  const handleSaveDetails = async () => {
    if (!fullName.trim()) {
      showToast('Full name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await authService.updateProfile({
        fullName: fullName.trim(),
      });
      updateCurrentUser(updated);
      showToast('Profile updated.', 'success');
    } catch (err) {
      showToast(
        err instanceof ApiError
          ? err.errors
            ? Object.values(err.errors).flat().join(' ')
            : err.message
          : 'Could not update profile.',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation mirrors the backend's own rules (image
    // mime-types, 4MB max — see ProfileController::avatar) so a bad file
    // is caught before spending an upload round-trip on it. The backend
    // check is still the one that actually matters/is enforced.
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.', 'error');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      showToast('Image must be smaller than 4MB.', 'error');
      return;
    }

    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const updated = await authService.uploadAvatar(file);
      updateCurrentUser(updated);
      // Checkpoint 38 — force every <img src={avatarUrl}> in the app to
      // re-fetch even if the backend returned the exact same URL string as
      // before (e.g. an in-place overwrite rather than a new filename per
      // upload).
      bumpAvatarVersion();
      showToast('Profile picture updated.', 'success');
    } catch (err) {
      showToast(
        err instanceof ApiError
          ? err.errors
            ? Object.values(err.errors).flat().join(' ')
            : err.message
          : 'Could not upload picture.',
        'error',
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Profile Settings"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleSaveDetails} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="profile-settings-avatar-row">
        <div className="profile-settings-avatar">
          {(preview || currentUser?.avatarUrl) && !avatarBroken ? (
            <img
              src={preview || avatarSrc(currentUser.avatarUrl)}
              alt=""
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <span>{currentUser?.avatar}</span>
          )}
        </div>
        <div>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icons.Camera size={14} strokeWidth={2} />{' '}
            {uploading ? 'Uploading…' : 'Change Picture'}
          </Button>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              margin: '6px 0 0',
            }}
          >
            JPG, PNG or WEBP. Up to 4MB.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Full Name</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Username</label>
        <input type="text" value={currentUser?.username || ''} disabled />
      </div>
      <div className="form-group">
        <label>Role</label>
        <input type="text" value={currentUser?.roleLabel || ''} disabled />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        Username, email and role aren't editable from here. Contact your
        Administrator to change them.
      </p>
    </Modal>
  );
}
