import { useEffect, useId, useRef } from 'react';

// What counts as reachable by Tab. Deliberately excludes [disabled] and
// tabindex="-1": three modals disable their footer buttons while a request is
// in flight (ConfirmActionModal, CreateUserModal, TwoFactorSelfService), and a
// trap that kept a disabled button in its cycle would strand focus on a control
// that does nothing.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Queried fresh every time rather than cached on open. Modal contents change
// while open — buttons disable mid-request, forms reveal fields — so a list
// captured once would go stale and trap focus on something unreachable.
//
// getClientRects() filters out anything not actually rendered, which matters
// here: the print-only letterhead PrintReport renders inside ChartSummaryModal
// is display:none on screen and must not join the tab cycle.
function focusableWithin(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

// Generic modal shell matching the original `.modal` / `.modal-content` styling.
// `size="lg"` applies the original `.modal-lg` width for record view/edit modals.
export default function Modal({
  open,
  onClose,
  title,
  size,
  footer,
  children,
}) {
  const contentRef = useRef(null);
  // The element that had focus before this modal opened, so it can be given
  // focus back on close. Held in a ref rather than state: writing it must not
  // re-render, and it has to survive the effect teardown/re-run React
  // StrictMode performs in development.
  const restoreRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = focusableWithin(contentRef.current);
      if (!focusable.length) {
        // Nothing to move to — keep focus where it is rather than letting Tab
        // walk out into the page behind. Not reachable through this component
        // today, since the close button below is unconditional.
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = contentRef.current?.contains(active);

      // Wrapping in both directions is the trap. The `!inside` branch also
      // recovers focus if it ever ends up outside the modal by some other
      // route, so the next Tab pulls it back in rather than continuing away.
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus in on open, back out on close.
  //
  // StrictMode runs effects twice in development — mount, clean up, mount
  // again — so the capture is guarded: without it the second pass would record
  // the element this effect had just focused INSIDE the modal as the "previous"
  // one, and closing would hand focus to something that no longer exists
  // instead of to the control that opened the dialog. Restoring on the
  // open -> closed transition rather than in a cleanup keeps that teardown from
  // firing a spurious restore while the modal is still on screen.
  useEffect(() => {
    if (open) {
      if (!restoreRef.current) restoreRef.current = document.activeElement;
      const [firstFocusable] = focusableWithin(contentRef.current);
      (firstFocusable || contentRef.current)?.focus();
      return;
    }

    const previous = restoreRef.current;
    restoreRef.current = null;
    // Only if it is still in the document and still focusable — the row or
    // button that opened the modal may well have been removed by whatever the
    // modal just did.
    if (previous?.isConnected && typeof previous.focus === 'function') {
      previous.focus();
    }
  }, [open]);

  // Individual-record printing (window.print() while a view modal is open,
  // e.g. Crime Data Collection's VIEW -> Print Record).
  // Modals here render as a sibling of the page's own list/table inside
  // `.module`, not in a portal, so without a marker the printed page would
  // include both the modal's single record AND the full table behind it.
  // A body-level class (rather than relying only on the CSS :has()
  // selector alongside this) works in every browser, including ones
  // without :has() support. See the print rule keyed on `.modal-open` in
  // global.css. A simple boolean class is safe even with nested/multiple
  // modal instances mounted at once, since it only needs to be true while
  // *any* modal is open — removing it on unmount could otherwise clear it
  // out from under a still-open second modal, so we deliberately don't
  // decrement/track a count here beyond what this effect's own cleanup
  // needs for its own open/close transition.
  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('modal-open');
    return () => {
      if (!document.querySelector('.modal'))
        document.body.classList.remove('modal-open');
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {/* The dialog itself is .modal-content; .modal above is the backdrop.
          tabIndex={-1} makes this a focus target for the fallback above without
          adding it to the tab cycle. */}
      <div
        ref={contentRef}
        className={`modal-content ${size === 'lg' ? 'modal-lg' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
