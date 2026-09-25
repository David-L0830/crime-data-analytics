import { describe, it, expect, vi, beforeEach } from 'vitest';

// downloadFile touches the DOM (Blob, URL.createObjectURL, a click on an
// anchor) and this suite runs in Vitest's `node` environment, where none of
// that exists. Mocking it keeps the serialisation — the part with the rules
// worth testing — assertable without pulling jsdom into the dependency tree,
// and lets the filename and MIME type be asserted directly rather than
// inferred.
vi.mock('./helpers', () => ({ downloadFile: vi.fn() }));

const { downloadFile } = await import('./helpers');
const { exportCsv, buildCsv, escapeCsvField, toCsvValue } = await import(
  './exportCsv.js'
);

const BOM = '\uFEFF';

// The header line and each record, as parsed back out of a built file. Keeps
// the assertions about ROWS separate from the assertions about the BOM and the
// trailing CRLF, which are checked on their own below.
const lines = (csv) => csv.replace(BOM, '').replace(/\r\n$/, '').split('\r\n');

beforeEach(() => {
  vi.mocked(downloadFile).mockReset();
});

// ---------------------------------------------------------------------------
// The projection. This is the reason the module exists: the CSV export that
// was removed from this application derived its header from the keys of the
// first record, so every file carried whatever the API happened to return —
// internal database ids, photoUrl, reportedBy, synced_at, and raw JSON for any
// nested array. These tests fail if that behaviour ever comes back.
// ---------------------------------------------------------------------------
describe('exportCsv — explicit projection, never arbitrary object keys', () => {
  it('writes only the declared columns and omits everything else', () => {
    const csv = buildCsv({
      columns: [
        { header: 'Case Number', key: 'caseNumber' },
        { header: 'Crime Type', key: 'crimeType' },
      ],
      rows: [{ id: 123, caseNumber: 'CN-001', crimeType: 'Theft' }],
    });

    expect(lines(csv)).toEqual(['Case Number,Crime Type', 'CN-001,Theft']);
    expect(csv).not.toContain('id');
    expect(csv).not.toContain('123');
  });

  it('omits internal plumbing even when every record carries it', () => {
    // The specific fields the old export leaked, on records shaped like the
    // ones this application's API actually returns.
    const csv = buildCsv({
      columns: [{ header: 'Case Number', key: 'caseNumber' }],
      rows: [
        {
          id: 41,
          caseNumber: 'CN-2026-0001',
          reportedBy: 'auth-uuid-1',
          synced_at: '2026-09-01T00:00:00Z',
          photoUrl: 'https://example.test/photo.jpg',
          previousStatus: 'Open',
          latitude: 14.7564,
          longitude: 121.0451,
        },
        {
          id: 42,
          caseNumber: 'CN-2026-0002',
          reportedBy: 'auth-uuid-2',
          synced_at: '2026-09-02T00:00:00Z',
          photoUrl: 'https://example.test/other.jpg',
          previousStatus: 'Solved',
          latitude: 14.75,
          longitude: 121.04,
        },
      ],
    });

    expect(lines(csv)).toEqual([
      'Case Number',
      'CN-2026-0001',
      'CN-2026-0002',
    ]);
    for (const leaked of [
      'reportedBy',
      'auth-uuid-1',
      'synced_at',
      'photoUrl',
      'example.test',
      'previousStatus',
      'latitude',
      '121.0451',
    ]) {
      expect(csv).not.toContain(leaked);
    }
  });

  it('never serialises a nested array or object that has no declared column', () => {
    // relatedIncidents and caseHistory are arrays of objects on the real
    // records. The old export turned them into columns of JSON.
    const csv = buildCsv({
      columns: [{ header: 'Full Name', key: 'fullName' }],
      rows: [
        {
          fullName: 'Juan Dela Cruz',
          relatedIncidents: [{ caseNumber: 'CN-001', crimeType: 'Theft' }],
          caseHistory: [{ date: '2026-01-01', label: 'Filed' }],
        },
      ],
    });

    expect(lines(csv)).toEqual(['Full Name', 'Juan Dela Cruz']);
    expect(csv).not.toContain('{');
    expect(csv).not.toContain('caseHistory');
  });

  it('writes an empty field, not the record, for a column whose key is absent', () => {
    // A projection naming a field a particular record does not carry must
    // produce a gap in that row — never a fallback that reaches for some other
    // property.
    const csv = buildCsv({
      columns: [
        { header: 'Case Number', key: 'caseNumber' },
        { header: 'Sitio', key: 'sitio' },
        { header: 'Status', key: 'status' },
      ],
      rows: [{ caseNumber: 'CN-001', status: 'Open', secret: 'leak-me' }],
    });

    expect(lines(csv)[1]).toBe('CN-001,,Open');
    expect(csv).not.toContain('leak-me');
  });
});

