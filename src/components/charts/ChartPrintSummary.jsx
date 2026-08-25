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
export default function ChartPrintSummary({
  title,
  rowLabel = 'Label',
  valueLabel = 'Value',
  labels,
  values,
  series,
  insight,
}) {
  if (!labels || labels.length === 0) return null;

  // `series` is optional — pass an array of { key, label, values } to get a
  // multi-column table (e.g. Actual vs Moving Avg). Every existing call
  // site keeps using the plain `values` prop and is unaffected.
  const columns = series
    ? [
        { key: 'label', label: rowLabel },
        ...series.map((s) => ({ key: s.key, label: s.label })),
      ]
    : [
        { key: 'label', label: rowLabel },
        { key: 'value', label: valueLabel },
      ];

  const rows = labels.map((label, i) => {
    if (series) {
      const row = { label };
      series.forEach((s) => {
        row[s.key] = s.values[i] ?? '—';
      });
      return row;
    }
    return { label, value: values[i] ?? 0 };
  });

  return (
    <div className="print-only chart-print-summary">
      <div className="chart-print-summary-heading">{title} — Data Summary</div>
      <Table columns={columns} rows={rows} />
      {insight && (
        <p className="chart-print-summary-analysis">
          <strong>Analysis: </strong>
          {insight}
        </p>
      )}
    </div>
  );
}
