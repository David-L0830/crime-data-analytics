// On-screen header for the analytics pages (Statistical Analysis, Trend and
// Pattern Detection): what the page is, what data it is built from and how
// many records are in view, so the page reads as complete while the embedded
// Metabase dashboard is still loading below. Screen only (.print-hidden): a
// printed report carries its own PrintReport title and meta line.
export default function AnalyticsHeader({ icon, title, description, recordCount }) {
  return (
    <header className="analytics-header print-hidden">
      <div className="analytics-header-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="analytics-header-body">
        <h2>{title}</h2>
        <p>{description}</p>
        <ul className="analytics-header-meta">
          <li>
            <strong>{recordCount}</strong> official record
            {recordCount === 1 ? '' : 's'} in view
          </li>
          <li>Validated, non-archived incidents only</li>
          <li>Filters apply to every chart on this page</li>
        </ul>
      </div>
    </header>
  );
}
