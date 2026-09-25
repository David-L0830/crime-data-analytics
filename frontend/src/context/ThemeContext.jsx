import { createContext, useEffect, useState } from 'react';

export const ThemeContext = createContext(null);

// Login redesign — first-visit theme resolution. A stored preference always
// wins (existing behavior, unchanged). Only when nothing has been saved yet
// do we consult the OS's prefers-color-scheme, so a first-time visitor on a
// system set to dark mode doesn't land on a jarringly bright screen; the
// light theme remains the hard default whenever the OS preference can't be
// read (matchMedia unsupported, non-browser render, etc).
function getInitialTheme() {
  const stored = localStorage.getItem('cdars_theme');
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && window.matchMedia) {
    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches)
        return 'dark';
    } catch {
      // matchMedia not available/blocked — fall through to the default.
    }
  }
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cdars_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
