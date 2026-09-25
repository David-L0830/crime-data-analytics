import { downloadFile } from './helpers';

// Shared .csv export for the whole system, and the counterpart to
// exportWorkbook.js. Every CSV button in the application goes through this
// function — there is deliberately no second CSV implementation, for the same
// reason there is only one workbook implementation.
//
// WHY THIS EXISTS AGAIN. An older CSV export was removed across all modules
// because it derived its header from the keys of the first record, so each file
// carried whatever the API happened to return: internal database ids, photoUrl,
// reportedBy, synced_at, and raw JSON for any nested array. That is the failure
// this module must not repeat, so it accepts NO records-only call shape at all.
// A caller must hand over the same explicit, ordered column projection that
// exportWorkbook takes, and only those columns are ever written. There is no
// code path here that enumerates an object's own keys — Object.keys, for-in and
// spread over a record all appear nowhere below, by design. A property that is
// not named in `columns` cannot reach the file.
//
// Callers pass ONE spec to both exporters (see the pages' exportSpec()), so the
// .csv and the .xlsx are guaranteed to carry the same columns, in the same
// order, under the same labels, over the same filtered rows. They cannot drift
// apart, because there is only one projection to keep in step.
//
// Column descriptor: the same one exportWorkbook documents —
//   { header, key, width, type: 'text' | 'date' | 'number', align, wrap,
//     numFmt, value }
// `width`, `align` and `wrap` describe a spreadsheet cell and have no meaning
// in comma-separated text, so they are read and ignored rather than emulated.
//
// No dependency. RFC 4180 is a short specification and the browser can already
// do everything it requires; adding a parser library to write six commas would
// be cost with no benefit.

// RFC 4180 §2.1 specifies CRLF between records. Excel, LibreOffice, Numbers,
// pandas and Google Sheets all read a bare LF too, but CRLF is what the
// standard says and it is the safer of the two on Windows, where these files
// are opened.
const CRLF = '\r\n';

// Excel does NOT detect UTF-8 in a .csv. Without a byte-order mark it decodes
// the file as the system's ANSI codepage, and non-ASCII characters in a
// Barangay 178 report are mangled on open — "Peñaranda" becomes "PeÃ±aranda".
// The BOM is the only in-band way to tell Excel otherwise, and it stays
// standards-based: a leading U+FEFF is legal UTF-8, and every other reader in
// common use skips it. Written as an escape rather than the literal character,
// which is invisible in an editor and easily lost to a copy or a reformat.
const BOM = '\uFEFF';

