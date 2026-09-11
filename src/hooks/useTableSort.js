import { useMemo, useState } from 'react';
import { sortRecords, describeSort } from '../utils/sortRecords';

// Sort state for one report surface.
//
// Deliberately tiny and deliberately shared: the four report tables that carry
// sorting (Crime Data Collection, Audit Logs, Criminal Records, Victim Records)
// each need the same three things — the current sort, the sorted rows, and a
// sentence describing the ordering for the report header — and four private
// copies of that would be four chances for one of them to sort the table
// without sorting what it exports.
//
// `rows` is the page's already-filtered array. The sorted array this returns is
// the ONLY array the page should use from here on: table, print and export all
// read it, the same way they all read `filtered` today.
//
// Pass `initial` as { key, direction, type, value, label } to start on a
// particular column; omit it and the page keeps whatever default order its data
// already arrived in.
export default function useTableSort(rows, initial = null) {
  const [sort, setSort] = useState(initial);

  // Three-state cycle per column: ascending -> descending -> off. The third
  // state matters here because the pages' default orderings are meaningful —
  // incidents arrive newest-first, audit logs newest-first — and a two-state
  // toggle would make that original ordering unreachable once any header had
  // been clicked.
  const toggleSort = (column) => {
    if (!column || !column.key) return;
    setSort((prev) => {
      if (!prev || prev.key !== column.key) {
        return {
          key: column.key,
          direction: 'asc',
          type: column.sortType,
          value: column.sortValue,
          label: column.label,
        };
      }
      if (prev.direction === 'asc') return { ...prev, direction: 'desc' };
      return null;
    });
  };

  const sorted = useMemo(() => sortRecords(rows, sort), [rows, sort]);

  return {
    sort,
    sorted,
    toggleSort,
    sortSummary: describeSort(sort, sort?.label),
  };
}
