import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: the incident modals must CLOSE the shared Modal, not
 * unmount it.
 *
 * Modal restores focus to whatever opened it on the `open -> closed`
 * transition (src/components/ui/Modal.jsx). Both incident wrappers used to
 * begin with `if (!incident) return null;`, and IncidentFeed clears its
 * `viewing` / `editing` state on close — so the wrapper returned null, the
 * Modal was torn down, that transition never happened, and focus fell to
 * <body>.
 *
 * That was confirmed in a real browser rather than inferred. After closing the
 * incident view modal with Escape the trigger button was still in the DOM
 * (`trigger_id_still_in_dom: true`), still connected
 * (`captured_node_isConnected: true`) and the very same node
 * (`same_node: true`) — yet `document.activeElement` was `BODY`. The same
 * check against a modal that stays mounted (/user-management -> Add User)
 * restored focus correctly, which is what isolated the cause to the unmount.
 *
 * WHAT THIS TEST DOES AND DOES NOT PROVE
 * --------------------------------------
 * This is a SOURCE-LEVEL guard, not a behavioural one. The Vitest suite runs
 * in a Node environment with no DOM (see vitest.config.js), so focus cannot be
 * observed here, and adding jsdom would mean new dependencies and a config
 * change. What it pins is the exact structural mistake that caused the bug: a
 * `return null` keyed on `incident` placed ahead of the `<Modal>`. Reintroduce
 * that and this fails.
 *
 * The behavioural proof is the browser pass, which must be re-run whenever
 * this area changes.
 */

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'IncidentModal.jsx'),
  'utf8',
);

/** Body of one exported component, up to the next top-level export. */
function componentBody(name) {
  const start = source.indexOf(`export function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = source.indexOf('\nexport function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe.each([
  ['IncidentViewModal', 'lastIncident'],
  ['IncidentEditModal', 'lastEdited'],
])('%s keeps the shared Modal mounted', (name, retainedRef) => {
  const body = componentBody(name);

  it('does not unmount by returning null when `incident` clears', () => {
    // The precise regression. `incident` goes null on close, so a guard on it
    // tears the Modal down instead of letting it transition to closed.
    expect(body).not.toMatch(/if\s*\(\s*!\s*incident\s*\)\s*return null/);
  });

  it('retains the last record so the Modal survives the close', () => {
    expect(body).toContain(`const ${retainedRef} = useRef(incident)`);
    expect(body).toMatch(
      new RegExp(`if\\s*\\(\\s*incident\\s*\\)\\s*${retainedRef}\\.current = incident`),
    );
  });

  it('still renders a Modal whose open state follows the record', () => {
    expect(body).toContain('<Modal');
    // View derives `open` from the record; Edit receives it as a prop. Either
    // way the Modal must be told to close rather than be removed.
    expect(body).toMatch(/open=\{(Boolean\(incident\)|open)\}/);
  });
});

it('Modal restores focus on the open -> closed transition, not on unmount', () => {
  // Guards the other half of the contract: if Modal ever moved its restore
  // into cleanup, keeping the wrappers mounted would stop mattering.
  const modal = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'Modal.jsx'),
    'utf8',
  );
  expect(modal).toContain('restoreRef.current = document.activeElement');
  expect(modal).toMatch(/previous\?\.isConnected/);
});
