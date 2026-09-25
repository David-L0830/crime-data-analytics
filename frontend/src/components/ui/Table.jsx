import Badge from './Badge';
import { Icons } from '../icons';

// Reusable data table. `columns`: [{ key, label, render?(value, row) }]
// `actions(row)` returns a node rendered in a trailing "Actions" column.
// `className` is optional and lands on the <table> itself, so a page can
// attach responsive column rules to its own table without those rules
// leaking to every other table in the application. Purely additive - every
// existing call site omits it and renders exactly as before.
//
// SORTING is opt-in and works the same way. A page that wants sortable headers
// passes `sort` (the current { key, direction }) and `onSort` (called with the
// whole column that was clicked); a page that passes neither renders exactly
// the plain headers it always did, which is why the aggregate tables on the
// Dashboard and the Statistical Analysis crosstab are untouched by this.
//
// Two extra column fields are read only when sorting is on:
//   sortable: false  - this column cannot be sorted (a rendered-JSX column
//                      whose underlying value orders meaninglessly)
//   sortType         - 'text' (default) | 'date' | 'number'
//   sortValue(row)   - accessor for columns whose sort key is not a property
// They are handed straight to the caller through onSort; this component does
// not order anything itself. Sorting the rows is the page's job precisely so
// that the array it sorts is the same array it exports and prints.
export default function Table({
  columns,
  rows,
  actions,
  onRowClick,
  className,
  sort,
  onSort,
  emptyMessage = 'No records found.',
}) {
  if (!rows || !rows.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Icons.ClipboardList size={32} strokeWidth={1.5} />
        </div>
        <p style={{ color: 'var(--text-muted)', padding: 20 }}>
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map((c) => {
            const sortable = Boolean(onSort) && c.sortable !== false;
            if (!sortable) return <th key={c.key}>{c.label}</th>;

            const active = sort && sort.key === c.key;
            const direction = active ? sort.direction : null;
            return (
              <th
                key={c.key}
                // aria-sort is what tells a screen reader which column the
                // table is ordered by, and it belongs on the header cell
                // rather than on the button inside it.
                aria-sort={
                  direction === 'asc'
                    ? 'ascending'
                    : direction === 'desc'
                      ? 'descending'
                      : 'none'
                }
              >
                {/* A real <button>, not a click handler on the <th>: the
                    header has to be reachable and operable from the keyboard,
                    and a button is the one element that is both by default. */}
                <button
                  type="button"
                  className={`th-sort${active ? ' th-sort-active' : ''}`}
                  onClick={() => onSort(c)}
                >
                  <span>{c.label}</span>
                  {/* The indicator is aria-hidden because aria-sort above
                      already conveys the state; announcing an arrow glyph as
                      well would say the same thing twice. */}
                  <span className="th-sort-indicator" aria-hidden="true">
                    {direction === 'asc'
                      ? '▲'
                      : direction === 'desc'
                        ? '▼'
                        : '⇅'}
                  </span>
                </button>
              </th>
            );
          })}
          {actions && <th className="actions-col">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.id ?? i}
            className={onRowClick ? 'table-row-clickable' : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(row);
                    }
                  }
                : undefined
            }
          >
            {columns.map((c) => {
              let val = row[c.key];
              if (c.render) val = c.render(val, row);
              else if (c.key === 'status') val = <Badge status={val} />;
              else val = val ?? '—';
              return <td key={c.key}>{val}</td>;
            })}
            {actions && <td className="actions-col">{actions(row)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
