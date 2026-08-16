import { useEffect, useState } from 'react';

// Small reusable hook — used to debounce search inputs across list pages
// (Incident Feed, Residents, Criminal Records) so filtering doesn't run on every keystroke.
export function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
