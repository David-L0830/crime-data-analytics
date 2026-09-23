<?php

namespace App\Console\Commands;

use App\Models\Incident;
use App\Services\Barangay178Boundary;
use App\Support\Audit;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Reports which incidents carry coordinates the map cannot honestly plot as
 * Barangay 178, and — only when explicitly told to, one named id at a time —
 * relocates a record inside the real boundary.
 *
 * WHY THIS IS A COMMAND AND NOT A MIGRATION
 *
 * A migration runs itself. This must not: the database holds a MIXTURE of
 * seeded demo rows and rows a person typed in, and nothing in the schema
 * distinguishes them. A migration that rewrote every out-of-boundary
 * coordinate would silently overwrite real reported locations along with the
 * demo ones, and a crime record whose location the system quietly edited is
 * worse than one that is visibly wrong — nothing afterwards reveals that it
 * happened.
 *
 * So the default mode writes NOTHING. It prints what is wrong, and leaves the
 * decision with a person who can tell the two kinds of row apart.
 *
 * WHAT IT REPORTS
 *
 * Three separate problems, deliberately not merged into one "bad coordinates"
 * count, because they call for different responses:
 *
 *   MISSING     no coordinate at all. Legitimate and common — plenty of
 *               reports arrive with a street and a sitio and no GPS reading.
 *               Not an error, just unplottable. Listed so the count of what
 *               the map omits is never a mystery.
 *   UNUSABLE    present but not a real point: non-numeric, out of range, or
 *               the 0,0 empty-field artefact.
 *   OUTSIDE     a real point, but not in Barangay 178. Includes both obvious
 *               data entry damage (longitude 117.0282 is open sea, ~450 km
 *               west) and the entire seeded dataset, which was generated
 *               around a centre 4.3 km outside the barangay.
 *
 * REPAIRING
 *
 * `--repair --ids=121,123` relocates exactly those incidents to fresh points
 * inside the real polygon. Ids must be named. There is deliberately no
 * "repair everything" switch: the point of this command is that a person
 * decides which rows are demo data, and a bulk flag would hand that decision
 * back to the machine. Every relocation writes an audit_logs row recording the
 * previous coordinates, so the change is reversible from the trail.
 */
class AuditIncidentCoordinates extends Command
{
    protected $signature = 'incidents:audit-coordinates
        {--repair : Relocate the named incidents inside the Barangay 178 boundary}
        {--ids= : Comma-separated incident ids to repair (required with --repair)}
        {--force : Skip the confirmation prompt (for non-interactive use)}';

    protected $description = 'Report incidents whose coordinates fall outside Barangay 178, and optionally relocate named demo records inside it';

    public function handle(Barangay178Boundary $boundary): int
    {
        $bounds = $boundary->bounds();

        $this->line('');
        $this->info('Barangay 178 boundary: '.$boundary->path());
        $this->line(sprintf(
            '  extent %.7f–%.7f N, %.7f–%.7f E',
            $bounds['south'], $bounds['north'], $bounds['west'], $bounds['east']
        ));
        $this->line('');

        $missing = [];
        $unusable = [];
        $outside = [];
        $inside = 0;

        Incident::query()
            ->select(['id', 'case_number', 'incident_code', 'sitio', 'street', 'status', 'latitude', 'longitude'])
            ->orderBy('id')
            ->chunk(200, function ($chunk) use ($boundary, &$missing, &$unusable, &$outside, &$inside) {
                foreach ($chunk as $incident) {
                    $lat = $incident->latitude;
                    $lng = $incident->longitude;

                    if ($lat === null && $lng === null) {
                        $missing[] = $incident;
                    } elseif (! Barangay178Boundary::isUsableCoordinate($lat, $lng)) {
                        $unusable[] = $incident;
                    } elseif (! $boundary->contains($lat, $lng)) {
                        $outside[] = $incident;
                    } else {
                        $inside++;
                    }
                }
            });

        $total = $inside + count($missing) + count($unusable) + count($outside);

        $this->table(
            ['Coordinate state', 'Incidents'],
            [
                ['Inside Barangay 178', $inside],
                ['OUTSIDE Barangay 178', count($outside)],
                ['UNUSABLE (non-numeric / out of range / 0,0)', count($unusable)],
                ['MISSING (no coordinate recorded)', count($missing)],
                ['Total', $total],
            ]
        );

        $this->listProblem('OUTSIDE Barangay 178', $outside, $boundary);
        $this->listProblem('UNUSABLE', $unusable, $boundary);

        if ($missing) {
            $this->line('');
            $this->comment(sprintf(
                'MISSING (%d): %s',
                count($missing),
                collect($missing)->pluck('case_number')->implode(', ')
            ));
            $this->line('  Not an error. These incidents were recorded without a coordinate and are');
            $this->line('  simply not plotted. The map states this rather than inventing a position.');
        }

        if (! $this->option('repair')) {
            $this->line('');
            $this->info('Report only — nothing was modified.');

            if ($outside || $unusable) {
                $this->line('To relocate specific DEMO records inside the boundary, name them explicitly:');
                $this->line('  php artisan incidents:audit-coordinates --repair --ids=<id,id,...>');
                $this->line('Do NOT repair a record that a person actually reported: a genuine location');
                $this->line('that is outside the barangay is a fact about the report, not a defect.');
            }

            return self::SUCCESS;
        }

        return $this->repair($boundary);
    }

