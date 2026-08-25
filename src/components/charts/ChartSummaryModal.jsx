import Modal from '../ui/Modal';
import KpiCard from '../ui/KpiCard';
import Table from '../ui/Table';
import Button from '../ui/Button';
import PrintReport from '../ui/PrintReport';
import { Icons } from '../icons';

// Presentational shell only — it renders whatever chart-specific content it's
// given (title/description/labels/datasets always; `insight` and `kpis` are
// optional and added by Dashboard.jsx starting in Phase 3). Keeping the
// analysis logic out of this file means every chart on the Dashboard can
// reuse the exact same modal without any chart-specific branching in here.
export default function ChartSummaryModal({
  open,
  onClose,
  title,
  description,
  rowLabel = 'Label',
  valueLabel = 'Value',
  labels = [],
  datasets = [],
  insight,
  kpis,
  onDrillDown,
  activeFiltersLabel,
}) {
  const values = datasets[0]?.data ?? [];
  const rows = labels.map((label, i) => ({
    id: label,
    label,
    value: values[i] ?? 0,
  }));

  const printMeta = [
    `Generated: ${new Date().toLocaleString('en-PH')}`,
    `Filters: ${activeFiltersLabel || 'None applied'}`,
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <Button variant="secondary" onClick={() => window.print()}>
          <Icons.Report size={15} strokeWidth={2} /> Print / Save as PDF
        </Button>
      }
    >
      <PrintReport title={title} meta={printMeta} />

      {description && (
        <p className="chart-summary-description">{description}</p>
      )}

      {insight && (
        <div className="chart-summary-insight">
          <p>{insight}</p>
        </div>
      )}

      {kpis && kpis.length > 0 && (
        <div className="kpi-grid chart-summary-kpis">
          {kpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>
      )}

      <h3 className="chart-summary-breakdown-title">Detailed Breakdown</h3>

      {onDrillDown && (
        <p className="chart-summary-drilldown-hint">
          Click a row to view those incidents.
        </p>
      )}

      <div className="table-wrap">
        <Table
          columns={[
            { key: 'label', label: rowLabel },
            { key: 'value', label: valueLabel },
          ]}
          rows={rows}
          onRowClick={onDrillDown ? (row) => onDrillDown(row.label) : undefined}
        />
      </div>
    </Modal>
  );
}
