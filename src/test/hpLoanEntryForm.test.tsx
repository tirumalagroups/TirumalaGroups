/**
 * Loan entry form, HP: renders the real form (in-memory database), picks HP LEDGER and checks the
 * Installments field, the "% per period" labels, the net amount and the schedule line.
 */
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fake = vi.hoisted(() => ({ db: null as any }));

vi.mock('../lib/supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  fake.db = createFakeSupabase();
  return {
    supabase: fake.db.client, rawSupabase: fake.db.client, default: fake.db.client,
    resolveSchemaAndTable: (t: string) => ({ schema: 'finance', table: t }), supabaseHelpers: {}
  };
});
vi.mock('../utils/dateUtils', async () => {
  const actual: any = await vi.importActual('../utils/dateUtils');
  return { ...actual, getLocalBusinessDateISO: (d?: Date) => (d ? actual.getLocalBusinessDateISO(d) : '2026-11-01') };
});
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'TESTER', is_admin: true, features: [] } })
}));
vi.mock('../components/finance/FinanceSmartCalendar', () => ({
  FinanceSmartCalendar: ({ label, value, onChange }: any) => (
    <input aria-label={label} value={value} onChange={e => onChange(e.target.value)} />
  )
}));
vi.mock('../components/finance/FinancePrintPreview', () => ({ default: () => null }));
vi.mock('../components/finance/BiometricScanner', () => ({ BiometricScanner: () => null }));

import LoanEntry from '../pages/finance/LoanEntry';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const settle = async (ms = 30) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
const text = () => (container.textContent || '').replace(/\s+/g, ' ');

const setNative = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};
const inputAfterLabel = (label: string) => {
  const lab = Array.from(container.querySelectorAll('label')).find(l => (l.textContent || '').trim().startsWith(label));
  return lab?.parentElement?.querySelector('input') as HTMLInputElement | null;
};

describe('Loan entry form: HP', () => {
  beforeEach(async () => {
    fake.db.seed({ finance_customers: [], finance_loans: [], finance_partners: [], finance_transactions: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><LoanEntry /></MemoryRouter>); });
    await settle(80);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('HP shows Installments, per-period labels, net 89,000 and the schedule line', async () => {
    const select = Array.from(container.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'HP')) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(text()).not.toContain('INSTALLMENTS *');
    await setNative(select, 'HP');
    await settle();

    expect(text()).toContain('INTEREST (% per period)');
    expect(text()).toContain('PENALTY (% per period)');
    expect(inputAfterLabel('INSTALLMENTS')).toBeTruthy();
    expect(inputAfterLabel('PERIOD (DAYS)')!.value).toBe('30');
    expect(container.querySelector('input[value="HP001"]')).toBeTruthy();

    await setNative(inputAfterLabel('LOAN AMOUNT')!, '100000');
    await setNative(inputAfterLabel('INSTALLMENTS')!, '10');
    await setNative(inputAfterLabel('DOC CHARGES')!, '1000');
    await settle();

    expect(text()).toContain('Net Amount To Borrower89,000.00');
    expect(text()).toContain('installment 1 = 10,000.00 principal, kept today');
    expect(text()).toContain('9 installments of 13,000.00 every 30 days');
    expect(text()).toContain('first on 2026-12-01, last on 2027-07-29');
    expect(text()).toContain('Total interest 27,000.00');

    // 15 days, 3% per period: still 13,000 per installment
    await setNative(inputAfterLabel('PERIOD (DAYS)')!, '15');
    await settle();
    expect(text()).toContain('9 installments of 13,000.00 every 15 days');
    expect(text()).toContain('last on 2027-03-16');
  });

  it('CD keeps its own labels and no Installments field', async () => {
    expect(text()).toContain('INTEREST (% pm)');
    expect(inputAfterLabel('INSTALLMENTS')).toBeFalsy();
  });
});
