import { downloadFile } from './helpers';

// Shared .xlsx export for the whole system. Every export button in the
// application goes through this function — there is deliberately no second
// workbook implementation.
//
// It replaced a CSV export used across all modules. Comma-separated text
// cannot express column widths, a frozen header, an autofilter, number/date
// formats, alignment or a sheet name — every one of which these reports need
// in order to read as official documents rather than data dumps. Worse, that
// export derived its header from the keys of the first record, so each file
// carried whatever the API happened to return: internal database ids, and
// raw JSON for any nested array. Callers here pass an explicit, ordered
// column projection instead.
//
// ExcelJS is loaded with a dynamic import so it lands in its own lazily
// fetched chunk. It is a large library and nothing about the normal screen UI
// needs it — pulling it into the main bundle would slow first paint for every
// user to serve a button most sessions never press.
//
// Column descriptor:
//   { header, key, width, type: 'text' | 'date' | 'number', align, wrap,
//     numFmt, value }
//
// `value` is an optional accessor, (row) => cellValue, for a column that is
// derived rather than a plain field — a nested array flattened to a readable
// list, say. `numFmt` overrides the default Excel display format for a date
// or number column.
//
// `type` drives real cell formatting, not string coercion: dates are written
// as Date objects with a display format so Excel can sort and filter them as
// dates, and numbers as numbers so they can be summed. Values are written
// as-is; this function never rounds, relabels or invents data.

const BRAND = '22291F'; // barangay green, used sparingly as a header fill
const RULE = 'FFB0B0B0';

const thinBorder = {
  top: { style: 'thin', color: { argb: RULE } },
  left: { style: 'thin', color: { argb: RULE } },
  bottom: { style: 'thin', color: { argb: RULE } },
  right: { style: 'thin', color: { argb: RULE } },
};

function coerce(value, type) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'date') {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d;
  }
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(n) ? String(value) : n;
  }
  // Arrays and objects would otherwise land in the sheet as [object Object] or
  // a JSON blob. Arrays of primitives read far better as a comma list; a real
  // object is a signal the caller should have supplied its own accessor, so it
  // is stringified rather than silently dropped.
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export async function exportWorkbook({
  filename,
  sheetName = 'Report',
  title,
  subtitle,
  meta = [],
  columns,
  rows,
  onEmpty,
}) {
  if (!rows || !rows.length) {
    if (onEmpty) onEmpty();
    return false;
  }

  try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BADAC Analytics — Barangay 178, North Caloocan';
    wb.created = new Date();

    // Excel rejects : \ / ? * [ ] in sheet names and caps them at 31 chars.
    const safeSheet = String(sheetName).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(safeSheet, {
      views: [{ state: 'frozen', ySplit: 0 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true },
    });

    const lastCol = columns.length;
    const colLetter = (n) => {
      let s = '';
      while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    const span = (r) => `A${r}:${colLetter(lastCol)}${r}`;

    // ---- Title block -------------------------------------------------
    let r = 1;
    ws.mergeCells(span(r));
    const titleCell = ws.getCell(`A${r}`);
    titleCell.value = 'BARANGAY 178 — NORTH CALOOCAN';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF' + BRAND } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r).height = 22;
    r += 1;

    ws.mergeCells(span(r));
    const sub = ws.getCell(`A${r}`);
    sub.value = title;
    sub.font = { name: 'Calibri', size: 12, bold: true };
    sub.alignment = { horizontal: 'center' };
    ws.getRow(r).height = 18;
    r += 1;

    if (subtitle) {
      ws.mergeCells(span(r));
      const s2 = ws.getCell(`A${r}`);
      s2.value = subtitle;
      s2.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF555555' } };
      s2.alignment = { horizontal: 'center' };
      r += 1;
    }

    ws.mergeCells(span(r));
    const metaCell = ws.getCell(`A${r}`);
    metaCell.value = [
      `Generated ${new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}`,
      `${rows.length} record${rows.length === 1 ? '' : 's'}`,
      ...meta,
    ].join('   •   ');
    metaCell.font = { name: 'Calibri', size: 9, color: { argb: 'FF555555' } };
    metaCell.alignment = { horizontal: 'center' };
    r += 1;

    ws.getRow(r).height = 6; // spacer
    r += 1;

    // ---- Header row --------------------------------------------------
    const headerRowNumber = r;
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width || 18 }));
    const headerRow = ws.getRow(headerRowNumber);
    columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder;
    });
    headerRow.height = 20;

    // ---- Data rows ---------------------------------------------------
    rows.forEach((row) => {
      r += 1;
      const xr = ws.getRow(r);
      columns.forEach((c, i) => {
        const cell = xr.getCell(i + 1);
        const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
        cell.value = coerce(raw, c.type);
        cell.font = { name: 'Calibri', size: 10 };
        cell.border = thinBorder;
        cell.alignment = {
          horizontal: c.align || (c.type === 'number' ? 'right' : 'left'),
          vertical: 'top',
          wrapText: Boolean(c.wrap),
        };
        // A column may override the default display format — the audit log,
        // for instance, needs the time of day as well as the date, which a
        // plain 'dd mmm yyyy' would silently drop from view even though the
        // cell holds it.
        if (c.type === 'date' && cell.value instanceof Date) {
          cell.numFmt = c.numFmt || 'dd mmm yyyy';
        } else if (c.type === 'number' && typeof cell.value === 'number') {
          cell.numFmt = c.numFmt || '#,##0';
        }
      });
    });

    // Freeze everything above and including the header, and filter the header.
    ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];
    ws.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: r, column: lastCol },
    };

    const buffer = await wb.xlsx.writeBuffer();
    downloadFile(
      buffer,
      filename,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return true;
  } catch {
    // Surface the failure through the caller's existing onEmpty toast rather
    // than failing silently, and return false so the call site skips its
    // "exported successfully" message.
    if (onEmpty) onEmpty();
    return false;
  }
}