// ---------------------------------------------------------------------------
// Headers and column order
// ---------------------------------------------------------------------------
describe('exportCsv — headers and column order', () => {
  it('uses the human-readable labels as the first line, in declared order', () => {
    const csv = buildCsv({
      columns: [
        { header: 'Date / Time', key: 'timestamp' },
        { header: 'Performed By', key: 'performedBy' },
        { header: 'Target Type', key: 'targetType' },
      ],
      rows: [{ performedBy: 'A. Santos', targetType: 'incident' }],
    });

    expect(lines(csv)[0]).toBe('Date / Time,Performed By,Target Type');
  });

  it('keeps the declared order even when it does not match the record', () => {
    const csv = buildCsv({
      columns: [
        { header: 'Status', key: 'status' },
        { header: 'Case Number', key: 'caseNumber' },
      ],
      // Object key order is the reverse of the projection.
      rows: [{ caseNumber: 'CN-001', status: 'Open' }],
    });

    expect(lines(csv)).toEqual(['Status,Case Number', 'Open,CN-001']);
  });

  it('quotes a header that itself contains a comma', () => {
    const csv = buildCsv({
      columns: [{ header: 'Surname, Given Name', key: 'fullName' }],
      rows: [{ fullName: 'Dela Cruz, Juan' }],
    });

    expect(lines(csv)).toEqual([
      '"Surname, Given Name"',
      '"Dela Cruz, Juan"',
    ]);
  });
});

// ---------------------------------------------------------------------------
// RFC 4180 escaping
// ---------------------------------------------------------------------------
describe('exportCsv — RFC 4180 escaping', () => {
  it('quotes a value containing a comma', () => {
    expect(escapeCsvField('Sitio 1, Block 4')).toBe('"Sitio 1, Block 4"');
  });

  it('doubles embedded quotes and wraps the field', () => {
    expect(escapeCsvField('Known as "Boy"')).toBe('"Known as ""Boy"""');
  });

  it('quotes a value containing a newline', () => {
    expect(escapeCsvField('Line one\nLine two')).toBe('"Line one\nLine two"');
    expect(escapeCsvField('Line one\r\nLine two')).toBe(
      '"Line one\r\nLine two"',
    );
  });

  it('leaves an ordinary value unquoted', () => {
    expect(escapeCsvField('Theft')).toBe('Theft');
    expect(escapeCsvField('Under Investigation')).toBe('Under Investigation');
  });

  it('keeps a multi-line description parseable as ONE record', () => {
    // A quoted newline stays inside the field, so the file still has one
    // record per incident. Splitting on \r\n outside quotes is what a reader
    // does; the count below is the property that matters.
    const csv = buildCsv({
      columns: [
        { header: 'Case Number', key: 'caseNumber' },
        { header: 'Description', key: 'description' },
      ],
      rows: [
        { caseNumber: 'CN-001', description: 'First para.\nSecond para.' },
        { caseNumber: 'CN-002', description: 'Plain' },
      ],
    });

    expect(csv).toContain('"First para.\nSecond para."');
    // Header + 2 records = 3 record separators' worth of content, and the
    // embedded LF must not have created a fourth.
    expect(csv.replace(BOM, '').replace(/\r\n$/, '').split('\r\n')).toHaveLength(
      3,
    );
  });

  it('separates records with CRLF and ends the file with one', () => {
    const csv = buildCsv({
      columns: [{ header: 'Case Number', key: 'caseNumber' }],
      rows: [{ caseNumber: 'CN-001' }, { caseNumber: 'CN-002' }],
    });

    expect(csv).toBe(`${BOM}Case Number\r\nCN-001\r\nCN-002\r\n`);
  });

  it('begins the file with a UTF-8 BOM so Excel does not mangle non-ASCII', () => {
    const csv = buildCsv({
      columns: [{ header: 'Full Name', key: 'fullName' }],
      rows: [{ fullName: 'Peñaranda' }],
    });

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain('Peñaranda');
  });
});

