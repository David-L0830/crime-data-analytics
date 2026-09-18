import { VALIDATION_STATUS_LABELS } from '../../utils/constants';

// Record validation pill. Deliberately a separate component and class family
// from Badge: Badge renders the CASE status (Open, Solved, Archived...), and a
// record can be "Solved" and "Pending Validation" at the same time, so the two
// must never share a vocabulary or a colour.
//
// The label is always rendered as text, never colour alone, so the state is
// readable without colour vision and by a screen reader.
export default function ValidationBadge({ status }) {
  const key = VALIDATION_STATUS_LABELS[status] ? status : 'unknown';
  const label = VALIDATION_STATUS_LABELS[status] || 'Not reviewed';
  return (
    <span className={`validation-badge validation-${key}`}>
      <span className="validation-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
