import { useEffect, useRef, useState } from 'react';
import {
  OTP_LENGTH,
  toSlots,
  clampIndex,
  typedText,
  applyInput,
  applyBackspace,
  applyDelete,
  navigationTarget,
  rovingTabStop,
  planFocus,
  resolveDeferredFocus,
} from '../../utils/otpInput';

// Segmented one-time-code input: one box per digit.
//
// A presentation layer over the same string value the sign-in form already
// used — the parent still receives "", "12", "123456" and still validates and
// submits it itself. Every editing rule lives in utils/otpInput.js, where it is
// unit tested; this component only maps DOM events onto those rules and moves
// focus to the box they name.
//
// Accessibility: the boxes form one labelled group, each box is announced as
// "Digit n of 6", and the first box carries autocomplete="one-time-code" so
// iOS/Android can offer the code from the message. Enter in any box submits
// the surrounding form, exactly as it did with the single input.
//
// KEYBOARD: a roving tabindex. Exactly one box is in the Tab order (see
// rovingTabStop), so Tab and Shift+Tab enter the group once and leave it
// normally — Verify and Cancel are always reachable. Tab is never intercepted
// and focus is never pushed back into the group. Arrows, Home and End move
// within it.
export default function OtpInput({
  id,
  value,
  onChange,
  length = OTP_LENGTH,
  labelledBy,
  describedBy,
  invalid = false,
  disabled = false,
}) {
  const refs = useRef([]);
  // { index, value } — focus waiting for the render that shows `value`.
  const deferredFocus = useRef(null);
  const [lastFocused, setLastFocused] = useState(null);
  const slots = toSlots(value, length);
  const tabStop = rovingTabStop(value, lastFocused, length);

  // Runs after every render, but only acts on a request made for the value
  // now on screen, and always consumes it — so an unrelated re-render (the
  // sign-in screen's resend countdown ticks once a second) can never move
  // focus.
  useEffect(() => {
    const pending = deferredFocus.current;
    if (!pending) return;
    deferredFocus.current = null;
    const index = resolveDeferredFocus(pending, value);
    const el = index === null ? null : refs.current[index];
    if (el) {
      el.focus();
      el.select();
    }
  });

  const focusBox = (index) => {
    const el = refs.current[index];
    if (el && document.activeElement !== el) el.focus();
  };

  const commit = (next) => {
    const { immediate, deferred } = planFocus(value, next);
    deferredFocus.current = deferred;
    if (deferred) {
      onChange(next.value);
    } else {
      focusBox(immediate);
    }
  };

  const handleChange = (i) => (e) => {
    // Many Android keyboards send no Backspace keydown at all, only an input
    // event that empties the box. Treat that as clearing it and step back, so
    // repeated deletes walk left the way they do on a hardware keyboard.
    if (e.target.value === '') {
      const cleared = applyDelete(value, i, length);
      commit({ value: cleared.value, focus: Math.max(0, i - 1) });
      return;
    }
    commit(applyInput(value, i, typedText(slots[i], e.target.value), length));
  };

  const handleKeyDown = (i) => (e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      commit(applyBackspace(value, i, length));
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      commit(applyDelete(value, i, length));
      return;
    }
    const target = navigationTarget(e.key, value, i, length);
    if (target !== null) {
      e.preventDefault();
      commit({ value, focus: target });
    }
  };

  const handlePaste = (i) => (e) => {
    e.preventDefault();
    commit(applyInput(value, i, e.clipboardData.getData('text'), length));
  };

  // Focus is accepted wherever it lands; this only records it as the roving
  // stop and selects the digit so typing replaces it.
  const handleFocus = (i) => (e) => {
    setLastFocused(i);
    e.target.select();
  };

  // A pointer press on an empty box beyond the first empty one is steered to
  // the first empty box, so the code is still entered left to right. This is
  // pointer-only: keyboard focus is governed by the roving tabindex above and
  // is never redirected.
  const handleMouseDown = (i) => (e) => {
    const allowed = clampIndex(value, i, length);
    if (allowed !== i) {
      e.preventDefault();
      refs.current[allowed]?.focus();
    }
  };

  return (
    <div
      className={`otp-input ${invalid ? 'otp-input-invalid' : ''}`}
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {slots.map((digit, i) => (
        <input
          // Index keys are correct here: the boxes are a fixed-length
          // positional sequence that never reorders.
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={i === 0 ? id : undefined}
          className={`otp-box ${digit ? 'otp-box-filled' : ''}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid ? true : undefined}
          tabIndex={i === tabStop ? 0 : -1}
          value={digit}
          disabled={disabled}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onPaste={handlePaste(i)}
          onFocus={handleFocus(i)}
          onMouseDown={handleMouseDown(i)}
        />
      ))}
    </div>
  );
}
