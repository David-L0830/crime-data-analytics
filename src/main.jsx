import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';
// Must follow global.css: print.css was extracted from the end of it, so
// selectors of equal specificity depend on this order to resolve the same
// way they did when the rules were one file.
import './styles/print.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
