/**
 * Saving a new loan: an HP loan must not get the CD opening rows (CD account, one month of CD
 * interest, CD document charges). Those rows showed an HP loan in the Day Book as a CD loan and
 * counted its disbursement twice. A CD loan keeps its three opening rows.
 * Runs the real save and Day Book code over an in-memory database (made-up loans only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({ db: null as any }));

vi.mock('../lib/supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  fake.db = createFakeSupabase();
  return {
    supabase: fake.db.client, rawSupabase: fake.db.client, default: fake.db.client,
    resolveSchemaAndTable: (t: string) => ({ schema: 'finance', table: t }), supabaseHelpers: {}
  };
});

import { supabaseFinance } from '../lib/supabaseFinance';
import { dailyFinancialTransactionService } from '../services/dailyFinancialTransactionService';

const loanPayload = (over: any) => ({
  loan_id: 'X001', customer_id: 'cust-1', date: '2026-11-01', amount: 100000, interest_rate: 3,
  duration_months: 30, due_type: 'Daily', due_amount: 0, penalty_percent: 0.75, document_charges: 500,
  period_days: 30, remarks: 'test', ...over
});

const save = (over: any) =>
  supabaseFinance.createLoan(loanPayload(over) as any, { id: 'cust-1' }, [], [], [], 'TESTER');

const dayBookRows = async (loanNo: string) => {
  const rows = await dailyFinancialTransactionService.getDailyFinancialTransactions({
    fromDate: '2026-11-01', toDate: '2026-11-01', financeMode: 'REGULAR'
  } as any);
  return rows.filter(r => r.accountOrLoanNo === loanNo);
};

describe('New loan save: CD opening rows only where they belong', () => {
  beforeEach(() => {
    fake.db.seed({ finance_customers: [{ id: 'cust-1', name: 'TEST CUSTOMER' }], finance_loans: [], finance_transactions: [], finance_cd_ledger_entries: [] });
  });

  it('HP loan: no CD rows are written', async () => {
    const loan = await save({ loan_id: 'HP001', loan_category: 'HP', duration_months: 10 });
    expect(loan).toBeTruthy();
    expect(fake.db.tables.finance_cd_ledger_entries.filter((e: any) => e.loan_id === loan!.id)).toEqual([]);
    const tx = fake.db.tables.finance_transactions.filter((t: any) => t.loan_id === loan!.id);
    // loan given, and installment 1 principal (1,00,000 / 10) + doc charges 500 kept on the loan date
    expect(tx.map((t: any) => `${t.type}|${t.amount}`)).toEqual(['Disbursement|100000', 'Collection|10500']);
  });

  it('HP loan: the Day Book shows the disbursement once, under HP, never under CD', async () => {
    await save({ loan_id: 'HP001', loan_category: 'HP', duration_months: 10 });
    const rows = await dayBookRows('HP001');
    expect(rows.map(r => `${r.headOfAccount}|${r.debit}|${r.credit}|${r.category}`).sort()).toEqual([
      'HP DISBURSEMENT|0|10000|HP',
      'HP DISBURSEMENT|100000|0|HP',
      'HP DOCUMENT CHARGES|0|500|HP'
    ]);
    expect(rows.some(r => r.headOfAccount.startsWith('CD'))).toBe(false);
  });

  it('HP loan: the period in days is kept on the loan', async () => {
    const loan = await save({ loan_id: 'HP002', loan_category: 'HP', period_days: 15 });
    expect(fake.db.tables.finance_loans.find((l: any) => l.id === loan!.id).period_days).toBe(15);
  });

  it('a lower-case "hp" category is treated the same', async () => {
    const loan = await save({ loan_id: 'HP003', loan_category: 'hp' });
    expect(fake.db.tables.finance_cd_ledger_entries.filter((e: any) => e.loan_id === loan!.id)).toEqual([]);
  });

  it('CD loan: still gets its three opening rows, unchanged', async () => {
    const loan = await save({ loan_id: 'CD001', loan_category: 'CD' });
    const rows = fake.db.tables.finance_cd_ledger_entries
      .filter((e: any) => e.loan_id === loan!.id)
      .map((e: any) => `${e.entry_type}|${e.account_name}|${e.debit}|${e.credit}`);
    expect(rows).toEqual([
      'original_loan|CD A/C|100000|0',
      'opening_commission|CD COMMISSION A/C|0|3000',
      'document_charge|CD DOCUMENT CHARGES A/C|0|500'
    ]);
  });
});
