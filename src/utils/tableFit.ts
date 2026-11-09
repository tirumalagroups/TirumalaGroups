// One rule for every screen: only the main page scrolls.
//  - Scroll boxes inside the page are opened up. Dropdowns and popups keep their own scrolling.
//  - Long tables show 50 rows, with Load 50 More and Refresh underneath.
//  - A table too wide for the screen wraps its text, then reduces its font until it fits.
// This only changes what is shown. Rows stay in the page, so totals, search and prints still
// use every record.

export const ROW_STEP = 50;
const MIN_FONT_PX = 8;
const FONT_STEP_PX = 0.5;

/** Statements that are read as a whole and are always shown in full. */
const FULL_ROUTES = ['/balance-sheet', '/finance/pl', '/finance/final-statement'];

const OPEN = 'data-fit-open';
const HIDDEN = 'data-fit-hidden';
const WRAP = 'data-fit-wrap';
const FONT = 'data-fit-font';
const TEXT = 'data-fit-text';

const isFloating = (el: Element): boolean => !!el.closest('.fixed, .absolute, [role="dialog"], [role="listbox"]');

/** The right edge of the space inside an element, without its padding and border. */
const contentRight = (el: HTMLElement): number => {
  const cs = getComputedStyle(el);
  return el.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
};

/** Summary cards: a figure too long for its box gets a smaller font. */
export const fitBoxes = (main: HTMLElement): void => {
  main.querySelectorAll<HTMLElement>('[class*="border"], [class*="rounded"]').forEach(box => {
    if (box.closest('table') || isFloating(box) || box.querySelector('table, input, select, textarea, button')) return;
    const leaves = Array.from(box.querySelectorAll<HTMLElement>('*')).filter(e => !e.children.length && e.textContent?.trim());
    if (leaves.length === 0 || leaves.length > 8) return;
    const right = contentRight(box);
    leaves.forEach(leaf => {
      // Measure the text itself: a block element is only as wide as its box, even when its text is not
      const range = document.createRange();
      range.selectNodeContents(leaf);
      const textRight = () => range.getBoundingClientRect().right;
      if (textRight() <= right + 0.5) return;
      let font = parseFloat(getComputedStyle(leaf).fontSize) || 12;
      while (font > MIN_FONT_PX && textRight() > right + 0.5) {
        font -= FONT_STEP_PX;
        leaf.style.fontSize = `${font}px`;
      }
    });
  });
};

const MIN_FIELD_FONT_PX = 12;
const SELECT_ARROW_PX = 20;
let measure: CanvasRenderingContext2D | null = null;

/** Dropdowns and boxes: a label too long for the field gets a smaller font. */
export const fitFields = (main: HTMLElement): void => {
  measure = measure ?? document.createElement('canvas').getContext('2d');
  if (!measure) return;
  const ctx = measure;
  main.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input:not([type]), input[type="text"], input[type="search"]').forEach(el => {
    if (isFloating(el) || el.closest('table') || el.clientWidth === 0) return;
    const isSelect = el instanceof HTMLSelectElement;
    const text = isSelect ? el.options[el.selectedIndex]?.text : el.value || el.placeholder;
    if (!text) return;
    const cs = getComputedStyle(el);
    const base = parseFloat(el.dataset.fitBase ?? cs.fontSize);
    el.dataset.fitBase = String(base);
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (isSelect ? SELECT_ARROW_PX : 0);
    let font = base;
    for (; font > MIN_FIELD_FONT_PX; font -= FONT_STEP_PX) {
      ctx.font = `${cs.fontWeight} ${font}px ${cs.fontFamily}`;
      if (ctx.measureText(text).width <= room) break;
    }
    const wanted = font === base ? '' : `${font}px`;
    // The page styles set field fonts as !important, so this has to be important as well
    if (wanted) {
      if (el.style.fontSize !== wanted || el.style.getPropertyPriority('font-size') !== 'important') {
        el.style.setProperty('font-size', wanted, 'important');
      }
    }
    else if (el.style.getPropertyPriority('font-size') === 'important') el.style.removeProperty('font-size');
  });
};

/** Opens scroll boxes in the page, and anything that would then cut their content off. */
export const openScrollBoxes = (main: HTMLElement): void => {
  const boxes = main.querySelectorAll<HTMLElement>(
    '[class*="overflow-"], [class*="max-h-"], [style*="overflow"], [style*="max-height"]'
  );
  boxes.forEach(el => {
    if (el.hasAttribute(OPEN) || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || isFloating(el)) return;
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) || /(auto|scroll)/.test(cs.overflowX)) el.setAttribute(OPEN, '');
  });
  boxes.forEach(el => {
    if (el.hasAttribute(OPEN) || el.tagName === 'TEXTAREA' || isFloating(el)) return;
    const cs = getComputedStyle(el);
    const cutsOff = cs.overflowY === 'hidden' && el.clientHeight > 60 && el.scrollHeight > el.clientHeight + 2;
    if (cutsOff && (el.querySelector('table') || el.querySelector(`[${OPEN}]`))) el.setAttribute(OPEN, '');
  });
};

/** A row that only shows details of the row above it does not count as a row of its own. */
export const isDetailRow = (row: Pick<HTMLTableRowElement, 'cells'>): boolean =>
  row.cells.length === 1 && row.cells[0].colSpan > 1;

