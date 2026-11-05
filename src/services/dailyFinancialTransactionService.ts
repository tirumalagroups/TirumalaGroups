import { supabase } from '../lib/supabase';

export const normalizeHeadOfAccount = (name: string): string => {
  const clean = (name || '').trim().toUpperCase();
  if (clean.includes('NPA WRITE-OFF') || clean.includes('NPA LOSS') || clean === 'WRITE-OFF' || clean === 'WAIVER' || clean === 'NPA WRITEOFF') {
    return 'NPA WRITE-OFF / LOSS A/C';
  }
  if (clean.includes('LOAN RECEIVABLE') || clean === 'CD LOAN RECEIVABLE A/C' || clean === 'CD LOAN RECEIVABLE') {
    return 'CD LOAN RECEIVABLE A/C';
  }
  if (clean === 'CD COMMISSION A/C' || clean === 'CD COMMISSION' || clean === 'CD INTEREST' || clean === 'CD INTEREST A/C') {
    return 'CD INTEREST';
  }
  if (clean === 'HP COMMISSION A/C' || clean === 'HP COMMISSION' || clean === 'HP INTEREST' || clean === 'HP INTEREST A/C') {
    return 'HP INTEREST';
  }
  if (clean === 'STBD COMMISSION A/C' || clean === 'STBD COMMISSION' || clean === 'STBD INTEREST' || clean === 'STBD INTEREST A/C') {
    return 'STBD INTEREST';
  }
  if (clean === 'COMMISSION A/C' || clean === 'COMMISSION' || clean === 'TBD COMMISSION A/C' || clean === 'TBD COMMISSION' || clean === 'TBD INTEREST' || clean === 'TBD INTEREST A/C') {
    return 'TBD INTEREST';
  }
  if (clean === 'CD A/C' || clean === 'CD PRINCIPAL' || clean === 'CD DISBURSEMENT' || clean === 'CD COLLECTION') {
    return 'CD DISBURSEMENT';
  }
  if (clean === 'HP A/C' || clean === 'HP PRINCIPAL' || clean === 'HP DISBURSEMENT' || clean === 'HP COLLECTION') {
    return 'HP DISBURSEMENT';
  }
  if (clean === 'STBD A/C' || clean === 'STBD PRINCIPAL' || clean === 'STBD DISBURSEMENT' || clean === 'STBD COLLECTION') {
    return 'STBD DISBURSEMENT';
  }
  if (clean === 'TBD A/C' || clean === 'TBD PRINCIPAL' || clean === 'TBD DISBURSEMENT' || clean === 'TBD COLLECTION') {
    return 'TBD DISBURSEMENT';
  }
  if (clean === 'CD DOCUMENT CHARGES A/C' || clean === 'CD DOCUMENT CHARGES') {
    return 'CD DOCUMENT CHARGES';
  }
  if (clean === 'PENALTY A/C' || clean === 'CD PENALTY' || clean === 'PENALTY CD A/C') {
    return 'CD PENALTY';
  }
  if (clean === 'HP PENALTY A/C' || clean === 'HP PENALTY') {
    return 'HP PENALTY';
  }
  if (clean === 'STBD PENALTY A/C' || clean === 'STBD PENALTY') {
    return 'STBD PENALTY';
  }
  if (clean === 'TBD PENALTY A/C' || clean === 'TBD PENALTY') {
    return 'TBD PENALTY';
  }
  return clean;
};

export function extractLoanPaymentSplits(lt: any, _lCat?: string): {
  principal: number;
  interest: number;
  penalty: number;
  docCharges: number;
} {
  const totalAmt = Number(lt.amount) || 0;
  const remarks = lt.remarks || '';

  // Extract explicit named amounts if present in remarks
  const prinMatch = remarks.match(/(?:Principal Paid|Principal Adjusted|Prin|Principal)[:\s]+₹?\s*([\d,]+(?:\.\d+)?)/i);
  const intMatch = remarks.match(/(?:Interest Paid|Interest|Commission Paid|Comm|Commission)[:\s]+₹?\s*([\d,]+(?:\.\d+)?)/i);
  const penMatch = remarks.match(/(?:Penalty Paid|Penalty|Pen)[:\s]+₹?\s*([\d,]+(?:\.\d+)?)/i);
  const docMatch = remarks.match(/(?:Document Charges|Doc Charges|Doc)[:\s]+₹?\s*([\d,]+(?:\.\d+)?)/i);

  const principal = prinMatch ? parseFloat(prinMatch[1].replace(/,/g, '')) : 0;
  const interest = intMatch ? parseFloat(intMatch[1].replace(/,/g, '')) : 0;
  const penalty = penMatch ? parseFloat(penMatch[1].replace(/,/g, '')) : 0;
  const docCharges = docMatch ? parseFloat(docMatch[1].replace(/,/g, '')) : 0;

  const parsedSum = principal + interest + penalty + docCharges;
  if (parsedSum > 0 && Math.abs(parsedSum - totalAmt) <= 2) {
    return { principal, interest, penalty, docCharges };
  }

  // Single component classification if remarks indicate only one type exclusively
  const upperRemarks = remarks.toUpperCase();
  if (upperRemarks.includes('PENALTY') && !upperRemarks.includes('INTEREST') && !upperRemarks.includes('PRINCIPAL') && !upperRemarks.includes('PRIN')) {
    return { principal: 0, interest: 0, penalty: totalAmt, docCharges: 0 };
  }
  if ((upperRemarks.includes('INTEREST') || upperRemarks.includes('COMMISSION')) && !upperRemarks.includes('PENALTY') && !upperRemarks.includes('PRINCIPAL') && !upperRemarks.includes('PRIN')) {
    return { principal: 0, interest: totalAmt, penalty: 0, docCharges: 0 };
  }
  if (upperRemarks.includes('DOC') && !upperRemarks.includes('INTEREST') && !upperRemarks.includes('PRINCIPAL')) {
    return { principal: 0, interest: 0, penalty: 0, docCharges: totalAmt };
  }

  // Default fallback: Principal repayment credited against Disbursement account (LOAN RECEIVABLE)
  // Per Rule 3 & 4: Principal is NOT income and is credited against CD DISBURSEMENT.
  return { principal: totalAmt, interest: 0, penalty: 0, docCharges: 0 };
}

