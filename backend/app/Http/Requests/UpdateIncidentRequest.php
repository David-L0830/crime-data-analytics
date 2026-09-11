<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesIncidentLocation;
use App\Models\Incident;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateIncidentRequest extends FormRequest
{
    // Coordinates must be a real place inside Barangay 178, or absent
    // entirely. See the trait for the policy and why it is enforced here
    // rather than by a per-field rule.
    use ValidatesIncidentLocation;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $incidentId = $this->route('incident')?->id;

        return [
            'caseNumber' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('incidents', 'case_number')->ignore($incidentId)],
            // See StoreIncidentRequest for why this must exist in crime_types.
            'crimeType' => ['sometimes', 'required', 'string', 'max:100', Rule::exists('crime_types', 'name')],
            'category' => ['nullable', 'string', 'max:100'],
            // See StoreIncidentRequest for why a future date is rejected.
            // `sometimes` is kept ahead of it: an edit that does not send
            // `date` at all leaves the stored date alone and is not judged
            // against today, so existing records stay editable.
            'date' => ['sometimes', 'required', 'date', 'before_or_equal:today'],
            'time' => ['nullable', 'date_format:H:i'],
            'street' => ['nullable', 'string', 'max:255'],
            'sitio' => ['sometimes', 'required', 'string', 'max:100'],
            ...$this->coordinateRules(),
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
            // ASSIGNABLE_STATUSES, not STATUSES: 'Archived' is reachable only
            // through PUT /incidents/{incident}/archive, which is the only
            // writer that also captures previous_status. See Incident.
            'status' => ['string', Rule::in(Incident::ASSIGNABLE_STATUSES)],
            // See StoreIncidentRequest for why this is 'sometimes' rather than
            // 'nullable': incidents.priority is NOT NULL DEFAULT 'Normal', so
            // an explicit null was a 500 rather than a 422.
            'priority' => ['sometimes', 'string', 'max:50'],
            'description' => ['nullable', 'string'],
            'evidence' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'caseNumber.unique' => 'Case number already exists.',
            'status.in' => 'Status cannot be set to Archived here — use the Archive action instead.',
            'date.before_or_equal' => 'Incident date cannot be in the future.',
            'complainantName.required_if' => 'Complainant full name is required when the complainant is not the victim.',
        ];
    }
}
