// Pure state transitions for the segmented one-time-code input
// (components/auth/OtpInput.jsx).
//
// Kept free of React and the DOM so every keyboard and paste rule can be unit
// tested in the node Vitest environment. The component only maps events onto
// these functions and moves focus to the index they return.
//
// THE MODEL
//
// The value is a plain string of digits with NO gaps: box n can only be filled
// once boxes 0..n-1 are. That keeps the value the component hands its parent
// identical to what the old single text input produced ("", "12", "123456"),
// so the sign-in form's existing /^\d{6}$/ check and the verify request are
// unchanged. Focus is clamped to the first empty box so a gap can never be
// typed into existence.
//
// This is presentation only. Nothing here validates, stores, logs or submits
// the code; the server remains the only authority on whether it is correct.

export const OTP_LENGTH = 6;

export function digitsOnly(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/** The value split across `length` boxes, '' for each unfilled box. */
export function toSlots(value, length = OTP_LENGTH) {
  const v = digitsOnly(value).slice(0, length);
  return Array.from({ length }, (_, i) => v[i] || '');
}

/** The furthest box focus may sit on: the first empty one, or the last box. */
export function clampIndex(value, index, length = OTP_LENGTH) {
  const firstEmpty = Math.min(digitsOnly(value).length, length - 1);
  return Math.max(0, Math.min(index, firstEmpty));
}

/**
 * What the user actually typed into a box that may already hold a digit.
 *
 * Typing into a filled box yields the old digit plus the new one ("37"); the
 * new one is whichever is not the old digit's position. Autofill and some
 * mobile keyboards put a whole code into one box instead, which is returned
 * unchanged so applyInput can spread it.
 */
export function typedText(previousChar, raw) {
  const text = String(raw ?? '');
  if (previousChar && text.length === 2 && text.includes(previousChar)) {
    return text[0] === previousChar ? text.slice(1) : text.slice(0, 1);
  }
  return text;
}

/**
 * Input (typing, autofill or paste) arriving at box `index`.
 *
 * Non-digits are discarded; input with no digits at all changes nothing and is
 * reported as rejected. A full-length code replaces the whole value wherever it
 * lands. Anything shorter fills forward from the box it was entered in.
 */
export function applyInput(value, index, raw, length = OTP_LENGTH) {
  const current = digitsOnly(value).slice(0, length);
  const digits = digitsOnly(raw);
  const at = clampIndex(current, index, length);

  if (!digits) {
    return { value: current, focus: at, rejected: String(raw ?? '') !== '' };
  }

  if (digits.length >= length) {
    return { value: digits.slice(0, length), focus: length - 1, rejected: false };
  }

  const chars = current.split('');
  for (let k = 0; k < digits.length && at + k < length; k += 1) {
    chars[at + k] = digits[k];
  }
  const next = chars.join('').slice(0, length);
  return {
    value: next,
    focus: Math.min(at + digits.length, length - 1),
    rejected: false,
  };
}

/**
 * Backspace in box `index`: clears that box if it holds a digit, otherwise
 * steps back and clears the previous one. Digits after a cleared box close up,
 * which is what keeps the value gap-free.
 */
export function applyBackspace(value, index, length = OTP_LENGTH) {
  const current = digitsOnly(value).slice(0, length);
  const at = clampIndex(current, index, length);

  if (at < current.length) {
    return { value: current.slice(0, at) + current.slice(at + 1), focus: at };
  }
  if (at === 0) return { value: current, focus: 0 };
  return {
    value: current.slice(0, at - 1) + current.slice(at),
    focus: at - 1,
  };
}

/** Delete in box `index`: clears it without moving focus. */
export function applyDelete(value, index, length = OTP_LENGTH) {
  const current = digitsOnly(value).slice(0, length);
  const at = clampIndex(current, index, length);
  if (at >= current.length) return { value: current, focus: at };
  return { value: current.slice(0, at) + current.slice(at + 1), focus: at };
}

/**
 * Roving tabindex: the ONE box that sits in the page's Tab order.
 *
 * Only this box gets tabIndex=0; the other five get -1. Tab and Shift+Tab
 * therefore enter the group once and leave it naturally, reaching Verify and
 * Cancel — nothing intercepts Tab. Inside the group, the arrow keys, Home and
 * End move between boxes. The stop is the box last focused, clamped so it can
 * never be an empty box beyond the first empty one; before any box has been
 * focused it is the first empty box (or the last box when the code is full).
 */
export function rovingTabStop(value, lastFocused, length = OTP_LENGTH) {
  const preferred = lastFocused === null || lastFocused === undefined
    ? length - 1
    : lastFocused;
  return clampIndex(value, preferred, length);
}

/**
 * How a state transition moves focus.
 *
 * When the value changes, focus must wait until React has rendered the new
 * value, so it is DEFERRED and tagged with the value it belongs to. When the
 * value does not change (arrows, Home/End, a rejected letter), nothing will
 * re-render on its account, so focus happens IMMEDIATELY and no deferred work
 * is left behind for some unrelated later render — such as the sign-in
 * screen's once-a-second resend countdown — to act on.
 */
export function planFocus(currentValue, next) {
  if (next.value !== currentValue) {
    return { immediate: null, deferred: { index: next.focus, value: next.value } };
  }
  return { immediate: next.focus, deferred: null };
}

/**
 * The box a deferred focus request may move to on this render, or null.
 *
 * Applied only when the rendered value is the one the request was made for.
 * A request whose value never arrived (the parent kept a different value) is
 * discarded rather than kept around to fire on a later render.
 */
export function resolveDeferredFocus(deferred, renderedValue) {
  if (!deferred) return null;
  return deferred.value === renderedValue ? deferred.index : null;
}

/** Arrow / Home / End navigation; null for any other key. */
export function navigationTarget(key, value, index, length = OTP_LENGTH) {
  switch (key) {
    case 'ArrowLeft':
      return clampIndex(value, index - 1, length);
    case 'ArrowRight':
      return clampIndex(value, index + 1, length);
    case 'Home':
      return 0;
    case 'End':
      return clampIndex(value, length - 1, length);
    default:
      return null;
  }
}
