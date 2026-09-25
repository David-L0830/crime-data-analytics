import { useState } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { Icons } from '../icons';
import { integrationService } from '../../services/integrationService';
import { auditLogService } from '../../services/auditLogService';
import { useToast } from '../../hooks/useToast';
import { downloadFile, today } from '../../utils/helpers';

// External System Integrations — System Settings (Super Administrator).
//
// BPA Level 2 "Reporting": CDARS outputs to two sub-systems. Both outputs are
// read-only and PULL-based — CDARS pushes nothing; the sub-system (or an
// administrator acting for it) requests a snapshot. Everything described here
// is a real endpoint in IntegrationController, and "Generate JSON Report"
// calls that endpoint and saves exactly what it returned.
const INTEGRATIONS = [
  {
    key: 'integration-security-alerts',
    recipient: 'Security Alert System Module',
    receives: 'Crime hotspot and risk area information',
    icon: <Icons.Siren size={18} strokeWidth={2} />,
    path: '/api/v1/integrations/security-alerts/hotspots',
    fetch: integrationService.securityAlertHotspots,
    filename: 'cdars_security_alerts_hotspots',
    fields: [
      'Per sitio: incident count, hotspot flag and risk level (Low / Medium / High)',
      'Per sitio: incident count by crime type',
      'The hotspot threshold and High-risk boundary the levels were computed with',
    ],
    summarise: (r) =>
      `${r.summary.areasReported} areas · ${r.summary.hotspotCount} hotspots · ${r.summary.highRiskCount} high-risk`,
  },
  {
    key: 'integration-campaign-planning',
    recipient: 'Campaign Planning Module',
    receives: 'Crime trend and analytical information',
    icon: <Icons.TrendingUp size={18} strokeWidth={2} />,
    path: '/api/v1/integrations/campaign-planning/trends',
    fetch: integrationService.campaignPlanningTrends,
    filename: 'cdars_campaign_planning_trends',
    fields: [
      'Monthly incident totals',
      'Monthly incident totals by crime type',
      'Totals by crime type and by category',
    ],
    summarise: (r) =>
      r.summary.firstMonth
        ? `${r.summary.totalIncidents} incidents · ${r.summary.firstMonth} to ${r.summary.lastMonth}`
        : 'No official incidents yet',
  },
];

export default function IntegrationsPanel() {
  return (
    <div className="integrations">
      <Card className="integrations-overview">
        <div className="integration-flow" aria-hidden="true">
          <span className="integration-node integration-node-source">
            <Icons.Database size={16} strokeWidth={2} /> CDARS
          </span>
          <span className="integration-arrow">
            <Icons.ArrowRight size={16} strokeWidth={2} />
          </span>
          <span className="integration-node">Security Alert System</span>
          <span className="integration-node">Campaign Planning</span>
        </div>
        <p className="settings-note">
          CDARS reports to two external sub-systems through read-only,
          pull-based APIs. Each request returns a fresh snapshot built from
          validated, non-archived incidents only. The data is aggregated by
          sitio, crime type, category and month, and carries no names, contact
          details, case numbers or coordinates.
        </p>
      </Card>

      <div className="settings-grid">
        {INTEGRATIONS.map((integration) => (
          <IntegrationCard key={integration.key} integration={integration} />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({ integration }) {
  const { showToast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const report = await integration.fetch();
      downloadFile(
        JSON.stringify(report, null, 2),
        `${integration.filename}_${today()}.json`,
        'application/json',
      );
      setLastRun({
        at: report.meta?.generatedAt,
        summary: integration.summarise(report),
      });
      showToast(`${integration.recipient} report generated`, 'success');
      // Recorded only after the file is in the user's hands; never fails the
      // download (see auditLogService.logExport).
      auditLogService.logExport(integration.key);
    } catch (err) {
      showToast(err.message || 'Could not generate the report.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card
      title={
        <span className="integration-title">
          {integration.icon} {integration.recipient}
        </span>
      }
      actions={<span className="integration-pill">Pull · Read-only</span>}
    >
      <p className="settings-note">Receives: {integration.receives}.</p>

      <div className="integration-endpoint">
        <span className="integration-method">GET</span>
        <code>{integration.path}</code>
      </div>

      <ul className="integration-fields">
        {integration.fields.map((field) => (
          <li key={field}>{field}</li>
        ))}
      </ul>

      <dl className="metabase-status-list">
        <dt>Data scope</dt>
        <dd>Validated, non-archived incidents</dd>
        <dt>Format</dt>
        <dd>JSON</dd>
        <dt>Access</dt>
        <dd>Super Administrator session</dd>
      </dl>

      <div className="integration-actions">
        <Button onClick={generate} disabled={generating} aria-busy={generating}>
          {generating ? (
            <>
              <span className="spinner" aria-hidden="true" /> Generating…
            </>
          ) : (
            <>
              <Icons.Download size={15} strokeWidth={2} /> Generate JSON Report
            </>
          )}
        </Button>
        {lastRun && (
          <p className="settings-note integration-last-run" role="status">
            Last generated
            {lastRun.at ? ` ${new Date(lastRun.at).toLocaleString('en-PH')}` : ''}
            : {lastRun.summary}
          </p>
        )}
      </div>
    </Card>
  );
}
