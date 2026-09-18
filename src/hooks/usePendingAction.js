import { useCallback, useRef, useState } from 'react';

/**
 * Wraps an async handler so the control that triggers it can show that it is
 * running, and cannot be triggered again while it is.
 *
 * This exists for the Excel exports. They are the slowest thing a user can ask
 * this application to do — exportWorkbook() dynamically imports exceljs, which
 * is a large chunk fetched on first use, and then builds the sheet — and until
 * now they gave no feedback at all between the click and the download. On a
 * slow connection that reads as a dead button, and the natural response to a
 * dead button is to click it again, which started a second export.
 *
 * Two separate guards, because they solve two different halves of that:
 *
 *   - `pending` is React state, and drives what the user sees (the disabled
 *     attribute, the spinner, the changed label).
 *   - `running` is a ref, and is what actually prevents the second export. A
 *     state update is not synchronous, so two clicks dispatched in the same
 *     tick would both observe `pending === false` and both start work. The ref
 *     is written immediately, so the second call returns having done nothing.
 *
 * The reset is in a `finally`, so a throw inside the action — a failed dynamic
 * import, a rejected write — cannot leave the button disabled for the rest of
 * the session. The error itself is deliberately not swallowed: it propagates to
 * whatever the caller has around it, exactly as it did before this wrapper
 * existed.
 *
 * Returns a [pending, run] pair so the call site reads like useState.
 */
export function usePendingAction(action) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    async (...args) => {
      if (running.current) return undefined;
      running.current = true;
      setPending(true);
      try {
        return await action(...args);
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [action],
  );

  return [pending, run];
}