export interface DailyFinancialTransaction {
  id: string;
  sourceType: 'CD_LEDGER' | 'CAPITAL_ENTRY' | 'DAY_BOOK_ENTRY' | 'LOAN_TRANSACTION';
  sourceRecordId: string;
  transactionDate: string;
  headOfAccountId?: string | null;
  headOfAccount: string;
  particulars: string;
  receiptOrVoucherNo?: string | null;
  accountOrLoanNo?: string | null;
  debit: number;
  credit: number;
  userId?: string | null;
  userName?: string | null;
  entryTime?: string | null;
  createdAt?: string | null;
  reportClassification: 'BALANCE_SHEET' | 'PROFIT_AND_LOSS' | 'UNCLASSIFIED';
  customerName?: string | null;
  partnerId?: string | null;
  category?: string | null;
  loanCategory?: string | null;
  partnerName?: string | null;
  /**
   * NPA close grouping (Day Book shows one NPA CLOSE row with its parts under it):
   *   npaGroupId   - same value on the parent and its children
   *   npaRole      - 'PARENT' = the loss row (Debit, NPA WRITE-OFF / LOSS A/C)
   *                  'CHILD'  = a part it clears (Credit: principal / interest / penalty)
   *   npaComponent - which part a CHILD row is
   *   displayType  - label to show instead of the head of account ('NPA CLOSE' on the parent)
   */
  npaGroupId?: string | null;
  npaRole?: 'PARENT' | 'CHILD' | null;
  npaComponent?: 'PRINCIPAL' | 'INTEREST' | 'PENALTY' | null;
  displayType?: string | null;
}

