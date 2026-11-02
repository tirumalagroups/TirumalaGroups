import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import React, { useEffect, useState, useMemo } from 'react';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { dailyFinancialTransactionService, DailyFinancialTransaction } from '../../services/dailyFinancialTransactionService';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { 
  ArrowLeft, 
  RefreshCw, 
  Printer, 
  Download, 
  ChevronDown, 
  ChevronRight, 
  ExternalLink,
  TrendingUp,
  TrendingDown,
  DollarSign,
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
      { 'Category': 'PER PARTNER SHARE', 'Head of Account': '', 'Opening Balance': 0, 'Current Period Amount': shareValue, 'Total Amount': shareValue, '% Share of Total Expense': '—', 'Ledger Count': 0 }
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

        {/* 4 Primary P&L KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Total Income */}
          <div className="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] hover:border-emerald-300 transition-all bg-gradient-to-b from-emerald-50/20 to-white">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total Income</span>
              <TrendingUp className="w-4 h-4 text-emerald-500 shrink-0" />
            </div>
            <div className="text-right">
              <div className={`font-black font-mono text-emerald-700 tracking-tight leading-none ${getAdaptiveCardFontSize(totalIncome)}`}>
                ₹ {totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">Across {incomeHeads.length} Income Heads</span>
            </div>
          </div>

          {/* Total Expenses */}
          <div className="bg-white border border-rose-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] hover:border-rose-300 transition-all bg-gradient-to-b from-rose-50/20 to-white">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Total Expenses</span>
              <TrendingDown className="w-4 h-4 text-rose-500 shrink-0" />
            </div>
            <div className="text-right">
              <div className={`font-black font-mono text-rose-700 tracking-tight leading-none ${getAdaptiveCardFontSize(totalExpenses)}`}>
                ₹ {totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">Across {expenseHeads.length} Expense Heads</span>
            </div>
          </div>

          {/* Net Profit / Loss */}
          <div className={`bg-white border ${totalProfit >= 0 ? 'border-emerald-200 bg-gradient-to-b from-emerald-50/20 to-white' : 'border-rose-200 bg-gradient-to-b from-rose-50/20 to-white'} rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] transition-all`}>
            <div className="flex justify-between items-center">
              <span className={`text-xs font-bold uppercase tracking-wider ${totalProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                Net Profit / Loss
              </span>
              <DollarSign className={`w-4 h-4 shrink-0 ${totalProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`} />
            </div>
            <div className="text-right">
              <div className={`font-black font-mono tracking-tight leading-none ${totalProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'} ${getAdaptiveCardFontSize(totalProfit)}`}>
                ₹ {totalProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">
                {totalProfit >= 0 ? 'Net Period Surplus' : 'Net Period Deficit'}
              </span>
            </div>
          </div>

          {/* Partner Share */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[110px] hover:border-slate-300 transition-all">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Partner Share ({partnerCount})
              </span>
              <Users className="w-4 h-4 text-slate-400 shrink-0" />
            </div>
            <div className="text-right">
              <div className={`font-black font-mono text-slate-900 tracking-tight leading-none ${getAdaptiveCardFontSize(shareValue, 0, 0)}`}>
                ₹ {shareValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-1.5">Per Partner Distribution</span>
            </div>
          </div>

        </div>

        {loading ? (
          <div className="flex justify-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-slate-900"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Income Accounts Table Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
              <div className="p-3.5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                  Income Heads (Interest, Penalty, etc.)
                </h3>
                <span className="font-mono font-black text-emerald-700 text-xs sm:text-sm whitespace-nowrap">
                  ₹ {totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="overflow-x-auto flex-1 max-h-[420px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-xs text-left border-collapse min-w-[500px]">
                  <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-600 uppercase tracking-wider text-[10px] sm:text-[11px] font-bold border-b border-slate-200">
                    <tr>
                      <th className="w-7 px-1.5 py-2.5 text-center"></th>
                      <th className="px-2 py-2.5">Account</th>
                      <th className="px-2 py-2.5 text-right text-slate-500 whitespace-nowrap">Opening</th>
                      <th className="px-2 py-2.5 text-right text-emerald-700 whitespace-nowrap">Current Period</th>
                      <th className="px-2 py-2.5 text-right text-slate-900 whitespace-nowrap">Total</th>
                      <th className="px-2 py-2.5 text-right text-slate-500 whitespace-nowrap">% Share</th>
                      <th className="px-2 py-2.5 text-center whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 bg-white text-[11px]">
                    {incomeHeads.map((head) => {
                      const isExpanded = expandedHeadNames.has(head.name);
                      return (
                        <React.Fragment key={head.name}>
                          <tr className="hover:bg-slate-50 transition-colors">
                            <td className="px-1.5 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => toggleExpandHead(head.name)}
                                className="p-0.5 text-slate-400 hover:text-slate-700 rounded transition-colors cursor-pointer"
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-700" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                              </button>
                            </td>
                            <td className="px-2 py-2 font-bold text-slate-900 uppercase truncate max-w-[140px]" title={head.name}>
                              {head.name}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-500 whitespace-nowrap">
                              {head.opening !== 0 ? head.opening.toLocaleString('en-IN') : '—'}
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                              {head.currentPeriod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                              {head.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-600 whitespace-nowrap">{head.percentage}%</td>
                            <td className="px-2 py-2 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => navigateToDetailedLedger(head.name)}
                                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 text-[10px] font-bold hover:underline"
                              >
                                <span>Ledger</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>

                          {/* Expandable Sub-table */}
                          {isExpanded && (
                            <tr className="bg-slate-50">
                              <td colSpan={7} className="px-2 py-2 border-y border-slate-200">
                                <div className="bg-white rounded-lg border border-slate-200 p-2 space-y-1.5 shadow-sm">
                                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-700 border-b pb-1">
                                    <span>TRANSACTION BREAKDOWN ({head.ledgerCount} entries)</span>
                                    <button 
                                      onClick={() => navigateToDetailedLedger(head.name)}
                                      className="text-slate-900 hover:underline font-bold text-[10px] inline-flex items-center gap-1"
                                    >
                                      View Full Ledger <ExternalLink className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="overflow-x-auto max-h-[260px] overflow-y-auto scrollbar-thin">
                                    <table className="w-full text-[10px] text-left border-collapse">
                                      <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold uppercase border-b border-slate-200">
                                        <tr>
                                          <th className="p-1 whitespace-nowrap">Date</th>
                                          <th className="p-1 whitespace-nowrap">Source</th>
                                          <th className="p-1 whitespace-nowrap">Receipt</th>
                                          <th className="p-1 whitespace-nowrap">Particulars</th>
                                          <th className="p-1 text-right text-emerald-700 whitespace-nowrap">Credit</th>
                                          <th className="p-1 text-right text-rose-700 whitespace-nowrap">Debit</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-150 font-mono">
                                        {head.entries.map((entry) => (
                                          <tr key={entry.id} className="hover:bg-slate-50">
                                            <td className="p-1 font-bold whitespace-nowrap">{formatDateOld(entry.transactionDate)}</td>
                                            <td className="p-1 text-slate-600 whitespace-nowrap">{entry.sourceType}</td>
                                            <td className="p-1 font-bold whitespace-nowrap">{entry.receiptOrVoucherNo || '—'}</td>
                                            <td className="p-1 font-sans text-slate-700 truncate max-w-[140px]" title={entry.particulars}>{entry.particulars || '—'}</td>
                                            <td className="p-1 text-right text-emerald-700 font-bold whitespace-nowrap">{entry.credit > 0 ? entry.credit.toLocaleString('en-IN') : '—'}</td>
                                            <td className="p-1 text-right text-rose-700 font-bold whitespace-nowrap">{entry.debit > 0 ? entry.debit.toLocaleString('en-IN') : '—'}</td>
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
                    {incomeHeads.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-6 text-slate-400 font-bold uppercase text-xs italic">No income transactions recorded.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {incomeHeads.length > 0 && (
                <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex justify-between items-center font-mono font-black text-xs">
                  <span className="font-sans font-bold uppercase text-slate-600">TOTAL INCOME</span>
                  <span className="text-emerald-700 text-xs sm:text-sm">₹ {totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>

            {/* Expense Accounts Table Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
              <div className="p-3.5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h3 className="text-xs font-bold uppercase tracking-wider text-rose-800 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
                  Expense Heads (Operating Expenses)
                </h3>
                <span className="font-mono font-black text-rose-700 text-xs sm:text-sm whitespace-nowrap">
                  ₹ {totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="overflow-x-auto flex-1 max-h-[420px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-xs text-left border-collapse min-w-[500px]">
                  <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-600 uppercase tracking-wider text-[10px] sm:text-[11px] font-bold border-b border-slate-200">
                    <tr>
                      <th className="w-7 px-1.5 py-2.5 text-center"></th>
                      <th className="px-2 py-2.5">Account</th>
                      <th className="px-2 py-2.5 text-right text-slate-500 whitespace-nowrap">Opening</th>
                      <th className="px-2 py-2.5 text-right text-rose-700 whitespace-nowrap">Current Period</th>
                      <th className="px-2 py-2.5 text-right text-slate-900 whitespace-nowrap">Total</th>
                      <th className="px-2 py-2.5 text-right text-slate-500 whitespace-nowrap">% Share</th>
                      <th className="px-2 py-2.5 text-center whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 bg-white text-[11px]">
                    {expenseHeads.map((head) => {
                      const isExpanded = expandedHeadNames.has(head.name);
                      return (
                        <React.Fragment key={head.name}>
                          <tr className="hover:bg-slate-50 transition-colors">
                            <td className="px-1.5 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => toggleExpandHead(head.name)}
                                className="p-0.5 text-slate-400 hover:text-slate-700 rounded transition-colors cursor-pointer"
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-700" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                              </button>
                            </td>
                            <td className="px-2 py-2 font-bold text-slate-900 uppercase truncate max-w-[140px]" title={head.name}>
                              {head.name}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-500 whitespace-nowrap">
                              {head.opening !== 0 ? head.opening.toLocaleString('en-IN') : '—'}
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                              {head.currentPeriod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                              {head.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-600 whitespace-nowrap">{head.percentage}%</td>
                            <td className="px-2 py-2 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => navigateToDetailedLedger(head.name)}
                                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 text-[10px] font-bold hover:underline"
                              >
                                <span>Ledger</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>

                          {/* Expandable Sub-table */}
                          {isExpanded && (
                            <tr className="bg-slate-50">
                              <td colSpan={7} className="px-2 py-2 border-y border-slate-200">
                                <div className="bg-white rounded-lg border border-slate-200 p-2 space-y-1.5 shadow-sm">
                                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-700 border-b pb-1">
                                    <span>TRANSACTION BREAKDOWN ({head.ledgerCount} entries)</span>
                                    <button 
                                      onClick={() => navigateToDetailedLedger(head.name)}
                                      className="text-slate-900 hover:underline font-bold text-[10px] inline-flex items-center gap-1"
                                    >
                                      View Full Ledger <ExternalLink className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="overflow-x-auto max-h-[260px] overflow-y-auto scrollbar-thin">
                                    <table className="w-full text-[10px] text-left border-collapse">
                                      <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold uppercase border-b border-slate-200">
                                        <tr>
                                          <th className="p-1 whitespace-nowrap">Date</th>
                                          <th className="p-1 whitespace-nowrap">Source</th>
                                          <th className="p-1 whitespace-nowrap">Receipt</th>
                                          <th className="p-1 whitespace-nowrap">Particulars</th>
                                          <th className="p-1 text-right text-emerald-700 whitespace-nowrap">Credit</th>
                                          <th className="p-1 text-right text-rose-700 whitespace-nowrap">Debit</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-150 font-mono">
                                        {head.entries.map((entry) => (
                                          <tr key={entry.id} className="hover:bg-slate-50">
                                            <td className="p-1 font-bold whitespace-nowrap">{formatDateOld(entry.transactionDate)}</td>
                                            <td className="p-1 text-slate-600 whitespace-nowrap">{entry.sourceType}</td>
                                            <td className="p-1 font-bold whitespace-nowrap">{entry.receiptOrVoucherNo || '—'}</td>
                                            <td className="p-1 font-sans text-slate-700 truncate max-w-[140px]" title={entry.particulars}>{entry.particulars || '—'}</td>
                                            <td className="p-1 text-right text-emerald-700 font-bold whitespace-nowrap">{entry.credit > 0 ? entry.credit.toLocaleString('en-IN') : '—'}</td>
                                            <td className="p-1 text-right text-rose-700 font-bold whitespace-nowrap">{entry.debit > 0 ? entry.debit.toLocaleString('en-IN') : '—'}</td>
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
                    {expenseHeads.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-6 text-slate-400 font-bold uppercase text-xs italic">No expense transactions recorded.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {expenseHeads.length > 0 && (
                <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex justify-between items-center font-mono font-black text-xs">
                  <span className="font-sans font-bold uppercase text-slate-600">TOTAL EXPENSES</span>
                  <span className="text-rose-700 text-xs sm:text-sm">₹ {totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
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
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto scrollbar-thin">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 uppercase tracking-wider text-[11px] font-bold border-b border-slate-200">
                      <tr>
                        <th className="w-12 px-3 py-2.5 text-center">S.No</th>
                        <th className="px-4 py-2.5">Account Name</th>
                        <th className="px-3 py-2.5 text-center">Category</th>
                        <th className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">Opening Balance</th>
                        <th className="px-4 py-2.5 text-right text-emerald-700 whitespace-nowrap">Credit</th>
                        <th className="px-4 py-2.5 text-right text-rose-700 whitespace-nowrap">Debit</th>
                        <th className="px-4 py-2.5 text-right text-slate-900 whitespace-nowrap">Closing Balance</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 bg-white font-mono">
                      {accountBalances.map((acc, idx) => (
                        <tr 
                          key={idx} 
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-3 py-2.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                          <td className="px-4 py-2.5 text-slate-900 font-sans font-bold uppercase truncate max-w-[240px]">
                            {acc.accountName}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-sans font-bold uppercase ${
                              acc.category === 'ASSET' ? 'bg-blue-100 text-blue-800' :
                              acc.category === 'CAPITAL' ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {acc.category}
                            </span>
                          </td>
                          <td className={`px-4 py-2.5 text-right font-bold whitespace-nowrap ${acc.opening >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {Math.abs(acc.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {acc.opening >= 0 ? 'Cr' : 'Dr'}
                          </td>
                          <td className="px-4 py-2.5 text-emerald-700 text-right font-bold whitespace-nowrap">
                            {acc.credit > 0 ? acc.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-rose-700 text-right font-bold whitespace-nowrap">
                            {acc.debit > 0 ? acc.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-black whitespace-nowrap ${acc.closing >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                            {Math.abs(acc.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {acc.closing >= 0 ? 'Cr' : 'Dr'}
                          </td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
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

      {/* Complete P&L & Balance Sheet Print Preview Modal */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="Profit & Loss & Balance Sheet Statement"
        documentTitle={`P&L / BALANCE SHEET: ${formatDateOld(startDate)} TO ${formatDateOld(endDate)}`}
        orientation="portrait"
      >
        <div className="space-y-6 pb-8 font-sans text-slate-900 text-[10px]">
          
          {/* Header */}
          <div className="text-center border-b-2 border-slate-900 pb-3">
            <h1 className="text-lg font-black uppercase text-slate-900 tracking-wide">TIRUMALA FINANCE</h1>
            <h2 className="text-sm font-bold uppercase text-slate-700 mt-0.5">PROFIT &amp; LOSS &amp; BALANCE SHEET STATEMENT</h2>
            <p className="text-[10px] text-slate-500 uppercase font-mono mt-1">Period: {formatDateOld(startDate)} To {formatDateOld(endDate)}</p>
          </div>

          {/* PART I: PROFIT & LOSS */}
          <div className="space-y-3">
            <div className="bg-slate-100 p-1.5 font-black uppercase tracking-wider text-slate-900 border-l-4 border-slate-900 text-[11px]">
              Part 1: Income &amp; Expenses (Profit &amp; Loss)
            </div>

            <div className="grid grid-cols-2 gap-6">
              
              {/* Income Column */}
              <div>
                <div className="border-b-2 border-emerald-800 px-1 pb-1 font-bold text-emerald-900 uppercase">
                  INCOME (Interest, Penalty, etc.)
                </div>
                <table className="w-full text-left mt-2 border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-slate-300 font-sans font-bold text-slate-600 text-[9px] uppercase">
                      <th className="py-1">Account</th>
                      <th className="py-1 text-right">Current Period</th>
                      <th className="py-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeHeads.map((head, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="py-1 uppercase text-slate-900 font-bold">{head.name}</td>
                        <td className="py-1 text-right text-emerald-800 font-black">{head.currentPeriod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="py-1 text-right text-slate-900 font-black">{head.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    {incomeHeads.length === 0 && (
                      <tr><td colSpan={3} className="py-2 text-center text-slate-400">No income recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Expense Column */}
              <div>
                <div className="border-b-2 border-rose-800 px-1 pb-1 font-bold text-rose-900 uppercase">
                  EXPENSES (Operating Expenses)
                </div>
                <table className="w-full text-left mt-2 border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-slate-300 font-sans font-bold text-slate-600 text-[9px] uppercase">
                      <th className="py-1">Account</th>
                      <th className="py-1 text-right">Current Period</th>
                      <th className="py-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseHeads.map((head, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="py-1 uppercase text-slate-900 font-bold">{head.name}</td>
                        <td className="py-1 text-right text-rose-800 font-black">{head.currentPeriod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="py-1 text-right text-slate-900 font-black">{head.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    {expenseHeads.length === 0 && (
                      <tr><td colSpan={3} className="py-2 text-center text-slate-400">No expenses recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>

            {/* P&L Totals Summary Banner */}
            <div className="grid grid-cols-4 gap-4 border border-slate-900 p-2 text-center font-bold uppercase bg-slate-50 font-mono">
              <div>
                <span className="block text-[8px] text-slate-500 font-sans">TOTAL INCOME</span>
                <span className="text-emerald-800 font-black">₹ {totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500 font-sans">TOTAL EXPENSES</span>
                <span className="text-rose-800 font-black">₹ {totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500 font-sans">NET PROFIT / LOSS</span>
                <span className={totalProfit >= 0 ? 'text-emerald-800 font-black' : 'text-rose-800 font-black'}>₹ {totalProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500 font-sans">PARTNER SHARE ({partnerCount})</span>
                <span className="text-slate-900 font-black">₹ {shareValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          </div>

          {/* PART II: BALANCE SHEET */}
          <div className="space-y-3 pt-2">
            <div className="bg-slate-100 p-1.5 font-black uppercase tracking-wider text-slate-900 border-l-4 border-slate-900 text-[11px]">
              Part 2: What We Own &amp; What We Owe (Balance Sheet)
            </div>

            <div className="grid grid-cols-2 gap-6">
              
              {/* Assets Column */}
              <div>
                <div className="border-b-2 border-blue-800 px-1 pb-1 font-bold text-blue-900 uppercase">
                  WHAT WE OWN
                </div>
                <table className="w-full text-left mt-2 border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-slate-300 font-sans font-bold text-slate-600 text-[9px] uppercase">
                      <th className="py-1">Item</th>
                      <th className="py-1 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="py-1 uppercase text-slate-900 font-bold">Loan Money Given Out (Not Yet Repaid)</td>
                      <td className="py-1 text-right text-blue-900 font-black">{totalLoanPrincipalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-1 uppercase text-slate-900 font-bold">Cash in Hand</td>
                      <td className="py-1 text-right text-slate-900 font-black">{closingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    {bankAndOtherAssetAccounts.map((acc, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="py-1 uppercase text-slate-900 font-bold">{acc.accountName}</td>
                        <td className="py-1 text-right text-slate-900 font-black">{acc.netOutstandingAsset.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-900 font-bold bg-slate-50">
                      <td className="py-1.5 uppercase text-slate-900">TOTAL WE OWN</td>
                      <td className="py-1.5 text-right text-blue-900 font-black">₹ {totalAssets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Liabilities & Capital Column */}
              <div>
                <div className="border-b-2 border-purple-800 px-1 pb-1 font-bold text-purple-900 uppercase">
                  WHAT WE OWE (PARTNERS’ MONEY &amp; PROFIT)
                </div>
                <table className="w-full text-left mt-2 border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-slate-300 font-sans font-bold text-slate-600 text-[9px] uppercase">
                      <th className="py-1">Item</th>
                      <th className="py-1 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="py-1 uppercase text-slate-900 font-bold">Money Put In by Partners</td>
                      <td className="py-1 text-right text-purple-900 font-black">{totalCapitalContributed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-1 uppercase text-slate-900 font-bold">Profit for This Period</td>
                      <td className={`py-1 text-right font-black ${totalProfit >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                        {totalProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    {liabilityAccounts.map((acc, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="py-1 uppercase text-slate-900 font-bold">{acc.accountName}</td>
                        <td className="py-1 text-right text-slate-900 font-black">{Math.abs(acc.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-900 font-bold bg-slate-50">
                      <td className="py-1.5 uppercase text-slate-900">TOTAL WE OWE (PARTNERS + PROFIT)</td>
                      <td className="py-1.5 text-right text-purple-900 font-black">₹ {totalLiabilitiesAndCapital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

            </div>

            {/* Balance Sheet Accounts Audit Table in Print */}
            <div className="pt-2">
              <div className="border-b border-slate-300 pb-1 font-bold text-slate-800 uppercase text-[9px]">
                ACCOUNT-WISE BALANCES
              </div>
              <table className="w-full text-left mt-1.5 border-collapse font-mono text-[9px]">
                <thead>
                  <tr className="border-b border-slate-300 font-sans font-bold text-slate-600 uppercase">
                    <th className="py-1 w-8 text-center">S.No</th>
                    <th className="py-1">Account Name</th>
                    <th className="py-1 text-center">Category</th>
                    <th className="py-1 text-right">Opening</th>
                    <th className="py-1 text-right">Credit</th>
                    <th className="py-1 text-right">Debit</th>
                    <th className="py-1 text-right">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {accountBalances.map((acc, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-0.5 text-center text-slate-400">{idx + 1}</td>
                      <td className="py-0.5 font-bold uppercase text-slate-900">{acc.accountName}</td>
                      <td className="py-0.5 text-center uppercase font-sans text-[8px]">{acc.category}</td>
                      <td className="py-0.5 text-right">{Math.abs(acc.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {acc.opening >= 0 ? 'Cr' : 'Dr'}</td>
                      <td className="py-0.5 text-right text-emerald-800">{acc.credit > 0 ? acc.credit.toLocaleString('en-IN') : '—'}</td>
                      <td className="py-0.5 text-right text-rose-800">{acc.debit > 0 ? acc.debit.toLocaleString('en-IN') : '—'}</td>
                      <td className="py-0.5 text-right font-black">{Math.abs(acc.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {acc.closing >= 0 ? 'Cr' : 'Dr'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Net Position Banner */}
            <div className="border border-slate-900 p-2 text-center font-bold uppercase bg-slate-50 font-mono grid grid-cols-3 gap-2">
              <div>
                <span className="block text-[8px] text-slate-500 font-sans">TOTAL WE OWN</span>
                <span className="text-blue-900 font-black">₹ {totalAssets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500 font-sans">TOTAL WE OWE (PARTNERS + PROFIT)</span>
                <span className="text-purple-900 font-black">₹ {totalLiabilitiesAndCapital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500 font-sans">NET WORTH (OWN − OWE)</span>
                <span className="text-emerald-800 font-black">₹ {netBusinessPosition.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

          </div>

        </div>
      </FinancePrintPreview>

    </div>
  );
};

export default ProfitAndLoss;
