// `hint`, when present, is shown via a small dedicated info icon in the
// card's corner rather than a `title` attribute on the whole card. A
// `title` on the whole card triggers the browser's own native tooltip
// (positioned wherever the cursor happens to be, often right over the
// value/label) *in addition to* any custom CSS tooltip — the two used to
// render on top of each other and cover the card's content. Scoping the
// hover target to the icon, and the tooltip to a fixed position relative
// to it, keeps the card's own value/label always readable.
export default function KpiCard({ label, value, cls = 'accent', hint }) {
  return (
    <div className={`kpi-card ${cls}`}>
      {hint && (
        <span className="kpi-info" tabIndex={0} aria-label={hint}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
          </svg>
          <span className="kpi-info-tooltip" role="tooltip">{hint}</span>
        </span>
      )}
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
