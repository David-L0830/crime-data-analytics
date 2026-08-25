import logo from '../../assets/images/barangay178-logo.png';

export default function PrintReport({ title, meta }) {
  return (
    <>
      {/* Renders once, in normal document flow, at the top of the
          printed report — see the .print-report-header rule in
          global.css for why this is intentionally not position: fixed. */}
      <div className="print-report-header print-only">
        <img src={logo} alt="Barangay 178 Logo" className="print-report-logo" />

        <div className="print-report-brand">
          <div className="print-report-title">
            Crime Data Analytics and Reporting System
          </div>

          <div className="print-report-subtitle">
            Barangay 178, North Caloocan
          </div>
        </div>
      </div>

      {/* Appears in the normal document flow */}
      <div className="print-report-title-block print-only">
        <div className="print-report-main-title">{title}</div>

        {meta && meta.length > 0 && (
          <div className="print-report-meta">
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        )}
      </div>

      {/* Repeats at the bottom of every printed page — position: fixed,
          browsers replay it on each page. Page count text comes entirely
          from CSS (counter(page)/counter(pages) on ::after in global.css);
          this div is just the anchor element. */}
      <div className="print-page-footer print-only" />
    </>
  );
}
