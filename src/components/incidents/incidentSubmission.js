/**
 * Pure helpers shared by IncidentCreateModal and IncidentEditModal.
 *
 * They live in a plain .js module rather than inside IncidentModal.jsx so the
 * Vitest suite — which runs in a Node environment with no DOM, see
 * vitest.config.js — can exercise them directly instead of pattern-matching
 * the component source.
 *
 * Neither of these validates anything. The backend
 * (StoreIncidentRequest / UpdateIncidentRequest and the
 * ValidatesIncidentLocation concern) remains the authoritative validation
 * layer; these two only shape what is sent to it and how what comes back is
 * shown.
 */

/**
 * One coordinate field as the API should receive it.
 *
 * A blank field means "this report has no GPS reading", which the backend
 * accepts, so it must travel as an explicit null. The check is on emptiness
 * rather than truthiness because a coordinate of exactly 0 is a value, not an
 * absence.
 */
export function toCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return parseFloat(value);
}

/**
 * The latitude/longitude pair for an incident payload.
 *
 * WHY THERE IS NO FALLBACK TO THE STORED RECORD
 *
 * The edit modal used to send
 * `form.latitude ? parseFloat(form.latitude) : incident.latitude`. But the
 * edit form opens pre-filled FROM the incident, so a blank field is never
 * "untouched" — it is the one case where the encoder deliberately cleared the
 * coordinate. The fallback therefore fired precisely when it was wrong, making
 * a wrong coordinate impossible to remove: the old value was silently put back
 * and the encoder was shown a successful save.
 *
 * Untouched fields still keep their values, because those values are sitting
 * in the form. Each field is mapped on its own, so clearing only one sends
 * null for that one and lets the backend's `required_with` pairing rule reject
 * the half-pair, rather than the UI quietly retaining the other half.
 */
export function coordinatePayload(form) {
  return {
    latitude: toCoordinate(form.latitude),
    longitude: toCoordinate(form.longitude),
  };
}

/**
 * The messages to show in the modal's error area for a failed save.
 *
 * ApiError carries Laravel's `errors` bag ({ field: [message, ...] }) for a
 * 422 alongside a generic `message` ("Please check the form for errors."). The
 * field-level messages are the useful half — they are what names the future
 * date or the coordinate outside Barangay 178 — and used to be dropped
 * entirely, leaving the encoder with a toast that did not say what was wrong.
 *
 * Falls back to `message` when there is no bag (a 403, a 500, a network
 * failure), so every failure still explains itself.
 */
export function submissionErrorMessages(err, fallback) {
  const bag = err?.errors;
  const messages = [];

  if (bag && typeof bag === 'object') {
    for (const value of Object.values(bag)) {
      for (const message of Array.isArray(value) ? value : [value]) {
        // Deduplicated because the modal keys its <li> by message text.
        if (typeof message === 'string' && message.trim() !== '' && !messages.includes(message))
          messages.push(message);
      }
    }
  }

  if (messages.length) return messages;
  return [err?.message || fallback];
}
