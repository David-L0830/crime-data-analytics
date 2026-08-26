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
            'crimeType' => ['required', 'string', 'max:100'],
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
        ];
    }
}
