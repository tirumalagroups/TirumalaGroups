/**
 * Finance Edit Entry: editing / deleting a loan receipt with full recalculation.
 * Runs the REAL save, rebuild and report code over an in-memory database (made-up loans only).
 * Ground truth = the same payments entered from scratch through the CD Ledger's entry flow.
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

import { loanFigures, enterPaymentsLikeCDLedger } from './helpers/financeReceiptKit';
import {
  classifyEntry, previewReceiptChange, saveReceiptEdit, deleteReceipt, findReceiptTx,
  saveCashbookEdit, deleteCashbook, saveCapitalEdit, deleteCapital, replayCDCollections
} from '../services/financeEntryEditService';
import { cdLedgerRebuildService } from '../services/cdLedgerRebuildService';
import { supabaseFinance } from '../lib/supabaseFinance';

const AS_OF = '2025-09-30';
const LOAN = 'loan-1';
type Pay = { receiptNo: string; date: string; amount: number; action: 'Renew' | 'Partial' | 'Close' };

// 1,00,000 at 3% a month: interest 100 a day, penalty 25 a day; first due date 30-Jan-2025
const baseLoan = (over: any = {}) => ({
  id: LOAN, loan_id: 'CD900', customer_id: 'cust-1', date: '2025-01-01', amount: 100000, interest_rate: 3,
  penalty_percent: 0.75, period_days: 30, duration_months: 1, status: 'Active', loan_category: 'CD', book_id: null, ...over
});

const seedEmpty = (loan = baseLoan()) => {
  fake.db.seed({
    finance_loans: [loan],
    finance_customers: [{ id: 'cust-1', name: 'TEST CUSTOMER', phone: '9000000000' }],
    finance_transactions: [{ id: 'tx-disb', loan_id: LOAN, date: loan.date, amount: Number(loan.amount), type: 'Disbursement', collected_by: 'TESTER', created_at: '2025-01-01T00:00:00Z' }],
    finance_cd_ledger_entries: [
      { id: 'e-orig', loan_id: LOAN, customer_id: 'cust-1', account_name: 'CD A/C', entry_date: loan.date, credit: 0, debit: Number(loan.amount), receipt_no: '-', particulars: 'Original Loan Disbursement', user_name: 'TESTER', entry_type: 'original_loan' },
      { id: 'e-comm', loan_id: LOAN, customer_id: 'cust-1', account_name: 'CD COMMISSION A/C', entry_date: loan.date, credit: 3000, debit: 0, receipt_no: '-', particulars: 'Opening CD Commission Charged', user_name: 'TESTER', entry_type: 'opening_commission' },
    ],
    finance_cd_interest_details: [],
  });
};

const build = async (pays: Pay[], loan = baseLoan()) => {
  seedEmpty(loan);
  await enterPaymentsLikeCDLedger(fake.db, LOAN, pays);
};
const figures = () => loanFigures(fake.db, LOAN, AS_OF);
const txOf = async (receipt: string) => findReceiptTx(LOAN, receipt);
const splitOf = (receipt: string) => {
  const rows = fake.db.tables.finance_cd_ledger_entries.filter((e: any) => e.receipt_no === receipt);
  const sum = (t: string) => rows.filter((e: any) => e.entry_type === t).reduce((a: number, e: any) => a + Number(e.credit || 0), 0);
  return { penalty: sum('penalty_payment'), interest: sum('interest_payment'), principal: sum('principal_payment'), paid: sum('amount_paid') };
};

const PAYS: Pay[] = [
  { receiptNo: 'RC101', date: '2025-03-01', amount: 3750, action: 'Renew' },
  { receiptNo: 'RC102', date: '2025-05-01', amount: 20000, action: 'Partial' },
  { receiptNo: 'RC103', date: '2025-07-01', amount: 6000, action: 'Renew' },
  { receiptNo: 'RC104', date: '2025-08-20', amount: 25000, action: 'Partial' },
];

/** Edit one receipt on a loan with PAYS, and the same payments entered fresh with the new amount */
const editVsTruth = async (receipt: string, newAmount: number) => {
  await build(PAYS);
  const before = await figures();
  const tx = await txOf(receipt);
  const preview = await previewReceiptChange(LOAN, { txId: tx.id, newAmount });
  expect(preview.blockers).toEqual([]);
  await saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount, reason: 'test', username: 'TESTER' });
  const edited = await figures();
  const editedSplit = splitOf(receipt);
  await build(PAYS.map(p => p.receiptNo === receipt ? { ...p, amount: newAmount } : p));
  const truth = await figures();
  return { before, edited, truth, preview, editedSplit };
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('hand-worked position of the base loan', () => {
  it('matches the numbers worked out by hand', async () => {
    await build([{ receiptNo: 'RC101', date: '2025-03-01', amount: 3750, action: 'Renew' }]);
    // 30-Jan to 01-Mar = 30 days overdue: interest 30 x 100 = 3000, penalty 30 x 25 = 750
    expect(splitOf('RC101')).toEqual({ penalty: 750, interest: 3000, principal: 0, paid: 3750 });
  });
});