export const dailyFinancialTransactionService = {
  async getDailyFinancialTransactions(params: {
    fromDate: string;
    toDate: string;
    financeMode: 'REGULAR' | 'ITR';
  }): Promise<DailyFinancialTransaction[]> {
    const { fromDate, toDate, financeMode } = params;

    const fromDateClean = fromDate.split('T')[0];
    const toDateClean = toDate.split('T')[0];
    const toDateEnd = toDateClean.length === 10 ? `${toDateClean}T23:59:59.999Z` : toDate;

    console.log(`[DAILY REPORT DEBUG] Fetching for ${fromDateClean} to ${toDateEnd}, mode: ${financeMode}`);

    const { data: accountsData } = await supabase
      .from('finance_cashbook_accounts')
      .select('*');

    const accountsMap = new Map<string, any>();
    if (accountsData) {
      accountsData.forEach(acc => {
        accountsMap.set(acc.account_name.toUpperCase(), acc);
      });
    }

    const getClassification = (headName: string): 'BALANCE_SHEET' | 'PROFIT_AND_LOSS' | 'UNCLASSIFIED' => {
      const cleanHead = normalizeHeadOfAccount(headName);
      const upper = cleanHead.toUpperCase();
      
      if (upper.includes('NPA WRITE-OFF') || upper.includes('NPA LOSS') || upper.includes('WRITE-OFF')) {
        return 'PROFIT_AND_LOSS';
      }
      if (upper.includes('RECEIVABLE')) {
        return 'BALANCE_SHEET';
      }
      if (upper === 'CAPITAL' || upper.startsWith('CAPITAL')) return 'BALANCE_SHEET';
      if (
        upper.includes('DISBURSEMENT') ||
        upper.includes('PRINCIPAL') || 
        upper === 'CD DISBURSEMENT' || 
        upper === 'HP DISBURSEMENT' || 
        upper === 'STBD DISBURSEMENT' || 
        upper === 'TBD DISBURSEMENT' ||
        upper.startsWith('BANK') ||
        upper.endsWith('BANK')
      ) {
        return 'BALANCE_SHEET';
      }
      
      if (
        upper.includes('INTEREST') || 
        upper.includes('COMMISSION') || 
        upper.includes('DOCUMENT CHARGES') || 
        upper.includes('PENALTY') ||
        upper.includes('SALARY') ||
        upper.includes('RENT') ||
        upper.includes('ELECTRICITY') ||
        upper.includes('STATIONERY') ||
        upper.includes('PRINTING') ||
        upper.includes('FUEL') ||
        upper.includes('TEA') ||
        upper.includes('EXPENSE') ||
        upper.includes('REPAIR') ||
        upper.includes('MAINTENANCE') ||
        upper.includes('DISCOUNT') ||
        upper.includes('CHARGES')
      ) {
        return 'PROFIT_AND_LOSS';
      }

      const acc = accountsMap.get(upper) || accountsMap.get(headName.toUpperCase());
      if (acc?.report_classification) {
        return acc.report_classification;
      }
      return 'PROFIT_AND_LOSS';
    };

    const fetchAllPages = async (queryFactory: (from: number, to: number) => any): Promise<any[]> => {
      const pageSize = 1000;
      let allRows: any[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await queryFactory(from, to);
        if (error) {
          console.error('Error in fetchAllPages:', error);
          break;
        }
        if (data && data.length > 0) {
          allRows = allRows.concat(data);
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }
      return allRows;
    };

    const cdEntries = await fetchAllPages((from, to) =>
      supabase
        .from('finance_cd_ledger_entries')
        .select('*, loan:finance_loans(loan_id, loan_category), customer:finance_customers(name)')
        .neq('account_name', 'CD Amount Paid')
        .gte('entry_date', fromDateClean)
        .lte('entry_date', toDateEnd)
        .range(from, to)
    );

    const cdReceiptSet = new Set<string>();
    const cdDisbursementLoanIds = new Set<string>();

    cdEntries.forEach(e => {
      if (e.receipt_no) {
        cdReceiptSet.add(e.receipt_no.trim().toUpperCase());
      }
      if (e.entry_type === 'original_loan' || (Number(e.debit) > 0 && (e.account_name === 'CD A/C' || e.account_name === 'CD DISBURSEMENT'))) {
        if (e.loan_id) cdDisbursementLoanIds.add(e.loan_id);
      }
    });

    const ltEntries = await fetchAllPages((from, to) =>
      supabase
        .from('finance_transactions')
        .select('*, loan:finance_loans(loan_id, loan_category, customer:finance_customers(name))')
        .gte('date', fromDateClean)
        .lte('date', toDateEnd)
        .range(from, to)
    );

    const capEntries = await fetchAllPages((from, to) =>
      supabase
        .from('finance_capital_entries')
        .select('*, partner:finance_partners(*)')
        .gte('entry_date', fromDateClean)
        .lte('entry_date', toDateEnd)
        .range(from, to)
    );

    const { data: bookData } = await supabase
      .from('finance_books')
      .select('id')
      .eq('book_code', financeMode === 'ITR' ? 'ITR-LEGACY' : 'REG-LEGACY')
      .maybeSingle();

    const cbEntries = await fetchAllPages((from, to) => {
      let cbQuery = supabase
        .from('finance_cashbook_entries')
        .select('*')
        .gte('entry_date', fromDateClean)
        .lte('entry_date', toDateEnd);
      if (bookData?.id) cbQuery = cbQuery.or(`book_id.eq.${bookData.id},book_id.is.null`);
      return cbQuery.range(from, to);
    });

    const npaEntries = await fetchAllPages((from, to) =>
      supabase
        .from('finance_npa_records')
        .select('*')
        .gte('closed_at', fromDateClean)
        .lte('closed_at', toDateEnd)
        .range(from, to)
    );

    const normalizedList: DailyFinancialTransaction[] = [];

    // Loans whose NPA close is already written in the CD ledger (new NPA close flow)
    const npaLedgerLoanIds = new Set<string>();
    (cdEntries || []).forEach((e: any) => {
      if (e.entry_type === 'NPA_WRITEOFF' && e.loan_id) npaLedgerLoanIds.add(e.loan_id);
    });

    if (cdEntries) {
      cdEntries.forEach((entry: any) => {
        // Zero-amount NPA marker rows carry no money; skip them
        if (entry.entry_type === 'NPA_CLOSE' && !(Number(entry.debit) > 0) && !(Number(entry.credit) > 0)) return;
        let head = entry.account_name || 'CD A/C';
        if (head === 'CD COMMISSION A/C') head = 'CD INTEREST';
        else if (head === 'CD A/C' || head === 'CD PRINCIPAL') head = 'CD DISBURSEMENT';
        else if (head === 'CD DOCUMENT CHARGES A/C') head = 'CD DOCUMENT CHARGES';
        else if (head === 'PENALTY A/C') head = 'CD PENALTY';

        const normHead = normalizeHeadOfAccount(head);
        const transDate = entry.entry_date ? entry.entry_date.split('T')[0] : fromDateClean;
        const isNpaRelated = entry.entry_type === 'NPA_CLOSE' || 
                             entry.entry_type === 'NPA_WRITEOFF' || 
                             normHead === 'NPA WRITE-OFF / LOSS A/C' || 
                             normHead === 'CD LOAN RECEIVABLE A/C' ||
                             (entry.particulars && entry.particulars.toUpperCase().includes('NPA'));
        const cat = isNpaRelated ? 'NPA CLOSED' : 'CD';

        normalizedList.push({
          id: `CD_LEDGER:${entry.id}`,
          sourceType: 'CD_LEDGER',
          sourceRecordId: entry.id,
          transactionDate: transDate,
          headOfAccount: normHead,
          particulars: entry.particulars || '',
          receiptOrVoucherNo: entry.receipt_no || null,
          accountOrLoanNo: entry.loan?.loan_id || 'CD',
          debit: Number(entry.debit) || 0,
          credit: Number(entry.credit) || 0,
          userName: entry.user_name || 'Staff',
          entryTime: entry.created_at,
          createdAt: entry.created_at,
          reportClassification: getClassification(normHead),
          customerName: entry.customer?.name || null,
          partnerName: entry.loan?.partner_name || null,
          category: cat,
          loanCategory: entry.loan?.loan_category || 'CD',
          ...(entry.entry_type === 'NPA_WRITEOFF' ? (() => {
            const isParent = Number(entry.debit) > 0;
            const comp = String(entry.particulars || '').toUpperCase().match(/NPA CLOSE - (PRINCIPAL|INTEREST|PENALTY)/);
            return {
              npaGroupId: `NPA:${entry.loan_id}:${entry.receipt_no || transDate}`,
              npaRole: (isParent ? 'PARENT' : 'CHILD') as 'PARENT' | 'CHILD',
              npaComponent: (!isParent && comp ? comp[1] : null) as any,
              displayType: isParent ? 'NPA CLOSE' : null
            };
          })() : {})
        });
      });
    }

    if (ltEntries) {
      ltEntries.forEach((lt: any) => {
        // Skip if this receipt is already represented in CD ledger entries
        if (lt.receipt_no && cdReceiptSet.has(lt.receipt_no.trim().toUpperCase())) return;

        const lCat = lt.loan?.loan_category || (lt.loan_id?.startsWith('CD') ? 'CD' : (lt.loan_id?.startsWith('HP') ? 'HP' : (lt.loan_id?.startsWith('STBD') ? 'STBD' : (lt.loan_id?.startsWith('TBD') ? 'TBD' : 'LOAN'))));
        const isDisb = lt.type === 'Disbursement';

        // If disbursement already accounted for in cdEntries, skip to avoid double counting
        if (isDisb && lCat === 'CD' && lt.loan_id && cdDisbursementLoanIds.has(lt.loan_id)) return;

        const amt = Number(lt.amount) || 0;
        const transDate = lt.date ? lt.date.split('T')[0] : fromDateClean;
        const isNpa = (lt.remarks && lt.remarks.toUpperCase().includes('NPA')) || (lt.type === 'NPA Close');
        const cat = isNpa ? 'NPA CLOSED' : (lCat === 'LOAN' ? 'OTHER' : lCat);

        if (isDisb) {
          const normHead = normalizeHeadOfAccount(`${lCat} DISBURSEMENT`);
          normalizedList.push({
            id: `LOAN_TRANSACTION:${lt.id}`,
            sourceType: 'LOAN_TRANSACTION',
            sourceRecordId: lt.id,
            transactionDate: transDate,
            headOfAccount: normHead,
            particulars: lt.remarks || `Loan Disbursed - ${lt.loan?.loan_id || lt.loan_id || ''}`,
            receiptOrVoucherNo: lt.receipt_no || null,
            accountOrLoanNo: lt.loan?.loan_id || lt.loan_id || lCat,
            debit: amt,
            credit: 0,
            userName: lt.collected_by || 'Staff',
            entryTime: lt.created_at,
            createdAt: lt.created_at,
            reportClassification: getClassification(normHead),
            customerName: lt.loan?.customer?.name || null,
            category: cat,
            loanCategory: lCat
          });
        } else {
          // Collection Transaction: Split into Principal, Interest, Penalty, Doc Charges components
          const splits = extractLoanPaymentSplits(lt, lCat);
          const baseParticulars = lt.remarks || `Loan Collection - ${lt.loan?.loan_id || lt.loan_id || ''}`;
          const loanAcc = lt.loan?.loan_id || lt.loan_id || lCat;
          const custName = lt.loan?.customer?.name || null;

          // 1. Principal Component -> ${lCat} DISBURSEMENT (Credit)
          if (splits.principal > 0) {
            const headPrin = normalizeHeadOfAccount(`${lCat} DISBURSEMENT`);
            normalizedList.push({
              id: `LOAN_TRANSACTION_PRIN:${lt.id}`,
              sourceType: 'LOAN_TRANSACTION',
              sourceRecordId: lt.id,
              transactionDate: transDate,
              headOfAccount: headPrin,
              particulars: splits.interest > 0 || splits.penalty > 0 
                ? `${baseParticulars} [Principal: ₹${splits.principal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}]`
                : baseParticulars,
              receiptOrVoucherNo: lt.receipt_no || null,
              accountOrLoanNo: loanAcc,
              debit: 0,
              credit: splits.principal,
              userName: lt.collected_by || 'Staff',
              entryTime: lt.created_at,
              createdAt: lt.created_at,
              reportClassification: getClassification(headPrin),
              customerName: custName,
              category: cat,
              loanCategory: lCat
            });
          }

          // 2. Interest Component -> ${lCat} INTEREST (Credit)
          if (splits.interest > 0) {
            const headInt = normalizeHeadOfAccount(`${lCat} INTEREST`);
            normalizedList.push({
              id: `LOAN_TRANSACTION_INT:${lt.id}`,
              sourceType: 'LOAN_TRANSACTION',
              sourceRecordId: lt.id,
              transactionDate: transDate,
              headOfAccount: headInt,
              particulars: `${baseParticulars} [Interest: ₹${splits.interest.toLocaleString('en-IN', { minimumFractionDigits: 2 })}]`,
              receiptOrVoucherNo: lt.receipt_no || null,
              accountOrLoanNo: loanAcc,
              debit: 0,
              credit: splits.interest,
              userName: lt.collected_by || 'Staff',
              entryTime: lt.created_at,
              createdAt: lt.created_at,
              reportClassification: getClassification(headInt),
              customerName: custName,
              category: cat,
              loanCategory: lCat
            });
          }

          // 3. Penalty Component -> ${lCat} PENALTY (Credit)
          if (splits.penalty > 0) {
            const headPen = normalizeHeadOfAccount(`${lCat} PENALTY`);
            normalizedList.push({
              id: `LOAN_TRANSACTION_PEN:${lt.id}`,
              sourceType: 'LOAN_TRANSACTION',
              sourceRecordId: lt.id,
              transactionDate: transDate,
              headOfAccount: headPen,
              particulars: `${baseParticulars} [Penalty: ₹${splits.penalty.toLocaleString('en-IN', { minimumFractionDigits: 2 })}]`,
              receiptOrVoucherNo: lt.receipt_no || null,
              accountOrLoanNo: loanAcc,
              debit: 0,
              credit: splits.penalty,
              userName: lt.collected_by || 'Staff',
              entryTime: lt.created_at,
              createdAt: lt.created_at,
              reportClassification: getClassification(headPen),
              customerName: custName,
              category: cat,
              loanCategory: lCat
            });
          }

          // 4. Document Charges Component -> ${lCat} DOCUMENT CHARGES (Credit)
          if (splits.docCharges > 0) {
            const headDoc = normalizeHeadOfAccount(`${lCat} DOCUMENT CHARGES`);
            normalizedList.push({
              id: `LOAN_TRANSACTION_DOC:${lt.id}`,
              sourceType: 'LOAN_TRANSACTION',
              sourceRecordId: lt.id,
              transactionDate: transDate,
              headOfAccount: headDoc,
              particulars: `${baseParticulars} [Doc Charges: ₹${splits.docCharges.toLocaleString('en-IN', { minimumFractionDigits: 2 })}]`,
              receiptOrVoucherNo: lt.receipt_no || null,
              accountOrLoanNo: loanAcc,
              debit: 0,
              credit: splits.docCharges,
              userName: lt.collected_by || 'Staff',
              entryTime: lt.created_at,
              createdAt: lt.created_at,
              reportClassification: getClassification(headDoc),
              customerName: custName,
              category: cat,
              loanCategory: lCat
            });
          }
        }
      });
    }

    // CD numbers for the NPA register rows (the register stores only the loan's internal id)
    const npaLoanInfo = new Map<string, { loan_id: string; loan_category: string | null }>();
    const npaLoanIds = [...new Set((npaEntries || []).map((n: any) => n.loan_id).filter(Boolean))] as string[];
    try {
      for (let i = 0; i < npaLoanIds.length; i += 100) {
        const { data: lrows } = await supabase
          .from('finance_loans')
          .select('id, loan_id, loan_category')
          .in('id', npaLoanIds.slice(i, i + 100));
        (lrows || []).forEach((l: any) => npaLoanInfo.set(l.id, { loan_id: l.loan_id, loan_category: l.loan_category }));
      }
    } catch (lookupErr) {
      // Without the lookup the rows still show, just with the stored loan id
      console.warn('Could not look up CD numbers for NPA records:', lookupErr);
    }
    // Loans that have an "NPA Closed Payment" collection in finance_transactions (that row already shows the cash)
    const npaCashTxLoanIds = new Set<string>(
      (ltEntries || [])
        .filter((lt: any) => lt.loan_id && String(lt.remarks || '').toUpperCase().startsWith('NPA CLOSED PAYMENT'))
        .map((lt: any) => lt.loan_id)
    );

    if (npaEntries) {
      // One register record per loan (retries after an error saved duplicates): use the earliest
      const npaSorted = [...npaEntries].sort((a: any, b: any) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      const npaSeenLoans = new Set<string>();
      npaSorted.forEach((npa: any) => {
        if (npa.loan_id) {
          if (npaSeenLoans.has(npa.loan_id)) return;
          npaSeenLoans.add(npa.loan_id);
          // New NPA close flow: the CD ledger already holds the loss and its parts
          if (npaLedgerLoanIds.has(npa.loan_id)) return;
        }
        const matchedReceipt = npa.reason?.match(/RC\d+/i)?.[0] || null;
        if (matchedReceipt && cdReceiptSet.has(matchedReceipt.trim().toUpperCase())) return;

        const loanInfo = npaLoanInfo.get(npa.loan_id);
        const lCat = loanInfo?.loan_category || npa.loan_type || 'CD';
        const head = `${lCat} DISBURSEMENT`;
        const normHead = normalizeHeadOfAccount(head);
        const amt = Number(npa.settlement_amount || npa.paid_amount) || 0;
        const waivedAmt = Number(npa.waived_amount) || 0;
        const closedDate = (npa.closed_at || npa.created_at || fromDateClean).split('T')[0];
        const loanNo = loanInfo?.loan_id || npa.loan_id || lCat;

        // The cash part is skipped when the same money is already listed (collection row / same receipt)
        const cashAlreadyListed = npaCashTxLoanIds.has(npa.loan_id) || normalizedList.some(tx =>
          (tx.sourceRecordId === npa.id) ||
          (matchedReceipt && tx.receiptOrVoucherNo === matchedReceipt) ||
          (tx.accountOrLoanNo === loanNo && (tx.particulars || '').toUpperCase().includes('NPA'))
        );

        if (amt > 0 && !cashAlreadyListed) {
          normalizedList.push({
            id: `NPA_RECORD_CASH:${npa.id}`,
            sourceType: 'CD_LEDGER',
            sourceRecordId: npa.id,
            transactionDate: closedDate,
            headOfAccount: normHead,
            particulars: npa.reason ? `NPA Closed Payment - ${loanNo} - ${npa.customer_name} (${npa.reason})` : `NPA Closed Payment - ${loanNo} - ${npa.customer_name}`,
            receiptOrVoucherNo: matchedReceipt,
            accountOrLoanNo: loanNo,
            debit: 0,
            credit: amt,
            userName: npa.closed_by || 'Staff',
            entryTime: npa.closed_at || npa.created_at,
            createdAt: npa.closed_at || npa.created_at,
            reportClassification: getClassification(normHead),
            customerName: npa.customer_name,
            partnerName: npa.loan?.partner_name || null,
            category: 'NPA CLOSED',
            loanCategory: lCat
          });
        }

        if (waivedAmt > 0) {
          const r2 = (v: number) => Number((Number(v) || 0).toFixed(2));
          // Which parts the write-off clears: any cash received first covers penalty, then interest, then principal
          let cashLeft = Math.max(0, amt);
          const penDue = Math.max(0, Number(npa.penalty_due) || 0);
          const intDue = Math.max(0, Number(npa.interest_due) || 0);
          const penCash = Math.min(cashLeft, penDue); cashLeft -= penCash;
          const intCash = Math.min(cashLeft, intDue); cashLeft -= intCash;
          let woPenalty = r2(Math.min(waivedAmt, penDue - penCash));
          let woInterest = r2(Math.min(waivedAmt - woPenalty, intDue - intCash));
          let woPrincipal = r2(waivedAmt - woPenalty - woInterest);
          if (woPrincipal < 0) { woPrincipal = 0; woInterest = r2(waivedAmt - woPenalty); }

          const groupId = `NPA:${npa.loan_id || npa.id}:${matchedReceipt || closedDate}`;
          const writeoffParticulars = `NPA CLOSE - ${loanNo} - ${npa.customer_name}\nPrincipal: ₹${woPrincipal.toFixed(2)}  Interest: ₹${woInterest.toFixed(2)}  Penalty: ₹${woPenalty.toFixed(2)}\nWritten off as loss: ₹${waivedAmt.toFixed(2)}${amt > 0 ? ` (amount received: ₹${amt.toFixed(2)})` : ' (no amount received)'}${npa.reason ? `\nReason: ${npa.reason}` : ''}`;
          const common = {
            sourceType: 'CD_LEDGER' as const,
            sourceRecordId: npa.id,
            transactionDate: closedDate,
            receiptOrVoucherNo: matchedReceipt ? `WO-${matchedReceipt}` : null,
            accountOrLoanNo: loanNo,
            userName: npa.closed_by || 'Staff',
            entryTime: npa.closed_at || npa.created_at,
            createdAt: npa.closed_at || npa.created_at,
            customerName: npa.customer_name,
            partnerName: npa.loan?.partner_name || null,
            category: 'NPA CLOSED',
            loanCategory: lCat,
            npaGroupId: groupId
          };

          // Parent: the loss (Debit)
          normalizedList.push({
            ...common,
            id: `NPA_RECORD_WO_DR:${npa.id}`,
            headOfAccount: 'NPA WRITE-OFF / LOSS A/C',
            particulars: writeoffParticulars,
            debit: waivedAmt,
            credit: 0,
            reportClassification: 'PROFIT_AND_LOSS',
            npaRole: 'PARENT',
            npaComponent: null,
            displayType: 'NPA CLOSE'
          });

          // Children: the parts it clears (Credit) - together they equal the loss, so cash does not change
          const parts: Array<['PRINCIPAL' | 'INTEREST' | 'PENALTY', number]> = [['PRINCIPAL', woPrincipal], ['INTEREST', woInterest], ['PENALTY', woPenalty]];
          parts.forEach(([label, partAmt]) => {
            if (!(partAmt > 0)) return;
            normalizedList.push({
              ...common,
              id: `NPA_RECORD_WO_CR_${label}:${npa.id}`,
              headOfAccount: 'CD LOAN RECEIVABLE A/C',
              particulars: `NPA CLOSE - ${label} - ${loanNo} - ${npa.customer_name}`,
              debit: 0,
              credit: partAmt,
              reportClassification: 'BALANCE_SHEET',
              npaRole: 'CHILD',
              npaComponent: label,
              displayType: null
            });
          });
        }
      });
    }

    if (capEntries) {
      capEntries.forEach((cap: any) => {
        const pName = cap.partner?.name || cap.partner_name || 'Partner';
        const transDate = cap.entry_date ? cap.entry_date.split('T')[0] : fromDateClean;
        normalizedList.push({
          id: `CAPITAL_ENTRY:${cap.id}`,
          sourceType: 'CAPITAL_ENTRY',
          sourceRecordId: cap.id,
          transactionDate: transDate,
          headOfAccount: 'CAPITAL',
          particulars: cap.particulars || 'Capital Entry',
          receiptOrVoucherNo: null,
          accountOrLoanNo: pName,
          debit: Number(cap.debit) || 0,
          credit: Number(cap.credit) || 0,
          userName: cap.created_by || 'Staff',
          entryTime: cap.created_at,
          createdAt: cap.created_at,
          reportClassification: getClassification('CAPITAL'),
          partnerId: cap.partner_id || null,
          partnerName: pName,
          category: 'CAPITAL'
        });
      });
    }

    // Process Day Book entries
    if (cbEntries) {
      cbEntries.forEach((cb: any) => {
        const head = cb.head_of_account;
        const normHead = normalizeHeadOfAccount(head);
        const transDate = cb.entry_date ? cb.entry_date.split('T')[0] : fromDateClean;
        
        let cat: string = 'OTHER';
        const acc = accountsMap.get(normHead.toUpperCase()) || accountsMap.get(head.toUpperCase());
        if (acc?.category) {
          cat = acc.category;
        } else {
          if (normHead.toUpperCase().includes('BANK')) cat = 'BANK';
          else if (normHead.toUpperCase().includes('SALARY')) cat = 'SALARY';
          else if (getClassification(normHead) === 'PROFIT_AND_LOSS' && Number(cb.debit) > 0) cat = 'EXPENSE';
        }

        normalizedList.push({
          id: `DAY_BOOK_ENTRY:${cb.id}`,
          sourceType: 'DAY_BOOK_ENTRY',
          sourceRecordId: cb.id,
          transactionDate: transDate,
          headOfAccount: normHead,
          particulars: cb.particulars || '',
          receiptOrVoucherNo: null,
          accountOrLoanNo: cb.account_number || '—',
          debit: Number(cb.debit) || 0,
          credit: Number(cb.credit) || 0,
          userName: cb.created_by || 'Staff',
          entryTime: cb.created_at,
          createdAt: cb.created_at,
          reportClassification: getClassification(normHead),
          category: cat
        });
      });
    }

    // Deduplicate by stable ID (sourceType + sourceRecordId)
    const uniqueMap = new Map<string, DailyFinancialTransaction>();
    normalizedList.forEach(item => {
      uniqueMap.set(item.id, item);
    });

    const result = Array.from(uniqueMap.values()).sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) {
        return a.transactionDate.localeCompare(b.transactionDate);
      }
      const aTime = a.entryTime || '';
      const bTime = b.entryTime || '';
      if (aTime !== bTime) {
        return aTime.localeCompare(bTime);
      }
      return a.id.localeCompare(b.id);
    });

    console.log(`[DAILY REPORT DEBUG] Mapped & Deduplicated final rows: ${result.length}`);
    return result;
  },

  async getDailyReportActivityDates(params: {
    month: number;
    year: number;
    financeMode: 'REGULAR' | 'ITR';
  }): Promise<{ c_date: string }[]> {
    const { month, year, financeMode } = params;
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endFormatted = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    try {
      const monthTransactions = await this.getDailyFinancialTransactions({
        fromDate: startStr,
        toDate: endFormatted,
        financeMode
      });

      const datesSet = new Set<string>();
      monthTransactions.forEach(tx => {
        if (tx.transactionDate) {
          datesSet.add(tx.transactionDate);
        }
      });

      return Array.from(datesSet).map(d => ({ c_date: d }));
    } catch (error) {
      console.error('Error fetching daily report activity dates:', error);
      return [];
    }
  },

  async getNearestTransactionDate(params: {
    currentDate: string;
    direction: 'prev' | 'next';
    financeMode: 'REGULAR' | 'ITR';
  }): Promise<string | null> {
    const { currentDate, direction, financeMode } = params;
    const isPrev = direction === 'prev';
    const orderOptions = { ascending: !isPrev };
    const dateOnly = currentDate.split('T')[0];

    try {
      // 1. Fetch nearest from CD ledger entries
      let cdQuery = supabase
        .from('finance_cd_ledger_entries')
        .select('entry_date')
        .neq('account_name', 'CD Amount Paid');
      if (isPrev) {
        cdQuery = cdQuery.lt('entry_date', dateOnly);
      } else {
        cdQuery = cdQuery.gt('entry_date', `${dateOnly}T23:59:59.999Z`);
      }
      const { data: cdData } = await cdQuery
        .order('entry_date', orderOptions)
        .limit(1);

      // 2. Fetch nearest from Capital entries
      let capQuery = supabase
        .from('finance_capital_entries')
        .select('entry_date');
      if (isPrev) {
        capQuery = capQuery.lt('entry_date', dateOnly);
      } else {
        capQuery = capQuery.gt('entry_date', `${dateOnly}T23:59:59.999Z`);
      }
      const { data: capData } = await capQuery
        .order('entry_date', orderOptions)
        .limit(1);

      // 3. Fetch nearest from Loan transactions
      let ltQuery = supabase
        .from('finance_transactions')
        .select('date');
      if (isPrev) {
        ltQuery = ltQuery.lt('date', dateOnly);
      } else {
        ltQuery = ltQuery.gt('date', `${dateOnly}T23:59:59.999Z`);
      }
      const { data: ltData } = await ltQuery
        .order('date', orderOptions)
        .limit(1);

      // 4. Fetch nearest from NPA records
      let npaQuery = supabase
        .from('finance_npa_records')
        .select('closed_at');
      if (isPrev) {
        npaQuery = npaQuery.lt('closed_at', dateOnly);
      } else {
        npaQuery = npaQuery.gt('closed_at', `${dateOnly}T23:59:59.999Z`);
      }
      const { data: npaData } = await npaQuery
        .order('closed_at', orderOptions)
        .limit(1);

      // 5. Fetch nearest from Cashbook entries
      const { data: bookData } = await supabase
        .from('finance_books')
        .select('id')
        .eq('book_code', financeMode === 'ITR' ? 'ITR-LEGACY' : 'REG-LEGACY')
        .maybeSingle();

      let cbData: any[] = [];
      if (bookData?.id) {
        let cbQuery = supabase
          .from('finance_cashbook_entries')
          .select('entry_date')
          .eq('book_id', bookData.id);
        if (isPrev) {
          cbQuery = cbQuery.lt('entry_date', dateOnly);
        } else {
          cbQuery = cbQuery.gt('entry_date', `${dateOnly}T23:59:59.999Z`);
        }
        const { data: fetchedCb } = await cbQuery
          .order('entry_date', orderOptions)
          .limit(1);
        cbData = fetchedCb || [];
      }

      const dates: string[] = [];
      const extractDate = (val: any) => {
        if (typeof val === 'string') {
          const match = val.match(/^(\d{4}-\d{2}-\d{2})/);
          if (match) dates.push(match[1]);
        }
      };

      if (cdData?.[0]) extractDate(cdData[0].entry_date);
      if (capData?.[0]) extractDate(capData[0].entry_date);
      if (ltData?.[0]) extractDate(ltData[0].date);
      if (npaData?.[0]) extractDate(npaData[0].closed_at);
      if (cbData?.[0]) extractDate(cbData[0].entry_date);

      if (dates.length === 0) return null;

      // Sort dates
      dates.sort();
      if (isPrev) {
        // Nearest previous date is the largest of dates < currentDate
        return dates[dates.length - 1];
      } else {
        // Nearest future date is the smallest of dates > currentDate
        return dates[0];
      }
    } catch (err) {
      console.error('Error fetching nearest transaction date:', err);
      return null;
    }
  },

  async getOldestTransactionDate(): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('finance_loans')
        .select('date')
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Error fetching oldest loan date:', error);
        return '2020-01-01';
      }

      return (data as any)?.date ? (data as any).date.split('T')[0] : '2020-01-01';
    } catch (e) {
      console.error('Error getting oldest transaction date:', e);
      return '2020-01-01';
    }
  }
};
