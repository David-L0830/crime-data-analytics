import { createContext, useCallback, useRef, useState } from 'react';
import { Icons } from '../components/icons';

export const ToastContext = createContext(null);

// How long a notification pop-up stays before it dismisses itself. Long enough
// to read two lines without hurrying, short enough that it is gone before it
// becomes furniture.
const NOTIFICATION_TOAST_MS = 6000;

// At most three at once. Beyond that the stack would start covering the topbar
// controls it sits next to, and the bell is the right place to read a backlog
// anyway.
const MAX_NOTIFICATION_TOASTS = 3;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { message, type }
  const timerRef = useRef(null);

  // Separate from `toast` on purpose. The plain toast is a transient
  // acknowledgement of something the user just did ("Settings saved"); a
  // notification pop-up announces something that happened elsewhere, carries a
  // title and body, can stack, and is dismissible. Sharing one slot would mean
  // a new incident silently replacing "Welcome back" — or worse, the reverse.
  const [notificationToasts, setNotificationToasts] = useState([]);
  const notificationTimers = useRef(new Map());
  const nextKey = useRef(0);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const dismissNotificationToast = useCallback((key) => {
    setNotificationToasts((prev) => prev.filter((t) => t.key !== key));
    const timer = notificationTimers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      notificationTimers.current.delete(key);
    }
  }, []);

  // `onClick` is optional: when supplied the card becomes actionable and
  // takes the viewer to the record the notification is about (see
  // MainLayout, which passes the same routing rules the bell's panel uses).
  const showNotificationToast = useCallback(
    ({ title, message, type = 'info', onClick }) => {
      const key = ++nextKey.current;
      setNotificationToasts((prev) =>
        [...prev, { key, title, message, type, onClick }].slice(
          -MAX_NOTIFICATION_TOASTS,
        ),
      );
      notificationTimers.current.set(
        key,
        setTimeout(() => {
          setNotificationToasts((prev) => prev.filter((t) => t.key !== key));
          notificationTimers.current.delete(key);
        }, NOTIFICATION_TOAST_MS),
      );
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast, showNotificationToast }}>
      {children}
      <div className={`toast ${toast?.type || ''} ${toast ? '' : 'hidden'}`}>
        {toast?.message}
      </div>

      {/* Upper right, above the content but clear of the topbar's own
          controls. aria-live="polite" announces each arrival once to a screen
          reader without interrupting whatever is being read; the container is
          always in the DOM so the live region is established before anything
          is inserted into it, which is what makes the announcement work. */}
      <div
        className="notif-toast-stack"
        role="status"
        aria-live="polite"
        aria-relevant="additions"
      >
        {notificationToasts.map((t) => {
          const ToastIcon =
            t.type === 'success'
              ? Icons.CheckCircle2
              : t.type === 'warning'
                ? Icons.AlertTriangle
                : Icons.Info;
          const activate = () => {
            if (!t.onClick) return;
            t.onClick();
            dismissNotificationToast(t.key);
          };

          return (
            <div
              key={t.key}
              className={`notif-toast ${t.type || 'info'} ${t.onClick ? 'actionable' : ''}`}
              // Only actionable cards become buttons. Giving a non-actionable
              // card a button role would promise the keyboard user something
              // to activate and then do nothing when they pressed Enter.
              role={t.onClick ? 'button' : undefined}
              tabIndex={t.onClick ? 0 : undefined}
              onClick={t.onClick ? activate : undefined}
              onKeyDown={
                t.onClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activate();
                      }
                    }
                  : undefined
              }
            >
              <span className="notif-toast-icon">
                <ToastIcon size={18} strokeWidth={2} />
              </span>
              <div className="notif-toast-body">
                <div className="notif-toast-title">{t.title}</div>
                <div className="notif-toast-msg">{t.message}</div>
              </div>
              <button
                type="button"
                className="notif-toast-close"
                aria-label="Dismiss notification"
                // Without this the click would bubble to the card and navigate
                // — dismissing would take you somewhere instead of closing.
                onClick={(e) => {
                  e.stopPropagation();
                  dismissNotificationToast(t.key);
                }}
              >
                <Icons.Close size={14} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
