import logo from '../../assets/images/barangay178-logo.png';

// Print-only report header/footer. Rendered into the DOM but visible only when
// printing/exporting to PDF (see the @media print rules in global.css).
// Per the design spec, printable reports carry only the official logo, the
// report title, and the report content itself — no generated-date/by,
// reporting-period, or app-chrome metadata that would make it look like a
// browser screenshot rather than an official administrative report.
export default function PrintReport({ title }) {
  return (
    <>
      <div className="print-report print-only">
        <div className="print-report-header">
          <img src={logo} alt="Barangay 178 Logo" className="print-report-logo" />
          <div className="print-report-brand">
            <div className="print-report-title">Crime Data Analytics and Reporting System</div>
            <div className="print-report-subtitle">Barangay 178, North Caloocan</div>
          </div>
        </div>
        <div className="print-report-main-title">{title}</div>
      </div>
      <div className="print-report-footer print-only">
        <span className="print-report-page">Page <span className="print-page-number" /></span>
      </div>
    </>
  );
}
