/**
 * HP Ledger engine: every worked example in the "HP Ledger Knowledge Base" (12 Nov 2026).
 */
import { describe, it, expect } from 'vitest';
import {
  buildHPContract, buildHPSchedule, hpOpening, hpLoanPreview, computeHPPosition, previewHPPayment,
  hpReceiptRemarks, hpOpeningRemarks, hpPaymentsFromTransactions, HPPaymentInput
} from '../services/hpLedgerEngine';
import { extractLoanPaymentSplits } from '../services/dailyFinancialTransactionService';

// Example A: 1,00,000; 10 installments; every 30 days; 3% and 0.75% per period; doc 1,000; 1 Nov 2026
const loanA = {
  date: '2026-11-01', amount: 100000, duration_months: 10, period_days: 30,
  interest_rate: 3, penalty_percent: 0.75, grace_days: 5, document_charges: 1000
};
// Example B: same loan, every 15 days
const loanB = { ...loanA, period_days: 15 };

const A = buildHPContract(loanA);
const B = buildHPContract(loanB);
const pay = (date: string, amount: number, kind: 'payment' | 'close' = 'payment'): HPPaymentInput => ({ date, amount, kind });
const inst = (pos: ReturnType<typeof computeHPPosition>, no: number) => pos.installments.find(i => i.no === no)!;

describe('Schedule and loan date', () => {
  it('Example A: 10,000 kept at disbursement, then 13,000 every 30 days', () => {
    const s = buildHPSchedule(A);
    expect(s.map(r => `${r.no}|${r.dueDate}|${r.principal}|${r.interest}|${r.amount}`)).toEqual([
      '1|2026-11-01|10000|0|10000',
      '2|2026-12-01|10000|3000|13000',
      '3|2026-12-31|10000|3000|13000',
      '4|2027-01-30|10000|3000|13000',
      '5|2027-03-01|10000|3000|13000',
      '6|2027-03-31|10000|3000|13000',
      '7|2027-04-30|10000|3000|13000',
      '8|2027-05-30|10000|3000|13000',
      '9|2027-06-29|10000|3000|13000',
      '10|2027-07-29|10000|3000|13000',
    ]);
  });

  it('Example A: cash to the customer 89,000; pays 1,17,000 later; interest 27,000', () => {
    expect(hpOpening(A)).toEqual({ disbursed: 100000, installment1Principal: 10000, docCharges: 1000, netCash: 89000 });
    const p = hpLoanPreview(A);
    expect(p.installmentAmount).toBe(13000);
    expect(p.customerPaysLater).toBe(117000);
    expect(p.totalInterest).toBe(27000);
    expect(p.lastDueDate).toBe('2027-07-29');
  });

  it('Example B (15 days): 13,000 every 15 days, 16 Nov, 1 Dec ... 16 Mar 2027', () => {
    const s = buildHPSchedule(B);
    expect(s[1]).toMatchObject({ dueDate: '2026-11-16', amount: 13000 });
    expect(s[2].dueDate).toBe('2026-12-01');
    expect(s[9].dueDate).toBe('2027-03-16');
    expect(hpLoanPreview(B).totalInterest).toBe(27000);
  });

  it('interest is per period: 10 installments every 15 days at 3% = 13,000, not 5,150 or 6,500', () => {
    expect(hpLoanPreview(B).interestPerInstallment).toBe(3000);
  });

  it('a loan that does not divide evenly: the last installment takes the paise', () => {
    const s = buildHPSchedule(buildHPContract({ ...loanA, duration_months: 3 }));
    expect(s.map(r => r.principal)).toEqual([33333.33, 33333.33, 33333.34]);
  });

  it('a new loan: installment 1 paid, 1 of 10, principal balance 90,000', () => {
    const pos = computeHPPosition(A, [], '2026-11-01');
    expect(pos.installmentsPaid).toBe(1);
    expect(pos.installmentsTotal).toBe(10);
    expect(pos.principalBalance).toBe(90000);
    expect(pos.totalDue).toBe(0);
    expect(pos.nextDue).toEqual({ no: 2, dueDate: '2026-12-01', balance: 13000 });
  });
});

