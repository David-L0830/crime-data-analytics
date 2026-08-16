import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Icons } from '../icons';

const CATEGORIES = [
  'Login / Account Access',
  'Two-Factor Authentication',
  'Incident or Case Data',
  'Technical Problem / Bug',
  'Other',
];

const SUPPORT_EMAIL = 'badac.support@barangay178.gov.ph';

const initialForm = { name: '', contact: '', category: '', message: '' };

// Login redesign — functional "Help Desk" link target (replaces the dead
// "#" the reference design implied). The project has no support-ticket
// backend endpoint to submit to (checked src/services and backend/app —
// see HANDOFF notes), so this composes a pre-filled email via `mailto:`
// instead of a real ticket queue. The confirmation copy below is written
// to reflect exactly that — it never claims a ticket was recorded in a
// backend system, per the redesign brief.
export default function HelpDeskModal({ open, onClose }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null); // 'sent' | 'error' | null

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleClose = () => {
    setForm(initialForm);
    setErrors({});
    setStatus(null);
    onClose?.();
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Please enter your name.';
    if (!form.contact.trim()) next.contact = 'Please enter an email or phone number.';
    if (!form.category) next.category = 'Please select an issue category.';
    if (!form.message.trim()) next.message = 'Please describe the issue.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) {
      setStatus(null);
      return;
    }
    const subject = `[BADAC Support] ${form.category}`;
    const body = [
      `Name: ${form.name}`,
      `Contact: ${form.contact}`,
      `Category: ${form.category}`,
      '',
      form.message,
    ].join('\n');
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      window.location.href = mailtoUrl;
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Help Desk" size="lg">
      <div className="helpdesk-content">
        <div className="helpdesk-support-row">
          <span className="helpdesk-support-icon"><Icons.Headset size={18} strokeWidth={2} /></span>
          <div>
            <strong>Need assistance?</strong>
            <p>
              Reach BADAC Support directly at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>, or fill out the form
              below and we'll open a pre-filled email to send from your own inbox.
            </p>
          </div>
        </div>

        {status === 'sent' && (
          <div className="login-success" style={{ marginBottom: 16 }}>
            Your email app should now be opening with your message pre-filled to BADAC
            Support. Please review and send it from there to complete your request — this
            form doesn't submit directly to a ticketing system.
          </div>
        )}
        {status === 'error' && (
          <div className="login-error" style={{ marginBottom: 16 }}>
            We couldn't open your email app automatically. Please email {SUPPORT_EMAIL}{' '}
            directly instead.
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="hd-name">Your Name</label>
              <input
                id="hd-name"
                type="text"
                value={form.name}
                onChange={update('name')}
                placeholder="Juan Dela Cruz"
              />
              {errors.name && <div className="field-error">{errors.name}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="hd-contact">Email or Phone</label>
              <input
                id="hd-contact"
                type="text"
                value={form.contact}
                onChange={update('contact')}
                placeholder="you@example.com"
              />
              {errors.contact && <div className="field-error">{errors.contact}</div>}
            </div>
            <div className="form-group full">
              <label htmlFor="hd-category">Issue Category</label>
              <select id="hd-category" value={form.category} onChange={update('category')}>
                <option value="">Select an issue type…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {errors.category && <div className="field-error">{errors.category}</div>}
            </div>
            <div className="form-group full">
              <label htmlFor="hd-message">Describe the Issue</label>
              <textarea
                id="hd-message"
                rows={4}
                value={form.message}
                onChange={update('message')}
                placeholder="Tell us what happened, what you expected, and any error messages you saw."
              />
              {errors.message && <div className="field-error">{errors.message}</div>}
            </div>
          </div>

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={handleClose}>Close</Button>
            <Button type="submit" variant="primary">Send to Support</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
