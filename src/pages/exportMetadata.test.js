import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Crime Mapping's export, and the scope metadata the export surfaces send with
 * it.
 *
 * Two things are guarded here, and they are guarded for different reasons.
 *
 * THE MAPPING PROJECTION IS A PRIVACY BOUNDARY. Crime Mapping draws the
 * PII-free GET /incidents/map payload — a location and a classification, and
 * nothing that names a person (see IncidentController::map()). An export built
 * from that dataset inherits the guarantee, but only for as long as nobody adds
 * a column by joining in the full record. The column list is therefore asserted
 * exactly, in order, rather than loosely: adding a complainant, victim, suspect
 * or officer field to this one export fails here, which is the point.
 *
 * THE METADATA IS SCOPE, NEVER CONTENT. report_runs records how large a run was
 * and over what period and filters — counts and filter text. A page must not
 * send the rows themselves, and Crime Data Collection must not send the text
 * typed into its search box, which matches people's names.
 *
 * Asserted against the source text, the same way exportSurfaces.test.js is, and
 * for the same reason: these pages need a DOM, a DataContext and Leaflet to
 * render, and this suite runs in Vitest's `node` environment. The serialisation
 * itself is covered in src/utils/exportCsv.test.js, and logExport's own
 * behaviour against a stubbed api in src/services/auditLogService.test.js.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(here, file), 'utf8');

const mapping = read('Mapping.jsx');

// Mapping.jsx explains at length WHY it holds no victim, complainant or
// suspect detail, so a search of the raw text finds those words in the very
// comments that rule them out. Assertions about what the page reads therefore
// run against the code with comments stripped — otherwise the documentation
// would be indistinguishable from the defect it warns about.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n'"`]*$/gm, '');

const mappingCode = stripComments(mapping);

