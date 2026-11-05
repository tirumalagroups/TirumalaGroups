/**
 * CD COMPOUND INTEREST (CI) DISPLAY ENGINE
 * ====================================================
 * TIMELINE-BASED 30-DAY COMPOUND INTEREST ENGINE
 * 
 * IMPORTANT:
 * This engine is PURELY READ-ONLY and INFORMATIONAL.
 * It NEVER modifies:
 *   - Database tables
 *   - Ledger entries
 *   - Interest Due / Penalty / Renewal calculations
 *   - Payment Splits or Closures
 *   - FinanceCalculationEngine
 *
 * CALCULATION RULES (Time-Based 30-Day Cycles):
 * 1. Start with Outstanding = Original Loan Principal at Loan Date (Day 0: Loan Start).
 * 2. Break timeline into sequential 30-day compound interest cycles + remaining days.
 * 3. At each 30-day boundary:
 *      Interest = Current Balance * (Monthly Rate / 100)
 *      Future Value = Current Balance + Interest
 * 4. For remaining partial days (R < 30):
 *      Interest = Current Balance * (Monthly Rate / 100) * (R / 30)
 *      Future Value = Current Balance + Interest
 * 5. When a payment occurs at day T:
 *      Accrue interest for complete 30-day cycles + remaining days up to day T.
 *      Deduct payment from accrued balance: Balance = max(0, Future Value - Payment).
 *      The next 30-day cycle restarts from the remaining balance at that payment date.
 * 6. If loan is closed, freeze simulation at the closure date.
 */

import { financeCalculationService } from './financeCalculationService';
import { getLocalBusinessDateISO } from '../utils/dateUtils';

export interface CILedgerEvent {
  date: string;
  type: 'DISBURSEMENT' | 'RENEWAL' | 'PAYMENT' | 'PRINCIPAL_REDUCTION' | 'CLOSE' | 'REOPEN' | 'TARGET_DATE';
  particulars: string;
  credit?: number;          // Total payment received
  principalPaid?: number;   // Amount allocated to principal reduction
  debit?: number;           // Additional disbursement / adjustment
  isCloseEvent?: boolean;
}

export interface CIReportRow {
  date: string;
  period: string;
  particulars: string;
  eventType: string;
  days: number;
  daysElapsed: number;
  startBalance: number;
  startingBalance: number;
  interest: number;
  interestAdded: number;
  payment: number;
  paymentReceived: number;
  principalReduction: number;
  endBalance: number;
  endingBalance: number;
  futureValue: number;
}

export interface CISummary {
  initialPrincipal: number;
  currentOutstandingPrincipal: number;
  totalPrincipalPaid: number;
  /** All money paid by the customer that the CI took off the balance (each receipt once) */
  totalPaymentsReceived?: number;
  compoundInterestEarned: number;
  finalCompoundBalance: number;
  effectiveLoanDays: number;
  isClosed: boolean;
  calculatedUntilDate: string;
  calculatedUntil: string;
  monthlyInterestRate: number;
  tooltipText: string;
}

export interface CIResult {
  summary: CISummary;
  reportRows: CIReportRow[];
}

export const TOOLTIP_TEXT = "Estimated compounded value based on pure 30-day time cycles, payments and principal reductions. Informational only.";