    /**
     * @param  array<int, Incident>  $rows
     */
    private function listProblem(string $label, array $rows, Barangay178Boundary $boundary): void
    {
        if (! $rows) {
            return;
        }

        $this->line('');
        $this->warn(sprintf('%s (%d):', $label, count($rows)));

        $this->table(
            ['id', 'Case number', 'Sitio', 'Street', 'Status', 'Latitude', 'Longitude'],
            collect($rows)->map(fn (Incident $i) => [
                $i->id,
                $i->case_number,
                $i->sitio,
                $i->street ?? '—',
                $i->status,
                $i->latitude ?? 'null',
                $i->longitude ?? 'null',
            ])->all()
        );
    }

    private function repair(Barangay178Boundary $boundary): int
    {
        $raw = (string) $this->option('ids');

        // Explicit ids are the whole safety mechanism, so an empty --ids is a
        // failure rather than a no-op that might be mistaken for "nothing
        // needed repairing".
        $ids = collect(explode(',', $raw))
            ->map(fn ($id) => trim($id))
            ->filter(fn ($id) => $id !== '' && ctype_digit($id))
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            $this->error('--repair requires --ids with at least one numeric incident id.');
            $this->line('There is no "repair everything" mode on purpose: only a person can tell a');
            $this->line('seeded demo row from a location somebody actually reported.');

            return self::FAILURE;
        }

        $incidents = Incident::query()->whereIn('id', $ids)->orderBy('id')->get();

        $missingIds = $ids->diff($incidents->pluck('id'));
        if ($missingIds->isNotEmpty()) {
            $this->error('No such incident(s): '.$missingIds->implode(', '));

            return self::FAILURE;
        }

        $this->line('');
        $this->warn('The following incidents will be RELOCATED to new coordinates inside Barangay 178:');
        $this->table(
            ['id', 'Case number', 'Current latitude', 'Current longitude'],
            $incidents->map(fn (Incident $i) => [
                $i->id, $i->case_number, $i->latitude ?? 'null', $i->longitude ?? 'null',
            ])->all()
        );
        $this->line('Their previous coordinates are recorded in audit_logs, so this is reversible.');

        if (! $this->option('force') && ! $this->confirm('Relocate these '.$incidents->count().' incident(s)?', false)) {
            $this->info('Cancelled — nothing was modified.');

            return self::SUCCESS;
        }

        // One transaction: a half-applied repair would leave the operator
        // unable to tell which rows had already moved.
        DB::transaction(function () use ($incidents, $boundary) {
            foreach ($incidents as $incident) {
                $before = sprintf(
                    '%s, %s',
                    $incident->latitude ?? 'null',
                    $incident->longitude ?? 'null'
                );

                [$lat, $lng] = $boundary->randomPointInside();

                $incident->forceFill(['latitude' => $lat, 'longitude' => $lng])->save();

                Audit::record([
                    // No user_id: this was run by an operator at a console, not
                    // by a signed-in account, and attributing it to a person who
                    // did not do it would be worse than leaving it null.
                    'user_id' => null,
                    'action' => 'UPDATE',
                    'module' => 'incidents',
                    'target_type' => 'incident',
                    'description' => sprintf(
                        'incidents:audit-coordinates relocated %s inside the Barangay 178 boundary '.
                        '(was %s, now %.7f, %.7f)',
                        $incident->case_number,
                        $before,
                        $lat,
                        $lng
                    ),
                    'ip_address' => null,
                ]);

                $this->line(sprintf('  #%d %s  %s  ->  %.7f, %.7f', $incident->id, $incident->case_number, $before, $lat, $lng));
            }
        });

        $this->line('');
        $this->info('Relocated '.$incidents->count().' incident(s). Each change is in audit_logs.');

        return self::SUCCESS;
    }
}
