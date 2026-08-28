<?php

namespace App\Http\Requests;

use App\Models\Incident;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateIncidentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $incidentId = $this->route('incident')?->id;

        return [
            'caseNumber' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('incidents', 'case_number')->ignore($incidentId)],
            'crimeType' => ['sometimes', 'required', 'string', 'max:100'],
            'category' => ['nullable', 'string', 'max:100'],
            'date' => ['sometimes', 'required', 'date'],
            'time' => ['nullable', 'date_format:H:i'],
            'street' => ['nullable', 'string', 'max:255'],
            'sitio' => ['sometimes', 'required', 'string', 'max:100'],
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
            'priority' => ['nullable', 'string', 'max:50'],
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
