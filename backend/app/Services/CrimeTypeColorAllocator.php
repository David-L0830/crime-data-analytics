<?php

namespace App\Services;

/**
 * The ONE place that decides what colour a crime type gets.
 *
 * Crime Mapping colours markers by crime type. Before this class, marker
 * colour was a hard-coded object literal in Mapping.jsx keyed by CATEGORY, so
 * adding a crime type meant editing JavaScript. Colour assignment now happens
 * once, server-side, at the moment a crime type is created, and the result is
 * stored on the crime_types row.
 *
 * Two properties this guarantees, both of which the requirement calls out
 * explicitly:
 *
 *  - STABILITY. allocate() is only ever called when a crime type is CREATED.
 *    Nothing re-derives a colour at read time, so a colour cannot drift
 *    between page loads, sessions, users or machines, and assigning a colour
 *    to a new crime type cannot disturb the colour of an existing one.
 *  - DISTINCTION. New colours are drawn from a curated palette of visually
 *    separable hues, skipping every colour already in use. Only once the
 *    palette is exhausted does it generate one, and even then it is generated
 *    deterministically from the crime type's own name AND pushed away from the
 *    hues already taken, rather than picked at random.
 */
class CrimeTypeColorAllocator
{
    /**
     * Curated, print-safe palette. Ordered so that the first colours handed
     * out are the most distinguishable from one another.
     *
     * @var list<string>
     */
    public const PALETTE = [
        '#2563EB', // blue
        '#EA580C', // orange
        '#DC2626', // red
        '#7C3AED', // violet
        '#059669', // emerald
        '#DB2777', // pink
        '#0891B2', // cyan
        '#CA8A04', // gold
        '#4F46E5', // indigo
        '#65A30D', // lime
        '#BE123C', // rose
        '#0F766E', // teal
        '#9333EA', // purple
        '#B45309', // bronze
        '#1E40AF', // navy
        '#15803D', // green
        '#A21CAF', // fuchsia
        '#475569', // slate
    ];

    /**
     * Colours the requirement named by example (Assault -> Blue, Theft ->
     * Orange, Robbery -> Red, Burglary -> Purple). Honoured when the colour is
     * still free; otherwise the normal palette walk applies, because never
     * handing out a duplicate matters more than matching the example.
     *
     * @var array<string, string>
     */
    public const PREFERRED = [
        'Assault' => '#2563EB',
        'Theft' => '#EA580C',
        'Robbery' => '#DC2626',
        'Burglary' => '#7C3AED',
    ];

    /**
     * @param  list<string>  $usedColors  colours already assigned to other crime types
     */
    public static function allocate(string $name, array $usedColors): string
    {
        $used = array_map(fn ($c) => strtoupper((string) $c), $usedColors);

        $preferred = self::PREFERRED[$name] ?? null;
        if ($preferred !== null && ! in_array($preferred, $used, true)) {
            return $preferred;
        }

        foreach (self::PALETTE as $color) {
            if (! in_array($color, $used, true)) {
                return $color;
            }
        }

        return self::generate($name, $used);
    }

    /**
     * Palette exhausted. Derive a colour from the name so the SAME name always
     * produces the SAME candidate, then walk it forward by the golden angle
     * until it is far enough from every hue already in use.
     *
     * @param  list<string>  $used
     */
    private static function generate(string $name, array $used): string
    {
        $usedHues = array_values(array_filter(
            array_map([self::class, 'hueOf'], $used),
            fn ($h) => $h !== null
        ));

        $base = crc32($name) % 360;

        // 137.508deg — the golden angle. Successive steps spread out evenly
        // rather than clustering, which is what keeps late additions legible.
        for ($i = 0; $i < 24; $i++) {
            $hue = (int) round(fmod($base + ($i * 137.508), 360));
            if (self::minDistance($hue, $usedHues) >= 24) {
                return self::hslToHex($hue, 62, 45);
            }
        }

        // Every hue is crowded — fall back to the name's own hue rather than
        // failing. Saturation/lightness still differ from the palette entries.
        return self::hslToHex($base, 62, 45);
    }

    /**
     * @param  list<int>  $hues
     */
    private static function minDistance(int $hue, array $hues): int
    {
        $min = 180;
        foreach ($hues as $h) {
            $d = abs($hue - $h);
            $d = min($d, 360 - $d);
            $min = min($min, $d);
        }

        return $min;
    }

    private static function hueOf(string $hex): ?int
    {
        if (! preg_match('/^#([0-9A-Fa-f]{6})$/', $hex, $m)) {
            return null;
        }

        [$r, $g, $b] = array_map(
            fn ($pair) => hexdec($pair) / 255,
            str_split($m[1], 2)
        );

        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $delta = $max - $min;

        if ($delta == 0.0) {
            return 0;
        }

        $hue = match (true) {
            $max === $r => 60 * fmod(($g - $b) / $delta, 6),
            $max === $g => 60 * ((($b - $r) / $delta) + 2),
            default => 60 * ((($r - $g) / $delta) + 4),
        };

        return (int) round(fmod($hue + 360, 360));
    }

    private static function hslToHex(int $h, int $s, int $l): string
    {
        $sf = $s / 100;
        $lf = $l / 100;

        $c = (1 - abs((2 * $lf) - 1)) * $sf;
        $x = $c * (1 - abs(fmod($h / 60, 2) - 1));
        $m = $lf - ($c / 2);

        [$r, $g, $b] = match (true) {
            $h < 60 => [$c, $x, 0],
            $h < 120 => [$x, $c, 0],
            $h < 180 => [0, $c, $x],
            $h < 240 => [0, $x, $c],
            $h < 300 => [$x, 0, $c],
            default => [$c, 0, $x],
        };

        return sprintf(
            '#%02X%02X%02X',
            (int) round(($r + $m) * 255),
            (int) round(($g + $m) * 255),
            (int) round(($b + $m) * 255)
        );
    }
}
