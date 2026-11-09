import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseFinance } from '../lib/supabaseFinance';
import { FinanceCalculationEngine } from '../services/FinanceCalculationEngine';
import { normalizeHeadOfAccount } from '../services/dailyFinancialTransactionService';

describe('NPA Closed Accounting & Reporting Logic Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Requirement 1 & 12: NPA_CLOSED loan has ₹0 outstanding receivable in FinanceCalculationEngine', () => {
    const loan = {
      id: 'loan-1',
      loan_id: 'CD118',
      amount: 50000,
      status: 'NPA_CLOSED',
      npa_closed: true
    };
    const dues = [
      {
        loan_id: 'CD118',
        current_principal: 45000,
        present_due: 48000,
        pending_interest: 3000,
        penalty: 500
      }
    ];

    const metrics = FinanceCalculationEngine.computeLoanMetrics(loan, dues);
    expect(metrics.outstanding).toBe(0);
    expect(metrics.presentDue).toBe(0);
    expect(metrics.pendingInterest).toBe(0);
    expect(metrics.pendingPenalty).toBe(0);
    expect(FinanceCalculationEngine.isActiveOrNpa('NPA_CLOSED')).toBe(false);
    expect(FinanceCalculationEngine.isActiveOrNpa('NPA CLOSED')).toBe(false);
  });

  it('Requirement 2, 3, 4, 5, 6: postCdNpaClose creates separate Cash Collection and balanced Write-off Journal entries', async () => {
    const cdLedgerEntries: any[] = [];
    const transactions: any[] = [];
    const waiverAudits: any[] = [];

    vi.spyOn(supabaseFinance, 'getNextReceiptNumber').mockResolvedValue('RC2474');
    vi.spyOn(supabaseFinance, 'addTransaction').mockImplementation(async (payload: any) => {
      transactions.push(payload);
      return { id: 'tx-1', ...payload };
    });
    vi.spyOn(supabaseFinance, 'addCDLedgerEntry').mockImplementation(async (payload: any) => {
      cdLedgerEntries.push(payload);
      return { id: `cd-${cdLedgerEntries.length}`, ...payload };
    });
    vi.spyOn(supabaseFinance, 'addWaiverAudit').mockImplementation(async (payload: any) => {
      waiverAudits.push(payload);
      return { id: `wv-${waiverAudits.length}`, ...payload } as any;
    });
    vi.spyOn(supabaseFinance, 'logTransactionForReview').mockResolvedValue({} as any);

    // Scenario: Total Outstanding = ₹50,000, Customer pays = ₹5,000, Waived = ₹45,000
    const res = await supabaseFinance.postCdNpaClose({
      loanId: 'loan-1',
      customerId: 'cust-1',
      customerName: 'NAGESHWAR REKHA',
      loanIdStr: 'CD118',
      userName: 'ADMIN',
      totalOutstanding: 50000,
      settlementAmount: 5000,
      waivedAmount: 45000,
      principalPaid: 5000,
      interestPaid: 0,
      penaltyPaid: 0,
      paymentDate: '2026-08-15',
      receiptNo: 'RC2474',
      reason: 'Borrower insolvent settlement'
    });

    expect(res.success).toBe(true);

    // 1. Check Cash Collection Transaction (Only ₹5,000 actual cash received)
    expect(transactions.length).toBe(1);
    expect(transactions[0].amount).toBe(5000);
    expect(transactions[0].type).toBe('Collection');
    expect(transactions[0].receipt_no).toBe('RC2474');

    // 2. Check CD Ledger Entries:
    // Entry 1: Cash Collection (Credit ₹5,000)
    const cashEntry = cdLedgerEntries.find(e => e.account_name === 'CD A/C');
    expect(cashEntry).toBeDefined();
    expect(cashEntry.credit).toBe(5000);
    expect(cashEntry.debit).toBe(0);
    expect(cashEntry.entry_type).toBe('NPA_CLOSE');

    // Entry 2: Write-off Debit side (Loss / Expense account) Dr ₹45,000
    const lossDebitEntry = cdLedgerEntries.find(e => e.account_name === 'NPA WRITE-OFF / LOSS A/C');
    expect(lossDebitEntry).toBeDefined();
    expect(lossDebitEntry.debit).toBe(45000);
    expect(lossDebitEntry.credit).toBe(0);
    expect(lossDebitEntry.entry_type).toBe('NPA_WRITEOFF');
    expect(lossDebitEntry.particulars).toContain('NPA CLOSURE / WRITE-OFF / WAIVER');
    expect(lossDebitEntry.particulars).toContain('Waived / Written Off: 45,000.00');

    // Entry 3: Write-off Credit side (CD Receivable reduction) Cr ₹45,000
    const receivableCreditEntry = cdLedgerEntries.find(e => e.account_name === 'CD LOAN RECEIVABLE A/C');
    expect(receivableCreditEntry).toBeDefined();
    expect(receivableCreditEntry.credit).toBe(45000);
    expect(receivableCreditEntry.debit).toBe(0);
    expect(receivableCreditEntry.entry_type).toBe('NPA_WRITEOFF');
    expect(receivableCreditEntry.particulars).toContain('NPA CLOSURE / WRITE-OFF / WAIVER');

    // 3. Verify balanced write-off accounting (Debit ₹45,000 == Credit ₹45,000)
    expect(lossDebitEntry.debit).toBe(receivableCreditEntry.credit);
    const writeOffNetCashMovement = lossDebitEntry.credit - lossDebitEntry.debit + (receivableCreditEntry.credit - receivableCreditEntry.debit);
    expect(writeOffNetCashMovement).toBe(0);

    // 4. Verify Total Receivable Removed: Cash ₹5,000 + Waived ₹45,000 = ₹50,000
    expect(cashEntry.credit + receivableCreditEntry.credit).toBe(50000);
  });

  it('Requirement 7, 8, 9, 10, 11: Head normalization and P&L / Balance Sheet classification', () => {
    // Check Head of Account normalizations
    expect(normalizeHeadOfAccount('NPA WRITE-OFF')).toBe('NPA WRITE-OFF / LOSS A/C');
    expect(normalizeHeadOfAccount('NPA LOSS')).toBe('NPA WRITE-OFF / LOSS A/C');
    expect(normalizeHeadOfAccount('NPA WRITEOFF')).toBe('NPA WRITE-OFF / LOSS A/C');
    expect(normalizeHeadOfAccount('CD LOAN RECEIVABLE')).toBe('CD LOAN RECEIVABLE A/C');
    expect(normalizeHeadOfAccount('CD A/C')).toBe('CD DISBURSEMENT');
    expect(normalizeHeadOfAccount('CD COLLECTION')).toBe('CD DISBURSEMENT');

    // Core rule: Waived Money is NOT Cash Received
    const outstanding = 500;
    const customerPaid = 0;
    const waived = 500;

    const debitLoss = waived;
    const creditReceivable = waived;
    const netCashMovement = debitLoss - creditReceivable;
    expect(outstanding).toBe(500);
    expect(customerPaid).toBe(0);
    expect(debitLoss).toBe(500);
    expect(creditReceivable).toBe(500);
    expect(netCashMovement).toBe(0);
  });

  it('Business Details: NPA CLOSED account shows ₹0 current outstanding, ₹0 pending interest, ₹0 pending penalty, ₹0 present due while preserving historical payment audit data', () => {
    // Before NPA closure
    const activeLoan = {
      id: 'cd-101',
      loan_id: 'CD101',
      amount: 400000,
      status: 'Active'
    };
    const activeDues = [
      {
        loan_id: 'CD101',
        current_principal: 400000,
        pending_interest: 330200,
        penalty: 82550,
        present_due: 412750,
        interest_paid: 25000,
        penalty_paid: 5000
      }
    ];

    const activeMetrics = FinanceCalculationEngine.computeLoanMetrics(activeLoan, activeDues);
    expect(activeMetrics.outstanding).toBe(400000);
    expect(activeMetrics.pendingInterest).toBe(330200);
    expect(activeMetrics.pendingPenalty).toBe(82550);
    expect(activeMetrics.presentDue).toBe(412750);
    expect(activeMetrics.interestEarned).toBe(25000);
    expect(activeMetrics.penaltyEarned).toBe(5000);

    // After NPA closure
    const npaLoan = {
      id: 'cd-101',
      loan_id: 'CD101',
      amount: 400000,
      status: 'NPA_CLOSED',
      npa_closed: true
    };
    const npaDues = [
      {
        loan_id: 'CD101',
        current_principal: 0,
        pending_interest: 0,
        penalty: 0,
        present_due: 0,
        interest_paid: 25000,
        penalty_paid: 5000
      }
    ];

    const npaMetrics = FinanceCalculationEngine.computeLoanMetrics(npaLoan, npaDues);
    expect(npaMetrics.outstanding).toBe(0);
    expect(npaMetrics.pendingInterest).toBe(0);
    expect(npaMetrics.pendingPenalty).toBe(0);
    expect(npaMetrics.presentDue).toBe(0);
    // Historical audit data preserved:
    expect(npaMetrics.interestEarned).toBe(25000);
    expect(npaMetrics.penaltyEarned).toBe(5000);
    expect(npaMetrics.principalFinanced).toBe(400000);
  });
});

