import { useState } from 'react';
import logo from '../../assets/images/barangay178-logo.png';
import { Icons } from '../icons';
import PrivacyPolicyModal from '../legal/PrivacyPolicyModal';
import TermsOfUseModal from '../legal/TermsOfUseModal';
import HelpDeskModal from '../support/HelpDeskModal';

const SUPPORT_EMAIL = 'badac.support@barangay178.gov.ph';

export default function LandingFooter() {
  // Reuses the exact same modal components as the Login page footer (see
  // src/pages/Login.jsx) instead of duplicating Privacy/Terms/Help content.
  const [legalModal, setLegalModal] = useState(null); // 'privacy' | 'terms' | 'help' | null

  return (
    <footer id="contact" className="landing-footer">
      <div className="landing-footer-inner">
        <div className="landing-footer-brand">
          <img src={logo} alt="Barangay 178 Seal" />
          <div>
            <strong>BADAC Analytics</strong>
            <p>Crime Data Analytics &amp; Reporting System</p>
            <p className="landing-footer-locality">
              Barangay 178, North Caloocan
            </p>
          </div>
        </div>

        <div className="landing-footer-col">
          <h4>Site</h4>
          <a href="#home">Home</a>
          <a href="#features">Features</a>
          <a href="#about">About</a>
        </div>

        <div className="landing-footer-col">
          <h4>Contact</h4>
          <span className="landing-footer-contact-line">
            <Icons.Mail size={14} strokeWidth={2} /> {SUPPORT_EMAIL}
          </span>
          <button
            type="button"
            className="landing-footer-link"
            onClick={() => setLegalModal('help')}
          >
            Help Desk
          </button>
        </div>

        <div className="landing-footer-col">
          <h4>Legal</h4>
          <button
            type="button"
            className="landing-footer-link"
            onClick={() => setLegalModal('privacy')}
          >
            Privacy Policy
          </button>
          <button
            type="button"
            className="landing-footer-link"
            onClick={() => setLegalModal('terms')}
          >
            Terms of Use
          </button>
        </div>
      </div>

      <div className="landing-footer-bottom">
        <p>
          &copy; 2026 Barangay 178 &mdash; North Caloocan. All rights reserved.
        </p>
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
    </footer>
  );
}
