/**
 * HP (HIRE PURCHASE) LEDGER ENGINE: the one place where HP amounts are worked out.
 *
 * Rules (agreed with the owner 12 Nov 2026, see "HP Ledger Knowledge Base"):
 *  - Flat interest PER PERIOD on the full loan: interest per installment = loan x rate%.
 *  - Principal per installment = loan / installments (the last one takes any paise difference).
 *  - Installment 1 = principal only, taken at disbursement (paid on the loan date, no interest).
 *  - Installment N is due on loan date + (N - 1) x period days.
 *  - Days late = payment date - due date.
 *  - Late interest: unpaid amount x rate% / period days, per day.
 *  - Penalty: when an installment is still unpaid after the grace days (5), penalty% / period days
 *    per day is added, counted back from day 1, on the part still unpaid after the grace days.
 *    A part paid inside the grace days is charged late interest only.
 *  - A payment goes to the oldest installment first; inside an installment: penalty, late interest,
 *    interest, principal. Money beyond what is due goes to the principal of the next installments
 *    (interest of an installment is only taken once it is due).
 *  - Total for Close = principal not yet paid + interest of installments due and not paid +
 *    interest for the days used in the current period + unpaid late charges. Future interest waived.
 *  - NPA when the oldest unpaid installment is more than 90 days late.
 *  - Paise are kept.
 *
 * Pure functions only: the screens and the save code call these; nothing here reads the database.
 */
import { addCalendarDays, differenceInCalendarDays } from './cdLedgerEngine';

export const HP_DEFAULT_GRACE_DAYS = 5;
export const HP_NPA_DAYS = 90;

/** Round to paise; halves go away from zero. */
export function hpRound(value: number): number {
  const v = Number(value) || 0;
  const sign = v < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(v) + 1e-9) * 100)) / 100;
}

const isZero = (v: number) => Math.abs(v) < 0.005;

export interface HPContract {
  loanDate: string; // YYYY-MM-DD
  amount: number;
  installments: number;
  periodDays: number;
  interestRate: number; // % per period
  penaltyRate: number; // % per period
  graceDays: number;
  docCharges: number;
}

/**
 * From a finance_loans row. HP keeps the number of installments in duration_months
 * (as the old HP screen did) and the days between installments in period_days.
 */
export function buildHPContract(loan: any): HPContract {
  if (!loan) throw new Error('HP_ENGINE_ERROR: loan record is required');
  const num = (v: any, fallback: number) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? fallback : Number(v));
  return {
    loanDate: String(loan.date || '').split('T')[0],
    amount: num(loan.amount, 0),
    installments: Math.max(1, Math.round(num(loan.duration_months, 1))),
    periodDays: Math.max(1, Math.round(num(loan.period_days, 30))),
    interestRate: num(loan.interest_rate, 3),
    penaltyRate: num(loan.penalty_percent, 0.75),
    graceDays: Math.max(0, Math.round(num(loan.grace_days, HP_DEFAULT_GRACE_DAYS))),
    docCharges: num(loan.document_charges, 0),
  };
}

export interface HPScheduleRow {
  no: number;
  dueDate: string;
  principal: number;
  interest: number;
  amount: number;
}

export function buildHPSchedule(c: HPContract): HPScheduleRow[] {
  const n = Math.max(1, c.installments);
  const each = hpRound(c.amount / n);
  const interest = hpRound(c.amount * c.interestRate / 100);
  const rows: HPScheduleRow[] = [];
  let principalSoFar = 0;
  for (let k = 1; k <= n; k++) {
    const principal = k === n ? hpRound(c.amount - principalSoFar) : each;
    principalSoFar = hpRound(principalSoFar + principal);
    const int = k === 1 ? 0 : interest;
    rows.push({
      no: k,
      dueDate: addCalendarDays(c.loanDate, (k - 1) * c.periodDays),
      principal,
      interest: int,
      amount: hpRound(principal + int),
    });
  }
  return rows;
}

/** What is kept back on the loan date: installment 1 principal and the document charges. */
export function hpOpening(c: HPContract) {
  const first = buildHPSchedule(c)[0];
  const installment1Principal = first ? first.principal : 0;
  return {
    disbursed: hpRound(c.amount),
    installment1Principal,
    docCharges: hpRound(c.docCharges),
    netCash: hpRound(c.amount - installment1Principal - c.docCharges),
  };
}

