import { useNavigate } from 'react-router-dom';
import { useData } from '../hooks/useData';
import Card from '../components/ui/Card';
import { Icons, NAV_ICONS } from '../components/icons';

// Records module landing page (Checkpoint 19, Tasks 2/3).
// The sidebar entry "Records" (moduleId stays 'criminal-records' — see
// utils/constants.js) lands here first, then the user picks Criminal
// Record or Victim Record. Both choices reuse the existing implementations
// (pages/CriminalRecords.jsx and the new pages/VictimRecords.jsx) — no
// business logic is duplicated here, this page is navigation only.
const CriminalIcon = NAV_ICONS.criminalRecords;

export default function Records() {
  const navigate = useNavigate();
  const { criminals, victims } = useData();

  const options = [
    {
      key: 'criminal',
      title: 'Criminal Record',
      description:
        'Search and manage criminal profiles, charges, and case history.',
      count: criminals.length,
      Icon: CriminalIcon,
      to: '/criminal-records/criminal',
    },
    {
      key: 'victim',
      title: 'Victim Record',
      description: 'Search and manage victim profiles linked to incidents.',
      count: victims.length,
      Icon: Icons.Users,
      to: '/criminal-records/victim',
    },
  ];

  return (
    <section className="module">
      <div className="module-toolbar">
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          Choose a record type to continue.
        </p>
      </div>

      <div
        className="records-landing-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {options.map(({ key, title, description, count, Icon, to }) => (
          <Card key={key} className="records-landing-card">
            <button
              type="button"
              onClick={() => navigate(to)}
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 10,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                textAlign: 'left',
              }}
              aria-label={`Open ${title}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon size={22} strokeWidth={2} />
                <strong style={{ fontSize: '1.05rem' }}>{title}</strong>
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{description}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {count} on file
              </span>
            </button>
          </Card>
        ))}
      </div>
    </section>
  );
}
