import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
} from './otpInput';

describe('six-box OTP layout', () => {
  it('matches the six-digit email code', () => {
    expect(OTP_LENGTH).toBe(6);
    expect(toSlots('')).toEqual(['', '', '', '', '', '']);
    expect(toSlots('123')).toEqual(['1', '2', '3', '', '', '']);
  });
});

describe('typing', () => {
  it('fills the box and advances focus', () => {
    expect(applyInput('', 0, '4')).toEqual({ value: '4', focus: 1, rejected: false });
    expect(applyInput('4', 1, '2')).toEqual({ value: '42', focus: 2, rejected: false });
  });

  it('stays on the last box once the code is complete', () => {
    expect(applyInput('12345', 5, '6')).toEqual({
      value: '123456',
      focus: 5,
      rejected: false,
    });
  });

  it('cannot create a gap by typing into a later box', () => {
    // Box 4 was focused with only one digit entered: input lands in box 1.
    expect(applyInput('1', 4, '9')).toEqual({ value: '19', focus: 2, rejected: false });
  });

  it('overwrites a filled box with the newly typed digit', () => {
    expect(typedText('3', '37')).toBe('7');
    expect(typedText('3', '73')).toBe('7');
    expect(applyInput('135', 1, typedText('3', '37'))).toMatchObject({
      value: '175',
      focus: 2,
    });
  });
});

describe('invalid input', () => {
  it('rejects letters and symbols without changing the value', () => {
    expect(applyInput('12', 2, 'a')).toEqual({ value: '12', focus: 2, rejected: true });
    expect(applyInput('12', 2, ' -')).toEqual({ value: '12', focus: 2, rejected: true });
  });

  it('keeps only the digits of mixed input', () => {
    expect(applyInput('', 0, '1a2')).toMatchObject({ value: '12', focus: 2 });
  });

  it('never grows past six digits', () => {
    expect(applyInput('123456', 5, '9').value).toHaveLength(6);
  });
});

describe('paste', () => {
  it('populates every box from a complete pasted code, wherever it lands', () => {
    expect(applyInput('', 0, '482913')).toEqual({
      value: '482913',
      focus: 5,
      rejected: false,
    });
    expect(applyInput('11', 2, '482913').value).toBe('482913');
  });

  it('ignores formatting in a pasted code', () => {
    expect(applyInput('', 0, ' 482-913 ').value).toBe('482913');
    expect(applyInput('', 0, 'Code: 4829135').value).toBe('482913');
  });

  it('fills forward from the focused box for a partial paste', () => {
    expect(applyInput('12', 2, '34')).toMatchObject({ value: '1234', focus: 4 });
  });
});

describe('backspace and delete', () => {
  it('clears the focused box when it holds a digit', () => {
    expect(applyBackspace('123', 2)).toEqual({ value: '12', focus: 2 });
  });

  it('steps back and clears the previous box from an empty box', () => {
    expect(applyBackspace('123', 3)).toEqual({ value: '12', focus: 2 });
  });

  it('does nothing on the first empty box', () => {
    expect(applyBackspace('', 0)).toEqual({ value: '', focus: 0 });
  });

  it('closes up so no gap is left in the middle', () => {
    expect(applyBackspace('123456', 2)).toEqual({ value: '12456', focus: 2 });
    expect(applyDelete('123456', 0)).toEqual({ value: '23456', focus: 0 });
  });
});

describe('keyboard navigation', () => {
  it('moves with arrows, Home and End, never past the first empty box', () => {
    expect(navigationTarget('ArrowLeft', '123', 2)).toBe(1);
    expect(navigationTarget('ArrowLeft', '123', 0)).toBe(0);
    expect(navigationTarget('ArrowRight', '123', 2)).toBe(3);
    expect(navigationTarget('ArrowRight', '123', 3)).toBe(3);
    expect(navigationTarget('Home', '123', 3)).toBe(0);
    expect(navigationTarget('End', '123', 0)).toBe(3);
    expect(navigationTarget('End', '123456', 0)).toBe(5);
    expect(navigationTarget('Tab', '123', 1)).toBeNull();
    expect(clampIndex('', 5)).toBe(0);
  });
});

