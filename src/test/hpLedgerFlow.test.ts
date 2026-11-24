/**
 * HP loan from start to close through the REAL save, receipt, Day Book, Due List and edit code,
 * over an in-memory database (made-up loan only). Amounts are the Knowledge Base examples.
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

// Example A: 1,00,000; 10 installments every 30 days; 3% + 0.75% per period; doc 1,000; 1 Nov 2026
const hpPayload = (over: any = {}) => ({
  loan_id: 'HP001', customer_id: 'cust-1', date: '2026-11-01', amount: 100000, interest_rate: 3,
  duration_months: 10, period_days: 30, due_type: 'Daily', due_amount: 13000, penalty_percent: 0.75,
  document_charges: 1000, remarks: 'test', loan_category: 'HP', ...over
});

const newLoan = async (over: any = {}) => {
  const loan = await supabaseFinance.createLoan(hpPayload(over) as any, { id: 'cust-1' }, [], [], [], 'TESTER');
  if (!loan) throw new Error('loan not saved');
  return loan;
};

const dayBook = async (date: string) => {
  const rows = await dailyFinancialTransactionService.getDailyFinancialTransactions({ fromDate: date, toDate: date, financeMode: 'REGULAR' } as any);
  return rows
    .filter(r => r.accountOrLoanNo === 'HP001')
    .map(r => `${r.headOfAccount}|${r.debit}|${r.credit}`)
    .sort();
};

const receipt = (loanId: string, date: string, amount: number, receiptNo: string, kind: 'payment' | 'close' = 'payment') =>
  supabaseFinance.postHPReceipt({ loanId, kind, date, amount, receiptNo, userName: 'TESTER' });

describe('HP loan: save, receipts, Day Book, Due List, edit, close', () => {
  beforeEach(() => {
    fake.db.seed({
      finance_customers: [{ id: 'cust-1', name: 'TEST CUSTOMER', phone: '9000000000' }],
      finance_loans: [], finance_transactions: [], finance_cd_ledger_entries: [], finance_dues: [],
      finance_cd_interest_details: [], finance_npa_records: [], finance_transaction_reviews: []
    });
  });

  it('saving: loan given 1,00,000; 10,000 + 1,000 kept on the loan date; no CD rows, no dues rows', async () => {
    const loan = await newLoan();
    const txs = fake.db.tables.finance_transactions.filter((t: any) => t.loan_id === loan.id);
    expect(txs.map((t: any) => `${t.type}|${t.amount}`)).toEqual(['Disbursement|100000', 'Collection|11000']);
    expect(fake.db.tables.finance_cd_ledger_entries).toEqual([]);
    expect(fake.db.tables.finance_dues).toEqual([]);
    expect(await dayBook('2026-11-01')).toEqual([
      'HP DISBURSEMENT|0|10000',
      'HP DISBURSEMENT|100000|0',
      'HP DOCUMENT CHARGES|0|1000',
    ]);
  });

  it('a receipt 6 days late: 13,097.50 split into 10,000 principal, 3,078 interest, 19.50 penalty', async () => {
    const loan = await newLoan();
    const res = await receipt(loan.id, '2026-12-07', 13097.5, 'RC101');
    expect(res.success).toBe(true);
    expect(await dayBook('2026-12-07')).toEqual([
      'HP DISBURSEMENT|0|10000',
      'HP INTEREST|0|3078',
      'HP PENALTY|0|19.5',
    ]);
    const saved = fake.db.tables.finance_loans.find((l: any) => l.id === loan.id);
    expect(saved).toMatchObject({ installments_paid: 2, balance_without_interest: 80000, status: 'Active', amount: 100000 });
    // nothing written to the cash book (that listed the same money twice)
    expect(fake.db.tables.finance_cashbook_entries || []).toEqual([]);
  });

  it('refuses a receipt dated before the last one, a reused receipt number, and too much money', async () => {
    const loan = await newLoan();
    expect((await receipt(loan.id, '2026-12-07', 13097.5, 'RC101')).success).toBe(true);
    expect((await receipt(loan.id, '2026-12-05', 100, 'RC102')).success).toBe(false);
    expect((await receipt(loan.id, '2026-12-08', 100, 'RC101')).success).toBe(false);
    expect((await receipt(loan.id, '2026-12-08', 500000, 'RC103')).success).toBe(false);
    expect(fake.db.tables.finance_transactions.filter((t: any) => t.receipt_no).length).toBe(1);
  });

  it('Due List row: 6 days late on 7 Dec, 13,097.50 due, HP type', async () => {
    const loan = await newLoan();
    const { dues } = await supabaseFinance.getDuesLedgerSummary('2026-12-07', [loan.id]);
    const row = dues.find((d: any) => d.id === loan.id);
    expect(row).toMatchObject({
      loan_type: 'HP', current_principal: 90000, present_due: 13097.5, due_days: 6, is_npa: false,
      // close: 90,000 principal + 3,000 interest of installment 2 + 600 for 6 days used + 97.50 late
      pending_interest: 3078, penalty: 19.5, closing_amount: 93697.5
    });
  });

  it('close on 20 Dec after installment 2 paid on time: 81,900; loan Closed; Day Book 80,000 + 1,900', async () => {
    const loan = await newLoan();
    expect((await receipt(loan.id, '2026-12-01', 13000, 'RC101')).success).toBe(true);
    const res = await receipt(loan.id, '2026-12-20', 81900, 'RC102', 'close');
    expect(res).toMatchObject({ success: true, closed: true });
    expect(fake.db.tables.finance_loans.find((l: any) => l.id === loan.id).status).toBe('Closed');
    expect(await dayBook('2026-12-20')).toEqual(['HP DISBURSEMENT|0|80000', 'HP INTEREST|0|1900']);
    // nothing more after closing
    expect((await receipt(loan.id, '2026-12-21', 100, 'RC103')).success).toBe(false);
  });

  it('editing an unpaid HP loan rewrites the loan-date row and makes no dues rows', async () => {
    const loan = await newLoan();
    await supabaseFinance.updateLoan(loan.id, { ...hpPayload({ amount: 120000, document_charges: 500 }) } as any, 'TESTER');
    const txs = fake.db.tables.finance_transactions.filter((t: any) => t.loan_id === loan.id);
    expect(txs.map((t: any) => `${t.type}|${t.amount}`).sort()).toEqual(['Collection|12500', 'Disbursement|120000']);
    expect(fake.db.tables.finance_dues).toEqual([]);
  });

  it('after a receipt, the loan terms are locked', async () => {
    const loan = await newLoan();
    expect((await receipt(loan.id, '2026-12-01', 13000, 'RC101')).success).toBe(true);
    await expect(supabaseFinance.updateLoan(loan.id, { amount: 120000 } as any, 'TESTER')).rejects.toThrow(/CD_CONTRACT_FIELD_IMMUTABLE/);
  });
});