describe('Round 1: raise the interest part of a renewal', () => {
  it('equals the payment entered that way from the start', async () => {
    const r = await editVsTruth('RC103', 7500);
    expect(r.editedSplit.interest).toBeGreaterThan(0);
    expect(r.edited).toEqual(r.truth);
    expect(r.edited.totalPaid).toBe(r.before.totalPaid + 1500);
    // More renewal now means fewer dues at the later partial payment, so more of it goes to principal
    expect(r.edited.principalBalance).toBeLessThan(r.before.principalBalance);
    expect(r.editedSplit.interest).toBeGreaterThan(r.preview.before?.interestPaid ?? 0);
    expect(r.editedSplit.paid).toBe(7500);
  });
});

describe('Round 2: lower the penalty part', () => {
  it('equals the payment entered that way from the start', async () => {
    const r = await editVsTruth('RC101', 3000);
    expect(r.edited).toEqual(r.truth);
    expect(r.edited.totalPaid).toBe(r.before.totalPaid - 750);
  });
});

describe('Round 3: change the principal of a partial payment', () => {
  it('moves the outstanding and later receipts, and equals the truth', async () => {
    const r = await editVsTruth('RC102', 30000);
    expect(r.edited).toEqual(r.truth);
    expect(r.edited.principalBalance).toBeLessThan(r.before.principalBalance);
    expect(r.edited.loanAmount).toBe(r.edited.principalBalance);
    expect(r.preview.laterChanged.length).toBeGreaterThan(0);
    expect(r.preview.afterPrincipal).toBe(r.edited.principalBalance);
  });
});

describe('Round 4: edit an old receipt with later receipts after it', () => {
  it('re-splits every later receipt exactly as if entered that way', async () => {
    const r = await editVsTruth('RC101', 5000);
    expect(r.edited).toEqual(r.truth);
    // Day Book, P&L heads, General Ledger, CI and Dues List are all inside the compared figures
    expect(r.edited.dayBook.length).toBeGreaterThan(0);
    expect(Object.keys(r.edited.plHeads).length).toBeGreaterThan(0);
    expect(r.edited.duesRow.principal).toBe(r.edited.principalBalance);
    expect(r.edited.duesRow.dueDays).toBe(r.edited.dueDays);
    expect(r.edited.ciFinal).toBe(r.truth.ciFinal);
  });
});

