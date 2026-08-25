import Modal from '../ui/Modal';
import Button from '../ui/Button';

// Login redesign — functional "Terms of Use" link target (replaces the
// dead "#" the reference design implied). Same Modal shell as
// PrivacyPolicyModal for a consistent, theme-aware presentation.
export default function TermsOfUseModal({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Terms of Use"
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="legal-content">
        <p className="legal-updated">Last updated: January 2026</p>

        <section>
          <h3>1. Authorized Access</h3>
          <p>
            BADAC Analytics is restricted to authorized BADAC personnel,
            barangay officials, and other individuals explicitly granted an
            account by a system administrator. Accessing or attempting to access
            this system without authorization is strictly prohibited.
          </p>
        </section>

        <section>
          <h3>2. Acceptable Use</h3>
          <p>
            The system may only be used for legitimate barangay public-safety,
            crime-data analytics, and governance purposes consistent with the
            user's assigned role. Users must not use the system for any purpose
            that is unlawful, deceptive, or inconsistent with these Terms.
          </p>
        </section>

        <section>
          <h3>3. User Responsibilities</h3>
          <p>
            Users are responsible for the accuracy of data they enter, for
            safeguarding their login credentials, and for all actions taken
            under their account. Shared or transferred accounts are not
            permitted.
          </p>
        </section>

        <section>
          <h3>4. Protected Information</h3>
          <p>
            Incident, resident, and criminal records accessible through this
            system are protected government information. Users must handle this
            data in accordance with applicable law, barangay policy, and the
            system's Privacy Policy, and must not export, copy, or disclose it
            outside authorized channels.
          </p>
        </section>

        <section>
          <h3>5. Prohibited Activities</h3>
          <p>
            Users must not attempt to bypass authentication or access controls,
            probe or test the system for vulnerabilities without authorization,
            interfere with the system's normal operation, or use another
            person's credentials.
          </p>
        </section>

        <section>
          <h3>6. Account Security</h3>
          <p>
            Users must choose a strong password, enable two-factor
            authentication where available, and report any suspected compromise
            of their account to a system administrator immediately.
          </p>
        </section>

        <section>
          <h3>7. System Monitoring</h3>
          <p>
            Activity on this system, including logins and record access, may be
            logged and audited to protect the integrity of barangay data and to
            investigate suspected misuse.
          </p>
        </section>

        <section>
          <h3>8. Violations</h3>
          <p>
            Violation of these Terms may result in suspension or termination of
            system access and may be referred for administrative or legal
            action, as appropriate.
          </p>
        </section>

        <section>
          <h3>9. Changes to Terms</h3>
          <p>
            These Terms may be revised from time to time. Continued use of BADAC
            Analytics after a revision takes effect constitutes acceptance of
            the updated Terms.
          </p>
        </section>
      </div>
    </Modal>
  );
}
