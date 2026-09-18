<?php

namespace App\Services;

use App\Models\Incident;
use Illuminate\Support\Carbon;
use InvalidArgumentException;

/**
 * Server-side report generation for automated (scheduled) reports.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BROWSER EXPORTS. Every report the user
 * downloads today is produced in the browser: the React page holds the
 * filtered records and src/utils/exportCsv.js and exportWorkbook.js write the
 * file. That is the right design for an on-demand export and a useless one for
 * an automated report, because at 06:00 on a Monday there is no browser. This
 * class is the server-side counterpart, and it is held to the same two rules
 * the browser exporters are held to:
 *
 *   1. AN EXPLICIT, ORDERED COLUMN PROJECTION. The columns below are written
 *      out one by one. Nothing here enumerates a model's attributes, so no
 *      internal field — the database id, reported_by, synced_at, the
 *      latitude/longitude the mapping module needs — can reach a file by
 *      being added to a table later. A property that is not named below
 *      cannot be exported.
 *   2. THE SAME FILTERS THE SCREEN USES. Crime type, category, sitio, status
 *      and an inclusive date range, matching IncidentController::index() and
 *      filterRecords() in src/utils/helpers.js, so a scheduled report over
 *      the same window contains the same rows the user would see on screen.
 *
 * ONLY ONE REPORT IS OFFERED, and that is a deliberate limit rather than an
 * unfinished edge. A scheduled report needs an unambiguous rolling period, and
 * `incidents` has one: incident_date, the date the crime occurred. Criminal
 * and victim records carry no comparable field — filtering them by "the last
 * 30 days" could mean the date the person was recorded or the date of the
 * offence they are linked to, and those are different reports. Rather than
 * pick one and call it a period, the report is left out until that meaning is
 * decided. Adding it afterwards is one entry in REPORTS.
 */
class ReportGenerator
{
    /**
     * Excel and LibreOffice execute a cell whose text begins with one of
     * these. An incident description is free text typed by an encoder, so it
     * reaches this file as data that a spreadsheet could otherwise be talked
     * into running. Mirrors FORMULA_LEAD in src/utils/exportCsv.js — the two
     * writers must agree, or the same record would be safe in a downloaded
     * file and dangerous in an emailed one.
     */
    private const FORMULA_LEAD = '/^[=+\-@\t\r]/';

    /**
     * RFC 4180 §2.1 specifies CRLF between records, and these files are opened
     * on Windows.
     */
    private const CRLF = "\r\n";

    /**
     * Excel does not detect UTF-8 in a .csv without a byte-order mark and
     * decodes the file as the system codepage instead, mangling every
     * non-ASCII character in a Barangay 178 report. Same reasoning, same
     * solution as the browser exporter.
     */
    private const BOM = "\u{FEFF}";

    public const REPORTS = [
        'incidents' => 'Crime Data Collection',
    ];

    /**
     * Produce one report.
     *
     * @param  array{crimeType?:string,category?:string,sitio?:string,status?:string}  $filters
     * @param  string|null  $from  inclusive start date, 'Y-m-d'
     * @param  string|null  $to  inclusive end date, 'Y-m-d'
     * @return array{filename:string,contents:string,rowCount:int,summary:string,label:string}
     */
    public function generate(string $reportKey, array $filters = [], ?string $from = null, ?string $to = null): array
    {
        if (! array_key_exists($reportKey, self::REPORTS)) {
            throw new InvalidArgumentException("Unknown report key [{$reportKey}].");
        }

        $rows = $this->incidentRows($filters, $from, $to);

        return [
            'label' => self::REPORTS[$reportKey],
            'filename' => sprintf('%s_%s.csv', $reportKey, Carbon::now()->format('Y-m-d')),
            'contents' => $this->toCsv($this->incidentColumns(), $rows),
            'rowCount' => count($rows),
            'summary' => $this->describeScope($filters, $from, $to),
        ];
    }