describe('Round 5: delete a whole receipt, then put it back', () => {
  it('delete equals never entered; restore and edit-back return the exact original', async () => {
    await build(PAYS);
    const original = await figures();
    const amounts = () => fake.db.tables.finance_transactions.filter((t: any) => t.type === 'Collection').map((t: any) => `${t.receipt_no}:${t.amount}`).sort();
    const originalAmounts = amounts();

    const tx = { ...(await txOf('RC102')) };
    await deleteReceipt({ loanId: LOAN, txId: tx.id, reason: 'test', username: 'TESTER' });
    const deleted = await figures();
    expect(splitOf('RC102').paid).toBe(0);
    const logRow = fake.db.tables.finance_deleted_logs.find((l: any) => l.record_id === tx.id);
    expect(logRow).toBeTruthy();

    // Restore from Edited/Deleted Logs brings everything back
    const logs = fake.db.tables.finance_deleted_logs;
    expect(await supabaseFinance.restoreDeletedRecord(logs[0].id, 'finance_transactions', logRow.old_values, 'TESTER')).toBe(true);
    expect(await figures()).toEqual(original);

    await build(PAYS.filter(p => p.receiptNo !== 'RC102'));
    expect(deleted).toEqual(await figures());

    // Edit there and back
    await build(PAYS);
    const t2 = { ...(await txOf('RC102')) };
    await saveReceiptEdit({ loanId: LOAN, txId: t2.id, newAmount: 30000, reason: 'test', username: 'TESTER' });
    await saveReceiptEdit({ loanId: LOAN, txId: t2.id, newAmount: 20000, reason: 'test', username: 'TESTER' });
    expect(await figures()).toEqual(original);
    expect(amounts()).toEqual(originalAmounts);
  });
});

describe('nothing goes unrecorded', () => {
  it('an edit reaches the loan history, Edited Logs and Approvals, even when a CREATE row exists', async () => {
    await build(PAYS);
    const tx = await txOf('RC103');
    const creates = fake.db.tables.finance_transaction_reviews.length;
    expect(creates).toBeGreaterThan(0);
    await saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 7000, reason: 'wrong amount', username: 'TESTER' });
    const reviews = fake.db.tables.finance_transaction_reviews;
    const editRow = reviews.find((r: any) => r.action_type === 'EDIT');
    expect(reviews.length).toBe(creates + 1);
    expect(editRow.receipt_number).toBe('RC103');
    expect(Number(editRow.amount)).toBe(7000);
    expect(Number(editRow.penalty_amount) + Number(editRow.interest_amount) + Number(editRow.principal_amount)).toBe(7000);
    expect(fake.db.tables.finance_edited_logs.some((l: any) => l.record_id === tx.id && l.table_name === 'finance_transactions')).toBe(true);
    expect(fake.db.tables.finance_cd_transaction_edit_logs.some((l: any) => l.transaction_id === tx.id && l.reason === 'wrong amount')).toBe(true);
  });

  it('a second edit and a delete of the same receipt each get their own Approvals row', async () => {
    await build(PAYS);
    const tx = { ...(await txOf('RC103')) };
    await saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 7000, reason: 'a', username: 'T' });
    await saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 8000, reason: 'b', username: 'T' });
    await deleteReceipt({ loanId: LOAN, txId: tx.id, reason: 'c', username: 'T' });
    const rows = fake.db.tables.finance_transaction_reviews;
    expect(rows.filter((r: any) => r.action_type === 'EDIT').length).toBe(2);
    expect(rows.filter((r: any) => r.action_type === 'DELETE').length).toBe(1);
  });

  it('Day Book and Capital edits / deletes are logged and reach Approvals', async () => {
    seedEmpty();
    fake.db.tables.finance_cashbook_entries = [{ id: 'cb-1', entry_date: '2025-02-01', head_of_account: 'EXP A/C', particulars: 'OLD', credit: 0, debit: 500, created_by: 'T', status: 'PENDING' }];
    fake.db.tables.finance_capital_entries = [{ id: 'cap-1', entry_date: '2025-02-01', partner_id: 'p', partner_name: 'P', particulars: 'OLD', credit: 1000, debit: 0, amount: 1000, type: 'Credit' }];
    await saveCashbookEdit('cb-1', { entry_date: '2025-02-02', head_of_account: 'EXP A/C', particulars: 'NEW', credit: 0, debit: 600 }, 'T');
    expect(fake.db.tables.finance_cashbook_entries[0].debit).toBe(600);
    await saveCapitalEdit('cap-1', { entry_date: '2025-02-02', particulars: 'NEW', credit: 2000, debit: 0 }, 'T');
    expect(fake.db.tables.finance_capital_entries[0].amount).toBe(2000);
    await deleteCashbook('cb-1', { date: '2025-02-02', amount: 600 }, 'T');
    await deleteCapital('cap-1', { date: '2025-02-02', amount: 2000 }, 'T');
    expect(fake.db.tables.finance_cashbook_entries.length).toBe(0);
    expect(fake.db.tables.finance_capital_entries.length).toBe(0);
    const rows = fake.db.tables.finance_transaction_reviews;
    expect(rows.filter((r: any) => r.action_type === 'EDIT').length).toBe(2);
    expect(rows.filter((r: any) => r.action_type === 'DELETE').length).toBe(2);
    expect(fake.db.tables.finance_deleted_logs.length).toBe(2);
    expect(fake.db.tables.finance_edited_logs.length).toBe(2);
  });
});