/** Which rows stay visible, keeping a detail row with its parent row. */
export const visibleRowFlags = (detailFlags: readonly boolean[], limit: number): boolean[] => {
  let main = 0;
  return detailFlags.map(isDetail => {
    if (isDetail) return main <= limit;
    main += 1;
    return main <= limit;
  });
};

const limits = new WeakMap<HTMLTableElement, number>();
const bars = new Map<HTMLTableElement, HTMLDivElement>();

const button = (label: string, tone: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = `px-3 py-1.5 rounded text-sm font-semibold ${tone}`;
  b.addEventListener('click', onClick);
  return b;
};

const removeBar = (table: HTMLTableElement): void => {
  bars.get(table)?.remove();
  bars.delete(table);
};

const showBar = (table: HTMLTableElement, shown: number, total: number, limit: number, rerun: () => void): void => {
  let bar = bars.get(table);
  if (!bar) {
    bar = document.createElement('div');
    bar.setAttribute('data-fit-bar', '');
    bar.className = 'flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-gray-200 bg-white';
    const info = document.createElement('span');
    info.className = 'text-sm text-gray-700 font-medium';
    const actions = document.createElement('span');
    actions.className = 'flex items-center gap-2';
    actions.append(
      button(`Load ${ROW_STEP} More`, 'bg-blue-600 text-white hover:bg-blue-700', () => {
        limits.set(table, (limits.get(table) ?? ROW_STEP) + ROW_STEP);
        rerun();
      }),
      button('Refresh', 'bg-gray-200 text-gray-900 hover:bg-gray-300', () => {
        limits.set(table, ROW_STEP);
        rerun();
      })
    );
    bar.append(info, actions);
    bars.set(table, bar);
  }
  if (bar.previousElementSibling !== table) table.after(bar);
  const text = `Showing ${shown} of ${total} records`;
  const info = bar.firstElementChild as HTMLElement;
  if (info.textContent !== text) info.textContent = text;
  (bar.querySelector('button') as HTMLButtonElement).style.display = shown < total ? '' : 'none';
  (bar.querySelector('button:last-child') as HTMLButtonElement).style.display = limit > ROW_STEP ? '' : 'none';
};

const applyRowLimit = (table: HTMLTableElement, rerun: () => void): void => {
  const rows = Array.from(table.tBodies).flatMap(b => Array.from(b.rows));
  const noLimit = table.hasAttribute('data-no-load-more') || FULL_ROUTES.includes(window.location.pathname);
  const details = rows.map(isDetailRow);
  const total = details.filter(d => !d).length;
  const limit = noLimit ? Number.MAX_SAFE_INTEGER : limits.get(table) ?? ROW_STEP;
  const flags = visibleRowFlags(details, limit);
  rows.forEach((row, i) => {
    if (row.hasAttribute(HIDDEN) === flags[i]) row.toggleAttribute(HIDDEN, !flags[i]);
  });
  if (noLimit || (total <= ROW_STEP && limit === ROW_STEP)) removeBar(table);
  else showBar(table, Math.min(limit, total), total, limit, rerun);
};

const markTextCells = (table: HTMLTableElement): void => {
  table.querySelectorAll<HTMLElement>(`tr:not([${HIDDEN}]) > td, tr:not([${HIDDEN}]) > th`).forEach(cell => {
    const text = cell.textContent ?? '';
    cell.toggleAttribute(TEXT, /[A-Za-z]/.test(text) && /\s/.test(text.trim()));
  });
};

/** Wraps long text first, then reduces the font until the table fits its space. */
export const fitTable = (table: HTMLTableElement, main: HTMLElement): void => {
  table.setAttribute('data-fit-table', '');
  table.removeAttribute(WRAP);
  table.removeAttribute(FONT);
  table.style.removeProperty('--fit-font');

  const parent = table.parentElement as HTMLElement;
  const limit = Math.min(contentRight(main), contentRight(parent));
  const fits = () => {
    const box = table.getBoundingClientRect();
    return box.width === 0 || box.right <= limit + 1;
  };
  if (fits()) return;

  markTextCells(table);
  table.setAttribute(WRAP, '');
  if (fits()) return;

  const cell = table.querySelector(`tr:not([${HIDDEN}]) > td`) ?? table;
  let font = parseFloat(getComputedStyle(cell).fontSize) || 12;
  table.setAttribute(FONT, '');
  while (font > MIN_FONT_PX) {
    table.style.setProperty('--fit-font', `${font}px`);
    if (fits()) return;
    font -= FONT_STEP_PX;
  }
  table.style.setProperty('--fit-font', `${MIN_FONT_PX}px`);
};

export const runTableFit = (main: HTMLElement, rerun: () => void): void => {
  openScrollBoxes(main);
  const tables = Array.from(main.querySelectorAll('table')).filter(t => !t.parentElement?.closest('table') && !isFloating(t));
  tables.forEach(t => applyRowLimit(t, rerun));
  bars.forEach((_, table) => {
    if (!table.isConnected) removeBar(table);
  });
  tables.forEach(t => fitTable(t, main));
  fitBoxes(main);
  fitFields(main);
};
