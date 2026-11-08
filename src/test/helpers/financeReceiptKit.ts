/**
 * Shared by the receipt-edit tests: reads a loan's figures the way every screen does, and builds
 * an independent "ground truth" by entering payments one by one through the real entry flow.
 */
import { supabaseFinance } from '../../lib/supabaseFinance';
import { financeCalculationService } from '../../services/financeCalculationService';
import { allocateCDPayment } from '../../services/cdLedgerEngine';
import { cdLedgerRebuildService } from '../../services/cdLedgerRebuildService';
import { cdCompoundInterestEngine } from '../../services/cdCompoundInterestEngine';
import { dailyFinancialTransactionService } from '../../services/dailyFinancialTransactionService';
import { normalizeCDLedgerEntries } from '../../utils/cdLedgerNormalize';

const r2 = (n: number) => Number((Number(n) || 0).toFixed(2));

/** Every figure the screens show for one loan: CD Ledger, Day Book, P&L, General Ledger, CI, Dues */
export const loanFigures = async (db: any, loanId: string, asOf: string) => {
  const loan = db.tables.finance_loans.find((l: any) => l.id === loanId);
  const rows = normalizeCDLedgerEntries(await supabaseFinance.getCDLedgerEntries(loanId));
  const ints = await supabaseFinance.getCDInterestDetails(loanId);
  const p: any = financeCalculationService.getCDAccountPosition(loan, rows, ints, asOf);
  const sum = (t: string) => r2(rows.filter((e: any) => e.entry_type === t).reduce((a: number, e: any) => a + Number(e.credit || 0), 0));

  const day = await dailyFinancialTransactionService.getDailyFinancialTransactions({ fromDate: '2000-01-01', toDate: asOf, financeMode: 'REGULAR' });
  const mine = day.filter(d => d.accountOrLoanNo === loan.loan_id);
  const dayBook = mine
    .map(d => `${String(d.transactionDate).slice(0, 10)}|${d.receiptOrVoucherNo || ''}|${d.headOfAccount}|${r2(d.credit)}|${r2(d.debit)}`)
    .sort();
  const heads: Record<string, { credit: number; debit: number; cls: string }> = {};
  mine.forEach(d => {
    const h = heads[d.headOfAccount] || { credit: 0, debit: 0, cls: d.reportClassification };
    h.credit = r2(h.credit + d.credit);
    h.debit = r2(h.debit + d.debit);
    heads[d.headOfAccount] = h;
  });

  const disb = rows.find((e: any) => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
  const ci: any = cdCompoundInterestEngine.calculateCITimeline(
    {
      id: loan.id, loan_id: loan.loan_id, amount: Number(disb?.debit) || Number(loan.amount) || 0,
      date: String(disb?.entry_date || loan.date).split('T')[0], interest_rate: Number(loan.interest_rate) || 3,
      status: loan.status, closed_at: loan.closed_at || null
    } as any,
    rows as any,
    asOf
  );

  const dues = await supabaseFinance.getDuesLedgerSummary(asOf, [loanId]);
  const due: any = (dues.dues || [])[0] || {};

  return {
    status: loan.status,
    loanAmount: r2(loan.amount),
    principalBalance: r2(p.principalBalance),
    accruedInterest: r2(p.accruedInterest),
    accruedPenalty: r2(p.accruedPenalty),
    todayDue: r2(p.todayDue),
    totalForClose: r2(p.totalForClose),
    dueDate: p.dueDateStr,
    dueDays: p.displayDueDays,
    totalPaid: sum('amount_paid'),
    interestPaid: sum('interest_payment'),
    penaltyPaid: sum('penalty_payment'),
    principalPaid: sum('principal_payment'),
    totalCredit: r2(rows.filter((e: any) => e.entry_type !== 'amount_paid').reduce((a: number, e: any) => a + Number(e.credit || 0), 0)),
    totalDebit: r2(rows.filter((e: any) => e.entry_type !== 'amount_paid').reduce((a: number, e: any) => a + Number(e.debit || 0), 0)),
    dayBook,
    plHeads: Object.fromEntries(Object.entries(heads).filter(([, v]) => v.cls === 'PROFIT_AND_LOSS')),
    glHeads: heads,
    ciFinal: r2(ci.summary?.finalCompoundBalance),
    ciEarned: r2(ci.summary?.compoundInterestEarned),
    ciPayments: r2(ci.summary?.totalPaymentsReceived),
    ciRows: (ci.reportRows || []).map((x: any) => `${x.date}|${x.payment}|${x.futureValue}`),
    duesRow: {
      principal: r2(due.current_principal), pendingInterest: r2(due.pending_interest), penalty: r2(due.penalty),
      presentDue: r2(due.present_due), dueDays: due.due_days, closing: r2(due.closing_amount),
      interestPaid: r2(due.interest_paid), penaltyPaid: r2(due.penalty_paid), totalPaid: r2(due.total_paid)
    }
  };
};

/**
 * Ground truth: an empty loan, then each payment entered in date order exactly as the CD Ledger
 * screen enters it (position -> allocateCDPayment -> postCdLedgerPayment -> rebuild).
 */
export const enterPaymentsLikeCDLedger = async (
  db: any,
  loanId: string,
  payments: { receiptNo: string; date: string; amount: number; action: 'Renew' | 'Partial' | 'Close'; userName?: string }[]
) => {
  const loan = db.tables.finance_loans.find((l: any) => l.id === loanId);
  const period = (loan.period_days != null && loan.period_days !== '') ? Number(loan.period_days) : 30;
  const ordered = [...payments].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    || a.receiptNo.localeCompare(b.receiptNo, undefined, { numeric: true }));
  for (const pay of ordered) {
    const fresh = db.tables.finance_loans.find((l: any) => l.id === loanId);
    const rows = normalizeCDLedgerEntries(await supabaseFinance.getCDLedgerEntries(loanId));
    const ints = await supabaseFinance.getCDInterestDetails(loanId);
    const pos: any = financeCalculationService.getCDAccountPosition(fresh, rows, ints, pay.date);
    const total = pos.principalBalance + Math.max(0, pos.accruedInterest) + pos.accruedPenalty;
    const closing = pay.action === 'Close' || pay.amount >= total;
    const split = allocateCDPayment(pos, pay.amount, closing ? 'Close' : pay.action, period);
    const res = await supabaseFinance.postCdLedgerPayment({
      loanId, customerId: fresh.customer_id, accountName: null, userName: pay.userName || 'TESTER',
      actionType: pay.action, principalPaid: split.principalPaid, interestPaid: split.interestPaid,
      penaltyPaid: split.penaltyPaid, renewedDays: split.renewedDays, paymentDate: pay.date, receiptNo: pay.receiptNo
    });
    if (!res.success) throw new Error(res.error);
    const rb = await cdLedgerRebuildService.rebuildCDLoanLifecycle(loanId, 'FULL_RECALCULATE');
    if (!rb.success) throw new Error(rb.error);
  }
};
