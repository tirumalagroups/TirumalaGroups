import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseFinance } from '../lib/supabaseFinance';

describe('CD Ledger NPA Close Day Book Reflection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly posts NPA Close financial transaction to finance_transactions and finance_cd_ledger_entries', async () => {
    const addTransactionSpy = vi.spyOn(supabaseFinance, 'addTransaction').mockResolvedValue({ id: 'tx-npa-1' } as any);
    const addCDLedgerEntrySpy = vi.spyOn(supabaseFinance, 'addCDLedgerEntry').mockResolvedValue({ id: 'ledger-npa-1' } as any);
    const logReviewSpy = vi.spyOn(supabaseFinance, 'logTransactionForReview').mockResolvedValue({} as any);

    const res = await supabaseFinance.postCdNpaClose({
      loanId: 'loan-123',
      customerId: 'cust-456',
      customerName: 'NAGESHWAR REKHA',
      loanIdStr: 'CD118',
      userName: 'OPERATOR1',
      settlementAmount: 113000,
      principalPaid: 100000,
      interestPaid: 10000,
      penaltyPaid: 2500,
      docChargesPaid: 500,
      paymentDate: '2026-08-15',
      receiptNo: 'RC2474',
      reason: 'DEFAULTED BORROWER SETTLEMENT'
    });

    expect(res.success).toBe(true);
    expect(res.receiptNo).toBe('RC2474');

    // 1. Check addTransaction call
    expect(addTransactionSpy).toHaveBeenCalledTimes(1);
    const txCall = addTransactionSpy.mock.calls[0][0];
    expect(txCall.loan_id).toBe('loan-123');
    expect(txCall.type).toBe('Collection');
    expect(txCall.amount).toBe(113000);
    expect(txCall.date).toBe('2026-08-15');
    expect(txCall.receipt_no).toBe('RC2474');
    expect(txCall.collected_by).toBe('OPERATOR1');
    expect(txCall.remarks).toContain('NPA Closed Payment - CD118 - NAGESHWAR REKHA');
    expect(txCall.remarks).toContain('Principal Paid: 1,00,000.00');
    expect(txCall.remarks).toContain('Interest Paid: 10,000.00');
    expect(txCall.remarks).toContain('Penalty Paid: 2,500.00');
    expect(txCall.remarks).toContain('Document Charges: 500.00');
    expect(txCall.remarks).toContain('Total Received: 1,13,000.00');
    expect(txCall.remarks).toContain('Receipt: RC2474');
    expect(txCall.remarks).toContain('Reason: DEFAULTED BORROWER SETTLEMENT');

    // 2. Check addCDLedgerEntry calls (1 for NPA_CLOSE row, 1 for CD Amount Paid audit row)
    expect(addCDLedgerEntrySpy).toHaveBeenCalledTimes(2);

    const mainEntry = addCDLedgerEntrySpy.mock.calls[0][0];
    expect(mainEntry.loan_id).toBe('loan-123');
    expect(mainEntry.customer_id).toBe('cust-456');
    expect(mainEntry.account_name).toBe('CD A/C');
    expect(mainEntry.entry_type).toBe('NPA_CLOSE');
    expect(mainEntry.credit).toBe(113000);
    expect(mainEntry.debit).toBe(0);
    expect(mainEntry.receipt_no).toBe('RC2474');
    expect(mainEntry.particulars).toContain('NPA Closed Payment - CD118 - NAGESHWAR REKHA');

    const auditEntry = addCDLedgerEntrySpy.mock.calls[1][0];
    expect(auditEntry.account_name).toBe('CD Amount Paid');
    expect(auditEntry.credit).toBe(113000);
    expect(auditEntry.debit).toBe(0);
    expect(auditEntry.receipt_no).toBe('RC2474');
  });

  it('handles partial settlement amounts and zero collections cleanly', async () => {
    const addTransactionSpy = vi.spyOn(supabaseFinance, 'addTransaction').mockResolvedValue({ id: 'tx-npa-2' } as any);
    const addCDLedgerEntrySpy = vi.spyOn(supabaseFinance, 'addCDLedgerEntry').mockResolvedValue({ id: 'ledger-npa-2' } as any);

    const res = await supabaseFinance.postCdNpaClose({
      loanId: 'loan-124',
      customerId: 'cust-457',
      customerName: 'RAMESH KUMAR',
      loanIdStr: 'CD119',
      userName: 'STAFF',
      settlementAmount: 0,
      principalPaid: 0,
      interestPaid: 0,
      penaltyPaid: 0,
      paymentDate: '2026-08-15',
      receiptNo: 'RC2475',
      reason: 'UNTRACEABLE BORROWER WRITE OFF'
    });

    expect(res.success).toBe(true);
    // Should not record financial transaction when settlement amount is 0
    expect(addTransactionSpy).not.toHaveBeenCalled();
    // But should record NPA_CLOSE entry in CD ledger for tracking
    expect(addCDLedgerEntrySpy).toHaveBeenCalledTimes(1);
    expect(addCDLedgerEntrySpy.mock.calls[0][0].entry_type).toBe('NPA_CLOSE');
    expect(addCDLedgerEntrySpy.mock.calls[0][0].credit).toBe(0);
  });
});
