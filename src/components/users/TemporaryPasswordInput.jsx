import { useState } from 'react';
import Button from '../ui/Button';
import { Icons } from '../icons';
import {
  copyToClipboard,
  generateTemporaryPassword,
} from '../../utils/temporaryPassword';

// The temporary-password field shared by Create User and Reissue.
//
// Controlled: the value lives in the PARENT's local state and nowhere else —
// not in DataContext, not in storage, not in the URL — so the parent clearing
// it on success or close is what removes it. Generation uses the browser's
// cryptographically secure generator (utils/temporaryPassword.js). The value is
// never logged.
export default function TemporaryPasswordInput({
  id,
  label = 'Temporary Password',
  value,
  onChange,
  error,
  hint,
  disabled = false,
  onNotice,
}) {
  const [visible, setVisible] = useState(false);

  const generate = () => {
    try {
      onChange(generateTemporaryPassword());
      setVisible(true);
    } catch {
      onNotice?.('A secure password could not be generated in this browser. Enter one instead.', 'error');
    }
  };

  const copy = async () => {
    const copied = await copyToClipboard(value);
    onNotice?.(
      copied ? 'Temporary password copied.' : 'Could not copy. Select and copy it manually.',
      copied ? 'success' : 'error',
    );
  };

  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <div className="temp-password-row">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          variant="secondary"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled || !value}
          aria-label={visible ? 'Hide temporary password' : 'Show temporary password'}
          aria-pressed={visible}
        >
          {visible ? (
            <Icons.EyeOff size={14} strokeWidth={2} />
          ) : (
            <Icons.Eye size={14} strokeWidth={2} />
          )}
        </Button>
        <Button variant="secondary" onClick={generate} disabled={disabled}>
          Generate
        </Button>
        <Button
          variant="secondary"
          onClick={copy}
          disabled={disabled || !value}
          aria-label="Copy temporary password"
        >
          Copy
        </Button>
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="form-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
