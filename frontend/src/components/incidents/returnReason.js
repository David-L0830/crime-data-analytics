import { CORRECTION_REASONS } from '../../utils/constants';

// Turns a validator's selected predefined reasons and optional custom text
// into the single string PUT /incidents/{id}/return has always accepted.
//
// The backend contract does not change for Checkpoint 2 — it still takes one
// `reason` string of at least 5 characters — so composing several selections
// into that one string here, rather than widening the API to accept an array,
// keeps this entirely frontend-side.
//
// KEPT IN ITS OWN FILE, SEPARATE FROM IncidentModal.jsx, on purpose.
// IncidentModal.jsx imports LocationPicker, which imports Leaflet, and
// Leaflet touches `window` at module load time — so importing anything from
// IncidentModal.jsx in this Vitest suite (a Node environment with no DOM; see
// vitest.config.js) crashes before a single assertion runs. Pulling this pure
// function out is the same move incidentSubmission.js and
// locationPickerState.js already make for IncidentModal.jsx and
// LocationPicker.jsx respectively, and for the same reason: it lets the logic
// be imported and tested for real, with real inputs, instead of only matched
// as source text.
export function composeReturnReason(selectedCodes, customText) {
  const labels = CORRECTION_REASONS.filter((r) =>
    selectedCodes.includes(r.code),
  ).map((r) => r.label);
  const trimmedCustom = customText.trim();

  if (labels.length && trimmedCustom) {
    return `${labels.join('; ')}\nDetails: ${trimmedCustom}`;
  }
  if (labels.length) {
    return labels.join('; ');
  }
  return trimmedCustom;
}
