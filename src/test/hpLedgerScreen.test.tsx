/**
 * HP Ledger screen (CD Ledger layout): renders the real page over an in-memory database (made-up
 * loan only), opens the account, checks what it shows and takes payments with the three buttons.
 * "Today" is fixed at 12 Nov 2026.
 */
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
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
  return { ...actual, getLocalBusinessDateISO: (d?: Date) => (d ? actual.getLocalBusinessDateISO(d) : '2026-11-12') };
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
vi.mock('../components/finance/CustomerFullDetails', () => ({ default: () => null }));

import HPLedger from '../pages/finance/HPLedger';
import { supabaseFinance } from '../lib/supabaseFinance';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const settle = async (ms = 30) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for: ${label}\n${text().slice(0, 800)}`);
};
const text = () => (container.textContent || '').replace(/\s+/g, ' ');
const buttonWith = (t: string) => Array.from(container.querySelectorAll('button')).find(b => (b.textContent || '').trim().includes(t)) as HTMLButtonElement;
const amountInput = () => container.querySelector('input[placeholder="Enter "]') as HTMLInputElement;
const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const openAccount = async () => {
  await waitFor(() => text().includes('All HP Loans') && text().includes('HP001'), 'loan list');
  const row = Array.from(container.querySelectorAll('tr')).find(r => (r.textContent || '').includes('HP001')) as HTMLTableRowElement;
  await act(async () => { row.click(); });
  await waitFor(() => text().includes('A/C: HP001') && text().includes('Account Position'), 'account');
};

describe('HP Ledger screen (CD Ledger layout)', () => {
  beforeEach(async () => {
    fake.db.seed({
      finance_customers: [{ id: 'cust-1', name: 'TEST CUSTOMER', phone: '9000000000', partner_name: 'PARTNER A' }],
      finance_loans: [], finance_transactions: [], finance_cd_ledger_entries: [], finance_dues: [], finance_photos: [],
      finance_loan_documents: [], finance_documents_returned: [], finance_transaction_reviews: [], finance_edited_logs: []
    });
    // 1,00,000; 10 installments every 30 days; 3% + 0.75% per period; doc 1,000; loan date 1 Sep 2026
    const loan = await supabaseFinance.createLoan({
      loan_id: 'HP001', customer_id: 'cust-1', date: '2026-09-01', amount: 100000, interest_rate: 3,
      duration_months: 10, period_days: 30, due_type: 'Daily', due_amount: 13000, penalty_percent: 0.75,
      document_charges: 1000, remarks: 'test', loan_category: 'HP'
    } as any, { id: 'cust-1' }, [], [], [], 'TESTER');
    // installment 2 (due 1 Oct) paid on time
    const r = await supabaseFinance.postHPReceipt({ loanId: loan!.id, kind: 'payment', date: '2026-10-01', amount: 13000, receiptNo: 'RC1', userName: 'TESTER' });
    expect(r.success).toBe(true);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<HPLedger />); });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('list: CD-style index with HP Number, borrower, phone, amount, status', async () => {
    await waitFor(() => text().includes('All HP Loans'), 'list');
    expect(text()).toContain('1 loan(s) in the system');
    expect(text()).toContain('HP Number');
    expect(text()).toContain('1,00,000');
    expect(text()).toContain('ACTIVE');
  });

  it('opened account: CD layout with HP figures', async () => {
    await openAccount();
    const t = text();
    expect(t).toContain('Record: 1 of 1');
    expect(t).toContain('Operator Action & Calculations');
    expect(t).toContain('Installments2 of 10every 30 days');
    expect(t).toContain('Rate / Penalty3.00% / 0.75%');
    expect(t).toContain('Current Due Date31-Oct-26');
    expect(t).toContain('Next Due Date30-Nov-26');
    expect(t).toContain('Due Days12');
    // Account Position on 12 Nov 2026
    expect(t).toContain('Principal Bal.80,000.00');
    expect(t).toContain('Today Due13,195.00');
    expect(t).toContain('Late Interest156.00');
    expect(t).toContain('Penalty39.00');
    expect(t).toContain('Next Installment#4 due 30-Nov-26');
    expect(t).toContain('Total to Regularize');
    expect(t).toContain('84,395.00'); // Total for Close
    // Tabs, Installments first
    ['Installments', 'Ledger Statement', 'Interest History', 'Payment History', 'Edit History'].forEach(tab => expect(t).toContain(tab));
    expect(t).toContain('Kept at disbursement');
    expect(t).toContain('Overdue');
    // Footer
    expect(t).toContain('Total Credit');
    ['Open Report', 'Receipt Print', 'NPA Close', 'Refresh', 'Excel'].forEach(b => expect(buttonWith(b)).toBeTruthy());
  });

  it('buttons: Partial for less than due, Installment for the due amount, Close for Total for Close', async () => {
    await openAccount();
    await typeInto(amountInput(), '5000');
    await waitFor(() => text().includes('Real-Time Payment Allocation'), 'allocation');
    expect(buttonWith('Partial Payment').disabled).toBe(false);
    expect(buttonWith('Installment Payment').disabled).toBe(true);
    expect(buttonWith('Close Account').disabled).toBe(true);

    await typeInto(amountInput(), '84395');
    await waitFor(() => text().includes('Closing Allocation Preview'), 'close preview');
    expect(buttonWith('Close Account').disabled).toBe(false);
    expect(buttonWith('Partial Payment').disabled).toBe(true);

    await typeInto(amountInput(), '13195');
    await waitFor(() => text().includes('Installment Allocation: #3'), 'installment preview');
    expect(text()).toContain('Penalty: 39');
    expect(text()).toContain('Late Int: 156');
    expect(buttonWith('Installment Payment').disabled).toBe(false);
    await act(async () => { buttonWith('Installment Payment').click(); });
    await waitFor(() => fake.db.tables.finance_transactions.some((t: any) => t.amount === 13195), 'receipt saved');
    await waitFor(() => text().includes('Installments3 of 10every'), 'refreshed');
    expect(fake.db.tables.finance_transactions.find((t: any) => t.amount === 13195).remarks)
      .toMatch(/^HP Collection - RC\d+ \(Prin: 10000\.00, Interest: 3156\.00, Pen: 39\.00\)$/);
  });

  it('Ledger Statement tab: Loan Issue row and the receipt, with grand totals', async () => {
    await openAccount();
    await act(async () => { buttonWith('Ledger Statement').click(); });
    await waitFor(() => text().includes('GRAND TOTALS'), 'statement');
    const t = text();
    expect(t).toContain('Loan Issue');
    expect(t).toContain('RC1');
    expect(t).toContain('Installment'); // RC1 cleared everything due on 1 Oct
    expect(t).toContain('90,000'); // outstanding after Loan Issue
  });
});
