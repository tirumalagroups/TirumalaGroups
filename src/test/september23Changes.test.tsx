/**
 * Changes of 23 Nov 2026 (ThirumalaChanges-September23-nov.pdf):
 *  - Edit Entry delete: Deleted Records lacked 5 day-book columns, so every delete was refused
 *  - CD Compound Interest report: Rate (default 3%) and Period (default 30 days) boxes, Penalty removed
 *  - HP Ledger installments: Total (To be paid) column
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase', () => {
  const chain: any = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  return { supabase: chain, rawSupabase: chain, default: chain, resolveSchemaAndTable: (t: string) => ({ schema: 'public', table: t }), supabaseHelpers: {} };
});

import { missingColumnOf, insertSkippingMissingColumns } from '../lib/supabaseDatabase';
import { cdCompoundInterestEngine, TOOLTIP_TEXT, tooltipFor } from '../services/cdCompoundInterestEngine';
import CompoundInterestModal, { parseCIRate, parseCIPeriod } from '../components/finance/CompoundInterestModal';
import { buildHPContract, computeHPPosition } from '../services/hpLedgerEngine';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Edit Entry delete: Deleted Records without the newer day-book columns', () => {
  // The live regular/itr deleted_cash_book (checked 23 Nov 2026) has no payment_mode,
  // credit_online, credit_offline, debit_online, debit_offline
  const deletedTableColumns = new Set([
    'id', 'sno', 'acc_name', 'sub_acc_name', 'particulars', 'c_date', 'credit', 'debit', 'approved',
    'company_name', 'address', 'staff', 'users', 'entry_time', 'book_id', 'deleted_by', 'deleted_at',
  ]);
  const fakeInsert = (saved: Record<string, any>[]) => async (row: Record<string, any>) => {
    const missing = Object.keys(row).find(k => !deletedTableColumns.has(k));
    if (missing) {
      return { error: { code: 'PGRST204', message: `Could not find the '${missing}' column of 'deleted_cash_book' in the schema cache` } };
    }
    saved.push(row);
    return { error: null };
  };
  const entry = {
    id: 'e1', sno: 7, acc_name: 'EXPENCES A/C', particulars: 'TEA EXP', c_date: '2026-11-16', credit: 0, debit: 20,
    approved: 'false', credit_online: 0, credit_offline: 0, debit_online: 0, debit_offline: 20, payment_mode: 'Cash',
    deleted_by: 'rama', deleted_at: '2026-11-16T08:00:00Z',
  };

  it('reads the missing column from both kinds of error', () => {
    expect(missingColumnOf({ code: 'PGRST204', message: "Could not find the 'payment_mode' column of 'deleted_cash_book' in the schema cache" })).toBe('payment_mode');
    expect(missingColumnOf({ code: '42703', message: 'column "debit_online" of relation "deleted_cash_book" does not exist' })).toBe('debit_online');
    expect(missingColumnOf({ code: '42501', message: 'permission denied' })).toBeNull();
    expect(missingColumnOf(null)).toBeNull();
  });

  it('the copy is saved without the missing columns (before: refused, "Entry NOT deleted")', async () => {
    const saved: Record<string, any>[] = [];
    const { error, skipped } = await insertSkippingMissingColumns(fakeInsert(saved), entry);
    expect(error).toBeNull();
    expect(skipped.sort()).toEqual(['credit_offline', 'credit_online', 'debit_offline', 'debit_online', 'payment_mode']);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'e1', sno: 7, debit: 20, particulars: 'TEA EXP', deleted_by: 'rama' });
  });

  it('after the SQL (all columns there) everything is kept', async () => {
    ['credit_online', 'credit_offline', 'debit_online', 'debit_offline', 'payment_mode'].forEach(c => deletedTableColumns.add(c));
    const saved: Record<string, any>[] = [];
    const { error, skipped } = await insertSkippingMissingColumns(fakeInsert(saved), entry);
    expect(error).toBeNull();
    expect(skipped).toEqual([]);
    expect(saved[0]).toEqual(entry);
  });

  it('any other error still stops the delete', async () => {
    let calls = 0;
    const { error } = await insertSkippingMissingColumns(async () => { calls++; return { error: { code: '42501', message: 'permission denied' } }; }, entry);
    expect(error.code).toBe('42501');
    expect(calls).toBe(1);
  });
});

describe('Compound Interest report: rate and period chosen by the user', () => {
  const loan = { id: 'cd-1', amount: 10000, date: '2026-08-13', interest_rate: 3, status: 'Active' };

  it('defaults stay as before: 30-day cycles, same note', () => {
    const r = cdCompoundInterestEngine.calculateCITimeline(loan, [], '2026-10-27');
    expect(r.summary.finalCompoundBalance).toBe(10768.14);
    expect(r.summary.periodDays).toBe(30);
    expect(r.summary.tooltipText).toBe(TOOLTIP_TEXT);
  });

  it('period 15 days: 3% added every 15 days (as typed), 5 cycles in 75 days', () => {
    const r = cdCompoundInterestEngine.calculateCITimeline(loan, [], '2026-10-27', { periodDays: 15 });
    expect(r.reportRows.map(x => x.days)).toEqual([0, 15, 15, 15, 15, 15]);
    expect(r.reportRows.map(x => x.endBalance)).toEqual([10000, 10300, 10609, 10927.27, 11255.09, 11592.74]);
    expect(r.summary.finalCompoundBalance).toBe(11592.74);
    expect(r.summary.tooltipText).toBe(tooltipFor(15));
    expect(r.summary.tooltipText).toContain('15-day');
  });

  it('rate 2%, 30 days: two cycles, then 15 days at half the rate', () => {
    const r = cdCompoundInterestEngine.calculateCITimeline({ ...loan, interest_rate: 2 }, [], '2026-10-27', { periodDays: 30 });
    expect(r.reportRows.map(x => x.endBalance)).toEqual([10000, 10200, 10404, 10508.04]);
  });

  it('what can be typed in the boxes', () => {
    expect(parseCIRate('3')).toBe(3);
    expect(parseCIRate('2.5')).toBe(2.5);
    expect(parseCIRate('')).toBeNull();
    expect(parseCIRate('0')).toBeNull();
    expect(parseCIRate('-1')).toBeNull();
    expect(parseCIPeriod('30')).toBe(30);
    expect(parseCIPeriod('7')).toBe(7);
    expect(parseCIPeriod('0')).toBeNull();
    expect(parseCIPeriod('12.5')).toBeNull();
    expect(parseCIPeriod('')).toBeNull();
  });

  it('popup: Rate and Period boxes (3 and 30), no Penalty; typing passes the new values on', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const rates: number[] = [];
    const periods: number[] = [];
    const summary = cdCompoundInterestEngine.calculateCITimeline(loan, [], '2026-10-27').summary;
    await act(async () => {
      root.render(
        <CompoundInterestModal
          isOpen
          onClose={() => {}}
          cdNumber='CD216'
          customerName='SHEKAR JAGAVAGARI'
          interestRate={3}
          periodDays={30}
          onInterestRateChange={v => rates.push(v)}
          onPeriodDaysChange={v => periods.push(v)}
          loanDate='2026-08-13'
          reportRows={[]}
          summary={summary}
        />
      );
    });
    const rate = box.querySelector('input[aria-label="Rate (% per period)"]') as HTMLInputElement;
    const period = box.querySelector('input[aria-label="Period (days)"]') as HTMLInputElement;
    expect(rate.value).toBe('3');
    expect(period.value).toBe('30');
    expect(box.textContent).not.toMatch(/penalty/i);

    const typeInto = (el: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => { typeInto(rate, '2.5'); typeInto(period, '15'); });
    expect(rates).toEqual([2.5]);
    expect(periods).toEqual([15]);

    // An empty or wrong value is not passed on and is shown in red
    await act(async () => { typeInto(period, '0'); });
    expect(periods).toEqual([15]);
    expect(box.textContent).toContain('Enter the period in whole days');
    await act(async () => root.unmount());
    box.remove();
  });
});

describe('HP Ledger installments: Total (To be paid)', () => {
  const A = buildHPContract({
    date: '2026-11-01', amount: 100000, duration_months: 10, period_days: 30,
    interest_rate: 3, penalty_percent: 0.75, grace_days: 5, document_charges: 1000,
  });
  const pay = (date: string, amount: number, kind: 'payment' | 'close' = 'payment') => ({ date, amount, kind });

  it('balance + unpaid late interest and penalty; 0 once paid', () => {
    const pos = computeHPPosition(A, [pay('2026-12-01', 8000)], '2026-12-11');
    const i = (n: number) => pos.installments.find(x => x.no === n)!;
    expect(i(1).toBePaid).toBe(0); // kept at disbursement
    expect(i(2)).toMatchObject({ balance: 5000, lateDue: 62.5, toBePaid: 5062.5 });
    expect(i(3)).toMatchObject({ balance: 13000, toBePaid: 13000 }); // not due yet
  });

  it('a closed loan owes nothing on any row', () => {
    const closeAmount = computeHPPosition(A, [], '2026-11-20').totalForClose;
    const pos = computeHPPosition(A, [pay('2026-11-20', closeAmount, 'close')], '2026-11-25');
    expect(pos.status).toBe('Closed');
    expect(pos.installments.every(x => x.toBePaid === 0)).toBe(true);
  });
});
