import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Force Uppercase on all operator text inputs globally
document.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;
  
  const isTextInput = target.tagName === 'INPUT' && (
    target.getAttribute('type') === 'text' || 
    !target.hasAttribute('type')
  );
  const isTextArea = target.tagName === 'TEXTAREA';

  if (isTextInput || isTextArea) {
    const originalValue = target.value;
    const upperValue = originalValue.toUpperCase();
    
    if (originalValue !== upperValue) {
      const start = target.selectionStart;
      const end = target.selectionEnd;

      // Bypass React's value tracking to ensure onChange triggers properly
      const prototype = target.tagName === 'INPUT' 
        ? window.HTMLInputElement.prototype 
        : window.HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      
      if (descriptor && descriptor.set) {
        descriptor.set.call(target, upperValue);
      } else {
        target.value = upperValue;
      }

      if (start !== null && end !== null) {
        target.setSelectionRange(start, end);
      }

      // Dispatch event to notify React's virtual DOM
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}, true);

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