/** Amounts shown on the loan entry form before saving. */
export function hpLoanPreview(c: HPContract) {
  const schedule = buildHPSchedule(c);
  const later = schedule.slice(1);
  const opening = hpOpening(c);
  return {
    principalPerInstallment: schedule[0]?.principal ?? 0,
    interestPerInstallment: later[0]?.interest ?? 0,
    installmentAmount: later[0]?.amount ?? schedule[0]?.amount ?? 0,
    netCash: opening.netCash,
    totalInterest: hpRound(later.reduce((s, r) => s + r.interest, 0)),
    customerPaysLater: hpRound(later.reduce((s, r) => s + r.amount, 0)),
    lastDueDate: schedule[schedule.length - 1]?.dueDate ?? c.loanDate,
    schedule,
  };
}

// ============================================================================
// Payments and replay
// ============================================================================

export type HPPaymentKind = 'payment' | 'close';

export interface HPPaymentInput {
  date: string; // YYYY-MM-DD
  amount: number;
  kind?: HPPaymentKind;
  receiptNo?: string | null;
  id?: string;
}

export interface HPSplit {
  penalty: number;
  lateInterest: number;
  interest: number;
  principal: number;
  total: number;
  /** Money that did not fit anywhere (the screens refuse such payments) */
  unallocated: number;
  /** Installment numbers this payment touched */
  installments: number[];
}

export interface HPInstallmentState extends HPScheduleRow {
  principalPaid: number;
  interestPaid: number;
  lateInterestAccrued: number;
  lateInterestPaid: number;
  penaltyAccrued: number;
  penaltyPaid: number;
  /** Date the installment was fully paid (late charges included), or null */
  clearedOn: string | null;
  // accrual bookkeeping
  lateInterestTo: string;
  penaltyStarted: boolean;
  penaltyTo: string;
}

export type HPInstallmentStatus = 'Paid' | 'Part paid' | 'Overdue' | 'Due today' | 'Upcoming';

export interface HPInstallmentView {
  no: number;
  dueDate: string;
  principal: number;
  interest: number;
  amount: number;
  paid: number; // principal + interest paid
  balance: number; // principal + interest still unpaid
  lateInterest: number; // charged so far (paid + unpaid)
  penalty: number; // charged so far (paid + unpaid)
  lateDue: number; // late interest + penalty still unpaid
  /** Total (To be paid): what is still owed on this installment = balance + unpaid late interest and penalty (0 once cleared) */
  toBePaid: number;
  daysLate: number;
  status: HPInstallmentStatus;
  clearedOn: string | null;
}

export interface HPPosition {
  asOf: string;
  contract: HPContract;
  status: 'Active' | 'Closed';
  closedOn: string | null;
  installments: HPInstallmentView[];
  installmentsTotal: number;
  installmentsPaid: number;
  principalBalance: number;
  principalPaid: number;
  interestPaid: number;
  lateInterestPaid: number;
  penaltyPaid: number;
  /** Due today: unpaid amounts of installments due on or before asOf, with their late charges */
  principalDue: number;
  interestDue: number;
  lateInterestDue: number;
  penaltyDue: number;
  totalDue: number;
  /** Interest for the days used in the running period (only charged when closing) */
  currentPeriodInterest: number;
  totalForClose: number;
  /** Days the oldest unpaid installment is late (0 when nothing is late) */
  dueDays: number;
  oldestUnpaidDueDate: string | null;
  isNPA: boolean;
  nextDue: { no: number; dueDate: string; balance: number } | null;
  splits: (HPSplit & { date: string; kind: HPPaymentKind; receiptNo: string | null; id?: string })[];
}

const unpaidOf = (s: HPInstallmentState) => hpRound(s.principal - s.principalPaid + s.interest - s.interestPaid);

function freshState(c: HPContract): HPInstallmentState[] {
  return buildHPSchedule(c).map(r => ({
    ...r,
    // installment 1 is taken at disbursement
    principalPaid: r.no === 1 ? r.principal : 0,
    interestPaid: 0,
    lateInterestAccrued: 0,
    lateInterestPaid: 0,
    penaltyAccrued: 0,
    penaltyPaid: 0,
    clearedOn: r.no === 1 ? c.loanDate : null,
    lateInterestTo: r.dueDate,
    penaltyStarted: false,
    penaltyTo: r.dueDate,
  }));
}

