// Shared helper functions used across pages — formatting, basic statistics, and CSV export.
// Pure functions only; no DOM access, so they're safe to unit test later.

export function formatDate(d) {
  if (!d || d === '—') return '—';
  const parsed = new Date(d + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(t) {
  if (!t) return '—';
  const parts = t.split(':');
  if (parts.length < 2) return t;
  const h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export function today() {
  return new Date().toISOString().split('T')[0];
}

export function uid(prefix = 'UID') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Checkpoint 27 — Excel-safe CSV export, shared by every export button in
// the app (Dashboard, Analytics, IncidentFeed, CriminalRecords,
// VictimRecords, Residents, AuditLogs — a fix here fixes all of them).
// Fixes over the previous version:
//  - UTF-8 BOM prefix so Excel on Windows (the common case for PH
//    government users) correctly detects UTF-8 instead of guessing a
//    legacy codepage and mangling names/locations with diacritics or ñ.
//  - Non-primitive field values (arrays/objects, if any ever appear) are
//    JSON-stringified instead of falling through to `String()`'s
//    "[object Object]" — which would also silently inject unescaped
//    commas into a supposedly-quoted CSV field for array values.
//  - Line breaks inside a field (e.g. a multi-line `description`) are
//    normalized to a space. Every field is already quoted, so an embedded
//    '\n' isn't a strict CSV-correctness problem, but Excel's row-height/
//    rendering handles a literal newline inside a quoted cell
//    inconsistently across versions; flattening it keeps one logical
//    record on one visual row everywhere.
//  - CRLF row endings (the CSV spec's own line terminator), which is what
//    Excel expects rather than a bare '\n'.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function exportCSV(records, filename, onEmpty) {
  if (!records || !records.length) {
    if (onEmpty) onEmpty();
    return false;
  }
  // Checkpoint 27 — error handling. exportCSV is synchronous (in-memory
  // Blob, no network round trip), so there's no "stuck loading" state for
  // it to leave the UI in, but row-construction on malformed record data
  // could still throw. Falling back to the same callback every existing
  // call site already wires up for "No data to export" ensures a genuine
  // failure surfaces as a toast instead of a silent no-op, and the boolean
  // return lets every call site skip its own "exported successfully" toast
  // when that happens (see the call sites: `if (exportCSV(...)) showToast(...)`).
  try {
    const keys = Object.keys(records[0]);
    const header = keys.join(',');
    const rows = records.map((r) => keys
      .map((k) => `"${csvCell(r[k]).replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`)
      .join(','));
    downloadFile(`\ufeff${[header, ...rows].join('\r\n')}`, filename, 'text/csv;charset=utf-8');
    return true;
  } catch {
    if (onEmpty) onEmpty();
    return false;
  }
}

// ===== Statistics =====
export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mode(arr) {
  if (!arr.length) return null;
  const freq = {};
  arr.forEach((v) => { freq[v] = (freq[v] || 0) + 1; });
  let max = 0;
  let modeVal = arr[0];
  for (const [k, v] of Object.entries(freq)) {
    if (v > max) { max = v; modeVal = k; }
  }
  return modeVal;
}

export function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

export function stdDev(arr) {
  return Math.sqrt(variance(arr));
}

export function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  points.forEach(([x, y]) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function movingAverage(data, window = 3) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    result.push(mean(slice));
  }
  return result;
}

// ===== Data Utilities =====
export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

export function countBy(arr, key) {
  const groups = groupBy(arr, key);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
}

// ===== Filters =====
// Checkpoint 26 — verified date-range filtering (shared by Dashboard,
// Analytics, Trends, IncidentFeed, Mapping — every FROM/TO filter in the
// app funnels through this one function, so a fix here fixes all of them).
// `r.date` and `filters.dateFrom`/`dateTo` are always plain 'YYYY-MM-DD'
// strings (native <input type="date"> values, and incident dates are
// stored/returned the same way — see IncidentResource on the backend) with
// no time-of-day component, so this is a pure lexical string comparison,
// never a `new Date(...)` parse — there is no UTC/local timezone
// conversion for it to accidentally apply. That also makes both ends
// naturally inclusive: '2026-08-14' <= '2026-08-14' is true for FROM, and
// '2026-08-14' <= '2026-08-14' is true for TO, exactly as required (see
// the "records exactly on the FROM/TO date" edge case).
export function filterRecords(records, filters) {
  return records.filter((r) => {
    if (filters.dateFrom && r.date < filters.dateFrom) return false;
    if (filters.dateTo && r.date > filters.dateTo) return false;
    if (filters.crimeType && r.crimeType !== filters.crimeType) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.sitio && r.sitio !== filters.sitio) return false;
    if (filters.officer && r.reportingOfficer !== filters.officer) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = `${r.caseNumber} ${r.street} ${r.reportingOfficer} ${r.crimeType} ${r.sitio || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
