<?php

namespace Tests\Feature;

use App\Models\Incident;
use App\Services\ReportGenerator;
use Illuminate\Database\Eloquent\Factories\Factory;
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
    /**
     * A report-eligible incident: validated, and not archived.
     *
     * Stated here rather than moved into IncidentFactory's definition, which
     * still mirrors the database default of 'pending' — a newly encoded
     * incident really is unreviewed, and a factory claiming otherwise would
     * quietly weaken every other suite. CP-5A made validation the gate on
     * report content, so a fixture for a report has to say that it passed it.
     */
    private function officialIncidents(): Factory
    {
        return Incident::factory()->state([
            'validation_status' => Incident::VALIDATION_VALIDATED,
        ]);
    }

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
        $this->officialIncidents()->count(3)->create(['incident_date' => '2026-05-10']);

        $report = $this->generator()->generate('incidents');

        $this->assertSame(3, $report['rowCount']);

        // Header + 3 records. Trailing CRLF produces one empty final element.
        $lines = array_filter(explode("\r\n", $report['contents']), fn ($l) => $l !== '');
        $this->assertCount(4, $lines);
    }

    public function test_it_writes_only_the_named_columns_and_no_internal_fields(): void
    {
        $this->officialIncidents()->create([
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
        $this->officialIncidents()->create([
            'case_number' => 'CN-KEEP-1',
            'crime_type' => 'Theft',
            'category' => 'Property Crime',
            'sitio' => 'Sitio 1',
            'status' => 'Solved',
            'incident_date' => '2026-05-10',
        ]);
        $this->officialIncidents()->create([
            'case_number' => 'CN-DROP-TYPE',
            'crime_type' => 'Robbery',
            'category' => 'Property Crime',
            'sitio' => 'Sitio 1',
            'status' => 'Solved',
            'incident_date' => '2026-05-10',
        ]);
        $this->officialIncidents()->create([
            'case_number' => 'CN-DROP-STATUS',
            'crime_type' => 'Theft',
            'category' => 'Property Crime',
            'sitio' => 'Sitio 1',
            'status' => 'Open',
            'incident_date' => '2026-05-10',
        ]);
        $this->officialIncidents()->create([
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
        $this->officialIncidents()->create(['case_number' => 'CN-BEFORE', 'incident_date' => '2026-04-30']);
        $this->officialIncidents()->create(['case_number' => 'CN-FIRST', 'incident_date' => '2026-05-01']);
        $this->officialIncidents()->create(['case_number' => 'CN-LAST', 'incident_date' => '2026-05-31']);
        $this->officialIncidents()->create(['case_number' => 'CN-AFTER', 'incident_date' => '2026-06-01']);

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
        $this->officialIncidents()->count(2)->create(['incident_date' => '2026-05-10']);

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
        $this->officialIncidents()->create([
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
        $this->officialIncidents()->create([
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
        $this->officialIncidents()->create(['incident_date' => '2026-05-10', 'street' => 'Peñaranda Street']);

        $report = $this->generator()->generate('incidents');

        $this->assertStringStartsWith("\u{FEFF}", $report['contents']);
        $this->assertStringContainsString('Peñaranda', $report['contents']);
    }

    public function test_the_scope_summary_describes_the_report_without_quoting_it(): void
    {
        $this->officialIncidents()->create([
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

    // ===== CP-5A — a generated report carries OFFICIAL data only =====
    //
    // A report is the one artefact that leaves the system, and it arrives
    // without the screen around it to qualify what it holds. Before CP-5A this
    // query applied the caller's filters and nothing else, so a scheduled file
    // could contain archived cases and encodings nobody had reviewed, set
    // beside validated ones and indistinguishable from them by anyone reading
    // the spreadsheet.

    public function test_a_report_includes_validated_non_archived_incidents(): void
    {
        $this->officialIncidents()->create([
            'case_number' => 'CN-OFFICIAL',
            'incident_date' => '2026-05-10',
        ]);

        $report = app(ReportGenerator::class)->generate('incidents');

        $this->assertSame(1, $report['rowCount']);
        $this->assertStringContainsString('CN-OFFICIAL', $report['contents']);
    }

    public function test_a_report_excludes_pending_incidents(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-PENDING',
            'incident_date' => '2026-05-10',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $report = app(ReportGenerator::class)->generate('incidents');

        $this->assertSame(0, $report['rowCount']);
        $this->assertStringNotContainsString('CN-PENDING', $report['contents']);
    }

    public function test_a_report_excludes_returned_incidents(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-RETURNED',
            'incident_date' => '2026-05-10',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);

        $report = app(ReportGenerator::class)->generate('incidents');

        $this->assertSame(0, $report['rowCount']);
        $this->assertStringNotContainsString('CN-RETURNED', $report['contents']);
    }

    public function test_a_report_excludes_archived_incidents_even_when_validated(): void
    {
        // This one was never filtered at all before CP-5A: the query had no
        // archive condition, so retired cases were being emailed out.
        $this->officialIncidents()->create([
            'case_number' => 'CN-ARCHIVED',
            'incident_date' => '2026-05-10',
            'status' => 'Archived',
        ]);

        $report = app(ReportGenerator::class)->generate('incidents');

        $this->assertSame(0, $report['rowCount']);
        $this->assertStringNotContainsString('CN-ARCHIVED', $report['contents']);
    }

    public function test_a_report_excludes_an_archived_pending_incident(): void
    {
        Incident::factory()->create([
            'case_number' => 'CN-ARCHIVED-PENDING',
            'incident_date' => '2026-05-10',
            'status' => 'Archived',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $report = app(ReportGenerator::class)->generate('incidents');

        $this->assertSame(0, $report['rowCount']);
    }

    public function test_a_report_of_a_mixed_set_contains_only_the_official_record(): void
    {
        $this->officialIncidents()->create([
            'case_number' => 'CN-OFFICIAL',
            'incident_date' => '2026-05-10',
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-PENDING',
            'incident_date' => '2026-05-10',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-RETURNED',
            'incident_date' => '2026-05-10',
            'validation_status' => Incident::VALIDATION_RETURNED,
        ]);
        $this->officialIncidents()->create([
            'case_number' => 'CN-ARCHIVED-VALIDATED',
            'incident_date' => '2026-05-10',
            'status' => 'Archived',
        ]);
        Incident::factory()->create([
            'case_number' => 'CN-ARCHIVED-PENDING',
            'incident_date' => '2026-05-10',
            'status' => 'Archived',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $report = app(ReportGenerator::class)->generate('incidents');

        $this->assertSame(1, $report['rowCount']);
        $this->assertStringContainsString('CN-OFFICIAL', $report['contents']);
        foreach (['CN-PENDING', 'CN-RETURNED', 'CN-ARCHIVED-VALIDATED', 'CN-ARCHIVED-PENDING'] as $excluded) {
            $this->assertStringNotContainsString($excluded, $report['contents']);
        }
    }

    public function test_the_official_rule_is_not_something_a_caller_can_filter_away(): void
    {
        // The caller controls crime type, category, sitio, status and dates.
        // None of those may readmit an unreviewed record — asking for
        // "status: Open" is not a way around review.
        Incident::factory()->create([
            'case_number' => 'CN-PENDING-OPEN',
            'incident_date' => '2026-05-10',
            'status' => 'Open',
            'validation_status' => Incident::VALIDATION_PENDING,
        ]);

        $report = app(ReportGenerator::class)->generate('incidents', ['status' => 'Open']);

        $this->assertSame(0, $report['rowCount']);
    }

    public function test_the_scope_summary_states_that_the_report_is_validated_only(): void
    {
        // A report_email_logs row saying "12 records" should not leave the
        // reader guessing whether unreviewed encodings were among them.
        $this->officialIncidents()->create(['incident_date' => '2026-05-10']);

        $report = app(ReportGenerator::class)->generate('incidents');

        $this->assertStringContainsString('Validation: Validated only', $report['summary']);
    }
}