describe('Crime Mapping exports the dataset it is already showing', () => {
  it('offers Export Excel and Export CSV', () => {
    expect(mapping).toMatch(
      /onClick=\{handleExportExcel\}[\s\S]{0,400}Export Excel/,
    );
    expect(mapping).toMatch(
      /onClick=\{handleExportCsv\}[\s\S]{0,120}Export CSV/,
    );
  });

  it('adds no page, route or navigation entry to reach them', () => {
    // Reporting is a process inside the module that owns the data, not a
    // module of its own. The export lives on the Crime Mapping page and
    // nowhere else: no route, no link, no destination called Reports.
    expect(mappingCode).not.toMatch(/<Route\b/);
    expect(mappingCode).not.toMatch(/['"`]\/report/);
    expect(mappingCode).not.toMatch(/<(Link|NavLink)\b/);
  });

  it('exports the filtered mapping dataset, not a second fetch of its own', () => {
    // `filtered` is the memo the map itself is drawn from. The export must
    // project it rather than call the API again — a second data path could
    // return something the map is not showing, and could return fields the map
    // payload deliberately withholds.
    expect(mapping).toMatch(/^\s{4}rows: filtered,$/m);

    const calls = [
      ...mappingCode.matchAll(/incidentService\s*\.\s*(\w+)\(/g),
    ].map((m) => m[1]);
    expect(calls).toEqual(['map']);
  });

  it('projects exactly the approved PII-free columns, in order', () => {
    const spec = mapping.slice(
      mapping.indexOf('const exportSpec = () => ({'),
      mapping.indexOf('const exportMeta = () => ({'),
    );
    const headers = [...spec.matchAll(/header: '([^']+)'/g)].map((m) => m[1]);

    expect(headers).toEqual([
      'Incident ID',
      'Case Number',
      'Date',
      'Time',
      'Crime Type',
      'Category',
      'Sitio',
      'Street / Location',
      'Status',
      'Priority',
      'Latitude',
      'Longitude',
    ]);
  });

  it('reads only keys the map payload actually carries', () => {
    // GET /incidents/map returns exactly these. A key outside the list is
    // either a typo that exports a column of blanks, or a field that had to be
    // fetched from somewhere else.
    const payloadKeys = [
      'id',
      'latitude',
      'longitude',
      'incidentCode',
      'caseNumber',
      'category',
      'crimeType',
      'date',
      'time',
      'location',
      'sitio',
      'status',
      'priority',
    ];

    const spec = mapping.slice(
      mapping.indexOf('const exportSpec = () => ({'),
      mapping.indexOf('const exportMeta = () => ({'),
    );
    const keys = [...spec.matchAll(/key: '([^']+)'/g)].map((m) => m[1]);

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(payloadKeys).toContain(key);
    }
  });

  it('carries no complainant, victim, suspect or officer field', () => {
    // The disclosure this module exists to avoid is a named individual
    // attached to a dot on a map.
    //
    // Asserted twice over, because either check alone is escapable. First the
    // export itself: none of these words may appear anywhere in the projection
    // or the metadata it sends. Then the whole page: it must never read such a
    // property off an incident at all, so there is nothing for a future column
    // to reach for. (A bare word search over the page would not do — its
    // geolocation help text mentions the browser's address bar, and its
    // comments name these fields precisely to explain their absence.)
    const exportRegion = mapping.slice(
      mapping.indexOf('const exportSpec = () => ({'),
      mapping.indexOf('const [exporting, handleExportExcel]'),
    );

    for (const field of [
      'complainant',
      'victim',
      'suspect',
      'officer',
      'badge',
      'contact',
      'address',
      'description',
    ]) {
      expect(exportRegion.toLowerCase()).not.toContain(field);
    }

    const reads = [
      ...mappingCode.matchAll(
        /\b\w+\.(complainant|victim|suspect|reporting|investigating|badge|contact|address)\w*/gi,
      ),
    ].map((m) => m[0]);
    expect(reads).toEqual([]);
  });

  it('exports the internal database id under no heading at all', () => {
    // 'Incident ID' is incidentCode — the identifier the map tooltip prints.
    // The numeric primary key is row plumbing, and shipping it in a report is
    // the defect that got the previous system-wide CSV export removed.
    expect(mapping).toContain("{ header: 'Incident ID', key: 'incidentCode'");
    expect(mapping).not.toMatch(/header: '[^']*',\s*key: 'id'/);
  });

  it('records the export under the whitelisted mapping key, on success only', () => {
    const csvHandler = mapping.slice(
      mapping.indexOf('const ok = exportCsv({'),
      mapping.indexOf('const ok = exportCsv({') + 600,
    );
    expect(csvHandler).toMatch(/if \(ok\) \{/);
    expect(csvHandler.indexOf('if (ok) {')).toBeLessThan(
      csvHandler.indexOf('logExport'),
    );
    expect(mapping).toContain(
      "auditLogService.logExport('mapping', exportMeta());",
    );
  });

  it('sends the filtered row count and the period the filters state', () => {
    const meta = mapping.slice(
      mapping.indexOf('const exportMeta = () => ({'),
      mapping.indexOf('const [exporting, handleExportExcel]'),
    );

    expect(meta).toContain('rowCount: filtered.length,');
    expect(meta).toContain("periodFrom: filters['map-dateFrom'] || null,");
    expect(meta).toContain("periodTo: filters['map-dateTo'] || null,");
    expect(meta).toContain('filtersSummary: filterSummary,');

    // Scope, not content: the rows themselves are never part of the metadata.
    expect(meta).not.toContain('rows:');
  });

  it('leaves the Leaflet map, its layers and the boundary alone', () => {
    // R2b adds an export to this page and changes nothing about how it draws.
    // These are the anchors the map is built on; the export touches none of
    // them, and this fails if a later edit reaches for them from the export
    // path.
    for (const anchor of [
      'L.markerClusterGroup',
      'L.heatLayer',
      'BARANGAY_178_BOUNDARY',
      'barangay178LatLngBounds',
      'basemapLayerRef',
      'userLocationRef',
    ]) {
      expect(mapping).toContain(anchor);
    }
  });
});

// The pages that had an export before R2b. Each keeps its existing behaviour
// and now states the scope of the run alongside it.
const METADATA_SURFACES = [
  { file: 'Dashboard.jsx', report: 'dashboard', rows: 'filtered', prefix: 'dash' },
  { file: 'Analytics.jsx', report: 'analytics', rows: 'filtered', prefix: 'ana' },
  { file: 'IncidentFeed.jsx', report: 'incidents', rows: 'sorted', prefix: 'inc' },
  { file: 'Mapping.jsx', report: 'mapping', rows: 'filtered', prefix: 'map' },
];

describe.each(METADATA_SURFACES)(
  '$file states the scope of its export',
  ({ file, report, rows, prefix }) => {
    const source = read(file);

    it('passes metadata on both the workbook and the CSV export', () => {
      const calls =
        source.match(
          new RegExp(
            `auditLogService\\.logExport\\('${report}', exportMeta\\(\\)\\);`,
            'g',
          ),
        ) || [];
      expect(calls).toHaveLength(2);
    });

    it('counts the same rows it exported', () => {
      // The count must come from the array the projection uses, so the number
      // in the history is the number of lines in the file.
      expect(source).toContain(`rowCount: ${rows}.length,`);
      expect(source).toMatch(new RegExp(`^\\s{4}rows: ${rows},$`, 'm'));
    });

    it('reports the period from the date filters, inventing nothing', () => {
      expect(source).toContain(`periodFrom: filters['${prefix}-dateFrom'] || null,`);
      expect(source).toContain(`periodTo: filters['${prefix}-dateTo'] || null,`);
    });

    it('sends no row content as metadata', () => {
      const meta = source.slice(
        source.indexOf('const exportMeta = () => ({'),
        source.indexOf('const [exporting, handleExportExcel]'),
      );
      expect(meta).not.toMatch(/\.map\(/);
      expect(meta).not.toMatch(/JSON\.stringify/);
      expect(meta).not.toMatch(/\brows\b/);
    });
  },
);

describe('Crime Data Collection does not persist what was searched for', () => {
  it('reports only that a search was applied', () => {
    // This page's search matches victim, suspect and complainant names.
    // filterSummary — the line printed on the document the user is holding —
    // still shows the term; the stored run record must not.
    const source = read('IncidentFeed.jsx');
    const meta = source.slice(
      source.indexOf('const exportMeta = () => ({'),
      source.indexOf('const [exporting, handleExportExcel]'),
    );

    expect(meta).toContain("`Search: ${debouncedSearch ? 'Applied' : 'None'}`");
    expect(meta).not.toContain('filtersSummary: filterSummary');
    expect(meta).not.toContain('`Search: ${debouncedSearch || ');
  });
});

describe('Trend and Pattern Detection is unchanged by R2b', () => {
  it('still has no export, and so has no metadata to send', () => {
    // Stated rather than assumed. Trends has only a printed document; adding
    // an export to it was not part of this checkpoint, and this records that
    // the absence is the existing state rather than something R2b dropped.
    const source = read('Trends.jsx');
    expect(source).not.toContain('logExport');
    expect(source).not.toContain('exportWorkbook');
    expect(source).toContain('PrintReport');
  });
});
