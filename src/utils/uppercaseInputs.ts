// Every text box and text area is forced to CAPITALS as the user types (app-wide rule).
// Strict rule: ONLY password boxes are exempt. They carry data-password="true" (the Input
// component's "password" prop sets it), so a password shown as text (eye toggle) or the admin's
// temporary-password box keeps exactly what was typed. Never exempt any other box.
export const forceUppercaseOnInput = (e: Event) => {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;
  // Password boxes keep exactly what the user typed (strict rule: only password boxes are exempt)
  if (target.dataset?.password === 'true') return;

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
};