// ---------------------------------------------------------------------------
// CSV injection. Free text an encoder types reaches a spreadsheet an
// administrator opens; a leading =, +, - or @ makes that text a formula.
// ---------------------------------------------------------------------------
describe('exportCsv — formula injection', () => {
  it('neutralises a value that would be read as a formula', () => {
    expect(escapeCsvField('=HYPERLINK("http://evil.test","click")')).toBe(
      '"\'=HYPERLINK(""http://evil.test"",""click"")"',
    );
    expect(escapeCsvField('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    expect(escapeCsvField('=cmd|calc')).toBe("'=cmd|calc");
  });

  it('leaves a negative number and a phone number alone', () => {
    // The guard applies only to text that is not itself a number, so real
    // data is never rewritten to defend against a formula it cannot be.
    expect(escapeCsvField('-5')).toBe('-5');
    expect(escapeCsvField('-12.5')).toBe('-12.5');
    expect(escapeCsvField('+639171234567')).toBe('+639171234567');
  });

  it('applies the guard through a full export', () => {
    const csv = buildCsv({
      columns: [{ header: 'Description', key: 'description' }],
      rows: [{ description: '=1+1' }],
    });

    expect(lines(csv)[1]).toBe("'=1+1");
  });
});

// ---------------------------------------------------------------------------
// Value serialisation
// ---------------------------------------------------------------------------
describe('exportCsv — value serialisation', () => {
  it('writes a date column as YYYY-MM-DD', () => {
    expect(toCsvValue('2026-09-04', { type: 'date' })).toBe('2026-09-04');
    expect(toCsvValue(new Date(2026, 8, 4), { type: 'date' })).toBe(
      '2026-09-04',
    );
  });

  it('includes the time when the column asks for one', () => {
    // The audit log's Date / Time column carries numFmt 'dd mmm yyyy hh:mm'.
    // Without this the .csv would silently drop a field the .xlsx shows.
    const value = toCsvValue(new Date(2026, 8, 4, 14, 30), {
      type: 'date',
      numFmt: 'dd mmm yyyy hh:mm',
    });

    expect(value).toBe('2026-09-04 14:30');
  });

  it('leaves an unparseable date as its original text', () => {
    expect(toCsvValue('not a date', { type: 'date' })).toBe('not a date');
  });

  it('writes a number bare, with no thousands separator', () => {
    expect(toCsvValue(1234, { type: 'number' })).toBe('1234');
    expect(toCsvValue('42', { type: 'number' })).toBe('42');
    expect(toCsvValue(0, { type: 'number' })).toBe('0');
  });

  it('writes an empty field for a missing value', () => {
    expect(toCsvValue(null, {})).toBe('');
    expect(toCsvValue(undefined, {})).toBe('');
    expect(toCsvValue('', {})).toBe('');
  });

  it('uses a column accessor when one is declared', () => {
    const csv = buildCsv({
      columns: [
        {
          header: 'Charges',
          key: 'charges',
          value: (r) => (r.charges || []).join(', '),
        },
      ],
      rows: [{ charges: ['Theft', 'Assault'] }],
    });

    expect(lines(csv)[1]).toBe('"Theft, Assault"');
  });

  it('renders an array of primitives as a readable list, not JSON', () => {
    expect(toCsvValue(['Theft', 'Robbery'], {})).toBe('Theft, Robbery');
  });
});

// ---------------------------------------------------------------------------
// Download, and the same empty-vs-failed contract exportWorkbook has
// ---------------------------------------------------------------------------
describe('exportCsv — download, empty data and failure', () => {
  const call = (overrides) =>
    exportCsv({
      filename: 'incidents_2026-09-04.csv',
      columns: [{ header: 'Case Number', key: 'caseNumber' }],
      rows: [{ caseNumber: 'CN-001' }],
      ...overrides,
    });

  it('downloads with the given filename and the text/csv MIME type', () => {
    const result = call();

    expect(result).toBe(true);
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [content, filename, mime] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe('incidents_2026-09-04.csv');
    expect(mime).toBe('text/csv;charset=utf-8');
    expect(content).toBe(`${BOM}Case Number\r\nCN-001\r\n`);
  });

  it('calls onEmpty and downloads nothing for zero rows', () => {
    const onEmpty = vi.fn();
    const onError = vi.fn();

    const result = call({ rows: [], onEmpty, onError });

    expect(result).toBe(false);
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('calls onEmpty when rows is missing entirely', () => {
    const onEmpty = vi.fn();

    expect(call({ rows: undefined, onEmpty })).toBe(false);
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it('calls onError — never onEmpty — when the download fails', () => {
    // Same defect exportWorkbook.test.js guards: six export surfaces word
    // onEmpty as "No data to export", so reporting a failure through it tells
    // the user their data was empty while the records sit on screen.
    vi.mocked(downloadFile).mockImplementationOnce(() => {
      throw new Error('save failed');
    });
    const onEmpty = vi.fn();
    const onError = vi.fn();

    const result = call({ onEmpty, onError });

    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEmpty).not.toHaveBeenCalled();
  });

  it('returns false on failure, so callers skip their success path', () => {
    // The success toast and auditLogService.logExport() are both gated on a
    // true return. A failed export must not be audited as REPORT_EXPORTED.
    vi.mocked(downloadFile).mockImplementationOnce(() => {
      throw new Error('save failed');
    });

    expect(call({ onEmpty: vi.fn(), onError: vi.fn() })).toBe(false);
  });

  it('does not throw when a caller omits the callbacks', () => {
    expect(() => call({ rows: [] })).not.toThrow();
    vi.mocked(downloadFile).mockImplementationOnce(() => {
      throw new Error('save failed');
    });
    expect(() => call({})).not.toThrow();
  });
});
