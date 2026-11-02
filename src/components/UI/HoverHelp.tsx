import { useEffect } from 'react';
import { getHelpText } from '../../utils/helpTexts';

/**
 * Site-wide hover help.
 * Rest the mouse on a button, menu item, column heading or label for 2 seconds and a
 * small box explains what it is. Text comes from (in order):
 *   1. a data-help="..." attribute on the element or a parent
 *   2. the plain-English list in utils/helpTexts.ts, matched on the visible label
 *   3. the element's own title / aria-label (icon-only buttons)
 * Mounted once in App; it works on every page without changing each screen.
 */

const HOVER_DELAY_MS = 2000;
const MAX_LEVELS = 5; // how far up from the hovered element we look for a label
const INTERACTIVE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], th, label, select, summary, input, textarea';

type Found = { el: HTMLElement; text: string };

const ownLabel = (el: HTMLElement): string => {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.placeholder || '';
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text || '';
  const text = (el.textContent || '').trim();
  return text.length <= 60 ? text : '';
};

const findHelp = (start: Element | null, isFinance: boolean): Found | null => {
  let el = start instanceof HTMLElement ? start : start?.parentElement || null;
  for (let level = 0; el && el !== document.body && level < MAX_LEVELS; level++, el = el.parentElement) {
    if (el.closest('[data-hover-help-box]')) return null;

    const explicit = el.getAttribute('data-help');
    if (explicit) return { el, text: explicit };

    const fromList = getHelpText(ownLabel(el), isFinance);
    if (fromList) return { el, text: fromList };

    // Any element that already carries a tooltip (title) uses it, after the same 2 s delay
    const ownTitle = el.getAttribute('title') || el.getAttribute('data-hover-help-title');
    if (ownTitle && ownTitle.trim().length > 1) return { el, text: ownTitle.trim() };

    // Card pattern: <div><span>Today Due</span><span>14,05,620.00</span></div>
    const first = el.firstElementChild as HTMLElement | null;
    if (first && !el.matches(INTERACTIVE)) {
      const fromFirst = getHelpText((first.textContent || '').trim(), isFinance);
      if (fromFirst) return { el, text: fromFirst };
    }

    // Stop at the first control without help; its parents describe something else
    if (el.matches(INTERACTIVE)) return null;
  }
  return null;
};

const HoverHelp: React.FC = () => {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const box = document.createElement('div');
    box.setAttribute('data-hover-help-box', '');
    box.setAttribute('role', 'tooltip');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: '2147483000',
      maxWidth: '300px',
      padding: '7px 10px',
      borderRadius: '8px',
      background: '#0f172a',
      color: '#f8fafc',
      font: '500 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
      letterSpacing: 'normal',
      textTransform: 'none',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.28)',
      pointerEvents: 'none',
      display: 'none',
      whiteSpace: 'normal',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(box);

    let current: HTMLElement | null = null;
    let timer: number | undefined;
    let mouseX = 0;
    let mouseY = 0;

    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      box.style.display = 'none';
    };

    // Native browser tooltips would pop up after ~0.5s; park the title while we handle it.
    const parkTitle = (el: HTMLElement) => {
      const t = el.getAttribute('title');
      if (t) {
        el.setAttribute('data-hover-help-title', t);
        el.removeAttribute('title');
      }
    };
    const restoreTitle = (el: HTMLElement | null) => {
      if (!el) return;
      const t = el.getAttribute('data-hover-help-title');
      if (t !== null) {
        if (!el.hasAttribute('title')) el.setAttribute('title', t);
        el.removeAttribute('data-hover-help-title');
      }
    };

    const place = () => {
      const pad = 8;
      box.style.left = '0px';
      box.style.top = '0px';
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      let left = mouseX + 14;
      let top = mouseY + 20;
      if (left + w > window.innerWidth - pad) left = Math.max(pad, mouseX - w - 10);
      if (top + h > window.innerHeight - pad) top = Math.max(pad, mouseY - h - 12);
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const isFinance = window.location.pathname.startsWith('/finance');
      const found = findHelp(e.target as Element, isFinance);
      if (found?.el === current) return;

      hide();
      restoreTitle(current);
      current = found?.el || null;
      if (!found) return;

      parkTitle(found.el);
      mouseX = e.clientX;
      mouseY = e.clientY;
      timer = window.setTimeout(() => {
        if (!current || !document.body.contains(current)) return;
        box.textContent = found.text;
        box.style.display = 'block';
        place();
      }, HOVER_DELAY_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (box.style.display === 'none') {
        mouseX = e.clientX;
        mouseY = e.clientY;
      }
    };

    const onLeaveWindow = (e: PointerEvent) => {
      if (!e.relatedTarget) {
        hide();
        restoreTitle(current);
        current = null;
      }
    };

    // Clicking, typing or scrolling hides the box until the mouse moves to another item.
    const dismiss = () => hide();

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerout', onLeaveWindow, true);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('blur', dismiss);

    return () => {
      hide();
      restoreTitle(current);
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerout', onLeaveWindow, true);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('blur', dismiss);
      box.remove();
    };
  }, []);

  return null;
};

export default HoverHelp;
