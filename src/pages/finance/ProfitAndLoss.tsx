import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import React, { useEffect, useState, useMemo } from 'react';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { dailyFinancialTransactionService, DailyFinancialTransaction } from '../../services/dailyFinancialTransactionService';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import { 
  ArrowLeft, 
  RefreshCw, 
  Printer, 
  Download, 
  ChevronDown, 
  ChevronRight, 
  ExternalLink,
  Users,
  Building2,
  Wallet,
  ShieldCheck
} from 'lucide-react';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { exportToExcelMultiSheet } from '../../utils/excel';

export interface PLHeadMetric {
  name: string;
  opening: number;
  currentPeriod: number;
  total: number;
  percentage: number;
  ledgerCount: number;
  entries: DailyFinancialTransaction[];
}

export interface BSAccountBalanceItem {
  accountName: string;
  category: 'ASSET' | 'LIABILITY' | 'CAPITAL';
  opening: number;
  credit: number;
  debit: number;
  closing: number;
  netOutstandingAsset: number;
}

const formatDateOld = (dateStr?: string | null): string => {
  if (!dateStr) return '—';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

const getAdaptiveCardFontSize = (amount: number, minimumFractionDigits = 2, maxFractionDigits?: number) => {
  const opts = maxFractionDigits !== undefined ? { maximumFractionDigits: maxFractionDigits } : { minimumFractionDigits };
  const str = `₹ ${amount.toLocaleString('en-IN', opts)}`;
  const len = str.length;
  if (len >= 18) return 'text-[15px] sm:text-[17px] xl:text-[19px]';
  if (len >= 15) return 'text-[17px] sm:text-[19px] xl:text-[21px]';
  if (len >= 12) return 'text-[20px] sm:text-[22px] xl:text-[24px]';
  return 'text-[23px] sm:text-[26px] xl:text-[28px]';
};

const fmtINR = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2020-09-19" -> "19-Sep-2020"
const formatDateLong = (dateStr?: string | null): string => {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('T')[0].split('-');
  const mi = Number(m) - 1;
  return y && d && mi >= 0 && mi < 12 ? `${d}-${MONTHS[mi]}-${y}` : dateStr;
};

// Loan types shown in the "Total Loans Details" print section (only those with data)
type PLLoanType = 'CD' | 'STBD' | 'HP' | 'TBD';
const PL_LOAN_TYPES: PLLoanType[] = ['CD', 'STBD', 'HP', 'TBD'];

const loanTypeFromLoan = (loanId?: string | null, category?: string | null): PLLoanType | null => {
  const id = (loanId || '').toUpperCase();
  if (id.startsWith('STBD')) return 'STBD';
  if (id.startsWith('TBD')) return 'TBD';
  if (id.startsWith('HP')) return 'HP';
  if (id.startsWith('CD')) return 'CD';
  const c = (category || '').toUpperCase();
  return PL_LOAN_TYPES.find(t => c === t) || null;
};

// "CD DISBURSEMENT" / "STBD DISBURSEMENT" ... -> loan type (principal account of that type)
const loanTypeFromHead = (head?: string | null): PLLoanType | null => {
  const h = (head || '').toUpperCase().trim();
  if (!h.endsWith('DISBURSEMENT')) return null;
  if (h.startsWith('STBD')) return 'STBD';
  if (h.startsWith('TBD')) return 'TBD';
  if (h.startsWith('HP')) return 'HP';
  if (h.startsWith('CD')) return 'CD';
  return null;
};

interface PLLoanTypeStat {
  type: PLLoanType;
  issued: number;      // principal given out in the period
  collection: number;  // principal paid back in the period
  newLoans: number;    // loans opened in the period
  closedLoans: number; // loans closed in the period
}

const PLTotalLine: React.FC<{ label: string; value: number; tone: 'income' | 'expense' | 'neutral'; strong?: boolean }> = ({ label, value, tone, strong }) => {
  const color = tone === 'income' ? 'text-emerald-800 border-emerald-300' : tone === 'expense' ? 'text-rose-800 border-rose-300' : 'text-slate-900 border-slate-400';
  return (
    <div className="flex items-center justify-end gap-3">
      <span className={`text-right uppercase text-slate-700 ${strong ? 'text-[15px] font-black' : 'text-[14px] font-bold'}`}>{label}:</span>
      <span className={`min-w-[12rem] text-right font-mono tabular-nums whitespace-nowrap bg-white border-2 rounded px-3 py-1 ${color} ${strong ? 'text-[19px] font-black' : 'text-[17px] font-black'}`}>
        ₹ {fmtINR(value)}
      </span>
    </div>
  );
};

const ProfitAndLoss: React.FC = () => {
  const navigate = useNavigate();
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(() => getLocalBusinessDateISO());
  
  const [loading, setLoading] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  const [incomeHeads, setIncomeHeads] = useState<PLHeadMetric[]>([]);
  const [expenseHeads, setExpenseHeads] = useState<PLHeadMetric[]>([]);
  const [expandedHeadNames, setExpandedHeadNames] = useState<Set<string>>(new Set());
  const [partnerCount, setPartnerCount] = useState(1);

  const [openingCash, setOpeningCash] = useState(0);
  const [closingCash, setClosingCash] = useState(0);
  const [accountBalances, setAccountBalances] = useState<BSAccountBalanceItem[]>([]);
  const [loanStats, setLoanStats] = useState<PLLoanTypeStat[]>([]);

  const [financeMode] = useState<'REGULAR' | 'ITR'>(() => {
    const mode = sessionStorage.getItem('finance_previous_mode') || localStorage.getItem('finance_previous_mode');
    return mode === 'itr' ? 'ITR' : 'REGULAR';
  });

  const toggleExpandHead = (headName: string) => {
    setExpandedHeadNames(prev => {
      const next = new Set(prev);
      if (next.has(headName)) next.delete(headName);
      else next.add(headName);
      return next;
    });
  };

  useEffect(() => {
    const loadDefaultStartDate = async () => {
      try {
        const oldest = await dailyFinancialTransactionService.getOldestTransactionDate();
        if (oldest) {
          setStartDate(oldest);
        } else {
          const d = new Date();
          d.setMonth(d.getMonth() - 1);
          setStartDate(d.toISOString().split('T')[0]);
        }
      } catch (err) {
        console.error(err);
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        setStartDate(d.toISOString().split('T')[0]);
      }
    };
    loadDefaultStartDate();
  }, []);

  useEffect(() => {
    if (startDate) {
      fetchStatementData();
    }
  }, [startDate, endDate]);

  const isPrincipalOrCapitalHead = (headName: string): boolean => {
    const upper = (headName || '').toUpperCase();
    return (
      upper.includes('DISBURSEMENT') ||
      upper.includes('PRINCIPAL') ||
      upper.includes('RECEIVABLE') ||
      upper.includes('COLLECTION') ||
      upper === 'CD A/C' ||
      upper === 'CAPITAL' ||
      upper.startsWith('CAPITAL') ||
      upper.startsWith('BANK') ||
      upper.endsWith('BANK')
    );
  };

  const getBSCategory = (headName: string, closing: number): 'ASSET' | 'LIABILITY' | 'CAPITAL' => {
    const upper = (headName || '').toUpperCase();
    if (upper === 'CAPITAL' || upper.startsWith('CAPITAL') || upper.includes('EQUITY') || upper.includes('PARTNER')) {
      return 'CAPITAL';
    }
    if (
      upper.includes('DISBURSEMENT') ||
      upper.includes('PRINCIPAL') ||
      upper.includes('RECEIVABLE') ||
      upper.includes('LOAN') ||
      upper.includes('ADVANCE GIVEN') ||
      upper.includes('BANK') ||
      upper.includes('CASH') ||
      upper.includes('ASSET')
    ) {
      return 'ASSET';
    }
    if (
      upper.includes('BORROWING') ||
      upper.includes('PAYABLE') ||
      upper.includes('LIABILITY') ||
      upper.includes('ADVANCE RECEIVED') ||
      upper.includes('SUSPENSE')
    ) {
      return 'LIABILITY';
    }
    return closing <= 0 ? 'ASSET' : 'LIABILITY';
  };

  const fetchStatementData = async () => {
    setLoading(true);
    try {
      // 1. Calculate opening balances & cash: fetch all historical entries before startDate
      const prevDateLimit = new Date(startDate);
      prevDateLimit.setDate(prevDateLimit.getDate() - 1);
      const prevDateLimitStr = prevDateLimit.toISOString().split('T')[0];

      let prevTxs: DailyFinancialTransaction[] = [];
      if (startDate > '1970-01-01') {
        prevTxs = await dailyFinancialTransactionService.getDailyFinancialTransactions({
          fromDate: '1970-01-01',
          toDate: prevDateLimitStr,
          financeMode
        });
      }

      // 2. Fetch current range entries & partner list
      const [txs, partners] = await Promise.all([
        dailyFinancialTransactionService.getDailyFinancialTransactions({
          fromDate: startDate,
          toDate: endDate,
          financeMode
        }),
        supabaseFinance.getPartners()
      ]);

      setPartnerCount(partners.length || 1);

      // Compute opening cash
      let prevCash = 0;
      prevTxs.forEach(t => {
        prevCash += (t.credit - t.debit);
      });
      setOpeningCash(prevCash);

      // 3. Compute Profit & Loss Head Details
      // Principal disbursements / collections and capital are strictly excluded from P&L
      const prevIncomeMap = new Map<string, number>();
      const prevExpenseMap = new Map<string, number>();

      prevTxs.forEach(t => {
        const head = t.headOfAccount || 'UNCLASSIFIED';
        if (isPrincipalOrCapitalHead(head)) return;

        if (t.reportClassification === 'PROFIT_AND_LOSS') {
          if (t.credit > 0) {
            prevIncomeMap.set(head, (prevIncomeMap.get(head) || 0) + (t.credit - t.debit));
          }
          if (t.debit > 0) {
            prevExpenseMap.set(head, (prevExpenseMap.get(head) || 0) + (t.debit - t.credit));
          }
        }
      });

      const incomeEntriesMap = new Map<string, DailyFinancialTransaction[]>();
      const expenseEntriesMap = new Map<string, DailyFinancialTransaction[]>();

      txs.forEach(t => {
        const head = t.headOfAccount || 'UNCLASSIFIED';
        if (isPrincipalOrCapitalHead(head)) return;

        if (t.reportClassification === 'PROFIT_AND_LOSS') {
          if (t.credit > 0) {
            if (!incomeEntriesMap.has(head)) incomeEntriesMap.set(head, []);
            incomeEntriesMap.get(head)!.push(t);
          }
          if (t.debit > 0) {
            if (!expenseEntriesMap.has(head)) expenseEntriesMap.set(head, []);
            expenseEntriesMap.get(head)!.push(t);
          }
        }
      });

      const allIncomeHeadNames = new Set<string>([
        ...Array.from(prevIncomeMap.keys()),
        ...Array.from(incomeEntriesMap.keys())
      ]);

      const allExpenseHeadNames = new Set<string>([
        ...Array.from(prevExpenseMap.keys()),
        ...Array.from(expenseEntriesMap.keys())
      ]);

      // Calculate total current period income & expense for percentage allocation
      let totalCurrentIncome = 0;
      allIncomeHeadNames.forEach(head => {
        const entries = incomeEntriesMap.get(head) || [];
        entries.forEach(e => totalCurrentIncome += (e.credit - e.debit));
      });

      let totalCurrentExpense = 0;
      allExpenseHeadNames.forEach(head => {
        const entries = expenseEntriesMap.get(head) || [];
        entries.forEach(e => totalCurrentExpense += (e.debit - e.credit));
      });

      const finalIncomes: PLHeadMetric[] = Array.from(allIncomeHeadNames).map(head => {
        const op = prevIncomeMap.get(head) || 0;
        const entries = incomeEntriesMap.get(head) || [];
        const curr = entries.reduce((sum, e) => sum + (e.credit - e.debit), 0);
        const tot = op + curr;
        const pct = totalCurrentIncome > 0 ? (curr / totalCurrentIncome) * 100 : 0;

        return {
          name: head,
          opening: parseFloat(op.toFixed(2)),
          currentPeriod: parseFloat(curr.toFixed(2)),
          total: parseFloat(tot.toFixed(2)),
          percentage: parseFloat(pct.toFixed(1)),
          ledgerCount: entries.length,
          entries
        };
      });

      const finalExpenses: PLHeadMetric[] = Array.from(allExpenseHeadNames).map(head => {
        const op = prevExpenseMap.get(head) || 0;
        const entries = expenseEntriesMap.get(head) || [];
        const curr = entries.reduce((sum, e) => sum + (e.debit - e.credit), 0);
        const tot = op + curr;
        const pct = totalCurrentExpense > 0 ? (curr / totalCurrentExpense) * 100 : 0;

        return {
          name: head,
          opening: parseFloat(op.toFixed(2)),
          currentPeriod: parseFloat(curr.toFixed(2)),
          total: parseFloat(tot.toFixed(2)),
          percentage: parseFloat(pct.toFixed(1)),
          ledgerCount: entries.length,
          entries
        };
      });

      finalIncomes.sort((a, b) => b.currentPeriod - a.currentPeriod);
      finalExpenses.sort((a, b) => b.currentPeriod - a.currentPeriod);

      setIncomeHeads(finalIncomes);
      setExpenseHeads(finalExpenses);

      // Compute closing cash
      let currCredit = 0;
      let currDebit = 0;
      txs.forEach(t => {
        currCredit += t.credit;
        currDebit += t.debit;
      });
      setClosingCash(prevCash + currCredit - currDebit);

      // 4. Compute Balance Sheet Accounts (Assets, Liabilities & Capital)
      const bsHeads = new Set<string>();
      prevTxs.forEach(t => {
        if (t.reportClassification === 'BALANCE_SHEET' || isPrincipalOrCapitalHead(t.headOfAccount)) {
          bsHeads.add(t.headOfAccount);
        }
      });
      txs.forEach(t => {
        if (t.reportClassification === 'BALANCE_SHEET' || isPrincipalOrCapitalHead(t.headOfAccount)) {
          bsHeads.add(t.headOfAccount);
        }
      });

      const balances: BSAccountBalanceItem[] = Array.from(bsHeads).map(head => {
        let op = 0;
        prevTxs.filter(t => t.headOfAccount === head).forEach(t => {
          op += (t.credit - t.debit);
        });

        let cr = 0;
        let dr = 0;
        txs.filter(t => t.headOfAccount === head).forEach(t => {
          cr += t.credit;
          dr += t.debit;
        });

        const closing = op + cr - dr;
        const category = getBSCategory(head, closing);
        const netOutstandingAsset = category === 'ASSET' ? Math.abs(closing) : 0;

        return {
          accountName: head,
          category,
          opening: op,
          credit: cr,
          debit: dr,
          closing,
          netOutstandingAsset
        };
      });

      balances.sort((a, b) => a.accountName.localeCompare(b.accountName));
      setAccountBalances(balances);

      // 5. Total Loans Details (for the print): principal issued / paid back per loan type,
      //    from the same period entries, plus new / closed loan counts from the loans list
      const statMap = new Map<PLLoanType, PLLoanTypeStat>();
      const statFor = (t: PLLoanType) => {
        if (!statMap.has(t)) statMap.set(t, { type: t, issued: 0, collection: 0, newLoans: 0, closedLoans: 0 });
        return statMap.get(t)!;
      };
      txs.forEach(t => {
        const type = loanTypeFromHead(t.headOfAccount);
        if (!type) return;
        const st = statFor(type);
        st.issued += t.debit;
        st.collection += t.credit;
      });
      try {
        let loanRows: any[] = [];
        for (let page = 0; page < 50; page++) {
          const { data, error } = await supabase
            .from('finance_loans')
            .select('loan_id, loan_category, date, status, updated_at')
            .range(page * 1000, page * 1000 + 999);
          if (error) throw error;
          loanRows = loanRows.concat(data || []);
          if (!data || data.length < 1000) break;
        }
        const inRange = (d?: string | null) => {
          const day = (d || '').split('T')[0];
          return !!day && day >= startDate && day <= endDate;
        };
        loanRows.forEach(l => {
          const type = loanTypeFromLoan(l.loan_id, l.loan_category);
          if (!type) return;
          const st = statFor(type);
          if (inRange(l.date)) st.newLoans += 1;
          const status = (l.status || '').toUpperCase();
          // Loans have no separate closing date; the last update of a closed loan is its closing day
          if ((status === 'CLOSED' || status === 'NPA_CLOSED') && inRange(l.updated_at)) st.closedLoans += 1;
        });
      } catch (loanErr) {
        console.warn('Could not load loan counts for the P&L print:', loanErr);
      }
      setLoanStats(PL_LOAN_TYPES.map(t => statMap.get(t)).filter((x): x is PLLoanTypeStat => !!x));

    } catch (err) {
      console.error(err);
      toast.error('Failed to compile statement data');
    } finally {
      setLoading(false);
    }
  };

  const navigateToDetailedLedger = (head: string) => {
    navigate(`/finance/detailed-ledger?head=${encodeURIComponent(head)}&from=${startDate}&to=${endDate}`);
  };

  const totalIncome = useMemo(() => incomeHeads.reduce((sum, item) => sum + item.currentPeriod, 0), [incomeHeads]);
  const totalExpenses = useMemo(() => expenseHeads.reduce((sum, item) => sum + item.currentPeriod, 0), [expenseHeads]);
  const totalProfit = totalIncome - totalExpenses;
  const shareValue = partnerCount > 0 ? totalProfit / partnerCount : totalProfit;

  // Balance Sheet Categorized Items & Summaries
  const loanPrincipalAccounts = useMemo(() => 
    accountBalances.filter(acc => 
      acc.category === 'ASSET' && (
        acc.accountName.toUpperCase().includes('DISBURSEMENT') ||
        acc.accountName.toUpperCase().includes('PRINCIPAL') ||
        acc.accountName.toUpperCase().includes('RECEIVABLE')
      )
    ), [accountBalances]);

  const bankAndOtherAssetAccounts = useMemo(() => 
    accountBalances.filter(acc => 
      acc.category === 'ASSET' && !loanPrincipalAccounts.some(lp => lp.accountName === acc.accountName)
    ), [accountBalances, loanPrincipalAccounts]);

  const capitalAccounts = useMemo(() => 
    accountBalances.filter(acc => acc.category === 'CAPITAL'), [accountBalances]);

  const liabilityAccounts = useMemo(() => 
    accountBalances.filter(acc => acc.category === 'LIABILITY'), [accountBalances]);

  const totalLoanPrincipalReceivable = useMemo(() => 
    loanPrincipalAccounts.reduce((sum, acc) => sum + acc.netOutstandingAsset, 0), [loanPrincipalAccounts]);

  const totalBankAndOtherAssets = useMemo(() => 
    bankAndOtherAssetAccounts.reduce((sum, acc) => sum + acc.netOutstandingAsset, 0), [bankAndOtherAssetAccounts]);

  const totalAssets = useMemo(() => 
    totalLoanPrincipalReceivable + Math.max(0, closingCash) + totalBankAndOtherAssets, 
    [totalLoanPrincipalReceivable, closingCash, totalBankAndOtherAssets]);

  const totalCapitalContributed = useMemo(() => 
    capitalAccounts.reduce((sum, acc) => sum + acc.closing, 0), [capitalAccounts]);

  const totalOtherLiabilities = useMemo(() => 
    liabilityAccounts.reduce((sum, acc) => sum + Math.abs(acc.closing), 0), [liabilityAccounts]);

  const totalLiabilitiesAndCapital = useMemo(() => 
    totalCapitalContributed + totalOtherLiabilities + totalProfit, 
    [totalCapitalContributed, totalOtherLiabilities, totalProfit]);

  const netBusinessPosition = totalAssets - totalOtherLiabilities;

  // Only loan types that have any data in the period
  const loanStatsShown = useMemo(() =>
    loanStats.filter(s => s.issued > 0 || s.collection > 0 || s.newLoans > 0 || s.closedLoans > 0), [loanStats]);
  const loanStatsTotal = useMemo(() => loanStatsShown.reduce(
    (acc, s) => ({ issued: acc.issued + s.issued, collection: acc.collection + s.collection, newLoans: acc.newLoans + s.newLoans, closedLoans: acc.closedLoans + s.closedLoans }),
    { issued: 0, collection: 0, newLoans: 0, closedLoans: 0 }
  ), [loanStatsShown]);

  const handleExportExcel = () => {
    const plData = [
      ...incomeHeads.map(head => ({
        'Category': 'INCOME HEAD',
        'Head of Account': head.name,
        'Opening Balance': head.opening,
        'Current Period Amount': head.currentPeriod,
        'Total Amount': head.total,
        '% Share of Total Income': `${head.percentage}%`,
        'Ledger Count': head.ledgerCount
      })),
      { 'Category': 'TOTAL INCOME', 'Head of Account': '', 'Opening Balance': 0, 'Current Period Amount': totalIncome, 'Total Amount': totalIncome, '% Share of Total Income': '100%', 'Ledger Count': 0 },
      ...expenseHeads.map(head => ({
        'Category': 'EXPENSE HEAD',
        'Head of Account': head.name,
        'Opening Balance': head.opening,
        'Current Period Amount': head.currentPeriod,
        'Total Amount': head.total,
        '% Share of Total Expense': `${head.percentage}%`,
        'Ledger Count': head.ledgerCount
      })),
      { 'Category': 'TOTAL EXPENSES', 'Head of Account': '', 'Opening Balance': 0, 'Current Period Amount': totalExpenses, 'Total Amount': totalExpenses, '% Share of Total Expense': '100%', 'Ledger Count': 0 },
      { 'Category': 'NET PERIOD PROFIT', 'Head of Account': '', 'Opening Balance': 0, 'Current Period Amount': totalProfit, 'Total Amount': totalProfit, '% Share of Total Expense': '—', 'Ledger Count': 0 },
      { 'Category': 'EACH PARTNER PROFIT', 'Head of Account': '', 'Opening Balance': 0, 'Current Period Amount': shareValue, 'Total Amount': shareValue, '% Share of Total Expense': '—', 'Ledger Count': 0 }
    ];

    const bsData = [
      { 'Section': 'ASSETS', 'Account Name': 'Loan Principal / Receivables', 'Opening Balance': '—', 'Credit (Principal Repaid)': '—', 'Debit (Disbursed)': '—', 'Closing Balance / Outstanding': totalLoanPrincipalReceivable },
      { 'Section': 'ASSETS', 'Account Name': 'Cash in Hand', 'Opening Balance': openingCash, 'Credit': '—', 'Debit': '—', 'Closing Balance / Outstanding': closingCash },
      ...bankAndOtherAssetAccounts.map(item => ({
        'Section': 'ASSETS',
        'Account Name': item.accountName,
        'Opening Balance': Math.abs(item.opening),
        'Credit': item.credit,
        'Debit': item.debit,
        'Closing Balance / Outstanding': item.netOutstandingAsset
      })),
      { 'Section': 'TOTAL ASSETS', 'Account Name': '', 'Opening Balance': 0, 'Credit': 0, 'Debit': 0, 'Closing Balance / Outstanding': totalAssets },
      ...capitalAccounts.map(item => ({
        'Section': 'LIABILITIES & CAPITAL',
        'Account Name': item.accountName,
        'Opening Balance': item.opening,
        'Credit': item.credit,
        'Debit': item.debit,
        'Closing Balance / Outstanding': item.closing
      })),
      ...liabilityAccounts.map(item => ({
        'Section': 'LIABILITIES & CAPITAL',
        'Account Name': item.accountName,
        'Opening Balance': Math.abs(item.opening),
        'Credit': item.credit,
        'Debit': item.debit,
        'Closing Balance / Outstanding': Math.abs(item.closing)
      })),
      { 'Section': 'LIABILITIES & CAPITAL', 'Account Name': 'Current Period Net Profit', 'Opening Balance': 0, 'Credit': totalProfit, 'Debit': 0, 'Closing Balance / Outstanding': totalProfit },
      { 'Section': 'TOTAL LIABILITIES & CAPITAL', 'Account Name': '', 'Opening Balance': 0, 'Credit': 0, 'Debit': 0, 'Closing Balance / Outstanding': totalLiabilitiesAndCapital }
    ];

    const sheets = [
      { name: 'Profit & Loss Statement', data: plData },
      { name: 'Balance Sheet Statement', data: bsData }
    ];

    exportToExcelMultiSheet(sheets, `PL_and_Balance_Sheet_${startDate}_to_${endDate}`);
    toast.success('P&L & Balance Sheet exported to Excel!');
  };

  // One side of the T statement (incomes or expenses): Account | Amount, with drill-down
  const renderPLSide = (side: 'income' | 'expense') => {
    const isIncome = side === 'income';
    const heads = isIncome ? incomeHeads : expenseHeads;
    const amountColor = isIncome ? 'text-emerald-800' : 'text-rose-800';
    return (
      <div className="flex flex-col min-w-0">
        <div className={`px-3 py-2 text-center text-[15px] font-black uppercase tracking-wide border-b border-slate-300 ${isIncome ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>
          {isIncome ? 'Incomes' : 'Expenses'}
        </div>
        <table className="w-full border-collapse table-auto">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[12px] font-bold uppercase text-slate-500">
              <th className="w-8 px-1 py-1.5"></th>
              <th className="px-2 py-1.5 text-left">Account</th>
              <th className="px-2 py-1.5 text-right whitespace-nowrap">Amount (₹)</th>
              <th className="w-10 px-1 py-1.5 text-center">Ledger</th>
            </tr>
          </thead>
          <tbody>
            {heads.map((head) => {
              const isExpanded = expandedHeadNames.has(head.name);
              return (
                <React.Fragment key={head.name}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-1 py-2 text-center align-top">
                      <button
                        type="button"
                        onClick={() => toggleExpandHead(head.name)}
                        className="p-0.5 text-slate-400 hover:text-slate-700 rounded transition-colors cursor-pointer"
                        title={isExpanded ? 'Hide entries' : 'Show entries'}
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-700" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-[14px] font-bold uppercase text-slate-900 break-words align-top">
                      {head.name}
                      <span className="ml-1.5 text-[11px] font-semibold normal-case text-slate-400 whitespace-nowrap">({head.ledgerCount})</span>
                    </td>
                    <td className={`px-2 py-2 text-right font-mono tabular-nums text-[15px] font-black whitespace-nowrap align-top ${amountColor}`}>
                      {fmtINR(head.currentPeriod)}
                    </td>
                    <td className="px-1 py-2 text-center align-top">
                      <button
                        type="button"
                        onClick={() => navigateToDetailedLedger(head.name)}
                        title="Open ledger"
                        className="inline-flex items-center justify-center p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-slate-50">
                      <td colSpan={4} className="px-2 py-2 border-b border-slate-200">
                        <div className="bg-white rounded-lg border border-slate-200 p-2 space-y-1.5 shadow-sm">
                          <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700 border-b pb-1">
                            <span>ENTRIES ({head.ledgerCount})</span>
                            <button
                              onClick={() => navigateToDetailedLedger(head.name)}
                              className="text-slate-900 hover:underline font-bold text-[11px] inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              View Full Ledger <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="max-h-[260px] overflow-y-auto scrollbar-thin">
                            <table className="w-full text-[12px] text-left border-collapse table-auto">
                              <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold uppercase border-b border-slate-200">
                                <tr className="text-[12px]">
                                  <th className="p-1 whitespace-nowrap">Date</th>
                                  <th className="p-1 whitespace-nowrap">Receipt</th>
                                  <th className="p-1">Particulars</th>
                                  <th className="p-1 text-right text-emerald-700 whitespace-nowrap">Credit</th>
                                  <th className="p-1 text-right text-rose-700 whitespace-nowrap">Debit</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {head.entries.map((entry) => (
                                  <tr key={entry.id} className="hover:bg-slate-50 align-top text-[13px]">
                                    <td className="p-1 font-mono font-bold whitespace-nowrap">{formatDateOld(entry.transactionDate)}</td>
                                    <td className="p-1 font-mono font-bold whitespace-nowrap">{entry.receiptOrVoucherNo || '—'}</td>
                                    <td className="p-1 text-slate-700 break-words">{entry.particulars || '—'}</td>
                                    <td className="p-1 text-right font-mono tabular-nums text-emerald-700 font-bold whitespace-nowrap">{entry.credit > 0 ? fmtINR(entry.credit) : '—'}</td>
                                    <td className="p-1 text-right font-mono tabular-nums text-rose-700 font-bold whitespace-nowrap">{entry.debit > 0 ? fmtINR(entry.debit) : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {heads.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-6 text-slate-400 font-bold uppercase text-[13px] italic">
                  {isIncome ? 'No income recorded' : 'No expenses recorded'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6 w-full select-none pb-8 px-1 text-slate-900 font-sans">
      
      {/* Header Bar & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-slate-200 p-4 rounded-xl shadow-sm gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 leading-none">PROFIT &amp; LOSS / BALANCE SHEET</h1>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1.5">
            FINANCIAL PERFORMANCE &amp; POSITION AUDIT STATEMENT
          </p>
        </div>
        
        {/* Equal Width / Baseline Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            onClick={() => navigate(-1)} 
            variant="secondary" 
            size="sm" 
            icon={ArrowLeft} 
            className="h-[40px] min-w-[90px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Back
          </Button>
          <Button 
            onClick={fetchStatementData} 
            variant="secondary" 
            size="sm" 
            icon={RefreshCw} 
            className="h-[40px] min-w-[100px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Refresh
          </Button>
          <Button 
            onClick={() => setShowPrintPreview(true)} 
            variant="primary" 
            size="sm" 
            icon={Printer} 
            className="h-[40px] min-w-[90px] justify-center bg-slate-900 hover:bg-slate-800 text-white rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Print
          </Button>
          <Button 
            onClick={handleExportExcel} 
            variant="secondary" 
            size="sm" 
            icon={Download} 
            className="h-[40px] min-w-[90px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Excel
          </Button>
        </div>
      </div>

      {/* Row 1: Date Range Selector */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1">
            <FinanceSmartCalendar
              label="FROM DATE"
              value={startDate}
              onChange={setStartDate}
              module="PROFIT_LOSS"
              compact={true}
            />
          </div>
          <div className="flex-1">
            <FinanceSmartCalendar
              label="TO DATE"
              value={endDate}
              onChange={setEndDate}
              module="PROFIT_LOSS"
              compact={true}
            />
          </div>
        </div>
      </div>

      {/* SECTION 1: PROFIT & LOSS (Income vs Expense 50% / 50% Split) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-0.5 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-600"></span>
            <h2 className="text-base font-black uppercase text-slate-900 tracking-tight">
              Part 1: Income &amp; Expenses (Profit &amp; Loss)
            </h2>
          </div>
          <span className="text-xs font-bold text-slate-500 uppercase">Operating Income &amp; Expenses</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-slate-900"></div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden">
            {/* Statement title */}
            <div className="text-center py-3 border-b border-slate-200 bg-slate-50">
              <div className="text-[19px] font-black uppercase tracking-wide text-slate-900 leading-tight">Tirumala Finance</div>
              <div className="text-[14px] font-bold uppercase text-slate-600">
                Profit and Loss Statement · {formatDateLong(startDate)} to {formatDateLong(endDate)}
              </div>
            </div>

            {/* T statement: incomes on the left, expenses on the right */}
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-slate-300">
              {renderPLSide('income')}
              {renderPLSide('expense')}
            </div>

            {/* Totals under the statement */}
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-slate-300 border-t-2 border-slate-800 bg-slate-50">
              <div className="p-3 space-y-2">
                <PLTotalLine label="Total Incomes" value={totalIncome} tone="income" />
                <PLTotalLine
                  label={totalProfit >= 0 ? 'Total Profit' : 'Total Loss'}
                  value={totalProfit}
                  tone={totalProfit >= 0 ? 'income' : 'expense'}
                  strong
                />
              </div>
              <div className="p-3 space-y-2">
                <PLTotalLine label="Total Expenses" value={totalExpenses} tone="expense" />
                <PLTotalLine
                  label={`Each Partner Profit (${partnerCount})`}
                  value={shareValue}
                  tone="neutral"
                  strong
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: BALANCE SHEET */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between px-0.5 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-600"></span>
            <h2 className="text-base font-black uppercase text-slate-900 tracking-tight">
              Part 2: What We Own &amp; What We Owe (Balance Sheet)
            </h2>
          </div>
          <span className="text-xs font-bold text-slate-500 uppercase">What We Own &amp; Partners’ Money</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-slate-900"></div>
          </div>
        ) : (
          <div className="space-y-4">
            
            {/* 4 Balance Sheet KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* Loan Principal Receivables */}
              <div className="bg-white border border-blue-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] bg-gradient-to-b from-blue-50/20 to-white">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-800">Loans Given Out</span>
                  <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                </div>
                <div className="text-right">
                  <div className={`font-black font-mono text-blue-900 tracking-tight leading-none ${getAdaptiveCardFontSize(totalLoanPrincipalReceivable)}`}>
                    ₹ {totalLoanPrincipalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">Principal still to be collected</span>
                </div>
              </div>

              {/* Cash & Bank Balances */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] hover:border-slate-300 transition-all">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Cash in Hand</span>
                  <Wallet className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
                <div className="text-right">
                  <div className={`font-black font-mono text-slate-900 tracking-tight leading-none ${getAdaptiveCardFontSize(closingCash)}`}>
                    ₹ {closingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">Opening: ₹ {openingCash.toLocaleString('en-IN')}</span>
                </div>
              </div>

              {/* Total Capital Contributed */}
              <div className="bg-white border border-purple-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] bg-gradient-to-b from-purple-50/20 to-white">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-800">Partners’ Money</span>
                  <Users className="w-4 h-4 text-purple-600 shrink-0" />
                </div>
                <div className="text-right">
                  <div className={`font-black font-mono text-purple-900 tracking-tight leading-none ${getAdaptiveCardFontSize(totalCapitalContributed)}`}>
                    ₹ {totalCapitalContributed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">Total money put in by partners</span>
                </div>
              </div>

              {/* Total Balance Sheet Assets */}
              <div className="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] bg-gradient-to-b from-emerald-50/20 to-white">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Total We Own</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                </div>
                <div className="text-right">
                  <div className={`font-black font-mono text-emerald-800 tracking-tight leading-none ${getAdaptiveCardFontSize(totalAssets)}`}>
                    ₹ {totalAssets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">Net Worth: ₹ {netBusinessPosition.toLocaleString('en-IN')}</span>
                </div>
              </div>

            </div>

            {/* Assets vs Liabilities & Capital 2-Column Overview Card */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* ASSETS SUMMARY CARD */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-3.5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                    What We Own
                  </h3>
                  <span className="font-mono font-black text-blue-900 text-xs sm:text-sm">
                    ₹ {totalAssets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="p-4 space-y-3 font-mono text-xs flex-1">
                  
                  {/* Loan Principal Receivables */}
                  <div className="p-3 rounded-lg bg-blue-50/40 border border-blue-100 flex justify-between items-center">
                    <div>
                      <div className="font-sans font-bold text-slate-900 uppercase">Loan Money Given Out (Not Yet Repaid)</div>
                      <div className="text-[11px] text-slate-500 font-sans mt-0.5">Loans given out minus principal repaid</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-blue-900 text-sm sm:text-base">
                        ₹ {totalLoanPrincipalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-blue-700 font-sans font-bold">Still to collect</div>
                    </div>
                  </div>

                  {/* Cash in Hand */}
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex justify-between items-center">
                    <div>
                      <div className="font-sans font-bold text-slate-900 uppercase">Cash in Hand (Closing)</div>
                      <div className="text-[11px] text-slate-500 font-sans mt-0.5">Opening: ₹ {openingCash.toLocaleString('en-IN')}</div>
                    </div>
                    <div className="text-right font-black text-slate-900 text-sm sm:text-base">
                      ₹ {closingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* Bank & Other Assets */}
                  {bankAndOtherAssetAccounts.map((acc, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex justify-between items-center">
                      <div>
                        <div className="font-sans font-bold text-slate-900 uppercase">{acc.accountName}</div>
                        <div className="text-[11px] text-slate-500 font-sans mt-0.5">Something we own</div>
                      </div>
                      <div className="text-right font-black text-slate-900 text-sm sm:text-base">
                        ₹ {acc.netOutstandingAsset.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))}

                </div>
                <div className="p-3 bg-slate-100/80 border-t border-slate-200 flex justify-between items-center font-mono font-black text-xs">
                  <span className="font-sans font-bold uppercase text-slate-700">TOTAL WE OWN</span>
                  <span className="text-blue-900 text-sm sm:text-base">₹ {totalAssets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* LIABILITIES & CAPITAL SUMMARY CARD */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-3.5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-600"></span>
                    What We Owe (Partners’ Money &amp; Profit)
                  </h3>
                  <span className="font-mono font-black text-purple-900 text-xs sm:text-sm">
                    ₹ {totalLiabilitiesAndCapital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="p-4 space-y-3 font-mono text-xs flex-1">
                  
                  {/* Capital Contributed */}
                  <div className="p-3 rounded-lg bg-purple-50/40 border border-purple-100 flex justify-between items-center">
                    <div>
                      <div className="font-sans font-bold text-slate-900 uppercase">Money Put In by Partners</div>
                      <div className="text-[11px] text-slate-500 font-sans mt-0.5">Capital given by partners</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-purple-900 text-sm sm:text-base">
                        ₹ {totalCapitalContributed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-purple-700 font-sans font-bold">Partners’ money</div>
                    </div>
                  </div>

                  {/* Net Period Profit */}
                  <div className="p-3 rounded-lg bg-emerald-50/40 border border-emerald-100 flex justify-between items-center">
                    <div>
                      <div className="font-sans font-bold text-slate-900 uppercase">Profit for This Period</div>
                      <div className="text-[11px] text-slate-500 font-sans mt-0.5">Total Income - Total Expenses</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-black text-sm sm:text-base ${totalProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        ₹ {totalProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-emerald-700 font-sans font-bold">Profit kept in business</div>
                    </div>
                  </div>

                  {/* Other Liabilities */}
                  {liabilityAccounts.map((acc, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex justify-between items-center">
                      <div>
                        <div className="font-sans font-bold text-slate-900 uppercase">{acc.accountName}</div>
                        <div className="text-[11px] text-slate-500 font-sans mt-0.5">Something we owe</div>
                      </div>
                      <div className="text-right font-black text-slate-900 text-sm sm:text-base">
                        ₹ {Math.abs(acc.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))}

                </div>
                <div className="p-3 bg-slate-100/80 border-t border-slate-200 flex justify-between items-center font-mono font-black text-xs">
                  <span className="font-sans font-bold uppercase text-slate-700">TOTAL WE OWE (PARTNERS + PROFIT)</span>
                  <span className="text-purple-900 text-sm sm:text-base">₹ {totalLiabilitiesAndCapital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

            </div>

            {/* Balance Sheet Accounts Audit Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-3.5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Account-wise Balances
                </h3>
                <span className="text-xs font-bold uppercase text-slate-500">
                  {accountBalances.length} Accounts
                </span>
              </div>

              {accountBalances.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-bold uppercase text-xs italic">
                  No balance sheet accounts recorded.
                </div>
              ) : (
                <div className="max-h-[380px] overflow-y-auto scrollbar-thin">
                  <table className="w-full text-[13px] text-left border-collapse table-auto">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 uppercase tracking-wider text-[11px] font-bold border-b border-slate-200">
                      <tr>
                        <th className="w-12 px-2 py-2 text-center">S.No</th>
                        <th className="px-2 py-2">Account Name</th>
                        <th className="px-2 py-2 text-center">Category</th>
                        <th className="px-2 py-2 text-right text-slate-500 whitespace-nowrap">Opening Balance</th>
                        <th className="px-2 py-2 text-right text-emerald-700 whitespace-nowrap">Credit</th>
                        <th className="px-2 py-2 text-right text-rose-700 whitespace-nowrap">Debit</th>
                        <th className="px-2 py-2 text-right text-slate-900 whitespace-nowrap">Closing Balance</th>
                        <th className="px-2 py-2 text-center whitespace-nowrap">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 bg-white font-mono">
                      {accountBalances.map((acc, idx) => (
                        <tr 
                          key={idx} 
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-2 py-2 text-center text-slate-400 font-bold">{idx + 1}</td>
                          <td className="px-2 py-2 text-slate-900 font-sans font-bold uppercase break-words">
                            {acc.accountName}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-sans font-bold uppercase ${
                              acc.category === 'ASSET' ? 'bg-blue-100 text-blue-800' :
                              acc.category === 'CAPITAL' ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {acc.category}
                            </span>
                          </td>
                          <td className={`px-2 py-2 text-right font-bold whitespace-nowrap ${acc.opening >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {Math.abs(acc.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {acc.opening >= 0 ? 'Cr' : 'Dr'}
                          </td>
                          <td className="px-2 py-2 text-emerald-700 text-right font-bold whitespace-nowrap">
                            {acc.credit > 0 ? acc.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="px-2 py-2 text-rose-700 text-right font-bold whitespace-nowrap">
                            {acc.debit > 0 ? acc.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className={`px-2 py-2 text-right font-black whitespace-nowrap ${acc.closing >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                            {Math.abs(acc.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {acc.closing >= 0 ? 'Cr' : 'Dr'}
                          </td>
                          <td className="px-2 py-2 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => navigateToDetailedLedger(acc.accountName)}
                              className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 text-[10px] font-sans font-bold hover:underline"
                            >
                              <span>Ledger</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* P&L & Balance Sheet print (A4 portrait) */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="Profit & Loss & Balance Sheet Statement"
        documentTitle="Gajwel, Dist: Siddipet, Telangana"
        orientation="portrait"
      >
        <div className="pl-print">
          <style>{`
            .pl-print { max-width: 190mm; margin: 0 auto; color: #000; font-family: Arial, Helvetica, sans-serif; }
            .pl-print .pl-period { display: flex; justify-content: space-between; align-items: baseline; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 5px 2px; margin-bottom: 10px; font-size: 13px; font-weight: bold; }
            .pl-print .pl-section { text-align: center; font-size: 14px; font-weight: 900; margin: 14px 0 5px; letter-spacing: 0.5px; }
            .pl-print table { width: 100%; border-collapse: collapse; table-layout: auto; margin-bottom: 4px; }
            .pl-print th, .pl-print td { border: 1px solid #444; padding: 4px 6px; font-size: 12px; line-height: 1.3; vertical-align: top; }
            .pl-print th { background: #eef0f3; font-weight: bold; text-align: left; }
            .pl-print .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-family: 'Courier New', monospace; font-weight: bold; }
            .pl-print .ctr { text-align: center; }
            .pl-print th.num { font-family: inherit; }
            .pl-print tr.tot td { font-weight: 900; background: #f3f4f6; border-top: 2px solid #000; }
            .pl-print .gap td { border: none; height: 4px; padding: 0; }
            @media print {
              .print-document .pl-print th, .print-document .pl-print td { font-size: 9.5pt !important; padding: 3px 5px !important; border: 1px solid #000 !important; line-height: 1.3 !important; vertical-align: top !important; }
              .print-document .pl-print th { background: #eef0f3 !important; }
              .print-document .pl-print .num { white-space: nowrap !important; text-align: right !important; }
              .print-document .pl-print tr.tot td { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .print-document .pl-print .gap td { border: none !important; padding: 0 !important; }
            }
          `}</style>

          <div className="pl-period">
            <span>From: {formatDateLong(startDate)} &nbsp; To: {formatDateLong(endDate)}</span>
            <span>Profit &amp; Loss and Balance Sheet</span>
          </div>

          {/* Total Loans Details */}
          <div className="pl-section">TOTAL LOANS DETAILS</div>
          <table>
            <thead>
              <tr>
                <th>Loan Type</th>
                <th className="num">Loans Issued (₹)</th>
                <th className="num">Collection (₹)</th>
                <th className="num">Balance (₹)</th>
                <th className="num">New Loans</th>
                <th className="num">Closed Loans</th>
                <th className="num">Running</th>
              </tr>
            </thead>
            <tbody>
              {loanStatsShown.map(s => (
                <tr key={s.type}>
                  <td>{s.type}</td>
                  <td className="num">{fmtINR(s.issued)}</td>
                  <td className="num">{fmtINR(s.collection)}</td>
                  <td className="num">{fmtINR(s.issued - s.collection)}</td>
                  <td className="num">{s.newLoans}</td>
                  <td className="num">{s.closedLoans}</td>
                  <td className="num">{s.newLoans - s.closedLoans}</td>
                </tr>
              ))}
              {loanStatsShown.length === 0 && (
                <tr><td colSpan={7} className="ctr">No loans in this period</td></tr>
              )}
              {loanStatsShown.length > 0 && (
                <tr className="tot">
                  <td>Total</td>
                  <td className="num">{fmtINR(loanStatsTotal.issued)}</td>
                  <td className="num">{fmtINR(loanStatsTotal.collection)}</td>
                  <td className="num">{fmtINR(loanStatsTotal.issued - loanStatsTotal.collection)}</td>
                  <td className="num">{loanStatsTotal.newLoans}</td>
                  <td className="num">{loanStatsTotal.closedLoans}</td>
                  <td className="num">{loanStatsTotal.newLoans - loanStatsTotal.closedLoans}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ fontSize: '10px', color: '#444' }}>
            Collection = loan principal paid back. Balance = Loans Issued − Collection. Running = New Loans − Closed Loans.
          </div>

          {/* Profit & Loss Details */}
          <div className="pl-section">PROFIT &amp; LOSS DETAILS</div>
          <table>
            <thead>
              <tr>
                <th>Income</th>
                <th className="num">Amount (₹)</th>
                <th>Expenditure</th>
                <th className="num">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(incomeHeads.length, expenseHeads.length, 1) }).map((_, i) => {
                const inc = incomeHeads[i];
                const exp = expenseHeads[i];
                return (
                  <tr key={i}>
                    <td>{inc ? inc.name : ''}</td>
                    <td className="num">{inc ? fmtINR(inc.currentPeriod) : ''}</td>
                    <td>{exp ? exp.name : ''}</td>
                    <td className="num">{exp ? fmtINR(exp.currentPeriod) : ''}</td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td>Total Income</td>
                <td className="num">{fmtINR(totalIncome)}</td>
                <td>Total Expenditure</td>
                <td className="num">{fmtINR(totalExpenses)}</td>
              </tr>
              <tr className="gap"><td colSpan={4}></td></tr>
              <tr className="tot">
                <td>{totalProfit >= 0 ? 'Total Profit' : 'Total Loss'}</td>
                <td className="num">{fmtINR(totalProfit)}</td>
                <td>Cash Balance</td>
                <td className="num">{fmtINR(closingCash)}</td>
              </tr>
              <tr className="tot">
                <td>Each Partner Profit ({partnerCount})</td>
                <td className="num">{fmtINR(shareValue)}</td>
                <td>Total Capital</td>
                <td className="num">{fmtINR(totalCapitalContributed)}</td>
              </tr>
            </tbody>
          </table>

          {/* Balance Sheet */}
          <div className="pl-section">BALANCE SHEET (WHAT WE OWN &amp; WHAT WE OWE)</div>
          <table>
            <thead>
              <tr>
                <th>What We Own</th>
                <th className="num">Amount (₹)</th>
                <th>What We Owe</th>
                <th className="num">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const own: { name: string; amount: number }[] = [
                  { name: 'Loan Money Given Out (Not Yet Repaid)', amount: totalLoanPrincipalReceivable },
                  { name: 'Cash in Hand', amount: closingCash },
                  ...bankAndOtherAssetAccounts.map(a => ({ name: a.accountName, amount: a.netOutstandingAsset }))
                ];
                const owe: { name: string; amount: number }[] = [
                  { name: 'Money Put In by Partners', amount: totalCapitalContributed },
                  { name: totalProfit >= 0 ? 'Profit for This Period' : 'Loss for This Period', amount: totalProfit },
                  ...liabilityAccounts.map(a => ({ name: a.accountName, amount: Math.abs(a.closing) }))
                ];
                return Array.from({ length: Math.max(own.length, owe.length) }).map((_, i) => (
                  <tr key={i}>
                    <td>{own[i]?.name || ''}</td>
                    <td className="num">{own[i] ? fmtINR(own[i].amount) : ''}</td>
                    <td>{owe[i]?.name || ''}</td>
                    <td className="num">{owe[i] ? fmtINR(owe[i].amount) : ''}</td>
                  </tr>
                ));
              })()}
              <tr className="tot">
                <td>Total We Own</td>
                <td className="num">{fmtINR(totalAssets)}</td>
                <td>Total We Owe</td>
                <td className="num">{fmtINR(totalLiabilitiesAndCapital)}</td>
              </tr>
            </tbody>
          </table>

          {/* Account-wise balances */}
          {accountBalances.length > 0 && (
            <>
              <div className="pl-section">ACCOUNT-WISE BALANCES</div>
              <table>
                <thead>
                  <tr>
                    <th className="ctr">S.No</th>
                    <th>Account</th>
                    <th className="ctr">Type</th>
                    <th className="num">Opening</th>
                    <th className="num">Credit</th>
                    <th className="num">Debit</th>
                    <th className="num">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {accountBalances.map((acc, idx) => (
                    <tr key={idx}>
                      <td className="ctr">{idx + 1}</td>
                      <td>{acc.accountName}</td>
                      <td className="ctr">{acc.category}</td>
                      <td className="num">{fmtINR(Math.abs(acc.opening))} {acc.opening >= 0 ? 'Cr' : 'Dr'}</td>
                      <td className="num">{acc.credit > 0 ? fmtINR(acc.credit) : '—'}</td>
                      <td className="num">{acc.debit > 0 ? fmtINR(acc.debit) : '—'}</td>
                      <td className="num">{fmtINR(Math.abs(acc.closing))} {acc.closing >= 0 ? 'Cr' : 'Dr'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </FinancePrintPreview>

    </div>
  );
};

export default ProfitAndLoss;
