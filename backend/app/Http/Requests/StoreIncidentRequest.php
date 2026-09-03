<?php

namespace App\Http\Requests;

use App\Models\Incident;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreIncidentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'caseNumber' => ['required', 'string', 'max:50', Rule::unique('incidents', 'case_number')],
            // Must name a real entry in the crime_types vocabulary (the
            // Crime Type dropdown on the incident form is populated from
            // GET /crime-types and never lets an operator free-type a
            // value), so a direct API call can no longer record an incident
            // against a crime type that doesn't exist in System Settings.
            // Not restricted to is_active=true: a disabled type is still a
            // real vocabulary entry, and UpdateIncidentRequest below reuses
            // this same rule for edits that don't touch crimeType at all.
            'crimeType' => ['required', 'string', 'max:100', Rule::exists('crime_types', 'name')],
            'category' => ['nullable', 'string', 'max:100'],
            'date' => ['required', 'date'],
            'time' => ['nullable', 'date_format:H:i'],
            'street' => ['nullable', 'string', 'max:255'],
            'sitio' => ['required', 'string', 'max:100'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'victimName' => ['nullable', 'string', 'max:150'],
            'victimAge' => ['nullable', 'integer', 'min:0', 'max:120'],
            'victimGender' => ['nullable', 'string', 'max:20'],
            'suspectName' => ['nullable', 'string', 'max:150'],
            'suspectAge' => ['nullable', 'integer', 'min:0', 'max:120'],
            'complainantIsVictim' => ['sometimes', 'boolean'],
            // Required only when the complainant is NOT the victim: that is
            // precisely the case where the record has to say who reported it,
            // because the person named as victim did not. When the box is
            // ticked these are ignored and cleared server-side (see
            // IncidentController::mapToColumns).
            'complainantName' => ['nullable', 'required_if:complainantIsVictim,false', 'string', 'max:150'],
            'complainantRelationship' => ['nullable', 'string', 'max:100'],
            'complainantContact' => ['nullable', 'string', 'max:50'],
            'complainantAddress' => ['nullable', 'string', 'max:255'],
            // Structured evidence. `evidenceItems` absent entirely means
            // "leave evidence alone"; an empty array means "this case has no
            // evidence" - the two are not the same and the controller
            // distinguishes them.
            'evidenceItems' => ['sometimes', 'array', 'max:50'],
            'evidenceItems.*.evidenceId' => ['nullable', 'string', 'max:50'],
            'evidenceItems.*.description' => ['nullable', 'string', 'max:2000'],
            'reportingOfficer' => ['nullable', 'string', 'max:100'],
            'investigatingOfficer' => ['nullable', 'string', 'max:100'],
            'badgeNumber' => ['nullable', 'string', 'max:50'],
            'unit' => ['nullable', 'string', 'max:100'],
            'status' => ['string', Rule::in(Incident::STATUSES)],
            // 'sometimes', not 'nullable', for the same reason status carries
            // no 'nullable': incidents.priority is NOT NULL DEFAULT 'Normal',
            // so an explicit null passed validation, reached mapToColumns()
            // and raised SQLSTATE[23000] as a 500. 'sometimes' rejects the
            // explicit null with an ordinary 422 while leaving an OMITTED
            // priority untouched — Laravel skips non-implicit rules for an
            // absent key, so it never reaches validated() and the column
            // default still applies.
            'priority' => ['sometimes', 'string', 'max:50'],
            'description' => ['nullable', 'string'],
            'evidence' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'caseNumber.unique' => 'Case number already exists.',
            'complainantName.required_if' => 'Complainant full name is required when the complainant is not the victim.',
        ];
    }
}
