import Modal from '../ui/Modal';
import Button from '../ui/Button';

// Login redesign — functional "Privacy Policy" link target (replaces the
// dead "#" the reference design implied). Reuses the existing generic
// Modal shell (same one used throughout the authenticated app) so it picks
// up light/dark theming and the Escape/backdrop-close behavior for free.
export default function PrivacyPolicyModal({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Privacy Policy"
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="legal-content">
        <p className="legal-updated">Last updated: January 2026</p>

        <section>
          <h3>1. Information Collected</h3>
          <p>
            BADAC Analytics collects information necessary to operate the Crime Data
            Analytics &amp; Reporting System for Barangay 178, North Caloocan. This includes
            account credentials and session data for authorized personnel, incident and
            case records entered by BADAC staff, resident and criminal records used for
            barangay public-safety operations, and system activity such as login timestamps
            and audit trails.
          </p>
        </section>

        <section>
          <h3>2. How Information Is Used</h3>
          <p>
            Information is used solely to support barangay crime-data analytics, incident
            reporting, case tracking, and related public-safety and governance functions.
            Data is not sold, rented, or used for advertising, and is not shared with third
            parties except where required by law or a lawful order from a competent authority.
          </p>
        </section>

        <section>
          <h3>3. Data Security</h3>
          <p>
            The system uses authenticated sessions, encrypted transport, and role-based
            access controls to protect stored data. Passwords are never stored in plain
            text. Optional two-factor authentication is available for accounts that require
            an additional layer of protection.
          </p>
        </section>

        <section>
          <h3>4. Access Control</h3>
          <p>
            Access is restricted to authorized BADAC personnel and barangay officials whose
            roles require it. Each account is individually attributable, and access to
            sensitive modules (criminal records, resident records, audit logs) is governed
            by the permissions assigned to that account's role.
          </p>
        </section>

        <section>
          <h3>5. Protected Government Information</h3>
          <p>
            This system contains protected government information related to public safety
            and barangay operations. Unauthorized access, duplication, or disclosure of this
            information is prohibited and may be subject to administrative or legal action
            under applicable Philippine law, including the Data Privacy Act of 2012 (RA 10173).
          </p>
        </section>

        <section>
          <h3>6. Data Retention</h3>
          <p>
            Records are retained for as long as necessary to fulfill public-safety,
            governance, and legal record-keeping purposes, consistent with barangay and
            applicable government retention requirements, after which they may be archived
            or disposed of in accordance with those requirements.
          </p>
        </section>

        <section>
          <h3>7. User Responsibilities</h3>
          <p>
            Users are responsible for keeping their login credentials confidential, for all
            activity conducted under their account, and for promptly reporting any suspected
            unauthorized access to a system administrator.
          </p>
        </section>

        <section>
          <h3>8. Policy Updates</h3>
          <p>
            This Privacy Policy may be updated from time to time to reflect changes in the
            system or applicable regulations. Continued use of BADAC Analytics after an
            update constitutes acknowledgment of the revised policy.
          </p>
        </section>
      </div>
    </Modal>
  );
}