/** Bring one installment's late interest and penalty up to date T (amounts kept unrounded). */
function accrue(c: HPContract, s: HPInstallmentState, T: string) {
  if (s.clearedOn) return;
  if (differenceInCalendarDays(T, s.dueDate) <= 0) return;
  const U = unpaidOf(s);
  if (U <= 0) return;
  const perDayInterest = (U * c.interestRate) / 100 / c.periodDays;
  const perDayPenalty = (U * c.penaltyRate) / 100 / c.periodDays;

  const liDays = differenceInCalendarDays(T, s.lateInterestTo);
  if (liDays > 0) {
    s.lateInterestAccrued += perDayInterest * liDays;
    s.lateInterestTo = T;
  }

  const graceEnd = addCalendarDays(s.dueDate, c.graceDays);
  if (differenceInCalendarDays(T, graceEnd) > 0) {
    if (!s.penaltyStarted) {
      // Past the grace days: penalty counted back from day 1 on what is still unpaid
      s.penaltyAccrued += perDayPenalty * differenceInCalendarDays(T, s.dueDate);
      s.penaltyStarted = true;
      s.penaltyTo = T;
    } else {
      const penDays = differenceInCalendarDays(T, s.penaltyTo);
      if (penDays > 0) {
        s.penaltyAccrued += perDayPenalty * penDays;
        s.penaltyTo = T;
      }
    }
  }
}

const lateDueOf = (s: HPInstallmentState) => ({
  penalty: Math.max(0, hpRound(s.penaltyAccrued - s.penaltyPaid)),
  lateInterest: Math.max(0, hpRound(s.lateInterestAccrued - s.lateInterestPaid)),
});

function markClearedIfDone(s: HPInstallmentState, T: string) {
  if (s.clearedOn) return;
  const late = lateDueOf(s);
  if (isZero(unpaidOf(s)) && isZero(late.penalty) && isZero(late.lateInterest)) s.clearedOn = T;
}

/** Interest for the days used in the running period at date T (0 on a due date or after the last one). */
function currentPeriodInterestAt(c: HPContract, states: HPInstallmentState[], T: string): number {
  const next = states.find(s => s.no > 1 && differenceInCalendarDays(s.dueDate, T) > 0);
  if (!next) return 0;
  const prevDue = states[next.no - 2].dueDate;
  const used = differenceInCalendarDays(T, prevDue);
  if (used <= 0) return 0;
  return hpRound((next.interest * used) / c.periodDays);
}

function closeFigures(c: HPContract, states: HPInstallmentState[], T: string) {
  states.forEach(s => accrue(c, s, T));
  const principal = hpRound(states.reduce((a, s) => a + (s.principal - s.principalPaid), 0));
  const dueInterest = hpRound(states
    .filter(s => s.no > 1 && differenceInCalendarDays(T, s.dueDate) >= 0)
    .reduce((a, s) => a + (s.interest - s.interestPaid), 0));
  const current = currentPeriodInterestAt(c, states, T);
  const penalty = hpRound(states.reduce((a, s) => a + lateDueOf(s).penalty, 0));
  const lateInterest = hpRound(states.reduce((a, s) => a + lateDueOf(s).lateInterest, 0));
  const interest = hpRound(dueInterest + current);
  return { principal, interest, dueInterest, current, penalty, lateInterest, total: hpRound(principal + interest + penalty + lateInterest) };
}

