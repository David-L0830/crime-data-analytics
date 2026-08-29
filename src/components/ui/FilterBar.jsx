import { useEffect, useState } from 'react';
import Button from './Button';

// Generic filter bar. `fields`: [{ id, label, type: 'text'|'date'|'select', options? }]
// Values are held locally and pushed up via onApply on every change — filters
// apply automatically as the user edits them, with no "Apply Filters" button.
//
// `onClear` is optional and runs alongside the built-in clear, for pages whose
// filter state extends past this bar — the three list screens keep their search
// box outside it, and a "Clear Filters" that left the search term applied would
// be telling the user something untrue.
export default function FilterBar({
  fields,
  onApply,
  initialValues,
  actions,
  onClear,
}) {
  const [values, setValues] = useState(initialValues || {});

  useEffect(() => {
    onApply(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const setField = (id, val) => setValues((prev) => ({ ...prev, [id]: val }));

  // Clearing resets the values held HERE, not just the page's copy. That
  // distinction is the whole point: `values` seeds from initialValues on mount
  // only, so a page that cleared its own filter state alone would leave this
  // bar still displaying the old selections while nothing was filtered — the
  // controls and the applied filters would disagree, silently. Resetting
  // `values` clears the visible controls and lets the effect above push
  // onApply({}) upward, so the two cannot diverge.
  const handleClear = () => {
    setValues({});
    if (onClear) onClear();
  };

  return (
    <div className="filters-bar">
      {fields.map((f) => (
        <div className="filter-group" key={f.id}>
          <label>{f.label}</label>
          {f.type === 'select' ? (
            <select
              value={values[f.id] || ''}
              onChange={(e) => setField(f.id, e.target.value)}
            >
              <option value="">All</option>
              {(f.options || []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type || 'text'}
              placeholder={f.type === 'date' ? '' : f.label}
              value={values[f.id] || ''}
              onChange={(e) => setField(f.id, e.target.value)}
            />
          )}
        </div>
      ))}
      {/* Always rendered, so Clear Filters is present whether or not a caller
          supplies its own actions and whether or not a filter is currently
          set. `gap` is inline rather than in .filter-bar-actions because that
          rule is shared with callers this change does not otherwise touch —
          Trends puts its Hotspots button here, and the two must not sit flush
          against each other. */}
      <div className="filter-bar-actions" style={{ gap: 8 }}>
        {actions}
        <Button variant="secondary" onClick={handleClear}>
          Clear Filters
        </Button>
      </div>
    </div>
  );
}
