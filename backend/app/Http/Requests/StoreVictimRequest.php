<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreVictimRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fullName' => ['required', 'string', 'max:200'],
            'alias' => ['nullable', 'string', 'max:150'],
            'gender' => ['nullable', 'string', 'max:20'],
            'dateOfBirth' => ['nullable', 'date', 'before_or_equal:today'],
            'civilStatus' => ['nullable', 'string', 'max:30'],
            'nationality' => ['nullable', 'string', 'max:100'],
            'contactNumber' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            // The case(s) this victim should be linked to — same
            // sync-vs-attach shape as Criminal's relatedIncidentIds.
            'incidentIds' => ['nullable', 'array'],
            'incidentIds.*' => ['integer', 'exists:incidents,id'],
        ];
    }
}
