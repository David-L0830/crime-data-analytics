<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateCriminalRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fullName' => ['sometimes', 'required', 'string', 'max:200'],
            'dateOfBirth' => ['nullable', 'date', 'before_or_equal:today'],
            'gender' => ['nullable', 'string', 'max:20'],
            'address' => ['nullable', 'string', 'max:255'],
            'physicalDescription' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'string', 'max:50'],
            'charges' => ['nullable', 'array'],
            'charges.*' => ['string', 'max:100'],
            'notes' => ['nullable', 'string'],
            'relatedIncidentId' => ['nullable', 'integer', 'exists:incidents,id'],
            'alias' => ['nullable', 'string', 'max:150'],
            'civilStatus' => ['nullable', 'string', 'max:30'],
            'nationality' => ['nullable', 'string', 'max:100'],
            'sitio' => ['nullable', 'string', 'max:100'],
            'contactNumber' => ['nullable', 'string', 'max:30'],
            'photoUrl' => ['nullable', 'string', 'max:500'],
            'height' => ['nullable', 'string', 'max:30'],
            'weight' => ['nullable', 'string', 'max:30'],
            'build' => ['nullable', 'string', 'max:50'],
            'hairColor' => ['nullable', 'string', 'max:50'],
            'eyeColor' => ['nullable', 'string', 'max:50'],
            'distinguishingMarks' => ['nullable', 'string', 'max:255'],
            'relatedIncidentIds' => ['nullable', 'array'],
            'relatedIncidentIds.*' => ['integer', 'exists:incidents,id'],
        ];
    }
}
