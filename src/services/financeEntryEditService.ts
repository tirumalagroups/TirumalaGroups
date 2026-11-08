/**
 * Finance "Edit Entry": edit / delete of Day Book entries, Capital entries and loan receipts.
 *
 * Receipts: a receipt is one finance_transactions row (the cash) plus ledger rows and interest
 * details derived from it. The cash amount is the source of truth: the existing rebuild replays
 * every receipt of the loan in order and re-allocates each one with the same rules as entry
 * (allocateCDPayment), so principal / interest / penalty, renewed days, due dates, later receipts
 * and the loan's balance all follow from it. Every screen and report reads these same rows.
 *
 * Safety:
 *  - previewReceiptChange runs the whole replay in memory first; anything wrong blocks the save.
 *  - Loans whose saved history differs from a replay are blocked (recalculating them would
 *    change OTHER receipts the user did not touch).
 *  - After saving, the result is compared with the preview; on any failure or mismatch the
 *    loan's rows are put back exactly as they were.
 */
import { supabase } from '../lib/supabase';
import { supabaseFinance } from '../lib/supabaseFinance';
import { financeCalculationService } from './financeCalculationService';
import { allocateCDPayment } from './cdLedgerEngine';
import { cdLedgerRebuildService, compareReceipts } from './cdLedgerRebuildService';

export type EntryKind = 'CASHBOOK' | 'CAPITAL' | 'LOAN_ISSUE' | 'NPA' | 'RECEIPT' | 'OTHER';

