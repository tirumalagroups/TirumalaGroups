/**
 * Same clean-up the CD Ledger page applies to ledger rows before calculating a loan's
 * position (opening commission / document charges / disbursement rows get their proper type).
 * Shared so other screens (Payment Follow-up) show exactly the CD Ledger's numbers.
 */
export const normalizeCDLedgerEntries = (entries: any[]) => {
  return (entries || []).map((entry: any) => {
    let entryType = entry.entry_type;
    let particulars = entry.particulars || '';
    const accountNameLower = (entry.account_name || '').toLowerCase();
    const particularsLower = particulars.toLowerCase();

    if (entry.account_name) {
      if (accountNameLower === 'cd commission a/c') {
        const isOpeningRow = entryType === 'opening_commission' || entryType === 'Commission'
          || (!entry.receipt_no || entry.receipt_no === '-');
        if (isOpeningRow && entryType !== 'interest_payment' && entryType !== 'penalty_payment') {
          entryType = 'opening_commission';
          particulars = 'Opening CD Commission Charged';
        }
      } else if (accountNameLower === 'cd document charges a/c') {
        if (entryType !== 'document_charge') entryType = 'document_charge';
      } else if (
        particularsLower.includes('disbursement') ||
        accountNameLower === 'disbursement' ||
        entryType === 'original_loan' ||
        (accountNameLower === 'cd a/c' && entry.debit > 0 && !entry.credit)
      ) {
        entryType = 'original_loan';
        particulars = 'Original Loan Disbursement';
      }
      return { ...entry, entry_type: entryType, particulars };
    }

    if (particularsLower.includes('disbursement') || (entry.debit > 0 && !entry.credit)) {
      entryType = 'original_loan';
      particulars = 'Original Loan Disbursement';
    }

    return { ...entry, entry_type: entryType, particulars };
  });
};