function applyPayment(c: HPContract, states: HPInstallmentState[], T: string, amount: number): HPSplit {
  let X = hpRound(amount);
  const split: HPSplit = { penalty: 0, lateInterest: 0, interest: 0, principal: 0, total: X, unallocated: 0, installments: [] };
  const take = (want: number) => {
    const a = Math.max(0, Math.min(X, hpRound(want)));
    X = hpRound(X - a);
    return a;
  };

  // 1. Installments already due, oldest first: penalty, late interest, interest, principal
  for (const s of states) {
    if (X <= 0) break;
    if (s.clearedOn || differenceInCalendarDays(T, s.dueDate) < 0) continue;
    accrue(c, s, T);
    const late = lateDueOf(s);
    const pen = take(late.penalty);
    const li = take(late.lateInterest);
    const int = take(s.interest - s.interestPaid);
    const pr = take(s.principal - s.principalPaid);
    if (pen + li + int + pr > 0) split.installments.push(s.no);
    s.penaltyPaid = hpRound(s.penaltyPaid + pen);
    s.lateInterestPaid = hpRound(s.lateInterestPaid + li);
    s.interestPaid = hpRound(s.interestPaid + int);
    s.principalPaid = hpRound(s.principalPaid + pr);
    split.penalty = hpRound(split.penalty + pen);
    split.lateInterest = hpRound(split.lateInterest + li);
    split.interest = hpRound(split.interest + int);
    split.principal = hpRound(split.principal + pr);
    markClearedIfDone(s, T);
  }

  // 2. Money left over: principal of the next installments (their interest is not due yet)
  for (const s of states) {
    if (X <= 0) break;
    if (s.clearedOn || differenceInCalendarDays(T, s.dueDate) >= 0) continue;
    const pr = take(s.principal - s.principalPaid);
    if (pr > 0) split.installments.push(s.no);
    s.principalPaid = hpRound(s.principalPaid + pr);
    split.principal = hpRound(split.principal + pr);
  }

  split.unallocated = X;
  return split;
}

function applyClose(c: HPContract, states: HPInstallmentState[], T: string, amount: number): HPSplit {
  const f = closeFigures(c, states, T);
  const total = hpRound(amount);
  const split: HPSplit = {
    penalty: f.penalty,
    lateInterest: f.lateInterest,
    interest: f.interest,
    principal: f.principal,
    total,
    unallocated: hpRound(total - f.total),
    installments: states.filter(s => !s.clearedOn).map(s => s.no),
  };
  // The running period's installment gets the interest for the days used; later ones are waived
  const running = states.find(s => !s.clearedOn && differenceInCalendarDays(T, s.dueDate) < 0);
  if (running) running.interestPaid = hpRound(running.interestPaid + f.current);
  for (const s of states) {
    if (s.clearedOn) continue;
    s.penaltyPaid = hpRound(s.penaltyAccrued);
    s.lateInterestPaid = hpRound(s.lateInterestAccrued);
    s.principalPaid = s.principal;
    if (differenceInCalendarDays(T, s.dueDate) >= 0) s.interestPaid = s.interest;
    s.clearedOn = T;
  }
  return split;
}

const byDate = (a: HPPaymentInput, b: HPPaymentInput) => differenceInCalendarDays(a.date, b.date);

/**
 * Replays every payment in date order and returns the account as it stands on asOf.
 * Payments dated after asOf are left out.
 */
