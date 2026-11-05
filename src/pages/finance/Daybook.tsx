import React, { useEffect, useState, useMemo } from 'react';
import { 
  Printer, 
  Plus, 
  Search, 
  ChevronLeft, 
  ChevronRight, ChevronDown,
  RotateCcw, 
  Scale, 
  BookOpen, 
  ArrowUpRight,
  ArrowDownLeft
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import { dailyFinancialTransactionService, DailyFinancialTransaction } from '../../services/dailyFinancialTransactionService';
import { supabaseFinance, FinanceCashbookAccount } from '../../lib/supabaseFinance';
import { clearFinanceCalendarCache, getAdjacentTransactionDate } from '../../services/financeCalendarService';
import { useAuth } from '../../contexts/AuthContext';
import { displayHeadName, displayHeadText } from '../../utils/financeLabels';

export interface DaybookRowItem extends DailyFinancialTransaction {
  runningBalance: number;
}

// Format Helper for Transaction Row Date (DD-Mon-YYYY)
export const formatRowDate = (dateStr?: string | null): string => {
  if (!dateStr) return '—';
  try {
    const clean = dateStr.split('T')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parts[2].padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${day}-${months[monthIdx]}-${year}`;
      }
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {
    // fallback
  }
  return dateStr || '—';
};

// Format Helper for Transaction Row Time (hh:mm AM/PM)
export const formatRowTime = (timeStr?: string | null, createdAt?: string | null): string => {
  const target = timeStr || createdAt;
  if (!target) return '—';
  try {
    const timeMatch = target.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2];
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const strHours = String(hours).padStart(2, '0');
      return `${strHours}:${minutes} ${ampm}`;
    }

    const d = new Date(target);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
    }
  } catch (e) {
    // fallback
  }
  if (target.length > 8 && target.includes('T')) {
    return target.substring(11, 16);
  }
  return target;
};

const Daybook: React.FC = () => {
  const { user } = useAuth();
  
  // Selected Business Date
  const [selectedDate, setSelectedDate] = useState(() => getLocalBusinessDateISO());
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Financial Metrics
  const [openingBalance, setOpeningBalance] = useState(0);
  const [allTransactions, setAllTransactions] = useState<DailyFinancialTransaction[]>([]);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // Active Mode
  const [financeMode] = useState<'REGULAR' | 'ITR'>(() => {
    const prev = sessionStorage.getItem('finance_previous_mode') || localStorage.getItem('finance_previous_mode');
    return prev === 'itr' ? 'ITR' : 'REGULAR';
  });

  // Filter States
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [operatorFilter, setOperatorFilter] = useState<string>('ALL');
  const [loanTypeFilter, setLoanTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Direct Cashbook Entry Inline States
  const [accounts, setAccounts] = useState<FinanceCashbookAccount[]>([]);
  const [headOfAccount, setHeadOfAccount] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [particulars, setParticulars] = useState('');
  const [credit, setCredit] = useState('');
  const [debit, setDebit] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);

  // Load Accounts for Cashbook modal
  useEffect(() => {
    supabaseFinance.getCashbookAccounts()
      .then(accs => setAccounts(accs))
      .catch(err => console.error('Error loading cashbook accounts:', err));
  }, []);

  // Manage Heads of Account (Add / Edit) - admin users only
  const isAdminUser = !!user?.is_admin;
  const [headModal, setHeadModal] = useState<null | { mode: 'add' | 'edit'; id?: string }>(null);
  const [headForm, setHeadForm] = useState({
    account_name: '',
    account_number: '',
    report_section: 'PROFIT_AND_LOSS' as 'BALANCE_SHEET' | 'PROFIT_AND_LOSS',
    category: 'Expense'
  });
  const [savingHead, setSavingHead] = useState(false);

  const openAddHead = () => {
    setHeadForm({ account_name: '', account_number: '', report_section: 'PROFIT_AND_LOSS', category: 'Expense' });
    setHeadModal({ mode: 'add' });
  };

  const openEditHead = () => {
    const acc = accounts.find(a => a.id === headOfAccount);
    if (!acc) {
      toast.error('Select a Head of Account first, then click Edit');
      return;
    }
    const section = (acc.report_section || acc.report_classification || 'PROFIT_AND_LOSS') as 'BALANCE_SHEET' | 'PROFIT_AND_LOSS';
    setHeadForm({
      account_name: acc.account_name,
      account_number: acc.account_number || '',
      report_section: section,
      category: acc.category || (section === 'BALANCE_SHEET' ? 'Other Asset' : 'Expense')
    });
    setHeadModal({ mode: 'edit', id: acc.id });
  };

  const saveHead = async () => {
    const name = headForm.account_name.trim().toUpperCase();
    if (!name) {
      toast.error('Enter the Head of Account name');
      return;
    }
    const duplicate = accounts.find(a => a.account_name.trim().toUpperCase() === name && a.id !== headModal?.id);
    if (duplicate) {
      toast.error('A Head of Account with this name already exists');
      return;
    }
    setSavingHead(true);
    try {
      if (headModal?.mode === 'add') {
        const created = await supabaseFinance.createCashbookAccount({
          account_name: name,
          account_number: headForm.account_number.trim() || null,
          report_classification: headForm.report_section,
          report_section: headForm.report_section,
          category: headForm.category
        });
        if (!created) throw new Error('Could not create Head of Account');
        toast.success(`Head of Account "${name}" added`);
        setHeadOfAccount(created.id);
      } else if (headModal?.mode === 'edit' && headModal.id) {
        // Renaming also updates the name on past Day Book entries (done inside updateCashbookAccount)
        const res = await supabaseFinance.updateCashbookAccount(headModal.id, {
          account_name: name,
          report_classification: headForm.report_section,
          report_section: headForm.report_section,
          category: headForm.category
        });
        if (!res.success) throw new Error(res.error || 'Could not update Head of Account');
        toast.success(`Head of Account "${name}" updated`);
      }
      const accs = await supabaseFinance.getCashbookAccounts();
      setAccounts(accs);
      setHeadModal(null);
      setRefreshTrigger(prev => prev + 1);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save Head of Account');
    } finally {
      setSavingHead(false);
    }
  };

  // Fetch Daybook Data when selectedDate, mode or refreshTrigger changes
  useEffect(() => {
    fetchDaybookJournal();
  }, [selectedDate, financeMode, refreshTrigger]);

  const fetchDaybookJournal = async () => {
    setLoading(true);
    try {
      // 1. Calculate Opening Balance (Net cash position prior to selectedDate)
      const oldestDate = await dailyFinancialTransactionService.getOldestTransactionDate();
      
      let opBal = 0;
      if (oldestDate && oldestDate < selectedDate) {
        const selectedObj = new Date(selectedDate);
        selectedObj.setDate(selectedObj.getDate() - 1);
        const priorDateStr = selectedObj.toISOString().split('T')[0];

        if (priorDateStr >= oldestDate) {
          const priorTxs = await dailyFinancialTransactionService.getDailyFinancialTransactions({
            fromDate: oldestDate,
            toDate: priorDateStr,
            financeMode
          });

          priorTxs.forEach(tx => {
            opBal += (Number(tx.credit) || 0) - (Number(tx.debit) || 0);
          });
        }
      }
      setOpeningBalance(opBal);

      // 2. Fetch all transactions for selectedDate
      const todayTxs = await dailyFinancialTransactionService.getDailyFinancialTransactions({
        fromDate: selectedDate,
        toDate: selectedDate,
        financeMode
      });

      setAllTransactions(todayTxs);
    } catch (err) {
      console.error('Error fetching Daybook journal:', err);
      toast.error('Failed to load Day Book entries');
    } finally {
      setLoading(false);
    }
  };

  // Day Overall Financial Summaries (unaffected by UI table search filters)
  const daySummary = useMemo(() => {
    let cashIn = 0;
    let cashOut = 0;
    allTransactions.forEach(tx => {
      cashIn += Number(tx.credit) || 0;
      cashOut += Number(tx.debit) || 0;
    });
    const netChange = cashIn - cashOut;
    const closingBalance = openingBalance + netChange;
    return {
      cashIn,
      cashOut,
      netChange,
      closingBalance,
      txCount: allTransactions.length
    };
  }, [allTransactions, openingBalance]);

  // Unique Filter Options
  const filterOptions = useMemo(() => {
    const operators = new Set<string>();
    const types = new Set<string>();
    const loanTypes = new Set<string>();

    allTransactions.forEach(tx => {
      if (tx.userName) operators.add(tx.userName);
      if (tx.headOfAccount) types.add(tx.headOfAccount);
      if (tx.loanCategory) loanTypes.add(tx.loanCategory);
      if (tx.category) loanTypes.add(tx.category);
    });

    return {
      operators: Array.from(operators).sort(),
      types: Array.from(types).sort(),
      loanTypes: Array.from(loanTypes).sort()
    };
  }, [allTransactions]);

  // Filtered Rows with Running Balance Calculation
  const filteredRows = useMemo(() => {
    let currBal = openingBalance;

    return allTransactions
      .filter(tx => {
        if (typeFilter !== 'ALL' && tx.headOfAccount !== typeFilter) return false;
        if (operatorFilter !== 'ALL' && tx.userName !== operatorFilter) return false;
        if (loanTypeFilter !== 'ALL' && tx.loanCategory !== loanTypeFilter && tx.category !== loanTypeFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchReceipt = (tx.receiptOrVoucherNo || '').toLowerCase().includes(q);
          const matchCustomer = (tx.customerName || '').toLowerCase().includes(q);
          const matchLoan = (tx.accountOrLoanNo || '').toLowerCase().includes(q);
          const matchParticulars = (tx.particulars || '').toLowerCase().includes(q);
          const matchHead = (tx.headOfAccount || '').toLowerCase().includes(q);
          const matchUser = (tx.userName || '').toLowerCase().includes(q);
          if (!matchReceipt && !matchCustomer && !matchLoan && !matchParticulars && !matchHead && !matchUser) {
            return false;
          }
        }
        return true;
      })
      .map(tx => {
        currBal += (Number(tx.credit) || 0) - (Number(tx.debit) || 0);
        return {
          ...tx,
          runningBalance: currBal
        };
      });
  }, [allTransactions, openingBalance, typeFilter, operatorFilter, loanTypeFilter, searchQuery]);

  // NPA close groups: one parent row (the loss, in Debit) with its principal / interest /
  // penalty parts as child rows that open underneath it. Children still count in the totals.
  const [expandedNpa, setExpandedNpa] = useState<Record<string, boolean>>({});
  const displayRows = useMemo(() => {
    const ordered = filteredRows.map((r, i) => ({ ...r, __order: i })) as any[];
    const childrenByGroup = new Map<string, any[]>();
    const parentGroups = new Set<string>();
    ordered.forEach(r => {
      if (r.npaGroupId && r.npaRole === 'PARENT') parentGroups.add(r.npaGroupId);
    });
    ordered.forEach(r => {
      if (r.npaGroupId && r.npaRole === 'CHILD' && parentGroups.has(r.npaGroupId)) {
        const list = childrenByGroup.get(r.npaGroupId) || [];
        list.push(r);
        childrenByGroup.set(r.npaGroupId, list);
      }
    });
    const out: { row: any; children: any[]; index: number }[] = [];
    let n = 0;
    ordered.forEach(r => {
      if (r.npaRole === 'CHILD' && r.npaGroupId && parentGroups.has(r.npaGroupId)) return;
      const children = r.npaRole === 'PARENT' && r.npaGroupId ? (childrenByGroup.get(r.npaGroupId) || []) : [];
      if (children.length) {
        const last = [r, ...children].reduce((m, c) => (c.__order > m.__order ? c : m), r);
        r.__groupBalance = last.runningBalance;
      }
      n += 1;
      out.push({ row: r, children, index: n });
    });
    return out;
  }, [filteredRows]);

  // Filtered Totals
  const filteredTotals = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    filteredRows.forEach(r => {
      inSum += Number(r.credit) || 0;
      outSum += Number(r.debit) || 0;
    });
    return { inSum, outSum, net: inSum - outSum };
  }, [filteredRows]);

  // Transaction-Aware Date Navigation (Jump strictly to dates having transactions)
  const handleAdjacentDate = async (direction: 'prev' | 'next') => {
    try {
      const adjacentDate = await getAdjacentTransactionDate(selectedDate, direction, financeMode);
      if (adjacentDate) {
        setSelectedDate(adjacentDate);
      } else {
        toast(direction === 'prev' ? 'No earlier transaction date found' : 'No later transaction date found', { icon: 'ℹ️' });
      }
    } catch (e) {
      console.error('Error navigating to adjacent transaction date:', e);
    }
  };

  // Format Helper for Display Dates
  const formatDisplayDate = (isoStr: string) => {
    if (!isoStr) return '';
    const parts = isoStr.split('-');
    if (parts.length !== 3) return isoStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dateObj = new Date(isoStr);
    const dayName = !isNaN(dateObj.getTime()) ? days[dateObj.getDay()] : '';
    return `${parts[2]} ${months[parseInt(parts[1], 10) - 1]} ${parts[0]} ${dayName ? `(${dayName})` : ''}`;
  };

  // Clear All Filters
  const handleClearFilters = () => {
    setTypeFilter('ALL');
    setOperatorFilter('ALL');
    setLoanTypeFilter('ALL');
    setSearchQuery('');
  };

  // Save Direct Cashbook Entry Handler
  const handleSaveCashbookEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const crVal = Number(credit) || 0;
    const drVal = Number(debit) || 0;

    if (!headOfAccount) {
      toast.error('Please select Head of Account');
      return;
    }
    if (!particulars.trim()) {
      toast.error('Please enter Particulars');
      return;
    }
    if (crVal < 0 || drVal < 0) {
      toast.error('Amounts cannot be negative');
      return;
    }
    if (crVal <= 0 && drVal <= 0) {
      toast.error('Please enter a Credit or Debit amount greater than 0');
      return;
    }
    if (crVal > 0 && drVal > 0) {
      toast.error('Cannot enter both Credit and Debit in a single entry');
      return;
    }

    setSavingEntry(true);
    try {
      const staffName = user?.username || 'Staff';
      const selectedAccName = accounts.find(a => a.id === headOfAccount)?.account_name || headOfAccount;

      const regBookId = await supabaseFinance.getLegacyBookId('REGULAR');
      const itrBookId = await supabaseFinance.getLegacyBookId('ITR');
      const bookId = financeMode === 'ITR' ? itrBookId : regBookId;

      await supabaseFinance.createCashbookEntry({
        entry_date: selectedDate,
        account_number: accountNumber || null,
        head_of_account: selectedAccName,
        particulars: particulars.trim(),
        credit: crVal,
        debit: drVal,
        created_by: staffName,
        book_id: bookId,
        status: 'APPROVED',
        approved_by: staffName,
        approved_at: new Date().toISOString()
      });

      toast.success('Cashbook entry saved to Day Book');
      clearFinanceCalendarCache();
      setHeadOfAccount('');
      setAccountNumber('');
      setParticulars('');
      setCredit('');
      setDebit('');
      setRefreshTrigger(prev => prev + 1);
    } catch (err: any) {
      console.error('Error saving cashbook entry:', err);
      toast.error(err.message || 'Failed to save Cashbook entry');
    } finally {
      setSavingEntry(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full max-w-[100%] mx-auto px-2 pt-1 pb-3 print:p-0 select-none">
      
      {/* ── ROW 1: Page Header & Quick Actions ───────────────────────── */}
      <div className={`flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-200 print:hidden ${showPrintPreview ? 'hidden' : ''}`}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs">
            <BookOpen className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-black uppercase text-slate-900 tracking-wide leading-none">Finance Day Book Journal</h1>
              <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-mono">
                Definitive Journal
              </span>
            </div>
            <p className="text-[11px] text-slate-600 font-semibold mt-0.5">
              Complete chronological journal of all financial transactions for the selected business day
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPrintPreview(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-xs font-extrabold uppercase shadow-2xs transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" /> Print Journal
          </button>
        </div>
      </div>

      {/* ── ROW 2: Transaction-Aware Date Selector Bar ───────────────────────── */}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-2xs px-3 py-2 print:hidden ${showPrintPreview ? 'hidden' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          
          {/* Calendar Picker + Transaction-Aware Navigation */}
          <div className="flex items-center gap-2">
            <div className="min-w-[215px]">
              <FinanceSmartCalendar
                label="Selected Business Date"
                value={selectedDate}
                onChange={(newDate) => {
                  if (newDate) setSelectedDate(newDate);
                }}
                module="DAY_BOOK"
                refreshTrigger={refreshTrigger}
                compact
              />
            </div>

            {/* Jump strictly to adjacent transaction dates */}
            <div className="flex items-center gap-1 mt-4">
              <button
                type="button"
                onClick={() => handleAdjacentDate('prev')}
                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-black transition-colors cursor-pointer flex items-center justify-center h-[36px] w-[36px]"
                title="Jump to Previous Transaction Date"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              
              <button
                type="button"
                onClick={() => setSelectedDate(getLocalBusinessDateISO())}
                className={`px-3 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg text-xs font-black uppercase transition-colors cursor-pointer h-[36px] flex items-center justify-center ${selectedDate === getLocalBusinessDateISO() ? 'bg-blue-100 text-blue-900 border border-blue-300' : ''}`}
              >
                Today
              </button>

              <button
                type="button"
                onClick={() => handleAdjacentDate('next')}
                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-black transition-colors cursor-pointer flex items-center justify-center h-[36px] w-[36px]"
                title="Jump to Next Transaction Date"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Business Date Display */}
          <div className="flex flex-col text-right ml-auto">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-0.5">Active Financial Date</span>
            <div className="text-sm font-black text-slate-900 uppercase bg-slate-50 border border-slate-300 px-3.5 py-1 rounded-lg h-[36px] flex items-center justify-center font-mono shadow-2xs">
              {formatDisplayDate(selectedDate)}
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 3: High-Readability Summary Metrics Cards ──────────────────── */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 print:hidden ${showPrintPreview ? 'hidden' : ''}`}>
        
        {/* Opening Balance */}
        <div className="bg-white border border-slate-200 rounded-xl p-2.5 shadow-2xs flex flex-col justify-between min-h-[62px]">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Opening Balance</span>
          <span className="text-slate-900 text-[19px] font-black font-mono tracking-tight whitespace-nowrap mt-0.5">
            {openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Total Cash In (Credit) */}
        <div className="bg-emerald-50/80 border border-emerald-300 rounded-xl p-2.5 shadow-2xs flex flex-col justify-between min-h-[62px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-emerald-900 uppercase tracking-wider">Total Credit (+)</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-700" />
          </div>
          <span className="text-emerald-800 text-[19px] font-black font-mono tracking-tight whitespace-nowrap mt-0.5">
            {daySummary.cashIn.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Total Cash Out (Debit) */}
        <div className="bg-rose-50/80 border border-rose-300 rounded-xl p-2.5 shadow-2xs flex flex-col justify-between min-h-[62px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-rose-900 uppercase tracking-wider">Total Debit (-)</span>
            <ArrowUpRight className="w-4 h-4 text-rose-700" />
          </div>
          <span className="text-rose-800 text-[19px] font-black font-mono tracking-tight whitespace-nowrap mt-0.5">
            {daySummary.cashOut.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Net Movement */}
        <div className={`border rounded-xl p-2.5 shadow-2xs flex flex-col justify-between min-h-[62px] ${daySummary.netChange >= 0 ? 'bg-blue-50/80 border-blue-300 text-blue-950' : 'bg-amber-50/80 border-amber-300 text-amber-950'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider">Net Movement</span>
            <Scale className="w-4 h-4 text-slate-600" />
          </div>
          <span className="text-[19px] font-black font-mono tracking-tight whitespace-nowrap mt-0.5">
            {daySummary.netChange >= 0 ? '+' : ''}{daySummary.netChange.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Closing Balance */}
        <div className="bg-indigo-50/80 border border-indigo-300 rounded-xl p-2.5 shadow-2xs flex flex-col justify-between min-h-[62px]">
          <span className="text-[10px] font-black text-indigo-900 uppercase tracking-wider">Closing Balance</span>
          <span className="text-indigo-950 text-[19px] font-black font-mono tracking-tight whitespace-nowrap mt-0.5">
            {daySummary.closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Transaction Count */}
        <div className="bg-slate-900 text-white rounded-xl p-2.5 shadow-2xs flex flex-col justify-between min-h-[62px]">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Transactions</span>
          <span className="text-amber-400 text-[20px] font-black font-mono tracking-tight whitespace-nowrap mt-0.5">
            {daySummary.txCount} <span className="text-[11px] font-extrabold text-slate-300 font-sans">Entries</span>
          </span>
        </div>

      </div>

      {/* ── ROW 4: Optimized Filters Toolbar ────────────────────────────────────── */}
      <div className={`bg-white border border-slate-200 rounded-xl p-2 shadow-2xs print:hidden ${showPrintPreview ? 'hidden' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Global Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search receipt, customer name, loan no, particulars..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
            />
          </div>

          {/* Type Filter */}
          <div className="min-w-[140px]">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Types</option>
              {filterOptions.types.map(t => (
                <option key={t} value={t}>{displayHeadName(t)}</option>
              ))}
            </select>
          </div>

          {/* Loan Category Filter */}
          <div className="min-w-[130px]">
            <select
              value={loanTypeFilter}
              onChange={(e) => setLoanTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Categories</option>
              <option value="CD">CD Loans</option>
              <option value="HP">HP Loans</option>
              <option value="STBD">STBD Loans</option>
              <option value="TBD">TBD Loans</option>
              <option value="CAPITAL">Capital</option>
              <option value="EXPENSE">Expense</option>
              <option value="BANK">Bank</option>
            </select>
          </div>

          {/* Operator Filter */}
          <div className="min-w-[120px]">
            <select
              value={operatorFilter}
              onChange={(e) => setOperatorFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Staff</option>
              {filterOptions.operators.map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>

          {/* Reset Filters */}
          {(typeFilter !== 'ALL' || operatorFilter !== 'ALL' || loanTypeFilter !== 'ALL' || searchQuery !== '') && (
            <button
              onClick={handleClearFilters}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-extrabold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Clear Filters
            </button>
          )}

        </div>
      </div>

      {/* ── ROW 5: Strictly Bounded 100% Desktop Viewport Table (Zero Cell Overlap) ────────── */}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden print:hidden ${showPrintPreview ? 'hidden' : ''}`}>
        
        {/* Table Header Info Bar */}
        <div className="px-3 py-2 border-b border-slate-200 bg-slate-100/90 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-slate-900 tracking-wider">
              DAILY FINANCIAL TRANSACTIONS JOURNAL
            </span>
            <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-slate-900 text-white rounded font-mono">
              {filteredRows.length} {filteredRows.length === 1 ? 'Record' : 'Records'}
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono font-black text-slate-800">
            <span>Filtered Credit: <strong className="text-emerald-700">{filteredTotals.inSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
            <span>Filtered Debit: <strong className="text-rose-700">{filteredTotals.outSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16 bg-white">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-900"></div>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto w-full" style={{ maxHeight: 'calc(100vh - 330px)' }}>
              <table className="fit-table w-full divide-y divide-slate-200">
              <thead className="sticky top-0 z-10 bg-slate-200 shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)]">
                <tr className="text-slate-950 uppercase font-black tracking-wider">
                  <th className="px-1 py-2.5 text-center border-r border-slate-300">#</th>
                  <th className="px-1.5 py-2.5 text-center border-r border-slate-300">Receipt</th>
                  <th className="px-1.5 py-2.5 text-center border-r border-slate-300">Type</th>
                  <th className="px-1.5 py-2.5 text-left border-r border-slate-300">Loan / Acc</th>
                  <th className="px-2 py-2.5 text-left border-r border-slate-300">Customer Name</th>
                  <th className="px-1.5 py-2.5 text-right border-r border-slate-300 text-emerald-950 bg-emerald-100/60">Credit</th>
                  <th className="px-1.5 py-2.5 text-right border-r border-slate-300 text-rose-950 bg-rose-100/60">Debit</th>
                  <th className="px-1.5 py-2.5 text-right border-r border-slate-300 text-indigo-950 bg-indigo-100/60">Balance</th>
                  <th className="px-1.5 py-2.5 text-left border-r border-slate-300">Operator</th>
                  <th className="px-1.5 py-2.5 text-left border-r border-slate-300">Date</th>
                  <th className="px-2 py-2.5 text-left">Particulars / Remarks</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-12 text-center text-slate-500 font-sans font-extrabold">
                      No financial transactions match the selected date and filters.
                    </td>
                  </tr>
                ) : (
                  displayRows.map(({ row, children, index }) => {
                    const isNpaParent = row.npaRole === 'PARENT';
                    const isOpen = isNpaParent && !!expandedNpa[row.npaGroupId || row.id];
                    const renderRow = (r: any, opts: { child?: boolean; idxLabel?: string; groupBalance?: number }) => {
                      const isCredit = r.credit > 0;
                      const isDebit = r.debit > 0;
                      const head = r.displayType || displayHeadName(r.headOfAccount);
                      const balance = opts.groupBalance !== undefined ? opts.groupBalance : r.runningBalance;
                      return (
                        <tr key={r.id} className={`transition-colors ${opts.child ? 'bg-rose-50/40' : r.npaRole === 'PARENT' ? 'bg-rose-50 hover:bg-rose-100/60' : 'hover:bg-slate-50/90'}`}>
                          {/* # */}
                          <td className="fit-nowrap px-1 py-2 text-center border-r border-slate-100 text-slate-500 font-bold">
                            {opts.child ? '' : (
                              r.npaRole === 'PARENT' && children.length > 0 ? (
                                <button type="button" onClick={() => setExpandedNpa(p => ({ ...p, [r.npaGroupId || r.id]: !p[r.npaGroupId || r.id] }))}
                                  title={isOpen ? 'Hide the parts of this NPA close' : 'Show the parts of this NPA close'}
                                  className="inline-flex items-center gap-0.5 text-rose-800 font-black">
                                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}{opts.idxLabel}
                                </button>
                              ) : opts.idxLabel
                            )}
                          </td>
                          {/* Receipt */}
                          <td className="fit-nowrap px-1.5 py-2 border-r border-slate-100 text-center">
                            {r.receiptOrVoucherNo ? (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-950 border border-slate-300 font-mono font-black inline-block">
                                {r.receiptOrVoucherNo}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-sans text-center block">—</span>
                            )}
                          </td>
                          {/* Type */}
                          <td className={`px-1 py-2 border-r border-slate-100 ${opts.child ? 'text-left pl-4' : 'text-center'}`}>
                            <span className={`inline-block px-1.5 py-0.5 rounded border font-black uppercase tracking-tight text-center ${
                              r.npaRole === 'PARENT'
                                ? 'bg-rose-600 text-white border-rose-700'
                                : opts.child
                                ? 'bg-white text-rose-900 border-rose-300'
                                : head.includes('INTEREST') || head.includes('COMMISSION')
                                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                : head.includes('PRINCIPAL') || r.debit > 0
                                ? 'bg-rose-50 text-rose-900 border-rose-300'
                                : head.includes('CAPITAL')
                                ? 'bg-amber-50 text-amber-950 border-amber-300'
                                : 'bg-blue-50 text-blue-950 border-blue-300'
                            }`}>
                              {opts.child ? `↳ ${r.npaComponent || head}` : head}
                            </span>
                          </td>
                          {/* Loan / Acc No */}
                          <td className="fit-nowrap px-1.5 py-2 border-r border-slate-100 font-mono font-bold text-slate-900">
                            {r.accountOrLoanNo || '—'}
                          </td>
                          {/* Customer */}
                          <td className="fit-name px-2 py-2 border-r border-slate-100 font-sans font-extrabold text-slate-950 leading-snug">
                            {r.customerName || '—'}
                          </td>
                          {/* Credit */}
                          <td className="fit-nowrap px-1.5 py-2 border-r border-slate-100 text-right font-mono font-black text-emerald-700 bg-emerald-50/20 tabular-nums">
                            {isCredit ? r.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          {/* Debit */}
                          <td className="fit-nowrap px-1.5 py-2 border-r border-slate-100 text-right font-mono font-black text-rose-700 bg-rose-50/20 tabular-nums">
                            {isDebit ? r.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          {/* Balance */}
                          <td className="fit-nowrap px-1.5 py-2 border-r border-slate-100 text-right font-mono font-black text-indigo-950 bg-indigo-50/20 tabular-nums">
                            {opts.child ? '' : balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          {/* Operator */}
                          <td className="px-1.5 py-2 border-r border-slate-100 font-sans font-black text-slate-800 uppercase">
                            {r.userName || 'Staff'}
                          </td>
                          {/* Date / time */}
                          <td className="fit-nowrap px-1.5 py-1.5 border-r border-slate-100 text-left">
                            <div className="flex flex-col leading-tight">
                              <span className="font-mono font-bold text-slate-900">{formatRowDate(r.transactionDate || r.createdAt)}</span>
                              <span className="font-mono font-medium text-slate-500">{formatRowTime(r.entryTime, r.createdAt)}</span>
                            </div>
                          </td>
                          {/* Particulars */}
                          <td className="fit-particulars px-2 py-2 font-sans font-semibold text-slate-800 leading-snug">
                            {displayHeadText(r.particulars) || '—'}
                          </td>
                        </tr>
                      );
                    };
                    const groupBalance = isNpaParent ? row.__groupBalance : undefined;
                    return (
                      <React.Fragment key={`grp-${row.id}`}>
                        {renderRow(row, { idxLabel: String(index), groupBalance })}
                        {isOpen && children.map(c => renderRow(c, { child: true }))}
                      </React.Fragment>
                    );
                  })
                )}

              </tbody>
            </table>
          </div>

          {/* ── DIRECT ENTRY ROW (Straight Horizontal Input Row Directly Below Table) ── */}
          <form onSubmit={handleSaveCashbookEntry} className="bg-slate-50 border-t-2 border-slate-300 px-3 py-2 flex flex-wrap lg:flex-nowrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider whitespace-nowrap">
                ENTRY:
              </span>
            </div>

            {/* Head of Account */}
            <div className="w-full sm:w-[280px] lg:w-[28%] shrink-0 flex items-center gap-1">
              <select
                value={headOfAccount}
                onChange={(e) => {
                  if (e.target.value === '__add_head__') { openAddHead(); return; }
                  if (e.target.value === '__edit_head__') { openEditHead(); return; }
                  setHeadOfAccount(e.target.value);
                  const selectedAcc = accounts.find(a => a.id === e.target.value);
                  if (selectedAcc?.account_number) setAccountNumber(selectedAcc.account_number);
                }}
                className="w-full h-8 px-2.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                required
              >
                <option value="">-- Select Head of Account * --</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.account_name} {acc.account_number ? `(${acc.account_number})` : ''}
                  </option>
                ))}
                {isAdminUser && (
                  <optgroup label="Manage Heads (Admin)">
                    <option value="__add_head__">+ Add new Head of Account</option>
                    {headOfAccount && <option value="__edit_head__">✎ Edit selected Head of Account</option>}
                  </optgroup>
                )}
              </select>
              {isAdminUser && (
                <>
                  <button
                    type="button"
                    onClick={openAddHead}
                    title="Add a new Head of Account"
                    className="h-8 px-2 shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-bold hover:bg-emerald-100"
                  >
                    + Add
                  </button>
                  <button
                    type="button"
                    onClick={openEditHead}
                    disabled={!headOfAccount}
                    title={headOfAccount ? 'Edit the selected Head of Account' : 'Select a Head of Account to edit'}
                    className="h-8 px-2 shrink-0 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-bold hover:bg-slate-50 disabled:opacity-40"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>

            {/* Particulars / Description */}
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Particulars / Description *"
                value={particulars}
                onChange={(e) => setParticulars(e.target.value)}
                className="w-full h-8 px-2.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                required
              />
            </div>

            {/* Cash In (Credit) */}
            <div className="w-28 sm:w-32 shrink-0">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Credit"
                value={credit}
                onChange={(e) => {
                  setCredit(e.target.value);
                  if (e.target.value) setDebit('');
                }}
                className="w-full h-8 px-2.5 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-bold font-mono text-emerald-900 placeholder:text-emerald-700/60 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-right"
              />
            </div>

            {/* Cash Out (Debit) */}
            <div className="w-28 sm:w-32 shrink-0">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Debit"
                value={debit}
                onChange={(e) => {
                  setDebit(e.target.value);
                  if (e.target.value) setCredit('');
                }}
                className="w-full h-8 px-2.5 bg-rose-50 border border-rose-300 rounded-lg text-xs font-bold font-mono text-rose-900 placeholder:text-rose-700/60 focus:outline-none focus:ring-2 focus:ring-rose-600 text-right"
              />
            </div>

            {/* Save Button */}
            <div className="shrink-0">
              <button
                type="submit"
                disabled={savingEntry}
                className="h-8 px-4 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                {savingEntry ? 'Saving...' : 'Save Entry'}
              </button>
            </div>
          </form>

          {/* ── JOURNAL TOTALS (Day Totals Summary Bar Below Direct Entry Row) ── */}
          <div className="bg-slate-200 border-t border-slate-300 px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-xs font-mono font-black text-slate-900">
            <div className="flex items-center gap-2">
              <span className="uppercase text-[11px] font-sans font-black tracking-wider text-slate-950">Journal Day Totals:</span>
              <span className="text-[10px] font-sans font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-300">
                {filteredRows.length} {filteredRows.length === 1 ? 'Row' : 'Rows'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <span>Total Credit: <strong className="text-emerald-800 text-[12px] bg-emerald-100/90 px-2 py-0.5 rounded border border-emerald-300 font-mono font-black">{filteredTotals.inSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
              <span>Total Debit: <strong className="text-rose-800 text-[12px] bg-rose-100/90 px-2 py-0.5 rounded border border-rose-300 font-mono font-black">{filteredTotals.outSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
              <span>Closing Balance: <strong className="text-indigo-950 text-[12px] bg-indigo-100/90 px-2 py-0.5 rounded border border-indigo-300 font-mono font-black">{daySummary.closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
              <span className="text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">NET: {daySummary.netChange >= 0 ? '+' : ''}{daySummary.netChange.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </>
      )}
    </div>

      {/* ── ROW 7: Print Preview Component ───────────────────────────────────── */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="Finance Day Book Journal"
        documentTitle={`DAYBOOK: ${formatDisplayDate(selectedDate)}`}
      >
        {!loading && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 bg-gray-50 rounded border">
                <span className="text-gray-500 block uppercase font-bold text-[9px]">Opening Balance</span>
                <span className="text-gray-900 font-mono font-black text-sm">{openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="p-2.5 bg-green-50 rounded border border-green-200">
                <span className="text-green-800 block uppercase font-bold text-[9px]">Total Credit (+)</span>
                <span className="text-green-900 font-mono font-black text-sm">{daySummary.cashIn.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="p-2.5 bg-red-50 rounded border border-red-200">
                <span className="text-red-800 block uppercase font-bold text-[9px]">Total Debit (-)</span>
                <span className="text-red-900 font-mono font-black text-sm">{daySummary.cashOut.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="p-2.5 bg-indigo-50 rounded border border-indigo-200">
                <span className="text-indigo-900 block uppercase font-bold text-[9px]">Closing Balance</span>
                <span className="text-indigo-950 font-mono font-black text-sm">{daySummary.closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <table className="min-w-full divide-y divide-gray-300 text-xs">
              <thead>
                <tr className="bg-gray-100 text-left uppercase text-[9px] font-black">
                  <th className="px-2 py-2">Receipt/Ref</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Loan/Acc</th>
                  <th className="px-2 py-2">Customer</th>
                  <th className="px-2 py-2 text-right">Credit</th>
                  <th className="px-2 py-2 text-right">Debit</th>
                  <th className="px-2 py-2 text-right">Balance</th>
                  <th className="px-2 py-2">Operator</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Particulars</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 font-mono text-[11px]">
                {filteredRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-1.5 font-bold">{r.receiptOrVoucherNo || '-'}</td>
                    <td className="px-2 py-1.5">{r.displayType || displayHeadName(r.headOfAccount)}</td>
                    <td className="px-2 py-1.5">{r.accountOrLoanNo || '-'}</td>
                    <td className="px-2 py-1.5">{r.customerName || '-'}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-green-700">{r.credit > 0 ? r.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-red-700">{r.debit > 0 ? r.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}</td>
                    <td className="px-2 py-1.5 text-right font-bold">{r.runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-1.5 text-left">{r.userName || 'Staff'}</td>
                    <td className="px-2 py-1.5 text-left">
                      <div className="font-bold text-[10px] text-gray-900">{formatRowDate(r.transactionDate || r.createdAt)}</div>
                      <div className="text-[9px] text-gray-500">{formatRowTime(r.entryTime, r.createdAt)}</div>
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-gray-700">{r.particulars || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-center mt-12 pt-6 border-t text-xs">
              <div>
                <p className="font-bold">Cashier Signature</p>
                <p className="text-gray-400 mt-6 text-[10px]">Authorized Signatory</p>
              </div>
              <div className="text-right">
                <p className="font-bold">Verified By Manager</p>
                <p className="text-gray-400 mt-6 text-[10px]">Audit Sign</p>
              </div>
            </div>
          </div>
        )}
      </FinancePrintPreview>

      {/* Add / Edit Head of Account (admin only) */}
      {headModal && isAdminUser && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !savingHead && setHeadModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200">
              <h3 className="text-[16px] font-black uppercase text-slate-900">
                {headModal.mode === 'add' ? 'Add Head of Account' : 'Edit Head of Account'}
              </h3>
              {headModal.mode === 'edit' && (
                <p className="text-[12px] text-slate-500 font-semibold mt-0.5">A new name is also shown on past Day Book entries of this head.</p>
              )}
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[12px] font-bold uppercase text-slate-700 mb-1">Head of Account Name *</label>
                <input
                  type="text"
                  autoFocus
                  value={headForm.account_name}
                  onChange={(e) => setHeadForm(f => ({ ...f, account_name: e.target.value }))}
                  placeholder="e.g. OFFICE EXPENSES A/C"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[14px] font-bold uppercase focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="block text-[12px] font-bold uppercase text-slate-700 mb-1">Account No (optional)</label>
                <input
                  type="text"
                  value={headForm.account_number}
                  disabled={headModal.mode === 'edit'}
                  onChange={(e) => setHeadForm(f => ({ ...f, account_number: e.target.value }))}
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[14px] font-semibold disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-bold uppercase text-slate-700 mb-1">Report</label>
                  <select
                    value={headForm.report_section}
                    onChange={(e) => {
                      const v = e.target.value as 'BALANCE_SHEET' | 'PROFIT_AND_LOSS';
                      setHeadForm(f => ({ ...f, report_section: v, category: v === 'BALANCE_SHEET' ? 'Other Asset' : 'Expense' }));
                    }}
                    className="w-full h-10 px-2 border border-slate-300 rounded-lg text-[14px] font-semibold"
                  >
                    <option value="PROFIT_AND_LOSS">Profit &amp; Loss</option>
                    <option value="BALANCE_SHEET">Balance Sheet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-bold uppercase text-slate-700 mb-1">Category</label>
                  <select
                    value={headForm.category}
                    onChange={(e) => setHeadForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full h-10 px-2 border border-slate-300 rounded-lg text-[14px] font-semibold"
                  >
                    {(headForm.report_section === 'PROFIT_AND_LOSS' ? ['Income', 'Expense'] : ['Other Asset', 'Liability', 'Capital'])
                      .concat(headForm.category && !['Income', 'Expense', 'Other Asset', 'Liability', 'Capital'].includes(headForm.category) ? [headForm.category] : [])
                      .map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setHeadModal(null)} disabled={savingHead} className="h-9 px-4 rounded-lg border border-slate-300 text-[13px] font-bold uppercase">Cancel</button>
              <button type="button" onClick={saveHead} disabled={savingHead} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-[13px] font-bold uppercase disabled:opacity-50">
                {savingHead ? 'Saving…' : headModal.mode === 'add' ? 'Add Head' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Daybook;