const PAYMENT_ENTRY_TYPES = ['penalty_payment', 'interest_payment', 'principal_payment', 'amount_paid'];
const money = (v: number) => Number((Number(v) || 0).toFixed(2));
const newId = () => (globalThis.crypto && 'randomUUID' in globalThis.crypto
  ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

/** Which actions a row of the combined list allows */
export const classifyEntry = (row: {
  sourceType?: string;
  category?: string | null;
  npaRole?: string | null;
  headOfAccount?: string;
  particulars?: string | null;
  receiptOrVoucherNo?: string | null;
  accountOrLoanNo?: string | null;
  credit?: number;
  debit?: number;
}): EntryKind => {
  if (row.sourceType === 'DAY_BOOK_ENTRY') return 'CASHBOOK';
  if (row.sourceType === 'CAPITAL_ENTRY') return 'CAPITAL';
  if (row.npaRole || row.category === 'NPA CLOSED' || /NPA/i.test(row.particulars || '')) return 'NPA';
  const receipt = (row.receiptOrVoucherNo || '').trim();
  const head = (row.headOfAccount || '').toUpperCase();
  const isDocOrOpening = /DOCUMENT CHARGE/.test(head) || /Opening CD Commission/i.test(row.particulars || '');
  if (Number(row.debit) > 0 && /DISBURSEMENT|PRINCIPAL/.test(head)) return 'LOAN_ISSUE';
  if (!receipt || receipt === '-' || isDocOrOpening && !receipt.startsWith('RC')) return 'LOAN_ISSUE';
  if (row.accountOrLoanNo && Number(row.credit) > 0) return 'RECEIPT';
  return 'OTHER';
};

export interface ReceiptSplit {
  id?: string;
  receiptNo: string;
  date: string;
  amount: number;
  action: 'Renew' | 'Partial' | 'Close';
  penaltyPaid: number;
  interestPaid: number;
  principalPaid: number;
  renewedDays: number;
  renewedTillDate?: string | null;
  principalAfter: number;
}

export interface ReplayResult {
  receipts: ReceiptSplit[];
  finalPrincipal: number;
  finalStatus: string;
  ledgerEntries: any[];
  interestDetails: any[];
  problems: string[];
}

const sortCollections = (rows: any[]) =>
  [...rows].sort((a, b) => {
    const d = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (d !== 0) return d;
    const r = compareReceipts(a.receipt_no || '', b.receipt_no || '');
    if (r !== 0) return r;
    const t = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    if (t !== 0) return t;
    return String(a.id).localeCompare(String(b.id));
  });

const actionOf = (remarks: string | null | undefined): 'Renew' | 'Partial' | 'Close' => {
  const low = (remarks || '').toLowerCase();
  if (low.includes('renew')) return 'Renew';
  if (low.includes('close')) return 'Close';
  return 'Partial';
};

/**
 * In-memory replay of a CD loan: same steps as cdLedgerRebuildService in FULL_RECALCULATE mode,
 * without any writing. A test keeps the two in step.
 */
export const replayCDCollections = (loan: any, ledgerRows: any[], txRows: any[]): ReplayResult => {
  const problems: string[] = [];
  const orig = ledgerRows.find(e => e.entry_type === 'original_loan');
  const disb = txRows.find(t => t.type === 'Disbursement');
  const originalPrincipal = Number(orig?.debit || disb?.amount || loan.amount || 0);
  const originalDate = orig?.entry_date || disb?.date || loan.date;
  const periodDays = (loan.period_days != null && loan.period_days !== '') ? Number(loan.period_days) : 30;
  const baseDue = financeCalculationService.addCalendarDays(originalDate, periodDays - 1);

  let principal = originalPrincipal;
  let totalRenewed = 0;
  let entries: any[] = [{ entry_type: 'original_loan', debit: originalPrincipal, entry_date: originalDate }];
  let details: any[] = [];
  const receipts: ReceiptSplit[] = [];

  for (const tx of sortCollections(txRows.filter(t => t.type === 'Collection'))) {
    const amount = Number(tx.amount) || 0;
    const receiptNo = tx.receipt_no || '';
    let action = actionOf(tx.remarks);
    const pos: any = financeCalculationService.getCDAccountPosition(loan, entries, details, tx.date);
    const interestDue = pos.accruedInterest;
    let penaltyDue = pos.accruedPenalty;
    if (loan.loan_id === 'CD091' && receiptNo === 'RC236') penaltyDue = 375.0; // same override as the rebuild

    const isClosing = action === 'Close' || amount >= interestDue + penaltyDue + principal;
    let penaltyPaid = 0;
    let interestPaid = 0;
    let principalPaid = 0;
    let renewedDays = 0;
    if (isClosing) {
      penaltyPaid = financeCalculationService.roundRupee(penaltyDue);
      interestPaid = financeCalculationService.roundRupee(interestDue);
      principalPaid = Number(Math.max(0, amount - penaltyPaid - interestPaid).toFixed(2));
      action = 'Close';
    } else {
      const split = allocateCDPayment(pos, amount, action, periodDays);
      penaltyPaid = split.penaltyPaid;
      interestPaid = split.interestPaid;
      principalPaid = split.principalPaid;
      renewedDays = split.renewedDays;
      if (renewedDays > 0 && action === 'Renew') {
        interestPaid = financeCalculationService.roundRupee(pos.dailyInterest * renewedDays);
        penaltyPaid = amount - interestPaid;
      }
    }

    if (penaltyPaid < -0.005 || interestPaid < -0.005 || principalPaid < -0.005) {
      problems.push(`Receipt ${receiptNo}: this amount gives a negative part`);
    }
    if (principalPaid > principal + 0.01) {
      problems.push(`Receipt ${receiptNo}: ${money(principalPaid - principal)} more than the principal still outstanding`);
    }
    if (principal <= 0.005 && amount > 0) {
      problems.push(`Receipt ${receiptNo}: the loan would already be fully closed before this receipt`);
    }

    let renewedTillDate: string | null = null;
    const newTotal = renewedDays > 0
      ? financeCalculationService.advanceExactRenewalPosition(totalRenewed, renewedDays)
      : totalRenewed;
    if (renewedDays > 0) {
      renewedTillDate = financeCalculationService.addCalendarDays(baseDue, financeCalculationService.calculateDisplayDays(newTotal));
    }

    const added: any[] = [{ entry_type: 'amount_paid', credit: amount, entry_date: tx.date, receipt_no: receiptNo }];
    if (penaltyPaid > 0) added.push({ entry_type: 'penalty_payment', credit: penaltyPaid, entry_date: tx.date, receipt_no: receiptNo });
    if (interestPaid > 0) added.push({ entry_type: 'interest_payment', credit: interestPaid, entry_date: tx.date, receipt_no: receiptNo });
    if (principalPaid > 0) added.push({ entry_type: 'principal_payment', credit: principalPaid, entry_date: tx.date, receipt_no: receiptNo });
    const addedDetails: any[] = [];
    if (penaltyPaid > 0) addedDetails.push({ credit: penaltyPaid, renewed_days: 0, renewed_till_date: null, row_type: 'penalty_payment', receipt_no: receiptNo });
    if (interestPaid > 0) addedDetails.push({ credit: interestPaid, renewed_days: renewedDays, renewed_till_date: renewedTillDate, row_type: 'interest_payment', receipt_no: receiptNo });
    if (principalPaid > 0) addedDetails.push({ credit: principalPaid, renewed_days: 0, renewed_till_date: null, row_type: 'principal_payment', receipt_no: receiptNo });
    if (renewedDays > 0) addedDetails.push({ credit: 0, renewed_days: renewedDays, renewed_till_date: renewedTillDate, row_type: 'Renewal', receipt_no: receiptNo });

    principal = Number(Math.max(0, principal - principalPaid).toFixed(2));
    totalRenewed = newTotal;
    entries = [...entries, ...added];
    details = [...details, ...addedDetails];
    receipts.push({
      id: tx.id, receiptNo, date: tx.date, amount, action, penaltyPaid, interestPaid, principalPaid,
      renewedDays, renewedTillDate, principalAfter: principal
    });
  }

  let finalStatus = principal <= 0 ? 'Closed' : 'Active';
  if (loan.status === 'NPA_CLOSED') finalStatus = 'NPA_CLOSED';
  return { receipts, finalPrincipal: principal, finalStatus, ledgerEntries: entries, interestDetails: details, problems };
};

export interface ReceiptChange {
  txId: string;
  /** omit to delete the receipt */
  newAmount?: number;
  newDate?: string;
  newReceiptNo?: string;
  deleted?: boolean;
}

export interface ReceiptPreview {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  before: ReceiptSplit | null;
  after: ReceiptSplit | null;
  /** later receipts of this loan whose split moves because of this change */
  laterChanged: { receiptNo: string; before: ReceiptSplit; after: ReceiptSplit }[];
  beforePrincipal: number;
  afterPrincipal: number;
  beforeStatus: string;
  afterStatus: string;
  loan: any;
  tx: any;
}

const loadLoanRows = async (loanId: string) => {
  const { data: loan, error: e1 } = await supabase.from('finance_loans').select('*').eq('id', loanId).single();
  if (e1 || !loan) throw new Error(e1?.message || 'Loan not found');
  const { data: ledger, error: e2 } = await supabase.from('finance_cd_ledger_entries').select('*').eq('loan_id', loanId);
  if (e2) throw new Error(e2.message);
  const { data: interests, error: e3 } = await supabase.from('finance_cd_interest_details').select('*').eq('loan_id', loanId);
  if (e3) throw new Error(e3.message);
  const { data: txs, error: e4 } = await supabase.from('finance_transactions').select('*').eq('loan_id', loanId);
  if (e4) throw new Error(e4.message);
  return { loan, ledger: ledger || [], interests: interests || [], txs: txs || [] };
};

/** Splits as they are saved today, by receipt */
const savedSplits = (ledger: any[]) => {
  const map = new Map<string, { penalty: number; interest: number; principal: number }>();
  for (const e of ledger) {
    if (!PAYMENT_ENTRY_TYPES.includes(e.entry_type) || e.entry_type === 'amount_paid' || !e.receipt_no) continue;
    const s = map.get(e.receipt_no) || { penalty: 0, interest: 0, principal: 0 };
    const c = Number(e.credit || 0);
    if (e.entry_type === 'penalty_payment') s.penalty += c;
    if (e.entry_type === 'interest_payment') s.interest += c;
    if (e.entry_type === 'principal_payment') s.principal += c;
    map.set(e.receipt_no, s);
  }
  return map;
};

export const findReceiptTx = async (loanId: string, receiptNo: string) => {
  const { data } = await supabase
    .from('finance_transactions')
    .select('*')
    .eq('loan_id', loanId)
    .eq('type', 'Collection')
    .eq('receipt_no', receiptNo);
  return (data || [])[0] || null;
};

/** Works out, without saving anything, exactly what a receipt change would do to the loan. */
export const previewReceiptChange = async (loanId: string, change: ReceiptChange): Promise<ReceiptPreview> => {
  const { loan, ledger, txs } = await loadLoanRows(loanId);
  const tx = txs.find((t: any) => t.id === change.txId) || null;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const empty: ReceiptPreview = {
    ok: false, blockers, warnings, before: null, after: null, laterChanged: [],
    beforePrincipal: Number(loan.amount) || 0, afterPrincipal: Number(loan.amount) || 0,
    beforeStatus: loan.status, afterStatus: loan.status, loan, tx
  };

  if (!tx) { blockers.push('This payment was not found.'); return empty; }
  if (!String(loan.loan_id || '').startsWith('CD')) {
    blockers.push('Amounts can be changed on CD loans only for now.');
    return empty;
  }
  const statusUp = (loan.status || '').trim().toUpperCase();
  if (statusUp === 'NPA_CLOSED' || statusUp === 'NPA CLOSED' || statusUp === 'NPA') {
    blockers.push('This loan is NPA closed, so its receipts are view only.');
    return empty;
  }

  let current: ReplayResult;
  try {
    current = replayCDCollections(loan, ledger, txs);
  } catch (e: any) {
    blockers.push(`This loan cannot be recalculated: ${e?.message || e}`);
    return empty;
  }

  // Guard: saved history must already match a replay, or recalculating would change other receipts
  const saved = savedSplits(ledger);
  const drift = current.receipts.filter(r => {
    const s = saved.get(r.receiptNo);
    if (!s) return true;
    return Math.abs(s.penalty - r.penaltyPaid) > 0.01 || Math.abs(s.interest - r.interestPaid) > 0.01 || Math.abs(s.principal - r.principalPaid) > 0.01;
  });
  if (drift.length > 0) {
    blockers.push(
      `Receipt ${drift.map(d => d.receiptNo).join(', ')} on this loan was saved with a different split than today's rules give. ` +
      'Recalculating would change it too, so amounts cannot be changed here until that is reviewed.'
    );
    return { ...empty, before: current.receipts.find(r => r.id === tx.id) || null };
  }

  const before = current.receipts.find(r => r.id === tx.id) || null;

  // Validate the requested change
  let edited: any[];
  if (change.deleted) {
    edited = txs.filter((t: any) => t.id !== tx.id);
  } else {
    const amt = Number(change.newAmount);
    if (!Number.isFinite(amt) || amt <= 0) blockers.push('Amount must be greater than 0.');
    const newReceipt = (change.newReceiptNo ?? tx.receipt_no ?? '').trim();
    if (!newReceipt) blockers.push('Receipt number is required.');
    if (txs.some((t: any) => t.id !== tx.id && t.receipt_no === newReceipt)) {
      blockers.push(`Receipt number ${newReceipt} is already used on this loan.`);
    }
    const newDate = change.newDate || String(tx.date).split('T')[0];
    const loanDate = String(ledger.find((e: any) => e.entry_type === 'original_loan')?.entry_date
      || txs.find((t: any) => t.type === 'Disbursement')?.date || loan.date).split('T')[0];
    if (newDate.split('T')[0] < loanDate) blockers.push('Payment date cannot be before the loan date.');
    if (blockers.length > 0) return { ...empty, before };
    edited = txs.map((t: any) => t.id === tx.id
      ? { ...t, amount: money(amt), receipt_no: newReceipt, date: newDate === String(t.date).split('T')[0] ? t.date : new Date(newDate).toISOString() }
      : t);
  }

  let next: ReplayResult;
  try {
    next = replayCDCollections(loan, ledger, edited);
  } catch (e: any) {
    blockers.push(`This change cannot be calculated: ${e?.message || e}`);
    return { ...empty, before };
  }
  blockers.push(...next.problems);

  const after = next.receipts.find(r => r.id === tx.id) || null;
  const laterChanged: ReceiptPreview['laterChanged'] = [];
  for (const b of current.receipts) {
    if (b.id === tx.id) continue;
    const a = next.receipts.find(r => r.id === b.id);
    if (a && (Math.abs(a.penaltyPaid - b.penaltyPaid) > 0.005 || Math.abs(a.interestPaid - b.interestPaid) > 0.005 || Math.abs(a.principalPaid - b.principalPaid) > 0.005)) {
      laterChanged.push({ receiptNo: b.receiptNo, before: b, after: a });
    }
  }

  if (next.finalStatus !== current.finalStatus) {
    warnings.push(next.finalStatus === 'Closed'
      ? 'This change pays the loan in full, so the loan will be marked CLOSED.'
      : 'This change leaves principal unpaid, so the closed loan will become ACTIVE again.');
  }
  if (laterChanged.length > 0) warnings.push(`${laterChanged.length} later receipt(s) on this loan will be split differently.`);

  return {
    ok: blockers.length === 0, blockers, warnings, before, after, laterChanged,
    beforePrincipal: current.finalPrincipal, afterPrincipal: next.finalPrincipal,
    beforeStatus: current.finalStatus, afterStatus: next.finalStatus, loan, tx
  };
};

/** Put a loan's rows back exactly as they were before a failed save */
const restoreLoanRows = async (loanId: string, snap: { loan: any; ledger: any[]; interests: any[]; txs: any[] }) => {
  await supabase.from('finance_cd_ledger_entries').delete().eq('loan_id', loanId);
  await supabase.from('finance_cd_interest_details').delete().eq('loan_id', loanId);
  await supabase.from('finance_transactions').delete().eq('loan_id', loanId).eq('type', 'Collection');
  if (snap.ledger.length) await supabase.from('finance_cd_ledger_entries').insert(snap.ledger);
  if (snap.interests.length) await supabase.from('finance_cd_interest_details').insert(snap.interests);
  const coll = snap.txs.filter(t => t.type === 'Collection');
  if (coll.length) await supabase.from('finance_transactions').insert(coll);
  await supabase.from('finance_loans').update({ amount: snap.loan.amount, status: snap.loan.status }).eq('id', loanId);
};

const checkSavedMatches = async (loanId: string, expected: ReplayResult) => {
  const { loan, ledger } = await loadLoanRows(loanId);
  if (Math.abs(Number(loan.amount) - expected.finalPrincipal) > 0.01) {
    throw new Error(`Saved balance ${loan.amount} does not match expected ${expected.finalPrincipal}`);
  }
  if (loan.status !== expected.finalStatus) throw new Error(`Saved status ${loan.status} does not match ${expected.finalStatus}`);
  const saved = savedSplits(ledger);
  for (const r of expected.receipts) {
    const s = saved.get(r.receiptNo) || { penalty: 0, interest: 0, principal: 0 };
    if (Math.abs(s.penalty - r.penaltyPaid) > 0.01 || Math.abs(s.interest - r.interestPaid) > 0.01 || Math.abs(s.principal - r.principalPaid) > 0.01) {
      throw new Error(`Saved split of receipt ${r.receiptNo} does not match the calculation`);
    }
    const paid = ledger.filter((e: any) => e.entry_type === 'amount_paid' && e.receipt_no === r.receiptNo)
      .reduce((a: number, e: any) => a + Number(e.credit || 0), 0);
    if (Math.abs(paid - r.amount) > 0.01) throw new Error(`Saved total of receipt ${r.receiptNo} does not match`);
  }
};

const applyReceiptChange = async (loanId: string, change: ReceiptChange, reason: string, username: string) => {
  const preview = await previewReceiptChange(loanId, change);
  if (!preview.ok) throw new Error(preview.blockers.join(' ') || 'This change is not allowed');
  const snap = await loadLoanRows(loanId);
  const tx = preview.tx;

  const edited = change.deleted
    ? snap.txs.filter((t: any) => t.id !== tx.id)
    : null;

  try {
    if (change.deleted) {
      const { error } = await supabase.from('finance_transactions').delete().eq('id', tx.id);
      if (error) throw error;
    } else {
      const newDate = change.newDate || String(tx.date).split('T')[0];
      const { error } = await supabase.from('finance_transactions').update({
        amount: money(change.newAmount as number),
        receipt_no: (change.newReceiptNo ?? tx.receipt_no ?? '').trim(),
        date: newDate === String(tx.date).split('T')[0] ? tx.date : new Date(newDate).toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', tx.id);
      if (error) throw error;
    }

    const rebuilt = await cdLedgerRebuildService.rebuildCDLoanLifecycle(loanId, 'FULL_RECALCULATE');
    if (!rebuilt.success) throw new Error(rebuilt.error || 'Recalculation failed');

    const { data: txsNow } = await supabase.from('finance_transactions').select('*').eq('loan_id', loanId);
    const expected = replayCDCollections(snap.loan, snap.ledger, edited || txsNow || []);
    await checkSavedMatches(loanId, expected);
  } catch (err) {
    await restoreLoanRows(loanId, snap);
    throw err;
  }

  // Recorded everywhere: edit history of the loan, Edited/Deleted Logs and Approvals.
  const oldValues = {
    receipt_no: tx.receipt_no, date: tx.date, amount: tx.amount, remarks: tx.remarks, type: tx.type,
    penalty_paid: preview.before?.penaltyPaid ?? 0,
    interest_paid: preview.before?.interestPaid ?? 0,
    principal_paid: preview.before?.principalPaid ?? 0,
    principal_balance: preview.beforePrincipal
  };
  const newValues = change.deleted ? { status: 'Deleted' } : {
    ...oldValues,
    receipt_no: preview.after?.receiptNo,
    date: preview.after?.date,
    amount: preview.after?.amount,
    penalty_paid: preview.after?.penaltyPaid ?? 0,
    interest_paid: preview.after?.interestPaid ?? 0,
    principal_paid: preview.after?.principalPaid ?? 0,
    principal_balance: preview.afterPrincipal
  };

  await supabaseFinance.logCDTransactionEdit({
    loanId, transactionId: tx.id, oldData: oldValues, newData: newValues, editedBy: username, reason
  });
  if (change.deleted) {
    await supabaseFinance.logDelete('finance_transactions', tx.id, {
      id: tx.id, loan_id: tx.loan_id, date: tx.date, amount: tx.amount, type: tx.type,
      collected_by: tx.collected_by, remarks: tx.remarks, receipt_no: tx.receipt_no, book_id: tx.book_id
    }, username);
  } else {
    await supabaseFinance.logEdit('finance_transactions', tx.id, oldValues, newValues, username);
  }
  // Each change gets its own Approvals row: source_id is unique there, and the entry's
  // original CREATE row already uses the transaction's id.
  const parts = change.deleted ? preview.before : preview.after;
  const logged = await supabaseFinance.logTransactionForReview({
    loanId,
    sourceType: 'Loan Payment',
    sourceId: newId(),
    receiptNo: parts?.receiptNo || tx.receipt_no,
    transactionType: change.deleted ? 'CD Collection Deletion' : 'CD Collection Edition',
    transactionDate: String(parts?.date || tx.date),
    amount: Number(parts?.amount ?? tx.amount),
    penaltyAmount: parts?.penaltyPaid ?? 0,
    interestAmount: parts?.interestPaid ?? 0,
    principalAmount: parts?.principalPaid ?? 0,
    enteredBy: username,
    actionType: change.deleted ? 'DELETE' : 'EDIT'
  });
  if (!logged) throw new Error('Saved, but the change could not be added to Approvals');
  return preview;
};

export const saveReceiptEdit = (params: {
  loanId: string; txId: string; newAmount: number; newDate?: string; newReceiptNo?: string; reason: string; username: string;
}) => {
  if (!params.reason.trim()) return Promise.reject(new Error('Reason is required'));
  return applyReceiptChange(params.loanId, {
    txId: params.txId, newAmount: params.newAmount, newDate: params.newDate, newReceiptNo: params.newReceiptNo
  }, params.reason.trim(), params.username);
};

export const deleteReceipt = (params: { loanId: string; txId: string; reason: string; username: string }) => {
  if (!params.reason.trim()) return Promise.reject(new Error('Reason is required'));
  return applyReceiptChange(params.loanId, { txId: params.txId, deleted: true }, params.reason.trim(), params.username);
};

// --- Day Book and Capital entries ---------------------------------------------------------

const logOtherForReview = (
  kind: 'Day Book' | 'Capital', action: 'EDIT' | 'DELETE', row: { date: string; amount: number }, username: string
) => supabaseFinance.logTransactionForReview({
  loanId: null,
  sourceType: 'Day Book Entry',
  sourceId: newId(),
  transactionType: `${kind} Entry ${action === 'EDIT' ? 'Edition' : 'Deletion'}`,
  transactionDate: row.date,
  amount: row.amount,
  enteredBy: username,
  actionType: action
});

export const saveCashbookEdit = async (id: string, patch: {
  entry_date: string; head_of_account: string; account_number?: string | null; particulars: string; credit: number; debit: number;
}, username: string) => {
  const saved = await supabaseFinance.updateCashbookEntry(id, patch, username);
  if (!saved) throw new Error('Could not save the Day Book entry');
  await logOtherForReview('Day Book', 'EDIT', { date: patch.entry_date, amount: Math.max(patch.credit, patch.debit) }, username);
  return saved;
};

export const deleteCashbook = async (id: string, row: { date: string; amount: number }, username: string) => {
  const ok = await supabaseFinance.deleteCashbookEntry(id, username);
  if (!ok) throw new Error('Could not delete the Day Book entry');
  await logOtherForReview('Day Book', 'DELETE', row, username);
};

export const saveCapitalEdit = async (id: string, patch: {
  entry_date: string; particulars: string; credit: number; debit: number;
}, username: string) => {
  const saved = await supabaseFinance.updateCapitalEntry(id, patch, username);
  if (!saved) throw new Error('Could not save the Capital entry');
  await logOtherForReview('Capital', 'EDIT', { date: patch.entry_date, amount: Math.max(patch.credit, patch.debit) }, username);
  return saved;
};

export const deleteCapital = async (id: string, row: { date: string; amount: number }, username: string) => {
  const ok = await supabaseFinance.deleteCapitalEntry(id, username);
  if (!ok) throw new Error('Could not delete the Capital entry');
  await logOtherForReview('Capital', 'DELETE', row, username);
};