export function computeHPPosition(contractOrLoan: HPContract | any, payments: HPPaymentInput[], asOf: string): HPPosition {
  const c: HPContract = 'installments' in (contractOrLoan || {}) && 'loanDate' in contractOrLoan
    ? contractOrLoan
    : buildHPContract(contractOrLoan);
  const states = freshState(c);
  const splits: HPPosition['splits'] = [];
  let closedOn: string | null = null;

  const list = (payments || [])
    .filter(p => p && Number(p.amount) > 0 && differenceInCalendarDays(asOf, p.date) >= 0)
    .slice()
    .sort(byDate);

  for (const p of list) {
    if (closedOn) {
      splits.push({ penalty: 0, lateInterest: 0, interest: 0, principal: 0, total: hpRound(p.amount), unallocated: hpRound(p.amount), installments: [], date: p.date, kind: p.kind || 'payment', receiptNo: p.receiptNo ?? null, id: p.id });
      continue;
    }
    const kind: HPPaymentKind = p.kind || 'payment';
    const split = kind === 'close' ? applyClose(c, states, p.date, p.amount) : applyPayment(c, states, p.date, p.amount);
    splits.push({ ...split, date: p.date, kind, receiptNo: p.receiptNo ?? null, id: p.id });
    if (kind === 'close' || states.every(s => s.clearedOn)) closedOn = p.date;
  }

  // Bring everything up to asOf for display
  if (!closedOn) states.forEach(s => accrue(c, s, asOf));

  const views: HPInstallmentView[] = states.map(s => {
    const late = lateDueOf(s);
    const balance = Math.max(0, unpaidOf(s));
    const daysFromDue = differenceInCalendarDays(asOf, s.dueDate);
    let status: HPInstallmentStatus;
    if (s.clearedOn) status = 'Paid';
    else if (daysFromDue > 0) status = 'Overdue';
    else if (daysFromDue === 0) status = 'Due today';
    else if (s.principalPaid > 0 || s.interestPaid > 0) status = 'Part paid';
    else status = 'Upcoming';
    const daysLate = s.clearedOn
      ? Math.max(0, differenceInCalendarDays(s.clearedOn, s.dueDate))
      : Math.max(0, daysFromDue);
    return {
      no: s.no, dueDate: s.dueDate, principal: s.principal, interest: s.interest, amount: s.amount,
      paid: hpRound(s.principalPaid + s.interestPaid),
      balance,
      lateInterest: hpRound(s.lateInterestAccrued),
      penalty: hpRound(s.penaltyAccrued),
      lateDue: hpRound(late.penalty + late.lateInterest),
      toBePaid: s.clearedOn ? 0 : hpRound(balance + late.penalty + late.lateInterest),
      daysLate,
      status,
      clearedOn: s.clearedOn,
    };
  });

  const dueNow = states.filter(s => !s.clearedOn && differenceInCalendarDays(asOf, s.dueDate) >= 0);
  const principalDue = hpRound(dueNow.reduce((a, s) => a + (s.principal - s.principalPaid), 0));
  const interestDue = hpRound(dueNow.reduce((a, s) => a + (s.interest - s.interestPaid), 0));
  const lateInterestDue = hpRound(states.reduce((a, s) => a + lateDueOf(s).lateInterest, 0));
  const penaltyDue = hpRound(states.reduce((a, s) => a + lateDueOf(s).penalty, 0));

  const oldestUnpaid = states.find(s => !s.clearedOn && differenceInCalendarDays(asOf, s.dueDate) > 0);
  const dueDays = oldestUnpaid ? differenceInCalendarDays(asOf, oldestUnpaid.dueDate) : 0;
  const next = states.find(s => !s.clearedOn);

  const close = closedOn
    ? { total: 0, current: 0 }
    : closeFigures(c, states.map(s => ({ ...s })), asOf);

  return {
    asOf,
    contract: c,
    status: closedOn ? 'Closed' : 'Active',
    closedOn,
    installments: views,
    installmentsTotal: states.length,
    installmentsPaid: states.filter(s => s.clearedOn).length,
    principalBalance: hpRound(states.reduce((a, s) => a + (s.principal - s.principalPaid), 0)),
    principalPaid: hpRound(states.reduce((a, s) => a + s.principalPaid, 0)),
    interestPaid: hpRound(states.reduce((a, s) => a + s.interestPaid, 0)),
    lateInterestPaid: hpRound(states.reduce((a, s) => a + s.lateInterestPaid, 0)),
    penaltyPaid: hpRound(states.reduce((a, s) => a + s.penaltyPaid, 0)),
    principalDue,
    interestDue,
    lateInterestDue: closedOn ? 0 : lateInterestDue,
    penaltyDue: closedOn ? 0 : penaltyDue,
    totalDue: closedOn ? 0 : hpRound(principalDue + interestDue + lateInterestDue + penaltyDue),
    currentPeriodInterest: close.current,
    totalForClose: close.total,
    dueDays: closedOn ? 0 : dueDays,
    oldestUnpaidDueDate: closedOn ? null : (oldestUnpaid ? oldestUnpaid.dueDate : null),
    isNPA: !closedOn && dueDays > HP_NPA_DAYS,
    nextDue: next && !closedOn ? { no: next.no, dueDate: next.dueDate, balance: Math.max(0, unpaidOf(next)) } : null,
    splits,
  };
}

/**
 * Works out how a new payment would be split, after the payments already on the account.
 * Refuses dates before the loan date or before the last payment (payments must be entered in order),
 * and amounts that would pay off the loan (those must use Close Account).
 */