    /**
     * The explicit, ordered projection. Header text matches the browser export
     * of the same report (src/pages/IncidentFeed.jsx), so a scheduled file and
     * a downloaded one describe the same thing under the same names.
     *
     * @return array<string, callable(Incident): mixed>
     */
    private function incidentColumns(): array
    {
        return [
            'Case Number' => fn (Incident $i) => $i->case_number,
            'Date' => fn (Incident $i) => $i->incident_date?->format('Y-m-d'),
            'Time' => fn (Incident $i) => $i->incident_time,
            'Crime Type' => fn (Incident $i) => $i->crime_type,
            'Category' => fn (Incident $i) => $i->category,
            'Sitio' => fn (Incident $i) => $i->sitio,
            'Street / Location' => fn (Incident $i) => $i->street,
            'Status' => fn (Incident $i) => $i->status,
            'Priority' => fn (Incident $i) => $i->priority,
            'Reporting Officer' => fn (Incident $i) => $i->reporting_officer,
            'Investigating Officer' => fn (Incident $i) => $i->investigating_officer,
            'Description' => fn (Incident $i) => $i->description,
        ];
    }

    /**
     * @return array<int, Incident>
     */
    private function incidentRows(array $filters, ?string $from, ?string $to): array
    {
        // CP-5A — a generated report is official data.
        //
        // Neither condition was here before, so a scheduled file leaving the
        // barangay could contain archived incidents and incidents nobody had
        // reviewed, presented beside validated ones and indistinguishable from
        // them. Only validated, non-archived records are official (Phase 2B),
        // and a report is the one artefact that travels outside the system.
        $query = Incident::query()->official();

        foreach (['crimeType' => 'crime_type', 'category' => 'category', 'sitio' => 'sitio', 'status' => 'status'] as $key => $column) {
            $value = $filters[$key] ?? null;
            // An empty filter means "no filtering, show all", exactly as an
            // empty FilterBar control does on screen. It must not become
            // WHERE column = ''.
            if ($value !== null && $value !== '') {
                $query->where($column, $value);
            }
        }

        if ($from !== null) {
            $query->whereDate('incident_date', '>=', $from);
        }
        if ($to !== null) {
            $query->whereDate('incident_date', '<=', $to);
        }

        // Same default ordering the API serves the list screen in, so the
        // emailed file opens newest-first like the screen does.
        return $query->orderByDesc('incident_date')->orderByDesc('id')->get()->all();
    }

    /**
     * One line describing exactly what the file contains, for the message body
     * and for the report_email_logs row.
     *
     * This is text about the scope, never the data: a log row that says "30
     * records, Theft, 2026-08-12 to 2026-09-11" explains its own row count
     * without becoming a copy of the report.
     */
    private function describeScope(array $filters, ?string $from, ?string $to): string
    {
        $parts = [
            'Period: '.($from === null && $to === null
                ? 'All dates'
                : ($from ?? 'Any').' to '.($to ?? 'Any')),
            'Crime Type: '.($filters['crimeType'] ?? null ?: 'All'),
            'Category: '.($filters['category'] ?? null ?: 'All'),
            'Sitio: '.($filters['sitio'] ?? null ?: 'All'),
            'Status: '.($filters['status'] ?? null ?: 'All'),
            // Fixed, not a filter: the reader of a report_email_logs row can
            // otherwise only guess whether an unreviewed encoding was counted.
            'Validation: Validated only',
        ];

        return implode(' · ', $parts);
    }

    /**
     * @param  array<string, callable>  $columns
     * @param  array<int, Incident>  $rows
     */
    private function toCsv(array $columns, array $rows): string
    {
        $lines = [implode(',', array_map([$this, 'escape'], array_keys($columns)))];

        foreach ($rows as $row) {
            $cells = [];
            foreach ($columns as $accessor) {
                $cells[] = $this->escape($accessor($row));
            }
            $lines[] = implode(',', $cells);
        }

        return self::BOM.implode(self::CRLF, $lines).self::CRLF;
    }

    private function escape(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '';
        }

        $text = (string) $value;

        // Neutralise a leading formula character by prefixing an apostrophe,
        // which every spreadsheet reads as "the rest of this cell is text".
        // The displayed value is unchanged; only its interpretation is.
        if (preg_match(self::FORMULA_LEAD, $text) === 1) {
            $text = "'".$text;
        }

        if (str_contains($text, '"') || str_contains($text, ',') || str_contains($text, "\n") || str_contains($text, "\r")) {
            return '"'.str_replace('"', '""', $text).'"';
        }

        return $text;
    }
}
