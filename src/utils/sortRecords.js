// Shared sort for the report surfaces, and the counterpart to filterRecords()
// in helpers.js.
//
// WHY THIS IS A SEPARATE, PURE FUNCTION. The reporting checklist requires that
// a report support filtering AND sorting, and the thing that must not happen is
// the failure the export layer was already built to prevent: the screen
// claiming one thing and the generated file containing another. Filtering
// avoids that structurally — each page has exactly ONE `filtered` array, and
// the table, the printed document and both exporters all read it — so sorting
// is built the same way. A page sorts once, into one array, and that array is
// what the table renders, what the .xlsx and .csv projections iterate, and what
// the printed report shows. There is no second ordering anywhere to fall out of
// step, because re-sorting for the export would be the bug, not the feature.
//
// Nothing here formats, rounds, relabels or invents a value. Sorting reorders
// rows and does not touch them.

/**
 * Read the value a row should be sorted by.
 *
 * `sortValue` exists for the columns whose displayed text is not a property:
 * Charges and Related Cases are arrays that render as a joined string, and
 * sorting on the raw array would compare "[object Array]" against itself. A
 * column that needs that passes its own accessor, exactly as the export column
 * descriptors already do with `value`.
 */
function readValue(row, sort) {
  if (typeof sort.value === 'function') return sort.value(row);
  return row[sort.key];
}

/**
 * True for the values that carry no ordering information.
 *
 * These always sink to the bottom, in BOTH directions. That is deliberate:
 * reversing the direction should bring the opposite end of the real data into
 * view, and a column sorted descending whose first screenful is twenty blank
 * cells has answered no question the user asked. Excel, LibreOffice and every
 * data grid in common use behave the same way.
 */
function isBlank(v) {
  return v === null || v === undefined || v === '';
}

/**
 * Compare two already-extracted values under a declared column type.
 *
 * `type` is declared by the column rather than sniffed from the data, because
 * sniffing gets the important cases wrong: an all-numeric case number sorts as
 * a number and loses its prefix grouping, and a date column whose first rows
 * happen to be empty sniffs as text and then orders '9 Jan' after '10 Feb'.
 */
export function compareValues(a, b, type = 'text') {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  if (type === 'number') {
    const na = Number(a);
    const nb = Number(b);
    // A value that is not a number at all is treated as blank rather than as
    // NaN, which compares false against everything and would make the sort
    // order depend on the input order.
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  }

  if (type === 'date') {
    const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
    const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  }

  // Text. `numeric: true` is what makes CASE-2 sort before CASE-10 instead of
  // after it — these identifiers are the columns most often sorted on, and
  // plain lexical order on them reads as broken. `sensitivity: 'base'` keeps
  // the ordering case-insensitive, so "dela Cruz" and "Dela Cruz" sit together
  // rather than in two separate blocks.
  return String(a).localeCompare(String(b), 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Return a new array of `rows` ordered by `sort`.
 *
 * `sort`: { key, direction: 'asc' | 'desc', type?, value? } — or null/undefined
 * for "no sort", which returns the input array UNCHANGED (same reference). That
 * is what keeps the pages' default ordering intact: Crime Data Collection is
 * served newest-incident-first by the API and Audit Logs is sorted by timestamp
 * before it reaches here, and neither of those defaults should be disturbed
 * just because this function was called.
 *
 * The sort is stable. Rows that compare equal keep their original relative
 * order, so sorting by Status does not scramble the newest-first ordering
 * within each status group. Array.prototype.sort is required to be stable in
 * every engine this application supports, but the index tiebreak below makes
 * that a property of this function rather than an assumption about the host.
 */
export function sortRecords(rows, sort) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!sort || !sort.key) return rows;

  const direction = sort.direction === 'desc' ? -1 : 1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = readValue(a.row, sort);
      const bv = readValue(b.row, sort);

      // Blanks are settled BEFORE the direction is applied, and deliberately
      // escape it. compareValues already sinks them, but multiplying that
      // result by -1 for a descending sort would float them straight back to
      // the top — which is the bug this branch exists to prevent, and exactly
      // what "blanks last in both directions" has to mean.
      const aBlank = isBlank(av);
      const bBlank = isBlank(bv);
      if (aBlank || bBlank) {
        if (aBlank && bBlank) return a.index - b.index;
        return aBlank ? 1 : -1;
      }

      const cmp = compareValues(av, bv, sort.type);
      if (cmp !== 0) return cmp * direction;
      // Equal under the sort key: original order wins, and it is NOT reversed
      // along with the direction. Flipping ties too would mean toggling a
      // column twice returned a different arrangement than never having sorted
      // it, which is not what "descending" means to a reader.
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * One-line description of the current ordering, for the printed report header
 * and the exported workbook's metadata line.
 *
 * The generated file has to be able to say how it was ordered for the same
 * reason it already says how it was filtered: a report sample is evidence, and
 * evidence that does not describe its own scope proves less. Returns the
 * default-order wording when nothing is sorted, rather than omitting the line,
 * so the report never leaves the question unanswered.
 */
export function describeSort(sort, label) {
  if (!sort || !sort.key) return 'Sort: Default order';
  const dir = sort.direction === 'desc' ? 'descending' : 'ascending';
  return `Sort: ${label || sort.key} (${dir})`;
}