export function previewHPPayment(
  loanOrContract: HPContract | any,
  existing: HPPaymentInput[],
  payment: HPPaymentInput
): { ok: true; split: HPSplit; before: HPPosition; after: HPPosition } | { ok: false; error: string; before?: HPPosition } {
  const c: HPContract = 'installments' in (loanOrContract || {}) && 'loanDate' in loanOrContract ? loanOrContract : buildHPContract(loanOrContract);
  const amount = hpRound(payment.amount);
  let kind: HPPaymentKind = payment.kind || 'payment';
  if (!(amount > 0)) return { ok: false, error: 'Enter an amount above 0.' };
  if (!payment.date) return { ok: false, error: 'Enter the payment date.' };
  if (differenceInCalendarDays(payment.date, c.loanDate) < 0) return { ok: false, error: 'The payment date is before the loan date.' };
  const last = (existing || []).filter(p => Number(p.amount) > 0).map(p => p.date).sort().pop();
  if (last && differenceInCalendarDays(payment.date, last) < 0) {
    return { ok: false, error: `The payment date is before the last payment (${last}). Payments must be entered in date order.` };
  }
  const before = computeHPPosition(c, existing, payment.date);
  if (before.status === 'Closed') return { ok: false, error: 'This account is already closed.', before };

  // A payment of exactly the Total for Close closes the account (same split either way)
  if (kind === 'payment' && Math.abs(amount - before.totalForClose) <= 0.009) kind = 'close';

  if (kind === 'close') {
    if (Math.abs(amount - before.totalForClose) > 0.009) {
      return { ok: false, error: `To close, the amount must be the Total for Close: ${before.totalForClose.toFixed(2)}.`, before };
    }
  } else {
    if (amount > before.totalForClose) {
      return { ok: false, error: `The amount is more than the Total for Close (${before.totalForClose.toFixed(2)}).`, before };
    }
    // Paying off every rupee of principal without the Close step would leave only future interest
    const payoff = hpRound(before.principalBalance + before.interestDue + before.lateInterestDue + before.penaltyDue);
    if (amount >= payoff - 0.009) {
      return { ok: false, error: `This amount pays off the loan. Use Close Account (Total for Close ${before.totalForClose.toFixed(2)}).`, before };
    }
  }

  const after = computeHPPosition(c, [...(existing || []), { ...payment, amount, kind }], payment.date);
  const split = after.splits[after.splits.length - 1];
  if (split.unallocated > 0.009) return { ok: false, error: 'The amount is more than this account can take.', before };
  return { ok: true, split, before, after };
}

// ============================================================================
// Receipt text: the Day Book reads the split from these remarks
// ============================================================================

const money = (v: number) => hpRound(v).toFixed(2);

export const HP_OPENING_PREFIX = 'HP Opening';
export const HP_COLLECTION_PREFIX = 'HP Collection';
export const HP_CLOSE_PREFIX = 'HP Close';

/** Remarks for the loan-date row: installment 1 principal and document charges kept back. */
export function hpOpeningRemarks(c: HPContract): string {
  const o = hpOpening(c);
  const parts = [`Prin: ${money(o.installment1Principal)}`];
  if (o.docCharges > 0) parts.push(`Doc Charges: ${money(o.docCharges)}`);
  return `${HP_OPENING_PREFIX} - Installment 1 kept at disbursement (${parts.join(', ')})`;
}

/** Remarks for a receipt. Interest = installment interest + late interest; Pen = penalty. */
export function hpReceiptRemarks(kind: HPPaymentKind, receiptNo: string, split: HPSplit): string {
  const prefix = kind === 'close' ? HP_CLOSE_PREFIX : HP_COLLECTION_PREFIX;
  return `${prefix} - ${receiptNo} (Prin: ${money(split.principal)}, Interest: ${money(split.interest + split.lateInterest)}, Pen: ${money(split.penalty)})`;
}

export const HP_NPA_PREFIX = 'HP NPA';

export function isHPOpeningRow(tx: any): boolean {
  return String(tx?.remarks || '').trim().startsWith(HP_OPENING_PREFIX);
}

/**
 * Turns the loan's finance_transactions into engine payments. Skips the disbursement, the opening
 * row and NPA settlement rows (an NPA close ends the account outside the installment rules).
 */
export function hpPaymentsFromTransactions(txs: any[]): HPPaymentInput[] {
  return (txs || [])
    .filter(t => t && t.type === 'Collection' && !isHPOpeningRow(t) && Number(t.amount) > 0
      && !String(t.remarks || '').trim().startsWith(HP_NPA_PREFIX))
    .map(t => ({
      id: t.id,
      date: String(t.date || '').split('T')[0],
      amount: Number(t.amount),
      receiptNo: t.receipt_no || null,
      kind: String(t.remarks || '').trim().startsWith(HP_CLOSE_PREFIX) ? 'close' as const : 'payment' as const,
    }));
}
