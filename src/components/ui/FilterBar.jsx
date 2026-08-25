import { useEffect, useState } from 'react';

// Generic filter bar. `fields`: [{ id, label, type: 'text'|'date'|'select', options? }]
// Values are held locally and pushed up via onApply on every change — filters
// apply automatically as the user edits them, with no "Apply Filters" button.
export default function FilterBar({ fields, onApply, initialValues, actions }) {
  const [values, setValues] = useState(initialValues || {});

  useEffect(() => {
    onApply(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const setField = (id, val) => setValues((prev) => ({ ...prev, [id]: val }));

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
      {actions && <div className="filter-bar-actions">{actions}</div>}
    </div>
  );
}