describe('safety', () => {
  it('the preview is exactly what the rebuild saves', async () => {
    await build(PAYS);
    const tx = await txOf('RC102');
    const preview = await previewReceiptChange(LOAN, { txId: tx.id, newAmount: 26000 });
    await saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 26000, reason: 'x', username: 'T' });
    expect(splitOf('RC102').principal).toBe(preview.after?.principalPaid);
    expect(splitOf('RC102').interest).toBe(preview.after?.interestPaid);
    const replay = replayCDCollections(fake.db.tables.finance_loans[0], fake.db.tables.finance_cd_ledger_entries, fake.db.tables.finance_transactions);
    for (const r of replay.receipts) {
      expect(splitOf(r.receiptNo).interest).toBeCloseTo(r.interestPaid, 2);
      expect(splitOf(r.receiptNo).penalty).toBeCloseTo(r.penaltyPaid, 2);
      expect(splitOf(r.receiptNo).principal).toBeCloseTo(r.principalPaid, 2);
    }
  });

  it('if the recalculation fails, every row goes back as it was', async () => {
    await build(PAYS);
    const before = await figures();
    const snapshot = JSON.stringify(fake.db.tables.finance_transactions.map((t: any) => [t.id, t.amount]));
    const tx = await txOf('RC102');
    const spy = vi.spyOn(cdLedgerRebuildService, 'rebuildCDLoanLifecycle').mockResolvedValueOnce({ success: false, error: 'boom' });
    await expect(saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 30000, reason: 'x', username: 'T' })).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await figures()).toEqual(before);
    expect(JSON.stringify(fake.db.tables.finance_transactions.filter((t: any) => t.type === 'Collection').concat().sort((a: any, b: any) => a.id < b.id ? -1 : 1).map((t: any) => [t.id, t.amount])).length)
      .toBe(JSON.stringify(JSON.parse(snapshot).filter((x: any) => x[0] !== 'tx-disb')).length);
    expect(fake.db.tables.finance_transaction_reviews.some((r: any) => r.action_type === 'EDIT')).toBe(false);
  });

  it('blocks NPA closed loans, overpayment, duplicate receipt numbers, early dates and bad amounts', async () => {
    await build(PAYS);
    const tx = await txOf('RC103');
    expect((await previewReceiptChange(LOAN, { txId: tx.id, newAmount: 0 })).ok).toBe(false);
    expect((await previewReceiptChange(LOAN, { txId: tx.id, newAmount: 7000, newReceiptNo: 'RC101' })).ok).toBe(false);
    expect((await previewReceiptChange(LOAN, { txId: tx.id, newAmount: 7000, newDate: '2024-01-01' })).ok).toBe(false);
    expect((await previewReceiptChange(LOAN, { txId: tx.id, newAmount: 9000000 })).ok).toBe(false);
    fake.db.tables.finance_loans[0].status = 'NPA_CLOSED';
    const npa = await previewReceiptChange(LOAN, { txId: tx.id, newAmount: 7000 });
    expect(npa.ok).toBe(false);
    await expect(saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 7000, reason: 'x', username: 'T' })).rejects.toThrow(/NPA/);
  });

  it('blocks a loan whose saved history differs from the rules, without touching it', async () => {
    await build(PAYS);
    const row = fake.db.tables.finance_cd_ledger_entries.find((e: any) => e.receipt_no === 'RC101' && e.entry_type === 'interest_payment');
    row.credit = Number(row.credit) - 42;
    const pen = fake.db.tables.finance_cd_ledger_entries.find((e: any) => e.receipt_no === 'RC101' && e.entry_type === 'penalty_payment');
    pen.credit = Number(pen.credit) + 42;
    const tx = await txOf('RC103');
    const writes = fake.db.writes.length;
    await expect(saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 7000, reason: 'x', username: 'T' })).rejects.toThrow(/RC101/);
    expect(fake.db.writes.length).toBe(writes);
  });

  it('an edit can close a loan and another can re-open it, matching the truth both ways', async () => {
    const pays: Pay[] = [
      { receiptNo: 'RC201', date: '2025-03-01', amount: 3750, action: 'Renew' },
      { receiptNo: 'RC202', date: '2025-04-15', amount: 50000, action: 'Partial' },
    ];
    await build(pays);
    const original = await figures();
    expect(original.status).toBe('Active');
    // Full payoff on 15-Apr: principal 1,00,000 + dues
    const tx = { ...(await txOf('RC202')) };
    const dues = Number(fake.db.tables.finance_cd_ledger_entries.filter((e: any) => e.receipt_no === 'RC202' && ['interest_payment', 'penalty_payment'].includes(e.entry_type)).reduce((a: number, e: any) => a + Number(e.credit), 0));
    const payoff = 100000 + dues;
    const pv = await previewReceiptChange(LOAN, { txId: tx.id, newAmount: payoff });
    expect(pv.ok).toBe(true);
    expect(pv.afterStatus).toBe('Closed');
    expect(pv.warnings.join(' ')).toMatch(/CLOSED/);
    await saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: payoff, reason: 'x', username: 'T' });
    const closed = await figures();
    expect(closed.status).toBe('Closed');
    expect(closed.principalBalance).toBe(0);
    await saveReceiptEdit({ loanId: LOAN, txId: tx.id, newAmount: 50000, reason: 'x', username: 'T' });
    expect(await figures()).toEqual(original);
    expect((await figures()).status).toBe('Active');
  });

  it('a receipt that would close the loan with later receipts after it is blocked', async () => {
    await build(PAYS);
    const tx = await txOf('RC101');
    const pv = await previewReceiptChange(LOAN, { txId: tx.id, newAmount: 120000 });
    expect(pv.ok).toBe(false);
  });
});