export const cdCompoundInterestEngine = {
  /**
   * Calculates Compound Interest (CI) timeline for a CD loan using 30-day cycles.
   * 
   * @param loan Basic loan details (id, amount, date, interest_rate, status, closed_at)
   * @param ledgerEntries Raw ledger entries or payment logs
   * @param asOfDate Target date for calculation (defaults to today or loan closed_at)
   */
  calculateCITimeline(
    loan: {
      id: string;
      loan_id?: string;
      amount: number;
      date: string;
      interest_rate: number;
      status?: string;
      closed_at?: string | null;
    },
    ledgerEntries: any[] = [],
    asOfDate?: string
  ): CIResult {
    const monthlyRate = Number(loan.interest_rate) || 0;
    const loanStartDate = (loan.date || '').split('T')[0];

    const entryDateOf = (e: any) => String(e.entry_date || e.date || '').split('T')[0];
    const typeOf = (e: any) => String(e.entry_type || e.type || '').toLowerCase();
    const accountOf = (e: any) => String(e.account_name || '').trim().toUpperCase();

    // A. Starting principal = the ORIGINAL loan amount (the disbursement row on the loan date).
    //    loan.amount holds the CURRENT principal (it goes down after partial payments),
    //    so using it made the CI start from the wrong amount (e.g. CD127: 20,000 instead of 1,00,000).
    const isDisbursementRow = (e: any) => {
      const t = typeOf(e);
      return (t === 'original_loan' || t === 'disbursement') && Number(e.debit) > 0;
    };
    const openingDisbursed = (ledgerEntries || [])
      .filter(e => isDisbursementRow(e) && entryDateOf(e) === loanStartDate)
      .reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
    let initialPrincipal = openingDisbursed > 0 ? openingDisbursed : (Number(loan.amount) || 0);

    if (!loanStartDate || initialPrincipal <= 0) {
      return this.emptyResult(initialPrincipal, monthlyRate, loanStartDate);
    }

    // Determine target calculation end date
    const statusUpper = (loan.status || '').trim().toUpperCase();
    const isNpaClosed = statusUpper === 'NPA_CLOSED' || statusUpper === 'NPA CLOSED' || statusUpper === 'NPA';
    const isClosed = statusUpper === 'CLOSED' || isNpaClosed;
    let endDate = (asOfDate || '').split('T')[0];

    if (isClosed && loan.closed_at) {
      endDate = (loan.closed_at || '').split('T')[0];
    } else if (isClosed) {
      // No closing date saved on the loan: freeze at the last ledger entry
      const lastEntry = (ledgerEntries || []).map(entryDateOf).filter(Boolean).sort().pop();
      endDate = lastEntry || endDate || getLocalBusinessDateISO();
    } else if (!endDate) {
      endDate = getLocalBusinessDateISO();
    }

    // Ensure endDate is at or after loanStartDate
    if (endDate < loanStartDate) {
      endDate = loanStartDate;
    }

    // 1. Group payment and financial events by date
    interface DateEventAgg {
      date: string;
      paymentCredit: number;
      principalPaid: number;
      additionalDebit: number;
      isClose: boolean;
      particularsList: string[];
    }

    const eventsByDate = new Map<string, DateEventAgg>();
    const getEvent = (date: string): DateEventAgg => {
      const existing = eventsByDate.get(date) || {
        date,
        paymentCredit: 0,
        principalPaid: 0,
        additionalDebit: 0,
        isClose: false,
        particularsList: []
      };
      eventsByDate.set(date, existing);
      return existing;
    };

    // Rows that are NOT money paid by the customer towards the loan balance:
    // opening interest/commission and document charges taken at issue, NPA write-off /
    // NPA pending (loan receivable) book entries.
    const isNonPaymentRow = (e: any) => {
      const t = typeOf(e);
      const acc = accountOf(e);
      return (
        t === 'opening_commission' || t === 'commission' ||
        t === 'document_charge' || t === 'document charges' || acc === 'CD DOCUMENT CHARGES A/C' ||
        t === 'npa_writeoff' || acc.includes('WRITE-OFF') || acc.includes('LOAN RECEIVABLE')
      );
    };
    const isCloseRow = (e: any) => {
      const t = typeOf(e);
      const p = String(e.particulars || '').toLowerCase();
      return t === 'close' || t === 'settlement' || t === 'npa_close' || t === 'npa_writeoff' ||
        p.includes('loan closed') || p.includes('npa closed') || p.includes('npa closure');
    };

    // B. One payment per receipt. A receipt is saved as an "Amount Paid" total row PLUS its split
    //    rows (principal / interest / penalty). Adding all of them counted the money twice
    //    (e.g. CD127 on 10-Dec-2021: 84,850 paid became a 1,69,700 "payment").
    //    Use the Amount Paid total when the receipt has one, otherwise the sum of its split rows.
    interface ReceiptAgg { date: string; amountPaidTotal: number; splitTotal: number; principal: number; particulars: string[] }
    const receipts = new Map<string, ReceiptAgg>();

    (ledgerEntries || []).forEach((e, idx) => {
      const eDate = entryDateOf(e);
      if (!eDate || eDate < loanStartDate || (isClosed && eDate > endDate)) return;

      const t = typeOf(e);
      const credit = Number(e.credit) || 0;
      const debit = Number(e.debit) || 0;

      if (isCloseRow(e)) {
        getEvent(eDate).isClose = true;
        // NPA close collects no money (the whole balance goes to loss), so an NPA close row
        // is the point where the CI stops, not a payment that wipes the balance.
        const p = String(e.particulars || '').toLowerCase();
        if (p.includes('npa') || typeOf(e).startsWith('npa')) return;
      }

      // Initial disbursement on the loan date is already the starting principal
      if (isDisbursementRow(e)) {
        if (eDate > loanStartDate) getEvent(eDate).additionalDebit += debit;
        return;
      }

      if (credit <= 0 || isNonPaymentRow(e)) return;

      const receiptNo = String(e.receipt_no || '').trim();
      const key = receiptNo && receiptNo !== '-' && receiptNo !== '—' ? `${eDate}|${receiptNo}` : `${eDate}|row-${idx}`;
      const r = receipts.get(key) || { date: eDate, amountPaidTotal: 0, splitTotal: 0, principal: 0, particulars: [] };
      if (t === 'amount_paid' || accountOf(e) === 'CD AMOUNT PAID') {
        r.amountPaidTotal += credit;
      } else {
        r.splitTotal += credit;
        if (t === 'principal_payment' || String(e.particulars || '').toLowerCase().includes('principal')) {
          r.principal += credit;
        }
      }
      if (e.particulars) r.particulars.push(String(e.particulars));
      receipts.set(key, r);
    });

    receipts.forEach(r => {
      const paid = r.amountPaidTotal > 0 ? r.amountPaidTotal : r.splitTotal;
      if (paid <= 0) return;
      const ev = getEvent(r.date);
      ev.paymentCredit += paid;
      ev.principalPaid += r.principal;
      ev.particularsList.push(...r.particulars);
    });

    // Ensure final target end date is represented if not closed before endDate
    if (!eventsByDate.has(endDate) && !isClosed) {
      eventsByDate.set(endDate, {
        date: endDate,
        paymentCredit: 0,
        principalPaid: 0,
        additionalDebit: 0,
        isClose: false,
        particularsList: ['Target Date']
      });
    }

    // Sort event dates chronologically
    const sortedEventDates = Array.from(eventsByDate.keys()).sort();

    // 2. Timeline Walk Simulation with 30-day cycles
    let currentBalance = initialPrincipal;
    let accumulatedInterest = 0;
    let totalPaymentsReceived = 0;
    let totalPrincipalPaid = 0;
    let totalDaysSimulated = 0;
    let anchorDate = loanStartDate;
    let cycleCount = 1;

    const reportRows: CIReportRow[] = [];

    // Helper for standard financial half-up 2-decimal rounding
    const round2 = (num: number): number => {
      return Math.round((num + Number.EPSILON) * 100) / 100;
    };

    // Helper to build a clean report row object
    const createRow = (
      date: string,
      period: string,
      particulars: string,
      eventType: string,
      days: number,
      startBal: number,
      interest: number,
      payment: number,
      endBal: number
    ): CIReportRow => {
      const rDays = Math.round(days);
      const rStart = round2(startBal);
      const rInt = round2(interest);
      const rPay = round2(payment);
      const rEnd = round2(endBal);
      return {
        date,
        period,
        particulars,
        eventType,
        days: rDays,
        daysElapsed: rDays,
        startBalance: rStart,
        startingBalance: rStart,
        interest: rInt,
        interestAdded: rInt,
        payment: rPay,
        paymentReceived: rPay,
        principalReduction: rPay,
        endBalance: rEnd,
        endingBalance: rEnd,
        futureValue: rEnd
      };
    };

    // Row 0: Loan Start
    reportRows.push(createRow(
      loanStartDate,
      'Loan Start',
      'Loan Start',
      'DISBURSEMENT',
      0,
      initialPrincipal,
      0,
      0,
      initialPrincipal
    ));

    for (const eventDate of sortedEventDates) {
      const eventAgg = eventsByDate.get(eventDate)!;
      let daysFromAnchor = Math.max(0, financeCalculationService.differenceInCalendarDays(eventDate, anchorDate));

      if (daysFromAnchor <= 0 && eventDate !== anchorDate) {
        continue;
      }

      const numFullCycles = Math.floor(daysFromAnchor / 30);
      const remainingDays = daysFromAnchor % 30;

      // A. Process complete 30-day cycles in this interval
      for (let k = 1; k <= numFullCycles; k++) {
        const cycleDate = financeCalculationService.addCalendarDays(anchorDate, 30 * k);
        const startVal = currentBalance;
        let cycleInterest = 0;

        if (currentBalance > 0 && monthlyRate > 0) {
          cycleInterest = round2(currentBalance * (monthlyRate / 100));
        }

        accumulatedInterest += cycleInterest;
        let balanceAfterInterest = round2(currentBalance + cycleInterest);
        totalDaysSimulated += 30;

        // Check if event happens exactly on this 30-day boundary and is the final step of interval
        if (k === numFullCycles && remainingDays === 0 && eventAgg.paymentCredit > 0) {
          const payAmt = eventAgg.paymentCredit;
          totalPaymentsReceived += payAmt;
          totalPrincipalPaid += (eventAgg.principalPaid > 0 ? eventAgg.principalPaid : payAmt);
          const endVal = round2(Math.max(0, balanceAfterInterest - payAmt));
          currentBalance = endVal;

          reportRows.push(createRow(
            cycleDate,
            `Cycle ${cycleCount}`,
            `Cycle ${cycleCount}`,
            'CYCLE',
            30,
            startVal,
            cycleInterest,
            payAmt,
            endVal
          ));
        } else {
          currentBalance = balanceAfterInterest;
          reportRows.push(createRow(
            cycleDate,
            `Cycle ${cycleCount}`,
            `Cycle ${cycleCount}`,
            'CYCLE',
            30,
            startVal,
            cycleInterest,
            0,
            currentBalance
          ));
        }

        cycleCount++;
      }

      // B. Process remaining partial days up to eventDate
      if (remainingDays > 0) {
        const startVal = currentBalance;
        let partialInterest = 0;

        if (currentBalance > 0 && monthlyRate > 0) {
          // Prorated interest formula: Current Balance * (Monthly Rate / 100) * (Remaining Days / 30)
          partialInterest = round2(currentBalance * (monthlyRate / 100) * (remainingDays / 30));
        }

        accumulatedInterest += partialInterest;
        let balanceAfterInterest = round2(currentBalance + partialInterest);
        totalDaysSimulated += remainingDays;

        if (eventAgg.paymentCredit > 0) {
          const payAmt = eventAgg.paymentCredit;
          totalPaymentsReceived += payAmt;
          totalPrincipalPaid += (eventAgg.principalPaid > 0 ? eventAgg.principalPaid : payAmt);
          const endVal = round2(Math.max(0, balanceAfterInterest - payAmt));
          currentBalance = endVal;

          reportRows.push(createRow(
            eventDate,
            'Partial Cycle',
            `Partial Cycle (${remainingDays} Days)`,
            'PAYMENT',
            remainingDays,
            startVal,
            partialInterest,
            payAmt,
            endVal
          ));
        } else {
          currentBalance = balanceAfterInterest;
          reportRows.push(createRow(
            eventDate,
            'Partial Cycle',
            `Partial Cycle (${remainingDays} Days)`,
            'TARGET_DATE',
            remainingDays,
            startVal,
            partialInterest,
            0,
            currentBalance
          ));
        }
      } else if (numFullCycles === 0 && eventAgg.paymentCredit > 0 && daysFromAnchor === 0 && eventDate !== loanStartDate) {
        // Payment on exact same day as anchor without days elapsed
        const startVal = currentBalance;
        const payAmt = eventAgg.paymentCredit;
        totalPaymentsReceived += payAmt;
        totalPrincipalPaid += (eventAgg.principalPaid > 0 ? eventAgg.principalPaid : payAmt);
        const endVal = round2(Math.max(0, currentBalance - payAmt));
        currentBalance = endVal;

        reportRows.push(createRow(
          eventDate,
          'Payment',
          'Payment Received',
          'PAYMENT',
          0,
          startVal,
          0,
          payAmt,
          endVal
        ));
      }

      // Handle additional disbursement if any
      if (eventAgg.additionalDebit > 0) {
        currentBalance += eventAgg.additionalDebit;
        initialPrincipal += eventAgg.additionalDebit;
      }

      // Reset anchor date for the next cycle
      if (eventAgg.paymentCredit > 0 || eventAgg.additionalDebit > 0) {
        anchorDate = eventDate;
      } else if (daysFromAnchor > 0) {
        anchorDate = eventDate;
      }

      // If loan closed at this event, terminate simulation
      if (eventAgg.isClose) {
        break;
      }
    }

    const finalCompoundBalance = round2(currentBalance);
    const compoundInterestEarned = round2(accumulatedInterest);

    return {
      summary: {
        initialPrincipal: round2(initialPrincipal),
        currentOutstandingPrincipal: round2(currentBalance),
        totalPrincipalPaid: round2(totalPrincipalPaid),
        totalPaymentsReceived: round2(totalPaymentsReceived),
        compoundInterestEarned,
        finalCompoundBalance,
        effectiveLoanDays: totalDaysSimulated,
        isClosed,
        calculatedUntilDate: anchorDate,
        calculatedUntil: anchorDate,
        monthlyInterestRate: monthlyRate,
        tooltipText: TOOLTIP_TEXT
      },
      reportRows
    };
  },

  emptyResult(initialPrincipal: number, monthlyRate: number, loanStartDate: string): CIResult {
    const calcDate = loanStartDate || getLocalBusinessDateISO();
    return {
      summary: {
        initialPrincipal: Number(initialPrincipal.toFixed(2)),
        currentOutstandingPrincipal: Number(initialPrincipal.toFixed(2)),
        totalPrincipalPaid: 0,
        compoundInterestEarned: 0,
        finalCompoundBalance: Number(initialPrincipal.toFixed(2)),
        effectiveLoanDays: 0,
        isClosed: false,
        calculatedUntilDate: calcDate,
        calculatedUntil: calcDate,
        monthlyInterestRate: monthlyRate,
        tooltipText: TOOLTIP_TEXT
      },
      reportRows: []
    };
  }
};
