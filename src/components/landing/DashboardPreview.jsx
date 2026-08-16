import KpiCard from '../ui/KpiCard';
import ChartCard from '../charts/ChartCard';
import { Icons } from '../icons';

// Sample/demo-only figures — clearly labeled as such in the UI below.
// These are illustrative and must never be mistaken for real Barangay 178
// crime statistics (see Task 8 of the landing page brief).
const DEMO_KPIS = [
  { label: 'Total Incidents', value: '1,248', cls: 'accent' },
  { label: 'Active Cases', value: '86', cls: 'warning' },
  { label: 'Resolved Cases', value: '1,162', cls: 'success' },
  { label: 'High-Risk Areas', value: '12', cls: 'danger' },
];

const TREND_LABELS = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
const TREND_DATA = [58, 71, 64, 80, 69, 52];

export default function DashboardPreview() {
  return (
    <div className="landing-preview-panel" role="img" aria-label="Preview of the BADAC Analytics dashboard showing sample crime statistics">
      <div className="landing-preview-header">
        <div className="landing-preview-header-title">
          <Icons.LayoutDashboard size={16} strokeWidth={2.25} />
          <span>Crime Overview</span>
        </div>
        <span className="landing-preview-badge">
          <Icons.Info size={12} strokeWidth={2.5} /> Demo Data
        </span>
      </div>

      <div className="landing-preview-kpis">
        {DEMO_KPIS.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="landing-preview-chart">
        <ChartCard
          title="Incident Trend (Sample)"
          type="line"
          height={140}
          labels={TREND_LABELS}
          datasets={[
            {
              label: 'Incidents',
              data: TREND_DATA,
              borderColor: '#2E8B47',
              backgroundColor: 'rgba(46, 139, 71, 0.14)',
              tension: 0.35,
              fill: true,
              pointRadius: 2,
            },
          ]}
          options={{ plugins: { legend: { display: false } } }}
        />
      </div>

      <div className="landing-preview-footer">
        <span className="landing-preview-activity">
          <span className="landing-preview-pulse" aria-hidden="true" />
          Sample activity feed &middot; illustrative only
        </span>
      </div>
    </div>
  );
}