describe('Late payment (installment 2 = 13,000 due 1 Dec 2026)', () => {
  const dueOn = (date: string) => computeHPPosition(A, [], date).totalDue;

  it('on time 13,000; 3 days 13,039; 5 days 13,065; 6 days 13,097.50', () => {
    expect(dueOn('2026-12-01')).toBe(13000);
    expect(dueOn('2026-12-04')).toBe(13039);
    expect(dueOn('2026-12-06')).toBe(13065);
    expect(dueOn('2026-12-07')).toBe(13097.5);
  });

  it('6 days late: 78 late interest + 19.50 penalty, paid first', () => {
    const r = previewHPPayment(A, [], pay('2026-12-07', 13097.5));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.split).toMatchObject({ penalty: 19.5, lateInterest: 78, interest: 3000, principal: 10000, unallocated: 0 });
    expect(inst(r.after, 2).status).toBe('Paid');
    expect(r.after.installmentsPaid).toBe(2);
  });

  it('3 days late: 39 late interest, no penalty', () => {
    const r = previewHPPayment(A, [], pay('2026-12-04', 13039));
    expect(r.ok && r.split).toMatchObject({ penalty: 0, lateInterest: 39, interest: 3000, principal: 10000 });
  });

  it('15-day period: 3 days late 78, 6 days late 195 (rate / 15 days)', () => {
    const p3 = computeHPPosition(B, [], '2026-11-19');
    expect(p3.lateInterestDue).toBe(78);
    expect(p3.penaltyDue).toBe(0);
    const p6 = computeHPPosition(B, [], '2026-11-22');
    expect(p6.lateInterestDue + p6.penaltyDue).toBe(195);
    expect(p6.penaltyDue).toBe(39);
  });

  it('two missed, paid together on 10 Jan 2027: 650 + 162.50, total 26,812.50', () => {
    const before = computeHPPosition(A, [], '2027-01-10');
    expect(inst(before, 2).lateDue).toBe(650);
    expect(inst(before, 3).lateDue).toBe(162.5);
    expect(before.totalDue).toBe(26812.5);
    const r = previewHPPayment(A, [], pay('2027-01-10', 26812.5));
    expect(r.ok && r.split).toMatchObject({ penalty: 162.5, lateInterest: 650, interest: 6000, principal: 20000 });
  });

  it('part payment: 8,000 on time, rest 10 days late: late charge on the 5,000 only = 62.50', () => {
    const pos = computeHPPosition(A, [pay('2026-12-01', 8000)], '2026-12-11');
    expect(inst(pos, 2).balance).toBe(5000);
    expect(inst(pos, 2).lateDue).toBe(62.5);
    expect(pos.totalDue).toBe(5062.5);
  });

  it('part paid inside grace keeps 3%: 8,000 cleared on 4 Dec, 5,000 on 11 Dec, late charges 86.50', () => {
    // 8,039 on 4 Dec = 39 late interest (3 days on 13,000) + 8,000 of the installment
    const pos = computeHPPosition(A, [pay('2026-12-04', 8039)], '2026-12-11');
    const i2 = inst(pos, 2);
    expect(i2.balance).toBe(5000);
    expect(i2.lateInterest + i2.penalty).toBe(86.5); // 24 + 15 + 35 late interest, 12.50 penalty
    expect(i2.penalty).toBe(12.5);
  });

  it('a payment smaller than the late charges pays penalty first, then late interest', () => {
    const r = previewHPPayment(A, [], pay('2026-12-07', 50));
    expect(r.ok && r.split).toMatchObject({ penalty: 19.5, lateInterest: 30.5, interest: 0, principal: 0 });
  });
});