// C2 — keyboard trap. Exactly one box is ever in the Tab order, so Tab and
// Shift+Tab leave the group instead of being bounced between boxes.
describe('roving tabindex (no keyboard trap)', () => {
  const tabStops = (value, lastFocused) =>
    toSlots(value).filter(
      (_, i) => i === rovingTabStop(value, lastFocused),
    ).length;

  it('puts exactly one box in the Tab order for every state', () => {
    for (const value of ['', '1', '123', '12345', '123456']) {
      for (const last of [null, 0, 2, 5]) {
        expect(tabStops(value, last)).toBe(1);
      }
    }
  });

  it('starts at the first empty box, or the last box when the code is full', () => {
    expect(rovingTabStop('', null)).toBe(0);
    expect(rovingTabStop('123', null)).toBe(3);
    expect(rovingTabStop('123456', null)).toBe(5);
  });

  it('follows the box the user last focused, never beyond the first empty box', () => {
    expect(rovingTabStop('123456', 1)).toBe(1);
    expect(rovingTabStop('12', 4)).toBe(2);
    expect(rovingTabStop('', 3)).toBe(0);
  });
});

// C3 — focus stealing. A transition that does not change the value must not
// leave deferred focus work for a later, unrelated render to perform.
describe('focus planning (no stale focus requests)', () => {
  it('defers focus only when the value changes, tagged with that value', () => {
    expect(planFocus('12', { value: '123', focus: 3 })).toEqual({
      immediate: null,
      deferred: { index: 3, value: '123' },
    });
  });

  it('focuses immediately and schedules nothing for arrows, Home/End and rejected keys', () => {
    const arrow = { value: '123', focus: navigationTarget('ArrowLeft', '123', 2) };
    expect(planFocus('123', arrow)).toEqual({ immediate: 1, deferred: null });

    const home = { value: '123', focus: navigationTarget('Home', '123', 3) };
    expect(planFocus('123', home)).toEqual({ immediate: 0, deferred: null });

    const rejected = applyInput('123', 3, 'x');
    expect(rejected.rejected).toBe(true);
    expect(planFocus('123', rejected).deferred).toBeNull();

    // Backspace on an empty first box changes nothing either.
    expect(planFocus('', applyBackspace('', 0)).deferred).toBeNull();
  });

  it('applies a deferred request only on the render showing its value', () => {
    const { deferred } = planFocus('12', { value: '123', focus: 3 });
    expect(resolveDeferredFocus(deferred, '123')).toBe(3);
    // A render with any other value (e.g. the parent kept its own value, or a
    // countdown re-render before the new value) must not move focus.
    expect(resolveDeferredFocus(deferred, '12')).toBeNull();
    expect(resolveDeferredFocus(null, '123')).toBeNull();
  });
});

// Source-level guards — the node test environment has no DOM. The behavioural
// proof is a browser pass (typing, paste, backspace, iOS/Android autofill and a
// screen reader), which must be re-run whenever this input changes.
describe('the sign-in screen keeps the existing OTP mechanism', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const login = readFileSync(join(here, '..', 'pages', 'Login.jsx'), 'utf8');
  const component = readFileSync(
    join(here, '..', 'components', 'auth', 'OtpInput.jsx'),
    'utf8',
  );

  it('uses the segmented input for the email code', () => {
    expect(login).toContain('<OtpInput');
    expect(login).toContain('id="email-mfa-code"');
  });

  it('still validates six digits and verifies through the same call', () => {
    expect(login).toContain("if (!/^\\d{6}$/.test(code))");
    expect(login).toContain('await verifyEmailMfaCode(code)');
  });

  it('is accessible and mobile-friendly', () => {
    expect(component).toContain('role="group"');
    expect(component).toContain('inputMode="numeric"');
    expect(component).toContain("autoComplete={i === 0 ? 'one-time-code' : 'off'}");
    expect(component).toContain('aria-label={`Digit ${i + 1} of ${length}`}');
  });

  it('never logs the code', () => {
    expect(component).not.toMatch(/console\./);
  });

  it('uses a roving tabindex and never intercepts or redirects Tab', () => {
    expect(component).toContain('tabIndex={i === tabStop ? 0 : -1}');
    expect(component).not.toMatch(/['"]Tab['"]/);
    // Keyboard focus is accepted where it lands; the only redirect left is
    // pointer-only (onMouseDown).
    const handleFocus = component.slice(
      component.indexOf('const handleFocus'),
      component.indexOf('const handleMouseDown'),
    );
    expect(handleFocus).not.toContain('.focus()');
    expect(component).toContain('onMouseDown={handleMouseDown(i)}');
  });

  it('routes every focus move through planFocus and consumes deferred focus once', () => {
    expect(component).toContain('planFocus(value, next)');
    expect(component).toContain('deferredFocus.current = null;');
    expect(component).toContain('resolveDeferredFocus(pending, value)');
  });
});