describe('which actions a row gets', () => {
  it('classifies the combined list', () => {
    expect(classifyEntry({ sourceType: 'DAY_BOOK_ENTRY' })).toBe('CASHBOOK');
    expect(classifyEntry({ sourceType: 'CAPITAL_ENTRY' })).toBe('CAPITAL');
    expect(classifyEntry({ sourceType: 'CD_LEDGER', npaRole: 'PARENT' })).toBe('NPA');
    expect(classifyEntry({ sourceType: 'CD_LEDGER', category: 'NPA CLOSED' })).toBe('NPA');
    expect(classifyEntry({ sourceType: 'CD_LEDGER', headOfAccount: 'CD DISBURSEMENT', debit: 1000, credit: 0, receiptOrVoucherNo: '-', accountOrLoanNo: 'CD1' })).toBe('LOAN_ISSUE');
    expect(classifyEntry({ sourceType: 'CD_LEDGER', headOfAccount: 'CD INTEREST', credit: 100, debit: 0, receiptOrVoucherNo: 'RC1', accountOrLoanNo: 'CD1' })).toBe('RECEIPT');
    expect(classifyEntry({ sourceType: 'CD_LEDGER', headOfAccount: 'CD INTEREST', credit: 100, debit: 0, receiptOrVoucherNo: '-', accountOrLoanNo: 'CD1', particulars: 'Opening CD Commission Charged' })).toBe('LOAN_ISSUE');
  });
});