// The leading characters Excel and LibreOffice treat as the start of a formula.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Serialise one already-projected value to CSV text.
 *
 * Mirrors coerce() in exportWorkbook.js so the two files agree on what a value
 * means, but produces text rather than a typed cell — CSV has no types.
 *
 * Dates are written as YYYY-MM-DD, which sorts lexically, is unambiguous
 * between the PH and US day/month conventions, and is what every spreadsheet
 * and every CSV reader parses back into a date. The workbook's own display
 * format decides whether the time of day is included: a column that asked for
 * an hour in `numFmt` (the audit log's 'dd mmm yyyy hh:mm') keeps its hour and
 * minute here too, so the .csv does not silently drop a field the .xlsx shows.
 * Components are read in local time, matching what the screen and the workbook
 * display; toISOString() would shift a Manila evening back to the previous day.
 *
 * Numbers are written bare — no thousands separator — because a grouped
 * "1,234" is both a second comma to quote and a string to whatever reads the
 * file back. The .xlsx keeps its '#,##0' display format; that is a presentation
 * choice a spreadsheet can afford and a data interchange format cannot.
 *
 * Nothing here rounds, relabels or invents a value.
 */
export function toCsvValue(raw, column = {}) {
  if (raw === null || raw === undefined || raw === '') return '';

  if (column.type === 'date') {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return /h/i.test(column.numFmt || '')
      ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      : day;
  }

  if (column.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isNaN(n) ? String(raw) : String(n);
  }

  // Same two fallbacks exportWorkbook applies: an array of primitives reads as
  // a comma list, and a bare object is a signal the caller should have supplied
  // its own accessor, so it is stringified rather than silently dropped. In
  // practice every array column in the app already passes a `value` accessor.
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

/**
 * Quote and escape one field per RFC 4180 §2.5–2.7, and defuse CSV injection.
 *
 * Quoting: a field containing a comma, a double quote, CR or LF is wrapped in
 * double quotes and each embedded quote is doubled. Everything else is written
 * bare, so an ordinary file stays readable.
 *
 * Injection: Excel and LibreOffice evaluate a cell whose text begins with =, +,
 * -, @, tab or CR as a FORMULA when a .csv is opened — quoting does not prevent
 * this, because the quotes are consumed by the CSV parser before the cell text
 * is interpreted. That matters here specifically: description, notes, alias and
 * address are free text an encoder types, and the file is opened by a BADAC
 * administrator. A description beginning "=HYPERLINK(...)" or a DDE payload
 * would run against their machine, not the author's (CWE-1236). A leading
 * apostrophe is the standard mitigation and forces the cell to stay text.
 *
 * This is the one place the CSV deliberately differs from the record, so it is
 * kept as narrow as possible: the apostrophe is added ONLY when the text also
 * fails to parse as a number, so -5, -12.5 and +639171234567 are written
 * unchanged. The .xlsx needs none of this — exceljs writes a string cell as a
 * string, and a leading = is inert there.
 */
export function escapeCsvField(value) {
  let s = String(value);

  if (FORMULA_LEAD.test(s) && !Number.isFinite(Number(s))) {
    s = `'${s}`;
  }

  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build the CSV text for an explicit projection. Exported separately from the
 * download so the serialisation can be asserted directly, without a DOM.
 *
 * The first line is the header row of human-readable column labels — the same
 * `header` strings the workbook prints, so the two files name their columns
 * identically. There is no title block above it: exportWorkbook opens the sheet
 * with a barangay letterhead, a generated-on line and the active filters, which
 * a spreadsheet renders as merged cells and a CSV cannot. Emitting those as
 * leading text lines would push the header off row 1 and break every reader
 * that expects a header there. A CSV is the machine-readable sibling of the
 * .xlsx; the letterhead lives in the workbook and in the printed report.
 */
export function buildCsv({ columns, rows }) {
  const lines = [columns.map((c) => escapeCsvField(c.header)).join(',')];

  rows.forEach((row) => {
    lines.push(
      columns
        .map((c) => {
          // The only two ways a value is ever read: a declared accessor, or the
          // declared key. Never the record's own enumerable properties.
          const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
          return escapeCsvField(toCsvValue(raw, c));
        })
        .join(','),
    );
  });

  // Trailing CRLF: RFC 4180 §2.2 makes the final record's line break optional,
  // and a file that ends with one is the friendlier of the two for tools that
  // append or concatenate.
  return BOM + lines.join(CRLF) + CRLF;
}

/**
 * Build and download a .csv.
 *
 * Same contract as exportWorkbook(): returns true only when a file was actually
 * handed to the browser, and reports "there was nothing to export" and "there
 * was something and it failed" through two separate callbacks, because they are
 * two different events and the user is entitled to know which one happened. The
 * `false` return is what keeps a failed export out of the audit trail — callers
 * gate both their success toast and auditLogService.logExport() on it.
 *
 * Synchronous, unlike exportWorkbook(): that one is async only because it
 * dynamically imports exceljs, and there is nothing here to wait for. Callers
 * are written accordingly rather than being handed a promise that is never
 * pending.
 */
export function exportCsv({ filename, columns, rows, onEmpty, onError }) {
  if (!rows || !rows.length) {
    if (onEmpty) onEmpty();
    return false;
  }

  try {
    // charset=utf-8 alongside the BOM: the parameter is what a browser and a
    // mail client read, the BOM is what Excel reads.
    downloadFile(buildCsv({ columns, rows }), filename, 'text/csv;charset=utf-8');
    return true;
  } catch {
    if (onError) onError();
    return false;
  }
}
