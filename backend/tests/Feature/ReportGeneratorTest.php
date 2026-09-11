<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Services\ReportGenerator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use InvalidArgumentException;
use Tests\TestCase;

/**
 * The server-side report writer behind automated reports.
 *
 * Two properties are asserted here above all others, because they are the two
 * that would fail quietly:
 *
 *   1. THE PROJECTION IS EXPLICIT. Only the columns the generator names can
 *      reach the file. The failure this prevents is the one the browser
 *      exporters were rewritten to prevent — a writer that enumerates a
 *      model's attributes ships every internal field ever added to the table,
 *      and nobody notices until a report already contains them.
 *   2. THE FILTERS ACTUALLY FILTER. A report that claims a scope in its
 *      subject line and carries unrelated rows in its attachment is worse
 *      than no report.
 */
class ReportGeneratorTest extends TestCase
{
    use RefreshDatabase;

    private function generator(): ReportGenerator
    {
        return app(ReportGenerator::class);
    }

    public function test_it_rejects_an_unknown_report_key(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $this->generator()->generate('not-a-report');
    }

    public function test_it_writes_a_header_row_and_one_row_per_record(): void
    {
        Incident::factory()->count(3)->create(['incident_date' => '2026-05-10']);

        $report = $this->generator()->generate('incidents');

        $this->assertSame(3, $report['rowCount']);

        // Header + 3 records. Trailing CRLF produces one empty final element.
        $lines = array_filter(explode("\r\n", $report['contents']), fn ($l) => $l !== '');
        $this->assertCount(4, $lines);
    }

