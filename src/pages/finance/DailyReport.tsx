import React, { useEffect, useState, useMemo } from 'react';
import { dailyFinancialTransactionService, DailyFinancialTransaction } from '../../services/dailyFinancialTransactionService';
import { 
  Printer, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Calendar,
  RefreshCw,
  FileSpreadsheet,
  SlidersHorizontal
} from 'lucide-react';
import toast from 'react-hot-toast';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { useNavigate } from 'react-router-dom';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import CustomCalendar from '../../components/UI/CustomCalendar';
import { displayHeadName } from '../../utils/financeLabels';

const DailyReportFinance: React.FC = () => {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => getLocalBusinessDateISO());
  const [loading, setLoading] = useState(true);
  const [financeMode] = useState<'REGULAR' | 'ITR'>(() => {
    const mode = sessionStorage.getItem('finance_previous_mode') || localStorage.getItem('finance_previous_mode');
    return mode === 'itr' ? 'ITR' : 'REGULAR';
  });

  const [openingBalance, setOpeningBalance] = useState(0);
  const [transactions, setTransactions] = useState<DailyFinancialTransaction[]>([]);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // Calendar states
  const [showCalendar, setShowCalendar] = useState(false);
  const [reportActivityDates, setReportActivityDates] = useState<{ c_date: string }[]>([]);

  // Expanded Filter states (Requirement 9)
  const [searchQuery, setSearchQuery] = useState(''); // Quick search (Requirement 10)
  const [accountFilter, setAccountFilter] = useState('ALL');
  const [staffFilter, setStaffFilter] = useState('ALL');
  const [receiptFilter, setReceiptFilter] = useState('');
  const [loanFilter, setLoanFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');

  // Modal / Drawer for clicked transaction (Requirement 1 & 3)
  const [selectedTx, setSelectedTx] = useState<DailyFinancialTransaction | null>(null);

  // Manual Date Entry Input State
  const [dateInputText, setDateInputText] = useState(() => {
    const todayStr = getLocalBusinessDateISO();
    const parts = todayStr.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  });

  useEffect(() => {
    if (selectedDate) {
      const parts = selectedDate.split('-');
      if (parts.length === 3) {
        setDateInputText(`${parts[2]}/${parts[1]}/${parts[0]}`);
      }
    }
  }, [selectedDate]);

  const parseAndValidateDate = (val: string): string | null => {
    const cleanVal = val.trim();
    const match = cleanVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const y = parseInt(match[3], 10);
    if (y < 1000 || y > 9999) return null;
    if (m < 1 || m > 12) return null;

    const daysInMonth = new Date(y, m, 0).getDate();
    if (d < 1 || d > daysInMonth) return null;

    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  };

  const handleDateTextBlurOrSubmit = () => {
    const validated = parseAndValidateDate(dateInputText);
    if (validated) {
      setSelectedDate(validated);
    } else {
      toast.error('Invalid date format/value. Use DD/MM/YYYY (e.g. 15/07/2026).');
      const parts = selectedDate.split('-');
      if (parts.length === 3) {
        setDateInputText(`${parts[2]}/${parts[1]}/${parts[0]}`);
      }
    }
  };

  // Auto-refresh interval (Requirement 6)
  useEffect(() => {
    fetchDailyData();
    const interval = setInterval(() => {
      fetchDailyData(true); // silent refresh
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedDate]);

  // Load activity dates for calendar
  useEffect(() => {
    const d = new Date(selectedDate);
    fetchActivityDates(d.getMonth() + 1, d.getFullYear());
  }, [selectedDate]);

  const handlePrevDay = async () => {
    const prevDate = await dailyFinancialTransactionService.getNearestTransactionDate({
      currentDate: selectedDate,
      direction: 'prev',
      financeMode
    });
    if (prevDate) {
      setSelectedDate(prevDate);
    } else {
      toast.error('No previous transaction dates found');
    }
  };

  const handleNextDay = async () => {
    const nextDate = await dailyFinancialTransactionService.getNearestTransactionDate({
      currentDate: selectedDate,
      direction: 'next',
      financeMode
    });
    if (nextDate) {
      setSelectedDate(nextDate);
    } else {
      toast.error('No future transaction dates found');
    }
  };

  const handleGoToToday = () => {
    setSelectedDate(getLocalBusinessDateISO());
  };

  const fetchActivityDates = async (month: number, year: number) => {
    try {
      const dates = await dailyFinancialTransactionService.getDailyReportActivityDates({
        month,
        year,
        financeMode
      });
      setReportActivityDates(dates);
    } catch (err) {
      console.error('Failed to load daily report activity dates', err);
    }
  };

  const fetchDailyData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // 1. Calculate opening balance by summing all transactions from past to yesterday
      const yesterday = new Date(selectedDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Dynamically derive the oldest transaction date as From Date (Requirement 12)
      const oldestDate = await dailyFinancialTransactionService.getOldestTransactionDate();

      const priorTx = await dailyFinancialTransactionService.getDailyFinancialTransactions({
        fromDate: oldestDate,
        toDate: yesterdayStr,
        financeMode
      });
      const opBal = priorTx.reduce((sum, tx) => sum + tx.credit - tx.debit, 0);
      setOpeningBalance(opBal);

      // 2. Fetch today's transactions
      const todayTx = await dailyFinancialTransactionService.getDailyFinancialTransactions({
        fromDate: selectedDate,
        toDate: selectedDate,
        financeMode
      });

      setTransactions(todayTx);
    } catch (err) {
      console.error(err);
      if (!silent) toast.error('Failed to load daily transactions log');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Extract unique accounts & staff list for dropdown filters
  const filterOptions = useMemo(() => {
    const accounts = new Set<string>();
    const staff = new Set<string>();
    transactions.forEach(tx => {
      if (tx.headOfAccount) accounts.add(tx.headOfAccount);
      if (tx.userName) staff.add(tx.userName);
    });
    return {
      accounts: Array.from(accounts).sort(),
      staff: Array.from(staff).sort()
    };
  }, [transactions]);

  // Filtered transactions (Requirement 9 & 10 - Quick Search)
  // Ordered NEWEST FIRST (Requirement 1)
  const filteredTransactions = useMemo(() => {
    const list = transactions.filter(tx => {
      // Quick Search (Receipt, Loan, Customer, Account, Phone, User)
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const matchesReceipt = tx.receiptOrVoucherNo?.toLowerCase().includes(q);
        const matchesLoan = tx.accountOrLoanNo?.toLowerCase().includes(q);
        const matchesCust = tx.customerName?.toLowerCase().includes(q) || tx.particulars?.toLowerCase().includes(q);
        const matchesAcc = tx.headOfAccount?.toLowerCase().includes(q);
        const matchesUser = tx.userName?.toLowerCase().includes(q);
        if (!matchesReceipt && !matchesLoan && !matchesCust && !matchesAcc && !matchesUser) {
          return false;
        }
      }

      // Detailed filters
      if (accountFilter !== 'ALL' && tx.headOfAccount !== accountFilter) return false;
      if (staffFilter !== 'ALL' && tx.userName !== staffFilter) return false;
      if (receiptFilter.trim() && !tx.receiptOrVoucherNo?.toLowerCase().includes(receiptFilter.toLowerCase().trim())) return false;
      if (loanFilter.trim() && !tx.accountOrLoanNo?.toLowerCase().includes(loanFilter.toLowerCase().trim())) return false;
      if (customerFilter.trim() && !tx.customerName?.toLowerCase().includes(customerFilter.toLowerCase().trim())) return false;
      if (txTypeFilter === 'CREDIT' && tx.credit === 0) return false;
      if (txTypeFilter === 'DEBIT' && tx.debit === 0) return false;

      return true;
    });

    // Newest first sorting
    return list.sort((a, b) => {
      const aTime = a.createdAt || '';
      const bTime = b.createdAt || '';
      return bTime.localeCompare(aTime);
    });
  }, [transactions, searchQuery, accountFilter, staffFilter, receiptFilter, loanFilter, customerFilter, txTypeFilter]);

  // Total daily summary (Reconciled Footer - Requirement 4)
  const dailyTotals = useMemo(() => {
    let credTotal = 0;
    let debTotal = 0;
    transactions.forEach(tx => {
      credTotal += tx.credit;
      debTotal += tx.debit;
    });
    return {
      credits: credTotal,
      debits: debTotal,
      opening: openingBalance,
      grandTotal: credTotal - debTotal,
      closing: openingBalance + credTotal - debTotal
    };
  }, [transactions, openingBalance]);

  // Account Summaries Panel (Requirement 2 & 7)
  const accountSummaries = useMemo(() => {
    const summary: Record<string, { credit: number; debit: number }> = {};
    transactions.forEach(tx => {
      const accName = tx.headOfAccount || 'UNCLASSIFIED';
      if (!summary[accName]) {
        summary[accName] = { credit: 0, debit: 0 };
      }
      summary[accName].credit += tx.credit;
      summary[accName].debit += tx.debit;
    });
    return Object.entries(summary).map(([account, totals]) => ({
      account,
      credit: totals.credit,
      debit: totals.debit,
      net: totals.credit - totals.debit
    })).sort((a, b) => a.account.localeCompare(b.account));
  }, [transactions]);

  // Today's Receipts Panel (Requirement 3 & 8)
  const todayReceipts = useMemo(() => {
    const receiptsList: Array<{ receiptNo: string; loanNo: string; borrower: string; amount: number; tx: DailyFinancialTransaction }> = [];
    transactions.forEach(tx => {
      if (tx.credit > 0 && tx.receiptOrVoucherNo) {
        receiptsList.push({
          receiptNo: tx.receiptOrVoucherNo,
          loanNo: tx.accountOrLoanNo || '—',
          borrower: tx.customerName || tx.particulars || 'CD Customer',
          amount: tx.credit,
          tx: tx
        });
      }
    });
    return receiptsList.sort((a, b) => b.receiptNo.localeCompare(a.receiptNo));
  }, [transactions]);

  const handleRowClick = (tx: DailyFinancialTransaction) => {
    setSelectedTx(tx);
  };

  const handleReceiptClick = (tx: DailyFinancialTransaction) => {
    setSelectedTx(tx);
  };

  const handleLoanClick = (loanNo: string) => {
    if (!loanNo || loanNo === '—') return;
    const clean = loanNo.toUpperCase();
    if (clean.startsWith('CD')) {
      navigate(`/finance/cd-ledger?loanId=${clean}`);
    } else if (clean.startsWith('HP')) {
      navigate(`/finance/hp-ledger?loanId=${clean}`);
    } else if (clean.startsWith('STBD')) {
      navigate(`/finance/stbd-ledger?loanId=${clean}`);
    } else if (clean.startsWith('TBD')) {
      navigate(`/finance/tbd-ledger?loanId=${clean}`);
    } else {
      toast.error('Ledger type not detected from Loan ID prefix');
    }
  };

  const handleExportCSV = () => {
    if (filteredTransactions.length === 0) {
      toast.error('No data to export');
      return;
    }
    const headers = ['Date', 'Account', 'CD No', 'Particulars', 'Receipt No', 'Credit', 'Debit', 'Username', 'Entry Time'];
    const rows = filteredTransactions.map(tx => [
      tx.transactionDate,
      tx.headOfAccount,
      getCdNo(tx),
      getParticulars(tx),
      tx.receiptOrVoucherNo || '',
      tx.credit,
      tx.debit,
      tx.userName || '',
      tx.createdAt ? new Date(tx.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Daily_Report_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Report exported to Excel CSV!');
  };

  const displayDate = new Date(selectedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

  const formatTransDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  // CD / loan number of a row (only real loan numbers such as CD522, HP12, STBD7, TBD3)
  const getCdNo = (tx: DailyFinancialTransaction): string => {
    const v = (tx.accountOrLoanNo || '').trim().toUpperCase();
    return /^(CD|HP|STBD|TBD)[-\s]?\d+/.test(v) ? v : '';
  };

  // Particulars always end with the receipt number, e.g. "80-Days Renewed - RC2547"
  const getParticulars = (tx: DailyFinancialTransaction): string => {
    const text = (tx.particulars || '').trim();
    const rc = (tx.receiptOrVoucherNo || '').trim();
    if (!rc || text.toUpperCase().includes(rc.toUpperCase())) return text;
    return text ? `${text} - ${rc}` : rc;
  };

  const printContent = useMemo(() => {
    return (
      <div className="space-y-6 pb-12 font-sans text-xs uppercase font-bold">
        <h2 className="text-center text-lg border-b pb-2 mb-4">DAILY TRANSACTION LOG</h2>
        <div className="flex justify-between text-[11px] mb-4">
          <div>DATE: {displayDate}</div>
          <div>GENERATED TIME: {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</div>
        </div>

        {/* Totals Grid */}
        <div className="grid grid-cols-4 gap-4 border-b border-t border-slate-900 py-3 text-center text-[10px]">
          <div>
            <p className="text-slate-500">Opening Balance</p>
            <p className="text-slate-900 mt-1">{dailyTotals.opening.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-slate-500">Credit Total</p>
            <p className="text-emerald-700 mt-1">{dailyTotals.credits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-slate-500">Debit Total</p>
            <p className="text-red-700 mt-1">{dailyTotals.debits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-slate-500">Closing Balance</p>
            <p className="text-slate-900 mt-1">{dailyTotals.closing.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        {/* Accounts Summary */}
        <div className="border border-slate-400 rounded p-3">
          <h3 className="border-b pb-1 mb-2 text-[10px]">Account Group Summary</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[9px]">
            {accountSummaries.map((acc, idx) => (
              <div key={idx} className="flex justify-between border-b pb-0.5 border-slate-100">
                <span>{acc.account}</span>
                <span className="font-mono">CR: {acc.credit.toLocaleString('en-IN')} | DR: {acc.debit.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Transactions Table */}
        <div className="border border-slate-900">
          <table className="w-full text-left text-[9px] border-collapse">
            <thead>
              <tr className="border-b border-slate-900 bg-slate-100">
                <th className="p-2 border-r">Date</th>
                <th className="p-2 border-r">CD No</th>
                <th className="p-2 border-r">Account</th>
                <th className="p-2 border-r">Particulars</th>
                <th className="p-2 border-r text-right">Credit</th>
                <th className="p-2 text-right">Debit</th>
              </tr>
            </thead>
            <tbody className="font-mono font-medium">
              {filteredTransactions.map((tx) => (
                <tr key={tx.id} className="border-b border-slate-200">
                  <td className="p-2 border-r">{formatTransDate(tx.transactionDate)}</td>
                  <td className="p-2 border-r whitespace-nowrap font-black">{getCdNo(tx) || '—'}</td>
                  <td className="p-2 border-r">{displayHeadName(tx.headOfAccount)}</td>
                  <td className="p-2 border-r">{getParticulars(tx)}</td>
                  <td className="p-2 border-r text-right text-emerald-700">{tx.credit > 0 ? tx.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</td>
                  <td className="p-2 text-right text-red-700">{tx.debit > 0 ? tx.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }, [filteredTransactions, dailyTotals, accountSummaries, displayDate]);

  return (
    <div className="space-y-2 w-full print:hidden font-outfit select-none">

      {/* Compact Header Bar */}
      <div className="flex items-center justify-between bg-white border border-slate-200 px-3 py-2 rounded shadow-sm">
        <div>
          <h1 className="text-[24px] font-bold uppercase text-slate-900 tracking-tight leading-none">Daily Audit Report &middot; {displayDate}</h1>
          <p className="text-[13px] text-slate-400 font-bold uppercase mt-0.5">Legacy ledger reconciliations and operational cashier control</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleGoToToday} className="inline-flex items-center gap-1 px-3 h-[36px] bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-50 font-bold text-[13px] uppercase">Today</button>
          <button onClick={handlePrevDay} className="inline-flex items-center justify-center h-[36px] w-[36px] bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={handleNextDay} className="inline-flex items-center justify-center h-[36px] w-[36px] bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => fetchDailyData()} className="inline-flex items-center gap-1 px-3 h-[36px] bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-50 font-bold text-[13px] uppercase"><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
          <button onClick={handleExportCSV} className="inline-flex items-center gap-1 px-3 h-[36px] bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 rounded font-bold text-[13px] uppercase"><FileSpreadsheet className="w-3.5 h-3.5" />Excel</button>
          <button onClick={() => setShowPrintPreview(true)} className="inline-flex items-center gap-1 px-3 h-[36px] bg-[#0b1329] hover:bg-slate-800 text-white border border-slate-800 rounded font-bold text-[13px] uppercase"><Printer className="w-3.5 h-3.5" />Print</button>
        </div>
      </div>

      {/* Compact Totals Strip */}
      <div className="grid grid-cols-5 gap-2">
        <div className="bg-white border border-slate-200 rounded px-3 py-2 relative">
          <div className="text-[11px] font-bold uppercase text-slate-400">Select Date</div>
          <div className="flex items-center justify-between mt-0.5">
            <input
              type="text"
              value={dateInputText}
              onChange={(e) => setDateInputText(e.target.value)}
              onBlur={handleDateTextBlurOrSubmit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDateTextBlurOrSubmit(); }}
              placeholder="DD/MM/YYYY"
              className="text-[15px] font-black text-slate-900 font-mono focus:outline-none w-28 bg-transparent"
            />
            <button
              type="button"
              onClick={() => setShowCalendar(!showCalendar)}
              className="p-1 hover:bg-slate-50 rounded shrink-0"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
          {showCalendar && (
            <CustomCalendar
              selectedDate={selectedDate}
              onDateSelect={(d) => { setSelectedDate(d); setShowCalendar(false); }}
              onClose={() => setShowCalendar(false)}
              entries={reportActivityDates}
              onMonthChange={(m, y) => fetchActivityDates(m, y)}
            />
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded px-3 py-2">
          <div className="text-[11px] font-bold uppercase text-slate-400">Opening Balance</div>
          <div className="text-[15px] font-black text-slate-900 font-mono mt-0.5">{dailyTotals.opening.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded px-3 py-2">
          <div className="text-[11px] font-bold uppercase text-slate-400">Total Inflow (Cr)</div>
          <div className="text-[15px] font-black text-emerald-600 font-mono mt-0.5">{dailyTotals.credits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded px-3 py-2">
          <div className="text-[11px] font-bold uppercase text-slate-400">Total Outflow (Dr)</div>
          <div className="text-[15px] font-black text-red-600 font-mono mt-0.5">{dailyTotals.debits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-[#0b1329] border border-slate-800 rounded px-3 py-2">
          <div className="text-[11px] font-bold uppercase text-slate-400">Closing Balance</div>
          <div className="text-[15px] font-black text-white font-mono mt-0.5">{dailyTotals.closing.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      {/* Compact Single-Row Filter Bar */}
      <div className="bg-white border border-slate-200 rounded px-3 py-2 flex items-center gap-2 flex-wrap">
        <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="QUICK SEARCH..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-[32px] w-36 bg-slate-50 border border-slate-200 rounded pl-7 pr-2 text-[12px] font-bold uppercase text-slate-800 focus:outline-none"
          />
        </div>
        <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}
          className="h-[32px] bg-slate-50 border border-slate-200 rounded px-2 text-[12px] font-bold uppercase text-slate-800 focus:outline-none">
          <option value="ALL">ALL ACCOUNTS</option>
          {filterOptions.accounts.map(acc => <option key={acc} value={acc}>{acc}</option>)}
        </select>
        <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}
          className="h-[32px] bg-slate-50 border border-slate-200 rounded px-2 text-[12px] font-bold uppercase text-slate-800 focus:outline-none">
          <option value="ALL">ALL STAFF</option>
          {filterOptions.staff.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <input type="text" placeholder="RECEIPT NO..." value={receiptFilter} onChange={(e) => setReceiptFilter(e.target.value)}
          className="h-[32px] w-28 bg-slate-50 border border-slate-200 rounded px-2 text-[12px] font-bold uppercase text-slate-800 focus:outline-none" />
        <input type="text" placeholder="LOAN ID..." value={loanFilter} onChange={(e) => setLoanFilter(e.target.value)}
          className="h-[32px] w-24 bg-slate-50 border border-slate-200 rounded px-2 text-[12px] font-bold uppercase text-slate-800 focus:outline-none" />
        <select value={txTypeFilter} onChange={(e) => setTxTypeFilter(e.target.value as any)}
          className="h-[32px] bg-slate-50 border border-slate-200 rounded px-2 text-[12px] font-bold uppercase text-slate-800 focus:outline-none">
          <option value="ALL">CR &amp; DR</option>
          <option value="CREDIT">CR ONLY</option>
          <option value="DEBIT">DR ONLY</option>
        </select>
        <button onClick={() => { setSearchQuery(''); setAccountFilter('ALL'); setStaffFilter('ALL'); setReceiptFilter(''); setLoanFilter(''); setCustomerFilter(''); setTxTypeFilter('ALL'); }}
          className="h-[32px] px-2 bg-white text-slate-400 border border-slate-200 rounded text-[12px] font-bold uppercase hover:text-slate-700">Clear</button>
      </div>

      {/* Main Layout Stack */}
      <div className="space-y-2">

        {/* Transaction Table - occupy almost full width */}
        <div className="w-full">
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 border-b flex justify-between items-center">
              <h3 className="text-[13px] font-bold text-slate-800 uppercase">Main Transaction Ledger</h3>
              <span className="text-[12px] font-mono text-slate-400 font-bold">{filteredTransactions.length} ENTRIES</span>
            </div>

            {loading ? (
              <div className="p-16 text-center text-slate-400 text-xs font-bold uppercase">Loading transactions...</div>
            ) : filteredTransactions.length === 0 ? (
              <div className="p-16 text-center text-slate-400 text-xs font-bold uppercase">No transactions matched filter criteria.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b text-[10px] font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Account</th>
                      <th className="px-4 py-3">CD No</th>
                      <th className="px-4 py-3">Particulars</th>
                      <th className="px-4 py-3 text-right">Credit (Cr)</th>
                      <th className="px-4 py-3 text-right">Debit (Dr)</th>
                      <th className="px-4 py-3">Staff</th>
                      <th className="px-4 py-3">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-bold">
                    {filteredTransactions.map((tx) => (
                      <tr 
                        key={tx.id} 
                        onClick={() => handleRowClick(tx)}
                        className="hover:bg-slate-50/50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-slate-500">{formatTransDate(tx.transactionDate)}</td>
                        <td className="px-4 py-3 uppercase text-slate-900">{displayHeadName(tx.headOfAccount)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getCdNo(tx) ? (
                            <span
                              className="inline-block px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 font-black text-[19px] leading-tight tracking-wide text-indigo-800 hover:underline cursor-pointer"
                              data-help="CD loan number. Click it to open this loan's ledger."
                              onClick={(e) => { e.stopPropagation(); handleLoanClick(getCdNo(tx)); }}
                            >
                              {getCdNo(tx)}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-800">{getParticulars(tx)}</td>
                        <td className="px-4 py-3 text-right text-emerald-600 font-mono">
                          {tx.credit > 0 ? `${tx.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600 font-mono">
                          {tx.debit > 0 ? `${tx.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-4 py-3 uppercase text-slate-500">{tx.userName || 'Staff'}</td>
                        <td className="px-4 py-3 font-mono text-slate-400 text-[10px]">
                          {tx.createdAt ? new Date(tx.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Summaries Panel moved below */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">

          {/* Account Summary Panel */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 border-b flex justify-between items-center">
              <h3 className="text-[13px] font-bold text-slate-800 uppercase">Account Summary</h3>
            </div>
            {accountSummaries.length === 0 ? (
              <div className="px-3 py-4 text-center text-slate-400 text-[12px] font-bold uppercase">No records today</div>
            ) : (
              <div className="divide-y overflow-y-auto" style={{ maxHeight: '34vh' }}>
                {accountSummaries.map((acc, idx) => (
                  <div key={idx} className="px-3 py-2 flex justify-between items-center text-[12px] hover:bg-slate-50">
                    <div>
                      <span className="font-bold text-slate-900 uppercase block text-[13px]">{acc.account}</span>
                      <span className="text-[11px] text-slate-400 font-bold uppercase">NET: {acc.net.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="text-right font-mono text-[12px]">
                      <div className="text-emerald-700 font-bold">CR: {acc.credit.toLocaleString('en-IN')}</div>
                      <div className="text-red-700 font-bold">DR: {acc.debit.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Today's Receipts Panel */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 border-b flex justify-between items-center">
              <h3 className="text-[13px] font-bold text-slate-800 uppercase">Today's Receipts</h3>
              <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-black font-mono">{todayReceipts.length} REC</span>
            </div>
            {todayReceipts.length === 0 ? (
              <div className="px-3 py-4 text-center text-slate-400 text-[12px] font-bold uppercase">No receipts today</div>
            ) : (
              <div className="divide-y overflow-y-auto" style={{ maxHeight: '36vh' }}>
                {todayReceipts.map((rc, idx) => (
                  <div key={idx} className="px-3 py-2 flex justify-between items-center hover:bg-slate-50">
                    <div>
                      <span className="font-mono font-bold text-[13px] text-indigo-700 hover:underline block cursor-pointer" onClick={() => handleReceiptClick(rc.tx)}>{rc.receiptNo}</span>
                      <span className="text-[11px] text-slate-500 uppercase font-semibold">{rc.borrower} ({rc.loanNo})</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-emerald-600 font-bold text-[13px]">{rc.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      <button onClick={() => handleLoanClick(rc.loanNo)} className="text-[11px] text-slate-400 hover:underline block mt-0.5 uppercase">Ledger</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white border rounded-xl shadow-xl max-w-md w-full overflow-hidden text-xs uppercase font-bold">
            <div className="bg-slate-50 p-4 border-b flex justify-between items-center">
              <h4 className="font-black text-slate-900">Transaction Details</h4>
              <button onClick={() => setSelectedTx(null)} className="text-slate-400 hover:text-slate-600 font-black">CLOSE</button>
            </div>
            <div className="p-4 space-y-3">
              <div><span className="text-slate-400 block text-[10px]">Head of Account</span><span className="text-slate-950 font-black">{displayHeadName(selectedTx.headOfAccount)}</span></div>
              <div><span className="text-slate-400 block text-[10px]">Particulars</span><span className="text-slate-800 font-bold">{selectedTx.particulars}</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-slate-400 block text-[10px]">Receipt No</span><span className="text-indigo-700 font-mono">{selectedTx.receiptOrVoucherNo || '—'}</span></div>
                <div><span className="text-slate-400 block text-[10px]">Account No</span><span className="text-slate-950 font-mono">{selectedTx.accountOrLoanNo || '—'}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-2">
                <div><span className="text-slate-400 block text-[10px]">Credit</span><span className="text-emerald-700 font-mono font-black">{selectedTx.credit.toLocaleString('en-IN')}</span></div>
                <div><span className="text-slate-400 block text-[10px]">Debit</span><span className="text-red-700 font-mono font-black">{selectedTx.debit.toLocaleString('en-IN')}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-2 text-[10px] text-slate-450">
                <div><span>Entered By: {selectedTx.userName || 'Staff'}</span></div>
                <div><span>Time: {selectedTx.createdAt ? new Date(selectedTx.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '—'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Handler */}
      {showPrintPreview && (
        <FinancePrintPreview
          isOpen={showPrintPreview}
          onClose={() => setShowPrintPreview(false)}
          title="Daily Report Audit log"
          documentTitle={`Daily Transaction Log: ${displayDate}`}
        >
          {printContent}
        </FinancePrintPreview>
      )}

    </div>
  );
};

export default DailyReportFinance;