describe('Extra payment, close and NPA', () => {
  it('extra money goes to the next installment: 15,000 on 1 Dec, installment 3 needs 11,000', () => {
    const pos = computeHPPosition(A, [pay('2026-12-01', 15000)], '2026-12-01');
    expect(inst(pos, 2).status).toBe('Paid');
    expect(inst(pos, 3).balance).toBe(11000);
    expect(pos.nextDue).toEqual({ no: 3, dueDate: '2026-12-31', balance: 11000 });
  });

  it('Total for Close on 20 Dec (installment 2 paid on time): 80,000 + 1,900 = 81,900', () => {
    const paid = [pay('2026-12-01', 13000)];
    const pos = computeHPPosition(A, paid, '2026-12-20');
    expect(pos.currentPeriodInterest).toBe(1900);
    expect(pos.totalForClose).toBe(81900);
    const r = previewHPPayment(A, paid, pay('2026-12-20', 81900, 'close'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.split).toMatchObject({ principal: 80000, interest: 1900, penalty: 0, lateInterest: 0, unallocated: 0 });
    expect(r.after.status).toBe('Closed');
    expect(r.after.installmentsPaid).toBe(10);
    expect(r.after.principalBalance).toBe(0);
  });

  it('15-day close 10 days into a period: interest for the days used = 2,000', () => {
    const pos = computeHPPosition(B, [pay('2026-11-16', 13000)], '2026-11-26');
    expect(pos.currentPeriodInterest).toBe(2000);
    expect(pos.totalForClose).toBe(82000);
  });

  it('Total for Close with an overdue installment adds its interest and late charges', () => {
    const pos = computeHPPosition(A, [], '2026-12-20');
    // 90,000 principal + 3,000 interest of installment 2 + 1,900 for 19 days + late charges for 19 days
    expect(pos.totalForClose).toBe(90000 + 3000 + 1900 + 308.75);
  });

  it('paying exactly the Total for Close is treated as a close', () => {
    const r = previewHPPayment(A, [pay('2026-12-01', 13000)], pay('2026-12-20', 81900));
    expect(r.ok && r.after.status).toBe('Closed');
  });

  it('paying the last installment on its due date closes the account', () => {
    const paid = ['2026-12-01', '2026-12-31', '2027-01-30', '2027-03-01', '2027-03-31', '2027-04-30', '2027-05-30', '2027-06-29']
      .map(d => pay(d, 13000));
    const r = previewHPPayment(A, paid, pay('2027-07-29', 13000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.after.status).toBe('Closed');
    expect(r.after.interestPaid).toBe(27000);
    expect(r.after.principalPaid).toBe(100000);
  });

  it('NPA: still active after 90 days (1 Mar 2027), NPA from 2 Mar 2027', () => {
    expect(computeHPPosition(A, [], '2027-03-01')).toMatchObject({ dueDays: 90, isNPA: false });
    expect(computeHPPosition(A, [], '2027-03-02')).toMatchObject({ dueDays: 91, isNPA: true });
  });
});

describe('What the payment screen refuses', () => {
  it('a date before the loan date', () => {
    expect(previewHPPayment(A, [], pay('2026-10-31', 100)).ok).toBe(false);
  });
  it('a date before the last payment', () => {
    const r = previewHPPayment(A, [pay('2026-12-10', 13000)], pay('2026-12-05', 100));
    expect(r.ok).toBe(false);
  });
  it('an amount that pays off every rupee of principal without closing', () => {
    const r = previewHPPayment(A, [pay('2026-12-01', 13000)], pay('2026-12-20', 80000));
    expect(r.ok).toBe(false);
  });
  it('more than the Total for Close', () => {
    expect(previewHPPayment(A, [pay('2026-12-01', 13000)], pay('2026-12-20', 90000)).ok).toBe(false);
  });
  it('a close amount that is not the Total for Close', () => {
    expect(previewHPPayment(A, [pay('2026-12-01', 13000)], pay('2026-12-20', 80000, 'close')).ok).toBe(false);
  });
  it('any payment after the account is closed', () => {
    const r = previewHPPayment(A, [pay('2026-12-01', 13000), pay('2026-12-20', 81900, 'close')], pay('2026-12-21', 100));
    expect(r.ok).toBe(false);
  });
});

describe('Receipt text read by the Day Book', () => {
  it('a receipt splits into principal, interest (with late interest) and penalty', () => {
    const r = previewHPPayment(A, [], pay('2026-12-07', 13097.5));
    if (!r.ok) throw new Error(r.error);
    const remarks = hpReceiptRemarks('payment', 'RC900', r.split);
    expect(remarks).toBe('HP Collection - RC900 (Prin: 10000.00, Interest: 3078.00, Pen: 19.50)');
    expect(extractLoanPaymentSplits({ amount: 13097.5, remarks })).toEqual({ principal: 10000, interest: 3078, penalty: 19.5, docCharges: 0 });
  });

  it('the loan-date row: installment 1 principal and document charges', () => {
    const remarks = hpOpeningRemarks(A);
    expect(extractLoanPaymentSplits({ amount: 11000, remarks })).toEqual({ principal: 10000, interest: 0, penalty: 0, docCharges: 1000 });
  });

  it('reading payments back: skips the disbursement, the opening row and NPA rows; knows a close', () => {
    const txs = [
      { id: 'd', type: 'Disbursement', amount: 100000, date: '2026-11-01', remarks: 'Loan disbursed' },
      { id: 'o', type: 'Collection', amount: 11000, date: '2026-11-01', remarks: hpOpeningRemarks(A) },
      { id: 'p', type: 'Collection', amount: 13000, date: '2026-12-01', receipt_no: 'RC1', remarks: 'HP Collection - RC1 (Prin: 10000.00, Interest: 3000.00, Pen: 0.00)' },
      { id: 'c', type: 'Collection', amount: 81900, date: '2026-12-20', receipt_no: 'RC2', remarks: 'HP Close - RC2 (Prin: 80000.00, Interest: 1900.00, Pen: 0.00)' },
      { id: 'n', type: 'Collection', amount: 500, date: '2026-12-21', remarks: 'HP NPA Settlement Collection - RC3 (Prin: 500)' },
    ];
    expect(hpPaymentsFromTransactions(txs)).toEqual([
      { id: 'p', date: '2026-12-01', amount: 13000, receiptNo: 'RC1', kind: 'payment' },
      { id: 'c', date: '2026-12-20', amount: 81900, receiptNo: 'RC2', kind: 'close' },
    ]);
  });
});
