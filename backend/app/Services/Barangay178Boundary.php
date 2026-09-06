<?php

namespace App\Services;

use RuntimeException;

/**
 * The real Barangay 178 boundary, and the questions the API asks of it.
 *
 * WHY THIS EXISTS
 *
 * Incident coordinates used to be validated only as `between:-90,90` /
 * `between:-180,180` — mathematically valid anywhere on Earth. That is how
 * incident 123 came to carry longitude 117.0282 (open sea, ~450 km west of
 * Metro Manila) and incident 121 came to sit 14 km away in a different city.
 * A barangay crime-record system that accepts a point in the South China Sea
 * is not validating location at all.
 *
 * It is also how the seed data came to be generated around a centre 4.3 km
 * outside the barangay: IncidentSeeder and IncidentFactory each carried their
 * own copy of the wrong coordinates, with nothing to check them against.
 *
 * There is now exactly one boundary in the backend, read from
 * resources/geo/barangay-178.geojson, and the validator, the seeder, the
 * factory and the repair command all ask it the same question.
 *
 * BOUNDARY SOURCE
 *
 * OpenStreetMap relation 11322824 — "Barangay 178, Zone 15, Camarin,
 * District 3, Caloocan" (ODbL, © OpenStreetMap contributors), retrieved
 * 2026-09-05 from polygons.openstreetmap.fr and cross-checked against
 * Nominatim, which returned the identical 186-point ring. The file is a
 * byte-identical copy of src/data/barangay178.geojson.json, so the backend
 * validates against exactly the polygon the frontend draws. If one is ever
 * replaced, replace both — Barangay178BoundaryTest asserts the extent this
 * class reports, which is what would catch a half-done swap.
 *
 * WHY IT IS A FILE AND NOT A DATABASE TABLE
 *
 * The boundary is static reference geography, not application data: it is not
 * edited by any user, has no per-row lifecycle, and every consumer wants all
 * of it at once. A table would add a migration, a model and a query to every
 * validation call in exchange for nothing.
 */
class Barangay178Boundary
{
    /**
     * Parsed polygons → rings → points → [lng, lat] (GeoJSON order).
     *
     * Grouped by polygon rather than flattened: a point is inside a
     * MultiPolygon when it is inside any ONE polygon, and inside a polygon
     * when it crosses an odd number of THAT polygon's rings — which is what
     * makes a hole a hole. One flat parity count over every ring would get
     * that wrong the moment the boundary gained one.
     *
     * @var array<int, array<int, array<int, array{0: float, 1: float}>>>|null
     */
    private ?array $polygons = null;

    /** @var array{south: float, west: float, north: float, east: float}|null */
    private ?array $bounds = null;

    public function path(): string
    {
        return base_path('resources/geo/barangay-178.geojson');
    }

    /**
     * @return array<int, array<int, array<int, array{0: float, 1: float}>>>
     */
    public function polygons(): array
    {
        if ($this->polygons !== null) {
            return $this->polygons;
        }

        $path = $this->path();

        if (! is_file($path)) {
            throw new RuntimeException("Barangay 178 boundary file is missing at {$path}.");
        }

        $decoded = json_decode((string) file_get_contents($path), true);

        if (! is_array($decoded)) {
            throw new RuntimeException("Barangay 178 boundary file at {$path} is not valid JSON.");
        }

        $geometry = $decoded['features'][0]['geometry'] ?? null;

        if (! is_array($geometry) || ! isset($geometry['type'], $geometry['coordinates'])) {
            throw new RuntimeException("Barangay 178 boundary file at {$path} has no usable geometry.");
        }

        $this->polygons = match ($geometry['type']) {
            'Polygon' => [$geometry['coordinates']],
            'MultiPolygon' => $geometry['coordinates'],
            default => throw new RuntimeException(
                "Barangay 178 boundary geometry must be a Polygon or MultiPolygon, got {$geometry['type']}."
            ),
        };

        return $this->polygons;
    }

    /**
     * The polygon's real bounding box. Not a rectangle anyone chose — the
     * extent of the geometry itself.
     *
     * @return array{south: float, west: float, north: float, east: float}
     */
    public function bounds(): array
    {
        if ($this->bounds !== null) {
            return $this->bounds;
        }

        $south = INF;
        $west = INF;
        $north = -INF;
        $east = -INF;

        foreach ($this->polygons() as $rings) {
            foreach ($rings as $ring) {
                foreach ($ring as [$lng, $lat]) {
                    $south = min($south, (float) $lat);
                    $north = max($north, (float) $lat);
                    $west = min($west, (float) $lng);
                    $east = max($east, (float) $lng);
                }
            }
        }

        return $this->bounds = compact('south', 'west', 'north', 'east');
    }