    public function test_it_writes_only_the_named_columns_and_no_internal_fields(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-PROJECTION-1',
            'incident_date' => '2026-05-10',
            'latitude' => 14.7601234,
            'longitude' => 121.0301234,
        ]);

        $report = $this->generator()->generate('incidents');
        $header = explode("\r\n", $report['contents'])[0];

        $this->assertStringContainsString('Case Number', $header);
        $this->assertStringContainsString('Crime Type', $header);
        $this->assertStringContainsString('Sitio', $header);

        // The mapping module's coordinates, the sync bookkeeping and the
        // database's own identifiers are not reporting fields, and no header
        // exists for them — so no value for them can be written either.
        foreach (['latitude', 'longitude', 'Latitude', 'Longitude', 'reported_by', 'synced_at', 'incident_code'] as $internal) {
            $this->assertStringNotContainsString($internal, $header);
        }

        $this->assertStringNotContainsString('14.760', $report['contents']);
        $this->assertStringNotContainsString('121.030', $report['contents']);
    }

    public function test_it_applies_every_filter_it_offers(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-KEEP-1',
            'crime_type' => 'Theft',
            'category' => 'Property Crime',
            'sitio' => 'Sitio 1',
            'status' => 'Solved',
            'incident_date' => '2026-05-10',
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-DROP-TYPE',
            'crime_type' => 'Robbery',
            'category' => 'Property Crime',
            'sitio' => 'Sitio 1',
            'status' => 'Solved',
            'incident_date' => '2026-05-10',
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-DROP-STATUS',
            'crime_type' => 'Theft',
            'category' => 'Property Crime',
            'sitio' => 'Sitio 1',
            'status' => 'Open',
            'incident_date' => '2026-05-10',
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-DROP-SITIO',
            'crime_type' => 'Theft',
            'category' => 'Property Crime',
            'sitio' => 'Sitio 3',
            'status' => 'Solved',
            'incident_date' => '2026-05-10',
        ]);

        $report = $this->generator()->generate('incidents', [
            'crimeType' => 'Theft',
            'sitio' => 'Sitio 1',
            'status' => 'Solved',
        ]);

        $this->assertSame(1, $report['rowCount']);
        $this->assertStringContainsString('CN-KEEP-1', $report['contents']);
        $this->assertStringNotContainsString('CN-DROP-TYPE', $report['contents']);
        $this->assertStringNotContainsString('CN-DROP-STATUS', $report['contents']);
        $this->assertStringNotContainsString('CN-DROP-SITIO', $report['contents']);
    }

    public function test_the_date_range_is_inclusive_at_both_ends(): void
    {
        Incident::factory()->create(['case_number' => 'CN-BEFORE', 'incident_date' => '2026-04-30']);
        Incident::factory()->create(['case_number' => 'CN-FIRST', 'incident_date' => '2026-05-01']);
        Incident::factory()->create(['case_number' => 'CN-LAST', 'incident_date' => '2026-05-31']);
        Incident::factory()->create(['case_number' => 'CN-AFTER', 'incident_date' => '2026-06-01']);

        $report = $this->generator()->generate('incidents', [], '2026-05-01', '2026-05-31');

        $this->assertSame(2, $report['rowCount']);
        $this->assertStringContainsString('CN-FIRST', $report['contents']);
        $this->assertStringContainsString('CN-LAST', $report['contents']);
        $this->assertStringNotContainsString('CN-BEFORE', $report['contents']);
        $this->assertStringNotContainsString('CN-AFTER', $report['contents']);
    }

    public function test_an_empty_filter_means_no_filtering_rather_than_an_empty_match(): void
    {
        // The React FilterBar sends '' for a control the user has not touched.
        // If that became WHERE crime_type = '' the report would arrive empty
        // and look like a quiet month rather than a broken filter.
        Incident::factory()->count(2)->create(['incident_date' => '2026-05-10']);

        $report = $this->generator()->generate('incidents', [
            'crimeType' => '',
            'sitio' => null,
        ]);

        $this->assertSame(2, $report['rowCount']);
    }

    public function test_it_neutralises_a_value_that_a_spreadsheet_would_execute(): void
    {
        // An incident description is free text typed by an encoder. Opened in
        // Excel, a cell beginning '=' or '+' is a formula, not a string.
        Incident::factory()->create([
            'case_number' => 'CN-FORMULA',
            'incident_date' => '2026-05-10',
            'description' => '=HYPERLINK("http://example.test","click")',
        ]);

        $report = $this->generator()->generate('incidents');

        $this->assertStringContainsString("'=HYPERLINK", $report['contents']);
        $this->assertStringNotContainsString(',=HYPERLINK', $report['contents']);
        $this->assertStringNotContainsString('"=HYPERLINK', $report['contents']);
    }

    public function test_it_quotes_and_escapes_values_containing_commas_and_quotes(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-QUOTING',
            'incident_date' => '2026-05-10',
            'description' => 'Suspect said "stop", then fled',
        ]);

        $report = $this->generator()->generate('incidents');

        // RFC 4180: the field is wrapped in quotes and each embedded quote is
        // doubled. Without this the comma would start a new column and every
        // field after it would be shifted by one.
        $this->assertStringContainsString('"Suspect said ""stop"", then fled"', $report['contents']);
    }

    public function test_it_starts_with_a_byte_order_mark_so_excel_reads_utf8(): void
    {
        Incident::factory()->create(['incident_date' => '2026-05-10', 'street' => 'Peñaranda Street']);

        $report = $this->generator()->generate('incidents');

        $this->assertStringStartsWith("\u{FEFF}", $report['contents']);
        $this->assertStringContainsString('Peñaranda', $report['contents']);
    }

    public function test_the_scope_summary_describes_the_report_without_quoting_it(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-SECRET-0001',
            'crime_type' => 'Theft',
            'incident_date' => '2026-05-10',
        ]);

        $report = $this->generator()->generate('incidents', ['crimeType' => 'Theft'], '2026-05-01', '2026-05-31');

        $this->assertStringContainsString('2026-05-01 to 2026-05-31', $report['summary']);
        $this->assertStringContainsString('Crime Type: Theft', $report['summary']);
        $this->assertStringContainsString('Sitio: All', $report['summary']);

        // The summary is stored on a report_email_logs row. It must describe
        // the scope, never carry a record from the report.
        $this->assertStringNotContainsString('CN-SECRET-0001', $report['summary']);
    }
}
