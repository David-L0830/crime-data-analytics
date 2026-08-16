import { createContext, useCallback, useRef, useState } from 'react';

export const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { message, type }
  const timerRef = useRef(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`toast ${toast?.type || ''} ${toast ? '' : 'hidden'}`}>{toast?.message}</div>
    </ToastContext.Provider>
  );
}