    /**
     * Whether a coordinate falls inside the actual boundary.
     *
     * Point-in-polygon against the real geometry, NOT a bounding-box test: the
     * bounding box covers noticeably more ground than the barangay does, and
     * calling that "inside Barangay 178" is the same class of mistake as the
     * 500 m circle this replaced. The box is used only as a cheap rejection
     * step before the edge tests.
     */
    public function contains(float|int|string|null $lat, float|int|string|null $lng): bool
    {
        if (! self::isUsableCoordinate($lat, $lng)) {
            return false;
        }

        $latitude = (float) $lat;
        $longitude = (float) $lng;
        $bounds = $this->bounds();

        if (
            $latitude < $bounds['south'] || $latitude > $bounds['north']
            || $longitude < $bounds['west'] || $longitude > $bounds['east']
        ) {
            return false;
        }

        foreach ($this->polygons() as $rings) {
            $inside = false;

            foreach ($rings as $ring) {
                if ($this->crossesRing($ring, $latitude, $longitude)) {
                    $inside = ! $inside;
                }
            }

            if ($inside) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether a pair is a usable coordinate at all, independent of WHERE it is.
     *
     * Kept separate from contains() because "you left the location blank" and
     * "that location is not in this barangay" are different problems needing
     * different messages. 0,0 is rejected as a value rather than a place: it is
     * the classic empty-field artefact, and an incident in the Gulf of Guinea
     * is not a case this barangay records.
     */
    public static function isUsableCoordinate(float|int|string|null $lat, float|int|string|null $lng): bool
    {
        if ($lat === null || $lng === null || $lat === '' || $lng === '') {
            return false;
        }

        if (! is_numeric($lat) || ! is_numeric($lng)) {
            return false;
        }

        $latitude = (float) $lat;
        $longitude = (float) $lng;

        if (! is_finite($latitude) || ! is_finite($longitude)) {
            return false;
        }

        if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
            return false;
        }

        return ! ($latitude === 0.0 && $longitude === 0.0);
    }

    /**
     * A random point that is genuinely inside the boundary.
     *
     * Rejection sampling against the real polygon — draw inside the bounding
     * box, keep it only if contains() agrees — rather than the
     * `centre ± random offset` the old seeder and factory used. That older
     * approach cannot be made correct by fixing its centre: a circle around any
     * centre still spills outside a non-circular barangay, so a share of every
     * seed run would land outside the very boundary the map is drawn to.
     *
     * The attempt cap makes a broken boundary file fail loudly instead of
     * hanging a seed run forever. Barangay 178 fills a good share of its
     * bounding box, so in practice this accepts within a handful of draws.
     *
     * @return array{0: float, 1: float} [latitude, longitude], rounded to the
     *                                   7 decimal places the schema stores.
     */
    public function randomPointInside(int $maxAttempts = 500): array
    {
        $bounds = $this->bounds();

        for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
            $lat = $this->randomBetween($bounds['south'], $bounds['north']);
            $lng = $this->randomBetween($bounds['west'], $bounds['east']);

            // Rounded BEFORE the test, so the value that is checked is the same
            // value that gets stored. Testing full precision and then rounding
            // could nudge a point just outside the edge it was accepted for.
            $lat = round($lat, 7);
            $lng = round($lng, 7);

            if ($this->contains($lat, $lng)) {
                return [$lat, $lng];
            }
        }

        throw new RuntimeException(
            "Could not find a point inside the Barangay 178 boundary in {$maxAttempts} attempts. ".
            'The boundary file is probably malformed — check '.$this->path().'.'
        );
    }

    private function randomBetween(float $min, float $max): float
    {
        return $min + (mt_rand() / mt_getrandmax()) * ($max - $min);
    }

    /**
     * Ray casting against one linear ring: how many times a due-east ray from
     * the point crosses this ring's edges. An odd count means enclosed.
     *
     * @param  array<int, array{0: float, 1: float}>  $ring
     */
    private function crossesRing(array $ring, float $lat, float $lng): bool
    {
        $inside = false;
        $count = count($ring);

        for ($i = 0, $j = $count - 1; $i < $count; $j = $i, $i++) {
            $xi = (float) $ring[$i][0];
            $yi = (float) $ring[$i][1];
            $xj = (float) $ring[$j][0];
            $yj = (float) $ring[$j][1];

            // Only edges straddling the point's latitude can be crossed. The
            // mixed strict/non-strict comparison is what stops a vertex lying
            // exactly on the ray from being counted twice.
            if (($yi > $lat) === ($yj > $lat)) {
                continue;
            }

            $intersectionLng = $xi + (($lat - $yi) / ($yj - $yi)) * ($xj - $xi);

            if ($lng < $intersectionLng) {
                $inside = ! $inside;
            }
        }

        return $inside;
    }
}
