import Badge from './Badge';
import { Icons } from '../icons';

// Reusable data table. `columns`: [{ key, label, render?(value, row) }]
// `actions(row)` returns a node rendered in a trailing "Actions" column.
export default function Table({
  columns,
  rows,
  actions,
  onRowClick,
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
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
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
