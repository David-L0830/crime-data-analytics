import Table from '../ui/Table';

// Print-only companion to ChartCard. A <canvas> chart prints fine as an
// image, but its underlying numbers aren't selectable/readable text — this
// renders the exact same labels/values as a table, plus the auto-generated
// analysis sentence, right after the chart. Hidden on screen (.print-only
// is display:none there) and shown only under @media print — see
// styles/global.css. Reuses the existing Table component (the same one
// ChartSummaryModal.jsx already uses), so no new table markup/styling is
// introduced. This file is independent of ChartSummaryModal.jsx — it
// doesn't import from it and doesn't need any change there.
export default function ChartPrintSummary({ title, rowLabel = 'Label', valueLabel = 'Value', labels, values, insight }) {
  if (!labels || labels.length === 0) return null;

  const rows = labels.map((label, i) => ({ label, value: values[i] ?? 0 }));

  return (
    <div className="print-only chart-print-summary">
      <div className="chart-print-summary-heading">{title} — Data Summary</div>
      <Table
        columns={[
          { key: 'label', label: rowLabel },
          { key: 'value', label: valueLabel },
        ]}
        rows={rows}
      />
      {insight && (
        <p className="chart-print-summary-analysis">
          <strong>Analysis: </strong>
          {insight}
        </p>
      )}
    </div>
  );
}