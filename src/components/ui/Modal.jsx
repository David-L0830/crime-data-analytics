import { useEffect } from 'react';

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Checkpoint 27 — individual-record PDF export (window.print() while a
  // view modal is open, e.g. Crime Data Collection's VIEW -> Export PDF).
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
      <div className={`modal-content ${size === 'lg' ? 'modal-lg' : ''}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
