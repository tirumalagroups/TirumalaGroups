import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { forceUppercaseOnInput } from './utils/uppercaseInputs';

// Force Uppercase on all operator text inputs globally (password boxes are exempt, see the file)
document.addEventListener('input', forceUppercaseOnInput, true);

// Lets the app open with no internet
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(reg => {
        const urls = performance
          .getEntriesByType('resource')
          .map(r => r.name)
          .filter(name => name.startsWith(`${location.origin}/assets/`));
        reg.active?.postMessage({ type: 'CACHE_URLS', urls });
      })
      .catch(err => console.error('Offline files could not be set up:', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
