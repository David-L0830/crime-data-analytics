<?php

namespace App\Http\Requests\Concerns;

use App\Services\Barangay178Boundary;
use Illuminate\Contracts\Validation\Validator;

/**
 * The coordinate policy for incidents, shared by StoreIncidentRequest and
 * UpdateIncidentRequest.
 *
 * THE POLICY, AND WHY IT IS THIS ONE
 *
 * This system records crimes for ONE barangay. Its letterhead, its Sitio
 * vocabulary, its dashboards and its map are all Barangay 178. An incident
 * outside the barangay is not a stricter-than-necessary edge case, it is a
 * record this system has no jurisdiction over — so a coordinate outside the
 * boundary is rejected with an explanation rather than accepted and quietly
 * plotted somewhere the barangay does not cover.
 *
 * The old rules were `between:-90,90` / `between:-180,180`: valid anywhere on
 * Earth. Under them the database accepted longitude 117.0282 (open sea, some
 * 450 km west of Metro Manila) and a point 14 km away in another city. Both
 * are still in the table today — see the accompanying repair command — and
 * neither should ever have been storable.
 *
 * WHAT IS DELIBERATELY *NOT* DONE HERE
 *
 * The submitted coordinates are never silently corrected, clamped or snapped
 * to the boundary. An encoder who mistypes a coordinate must be told, not
 * quietly moved: a crime record whose location the system edited on its own is
 * worse than one that failed to save, because nothing afterwards reveals that
 * it happened.
 *
 * Coordinates also remain OPTIONAL. A great many reports arrive with a street
 * and a sitio and no GPS reading at all, and demanding a coordinate would push
 * encoders into inventing one — which is exactly the failure this rule exists
 * to prevent. Only a coordinate that IS supplied has to be a real place inside
 * the barangay.
 *
 * WHY A withValidator HOOK RATHER THAN A RULE OBJECT
 *
 * The question "is this point inside the barangay" needs BOTH fields at once.
 * A per-attribute rule would have to reach across to its sibling through the
 * request and would run twice, producing two error messages for one mistake.
 * Hooking the validator lets the pair be judged once and reported once.
 */
trait ValidatesIncidentLocation
{
    /**
     * The base rules for the coordinate pair.
     *
     * The worldwide `between` bounds are KEPT, not replaced: they are what
     * turns "abc" or 999 into a clean field-level message before the geometry
     * is ever consulted. The boundary check below is an additional, narrower
     * gate layered on top of them.
     *
     * @return array<string, array<int, string>>
     */
    protected function coordinateRules(): array
    {
        return [
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
        ];
    }

    /**
     * Rejects a supplied coordinate that is not inside Barangay 178.
     *
     * Runs in `after`, so it only fires once the field-level rules above have
     * passed — a non-numeric latitude is reported as a non-numeric latitude,
     * not as a point outside the barangay.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($validator->errors()->hasAny(['latitude', 'longitude'])) {
                return;
            }

            $lat = $this->input('latitude');
            $lng = $this->input('longitude');

            // Absent or explicitly cleared: allowed, see the note above about
            // reports that arrive without a GPS reading.
            if ($lat === null && $lng === null) {
                return;
            }

            if (! Barangay178Boundary::isUsableCoordinate($lat, $lng)) {
                $validator->errors()->add(
                    'latitude',
                    'Enter a complete, valid location, or leave both latitude and longitude blank.'
                );

                return;
            }

            if (! app(Barangay178Boundary::class)->contains($lat, $lng)) {
                // Names the barangay and the acceptable extent, because
                // "invalid location" leaves an encoder with a correct-looking
                // coordinate and no idea what is wrong with it.
                $bounds = app(Barangay178Boundary::class)->bounds();

                $validator->errors()->add('latitude', sprintf(
                    'That location is outside Barangay 178. This system records incidents within the '.
                    'barangay only (roughly %.4f–%.4f°N, %.4f–%.4f°E). Check the coordinates, or leave '.
                    'both blank and record the street and sitio instead.',
                    $bounds['south'],
                    $bounds['north'],
                    $bounds['west'],
                    $bounds['east'],
                ));
            }
        });
    }
}
