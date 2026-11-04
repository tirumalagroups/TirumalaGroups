import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import React, { useEffect, useState, useMemo } from 'react';
import Button from '../../components/UI/Button';
import Card from '../../components/UI/Card';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { dailyFinancialTransactionService, DailyFinancialTransaction } from '../../services/dailyFinancialTransactionService';
import { Printer, RefreshCw, ArrowLeft, ChevronRight, ChevronDown, X, Search, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { useNavigate } from 'react-router-dom';

const formatDateOld = (dateStr?: string | null): string => {
  if (!dateStr) return '—';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

const GeneralLedger: React.FC = () => {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(() => getLocalBusinessDateISO());
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'CD' | 'CAPITAL' | 'BANK' | 'SALARY' | 'EXPENSE' | 'NPA CLOSED' | 'OTHER'>('ALL');
  const [headFilter, setHeadFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [allEntries, setAllEntries] = useState<DailyFinancialTransaction[]>([]);
  const [allHistoryEntries, setAllHistoryEntries] = useState<DailyFinancialTransaction[]>([]);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  
  // Expandable Head rows state
  const [expandedHeadNames, setExpandedHeadNames] = useState<Set<string>>(new Set());
  
  // Modal drill-down state (optional secondary view)
  const [selectedHead, setSelectedHead] = useState<string | null>(null);
  const [drillSearchQuery, setDrillSearchQuery] = useState('');

  const [financeMode] = useState<'REGULAR' | 'ITR'>(() => {
    const mode = sessionStorage.getItem('finance_previous_mode') || localStorage.getItem('finance_previous_mode');
    return mode === 'itr' ? 'ITR' : 'REGULAR';
  });

  const categories = [
    { value: 'ALL', label: 'All Categories' },
    { value: 'CD', label: 'CD Ledger' },
    { value: 'NPA CLOSED', label: 'NPA Closed / Write-off' },
    { value: 'CAPITAL', label: 'Partner Capital' },
    { value: 'BANK', label: 'Bank Book' },
    { value: 'SALARY', label: 'Salary Ledger' },
    { value: 'EXPENSE', label: 'Expenses' },
    { value: 'OTHER', label: 'Other Daybook' }
  ];

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
          setStartDate('1970-01-01');
        }
      } catch (err) {
        console.error(err);
        setStartDate('1970-01-01');
      }
    };
    loadDefaultStartDate();
  }, []);

  useEffect(() => {
    if (startDate) {
      fetchLedgerData();
    }
  }, [startDate, endDate]);

  const fetchLedgerData = async () => {
    setLoading(true);
    try {
      const prevDateLimit = new Date(startDate);
      prevDateLimit.setDate(prevDateLimit.getDate() - 1);
      const prevDateLimitStr = prevDateLimit.toISOString().split('T')[0];

      const [historyTxs, rangeTxs] = await Promise.all([
        startDate > '1970-01-01' 
          ? dailyFinancialTransactionService.getDailyFinancialTransactions({
              fromDate: '1970-01-01',
              toDate: prevDateLimitStr,
              financeMode
            })
          : Promise.resolve([]),
        dailyFinancialTransactionService.getDailyFinancialTransactions({
          fromDate: startDate,
          toDate: endDate,
          financeMode
        })
      ]);

      setAllEntries(rangeTxs);
      setAllHistoryEntries(historyTxs);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load general ledger data');
    } finally {
      setLoading(false);
    }
  };

  // Extract all unique head of accounts from all entries in date range
  const uniqueHeads = useMemo(() => {
    const heads = new Set<string>();
    allEntries.forEach(t => {
      if (t.headOfAccount) heads.add(t.headOfAccount);
    });
    allHistoryEntries.forEach(t => {
      if (t.headOfAccount) heads.add(t.headOfAccount);
    });
    return Array.from(heads).sort();
  }, [allEntries, allHistoryEntries]);

  // Apply Category, Head of Account, and Search Query filters to all current entries
  const filteredEntries = useMemo(() => {
    let list = [...allEntries];

    if (categoryFilter !== 'ALL') {
      list = list.filter(t => t.category === categoryFilter);
    }

    if (headFilter !== 'ALL') {
      list = list.filter(t => t.headOfAccount === headFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(t =>
        (t.headOfAccount && t.headOfAccount.toLowerCase().includes(q)) ||
        (t.particulars && t.particulars.toLowerCase().includes(q)) ||
        (t.accountOrLoanNo && t.accountOrLoanNo.toLowerCase().includes(q)) ||
        (t.customerName && t.customerName.toLowerCase().includes(q)) ||
        (t.partnerName && t.partnerName.toLowerCase().includes(q))
      );
    }

    return list;
  }, [allEntries, categoryFilter, headFilter, searchQuery]);

  // Group and summarize filtered entries by normalized Head of Account
  const summaryData = useMemo(() => {
    const map: Record<string, {
      opening: number;
      debit: number;
      credit: number;
      count: number;
      classification: string;
      entries: DailyFinancialTransaction[];
    }> = {};

    // First process history for opening balances
    let historyList = [...allHistoryEntries];
    if (categoryFilter !== 'ALL') {
      historyList = historyList.filter(t => t.category === categoryFilter);
    }
    if (headFilter !== 'ALL') {
      historyList = historyList.filter(t => t.headOfAccount === headFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      historyList = historyList.filter(t =>
        (t.headOfAccount && t.headOfAccount.toLowerCase().includes(q)) ||
        (t.particulars && t.particulars.toLowerCase().includes(q)) ||
        (t.accountOrLoanNo && t.accountOrLoanNo.toLowerCase().includes(q)) ||
        (t.customerName && t.customerName.toLowerCase().includes(q)) ||
        (t.partnerName && t.partnerName.toLowerCase().includes(q))
      );
    }

    historyList.forEach(entry => {
      const head = entry.headOfAccount || 'UNCLASSIFIED';
      if (!map[head]) {
        map[head] = { opening: 0, debit: 0, credit: 0, count: 0, classification: entry.reportClassification, entries: [] };
      }
      map[head].opening += (entry.credit || 0) - (entry.debit || 0);
    });

    filteredEntries.forEach(entry => {
      const head = entry.headOfAccount || 'UNCLASSIFIED';
      if (!map[head]) {
        map[head] = { opening: 0, debit: 0, credit: 0, count: 0, classification: entry.reportClassification, entries: [] };
      }
      map[head].debit += entry.debit || 0;
      map[head].credit += entry.credit || 0;
      map[head].count += 1;
      map[head].entries.push(entry);
    });

    return Object.entries(map)
      .filter(([_, data]) => data.opening !== 0 || data.debit !== 0 || data.credit !== 0 || data.count > 0)
      .map(([head, data]) => {
        const netMovement = data.credit - data.debit;
        const closing = data.opening + netMovement;
        return {
          head,
          opening: data.opening,
          debit: data.debit,
          credit: data.credit,
          balance: netMovement,
          closing,
          count: data.count,
          classification: data.classification,
          entries: data.entries.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate))
        };
      }).sort((a, b) => a.head.localeCompare(b.head));
  }, [filteredEntries, allHistoryEntries, categoryFilter, headFilter, searchQuery]);

  // Totals for the entire general ledger summary
  const overallTotals = useMemo(() => {
    let opening = 0;
    let debit = 0;
    let credit = 0;
    let closing = 0;
    let totalCount = 0;
    summaryData.forEach(s => {
      opening += s.opening;
      debit += s.debit;
      credit += s.credit;
      closing += s.closing;
      totalCount += s.count;
    });
    return { opening, debit, credit, balance: credit - debit, closing, totalCount };
  }, [summaryData]);

  // Filter entries for modal drill-down view
  const drillDownEntries = useMemo(() => {
    if (!selectedHead) return [];
    let list = filteredEntries.filter(e => e.headOfAccount === selectedHead);

    if (drillSearchQuery.trim()) {
      const q = drillSearchQuery.toLowerCase().trim();
      list = list.filter(e => 
        (e.particulars && e.particulars.toLowerCase().includes(q)) ||
        (e.accountOrLoanNo && e.accountOrLoanNo.toLowerCase().includes(q)) ||
        (e.customerName && e.customerName.toLowerCase().includes(q)) ||
        (e.partnerName && e.partnerName.toLowerCase().includes(q))
      );
    }

    return list.sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) {
        return a.transactionDate.localeCompare(b.transactionDate);
      }
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  }, [filteredEntries, selectedHead, drillSearchQuery]);

  // Compute live drill-down summary
  const drillTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    drillDownEntries.forEach(e => {
      debit += e.debit || 0;
      credit += e.credit || 0;
    });
    return { debit, credit, balance: credit - debit };
  }, [drillDownEntries]);

  const handleExportCSV = () => {
    if (summaryData.length === 0) {
      toast.error('No summary data to export');
      return;
    }
    const headers = ['Head of Account', 'Opening Balance', 'Credit (Cr)', 'Debit (Dr)', 'Net Movement', 'Closing Balance', 'Transaction Count'];
    const rows = summaryData.map(s => [
      `"${s.head}"`,
      `"${Math.abs(s.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${s.opening >= 0 ? 'Cr' : 'Dr'}"`,
      s.credit,
      s.debit,
      `"${Math.abs(s.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${s.balance >= 0 ? 'Cr' : 'Dr'}"`,
      `"${Math.abs(s.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${s.closing >= 0 ? 'Cr' : 'Dr'}"`,
      s.count
    ]);

    rows.push([
      '"Grand Total"',
      `"${Math.abs(overallTotals.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${overallTotals.opening >= 0 ? 'Cr' : 'Dr'}"`,
      overallTotals.credit,
      overallTotals.debit,
      `"${Math.abs(overallTotals.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${overallTotals.balance >= 0 ? 'Cr' : 'Dr'}"`,
      `"${Math.abs(overallTotals.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${overallTotals.closing >= 0 ? 'Cr' : 'Dr'}"`,
      overallTotals.totalCount
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `General_Ledger_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('General Ledger summary exported to CSV!');
  };

  const displayDateRange = `${startDate ? new Date(startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-') : ''} TO ${endDate ? new Date(endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-') : ''}`;

  return (
    <div className="space-y-4 w-full select-none text-slate-800 p-4 font-sans">
      
      {/* Header */}
      <div className="flex justify-between items-center bg-white border border-slate-200 p-4 md:p-6 rounded-3xl shadow-sm">
        <div>
          <h1 className="finance-h1">General Ledger</h1>
        </div>
        <div className="flex gap-2 items-center">
          <Button onClick={() => navigate(-1)} variant="secondary" size="sm" icon={ArrowLeft} className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs uppercase">
            Back
          </Button>
          <Button onClick={fetchLedgerData} variant="secondary" size="sm" icon={RefreshCw} className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs uppercase">
            Refresh
          </Button>
          <Button onClick={handleExportCSV} variant="secondary" size="sm" icon={FileSpreadsheet} className="bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 font-bold text-xs uppercase">
            Excel
          </Button>
          <Button onClick={() => setShowPrintPreview(true)} variant="primary" size="sm" icon={Printer} className="bg-[#0b1329] hover:bg-slate-800 text-white font-bold text-xs uppercase">
            Print
          </Button>
        </div>
      </div>

      {/* Date & Category & Search Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-4 bg-white border border-slate-200 rounded-3xl shadow-sm items-end">
        <div>
          <FinanceSmartCalendar
            label="FROM DATE"
            value={startDate}
            onChange={setStartDate}
            module="GENERAL_LEDGER"
          />
        </div>
        <div>
          <FinanceSmartCalendar
            label="TO DATE"
            value={endDate}
            onChange={setEndDate}
            module="GENERAL_LEDGER"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-500 uppercase block">Category Filter</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            className="w-full bg-white border border-slate-250 rounded-xl px-3 text-xs focus:outline-none h-[42px] font-bold uppercase"
          >
            {categories.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-500 uppercase block">Head of Account</label>
          <select
            value={headFilter}
            onChange={(e) => setHeadFilter(e.target.value)}
            className="w-full bg-white border border-slate-250 rounded-xl px-3 text-xs focus:outline-none h-[42px] font-bold uppercase"
          >
            <option value="ALL">ALL HEADS</option>
            {uniqueHeads.map(h => (
              <option key={h} value={h}>{h.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-500 uppercase block">Search Transactions</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search party or head..."
              className="w-full pl-9 pr-3 bg-white border border-slate-250 rounded-xl text-xs focus:outline-none h-[42px] font-bold"
            />
          </div>
        </div>
      </div>

      {/* Summary Table */}
      <div className={showPrintPreview ? 'print:hidden' : ''}>
        <Card
          title={
            <div className="flex justify-between items-center w-full">
              <span className="text-sm font-bold uppercase text-slate-900">General Ledger Accounts Summary</span>
              <span className="font-mono text-slate-500 text-xs font-bold uppercase">
                {displayDateRange}
              </span>
            </div>
          }
          className="shadow-sm border-slate-200 rounded-3xl overflow-hidden"
        >
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-900"></div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-hidden border border-slate-200 rounded-2xl max-h-[600px] overflow-y-auto scrollbar-thin">
                <table className="fit-table w-full text-left border-collapse tabular-nums">
                  <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-700 uppercase font-bold border-b border-slate-250">
                    <tr className="text-[12px] min-[1400px]:text-[13px] min-[1600px]:text-[14px]">
                      <th className="w-8 px-3 py-3 text-center"></th>
                      <th className="px-4 py-3">Head of Account</th>
                      <th className="px-4 py-3.5 text-right text-slate-600">Opening Bal</th>
                      <th className="px-4 py-3.5 text-right text-emerald-800">Credit (Cr)</th>
                      <th className="px-4 py-3.5 text-right text-rose-800">Debit (Dr)</th>
                      <th className="px-4 py-3.5 text-right text-slate-800">Net Movement</th>
                      <th className="px-4 py-3.5 text-right text-slate-900">Closing Bal</th>
                      <th className="px-4 py-3.5 text-center whitespace-nowrap">Count</th>
                      <th className="px-4 py-3.5 text-center whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white font-sans">
                    {summaryData.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-400 font-bold uppercase italic">
                          No transactions found.
                        </td>
                      </tr>
                    ) : (
                      summaryData.map(s => {
                        const isExpanded = expandedHeadNames.has(s.head);
                        return (
                          <React.Fragment key={s.head}>
                            <tr className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors text-[12px] min-[1400px]:text-[13px] min-[1600px]:text-[14px]">
                              <td className="px-2.5 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleExpandHead(s.head)}
                                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition-colors cursor-pointer"
                                  title={isExpanded ? "Hide Details" : "Show Details"}
                                >
                                  {isExpanded ? <ChevronDown className="w-4 h-4 text-blue-600" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                </button>
                              </td>
                              <td className="fit-name px-4 py-3 font-bold text-slate-900 uppercase">{s.head}</td>
                              <td className={`fit-nowrap px-4 py-3 text-right font-mono font-bold whitespace-nowrap ${s.opening >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {Math.abs(s.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {s.opening >= 0 ? 'Cr' : 'Dr'}
                              </td>
                              <td className="fit-nowrap px-4 py-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                                {s.credit > 0 ? s.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                              </td>
                              <td className="fit-nowrap px-4 py-3 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                                {s.debit > 0 ? s.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                              </td>
                              <td className={`fit-nowrap px-4 py-3 text-right font-mono font-bold whitespace-nowrap ${s.balance >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                                {Math.abs(s.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {s.balance >= 0 ? 'Cr' : 'Dr'}
                              </td>
                              <td className={`fit-nowrap px-4 py-3 text-right font-mono font-black whitespace-nowrap ${s.closing >= 0 ? 'text-emerald-900' : 'text-rose-900'}`}>
                                {Math.abs(s.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {s.closing >= 0 ? 'Cr' : 'Dr'}
                              </td>
                              <td className="fit-nowrap px-4 py-3 text-center font-mono font-black text-slate-800">{s.count}</td>
                              <td className="px-4 py-3 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setSelectedHead(s.head)}
                                  className="text-indigo-700 hover:text-indigo-900 text-[13px] font-bold hover:underline"
                                >
                                  View Details
                                </button>
                              </td>
                            </tr>

                            {/* Inline Expandable Sub-table for Ledger Postings */}
                            {isExpanded && (
                              <tr className="bg-slate-50/90">
                                <td colSpan={9} className="px-4 py-3 border-y border-slate-250">
                                  <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 shadow-sm">
                                    <div className="flex items-center justify-between text-[13px] font-mono font-bold text-slate-700 border-b pb-1.5">
                                      <span className="flex items-center gap-1.5 text-blue-900">
                                        <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                        TRANSACTION BREAKDOWN
                                      </span>
                                      <span className="text-slate-500 font-normal">Head: <span className="font-bold text-slate-800">{s.head}</span></span>
                                    </div>
                                    <div className="overflow-x-hidden max-h-[340px] overflow-y-auto scrollbar-thin">
                                      <table className="fit-table fit-dense w-full text-left border-collapse tabular-nums">
                                        <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold uppercase border-b border-slate-200">
                                          <tr className="text-[12px] min-[1400px]:text-[13px] min-[1600px]:text-[14px]">
                                            <th className="p-1.5 whitespace-nowrap">Date</th>
                                            <th className="p-1.5 whitespace-nowrap">Module</th>
                                            <th className="p-1.5">Receipt/Voucher</th>
                                            <th className="p-1.5">Loan/Acc No</th>
                                            <th className="p-1.5">Party/Customer</th>
                                            <th className="p-1.5 whitespace-nowrap">Particulars</th>
                                            <th className="p-1.5 text-right text-emerald-800 whitespace-nowrap">Credit (Cr)</th>
                                            <th className="p-1.5 text-right text-rose-800 whitespace-nowrap">Debit (Dr)</th>
                                            <th className="p-1.5 whitespace-nowrap">User</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-150 font-mono">
                                          {s.entries.map((entry) => {
                                            const moduleName = entry.sourceType === 'CD_LEDGER' ? 'CD Ledger'
                                              : entry.sourceType === 'LOAN_TRANSACTION' ? 'Loan Register'
                                              : entry.sourceType === 'CAPITAL_ENTRY' ? 'Capital Account'
                                              : 'Daybook';
                                            return (
                                              <tr key={entry.id} className="hover:bg-slate-50 text-[12px] min-[1400px]:text-[13px] min-[1600px]:text-[14px]">
                                                <td className="fit-nowrap p-1.5 font-bold">{formatDateOld(entry.transactionDate)}</td>
                                                <td className="p-1.5 text-slate-600 font-sans font-medium">{moduleName}</td>
                                                <td className="fit-nowrap p-1.5 font-black">{entry.receiptOrVoucherNo || '—'}</td>
                                                <td className={`p-1.5 font-bold text-blue-900 ${(entry.accountOrLoanNo || '').length > 14 ? 'break-all' : 'fit-nowrap'}`}>{entry.accountOrLoanNo || '—'}</td>
                                                <td className="fit-name p-1.5 font-sans font-medium">{entry.customerName || entry.partnerName || '—'}</td>
                                                <td className="fit-particulars min-[1600px]:!min-w-[14rem] p-1.5 font-sans text-slate-700" title={entry.particulars}>{entry.particulars || '—'}</td>
                                                <td className="fit-nowrap p-1.5 text-right text-emerald-700 font-bold">{entry.credit > 0 ? entry.credit.toLocaleString('en-IN') : '—'}</td>
                                                <td className="fit-nowrap p-1.5 text-right text-rose-700 font-bold">{entry.debit > 0 ? entry.debit.toLocaleString('en-IN') : '—'}</td>
                                                <td className="p-1.5 font-sans text-slate-600 whitespace-nowrap">{entry.userName || 'Staff'}</td>
                                              </tr>
                                            );
                                          })}
                                          {s.entries.length === 0 && (
                                            <tr>
                                              <td colSpan={9} className="text-center py-4 text-slate-400 font-bold uppercase italic">No transactions found.</td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                  {/* Overall Totals */}
                  {summaryData.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-900 font-mono font-black border-t-2 border-slate-300">
                      <tr className="text-[12px] min-[1400px]:text-[13px] min-[1600px]:text-[14px]">
                        <td colSpan={2} className="px-4 py-3.5 uppercase text-right font-sans font-bold text-slate-700">GRAND TOTALS:</td>
                        <td className={`fit-nowrap px-4 py-3.5 text-right font-black ${overallTotals.opening >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                          {Math.abs(overallTotals.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {overallTotals.opening >= 0 ? 'Cr' : 'Dr'}
                        </td>
                        <td className="fit-nowrap px-4 py-3.5 text-right text-emerald-800 font-black">
                          {overallTotals.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="fit-nowrap px-4 py-3.5 text-right text-rose-800 font-black">
                          {overallTotals.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className={`fit-nowrap px-4 py-3.5 text-right font-black ${overallTotals.balance >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                          {Math.abs(overallTotals.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {overallTotals.balance >= 0 ? 'Cr' : 'Dr'}
                        </td>
                        <td className={`fit-nowrap px-4 py-3.5 text-right font-black ${overallTotals.closing >= 0 ? 'text-emerald-900' : 'text-rose-900'}`}>
                          {Math.abs(overallTotals.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {overallTotals.closing >= 0 ? 'Cr' : 'Dr'}
                        </td>
                        <td className="px-4 py-3.5 text-center text-slate-900 font-black">{overallTotals.totalCount.toLocaleString('en-IN')}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Secondary Drill Down Modal */}
      {selectedHead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div>
                <h3 className="text-base font-bold uppercase tracking-tight text-slate-100">
                  Account Statement: {selectedHead}
                </h3>
                <p className="text-xs text-slate-400 font-semibold uppercase mt-0.5">{displayDateRange}</p>
              </div>
              <button 
                onClick={() => { setSelectedHead(null); setDrillSearchQuery(''); }}
                className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Filters */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex gap-4 items-center">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={drillSearchQuery}
                  onChange={(e) => setDrillSearchQuery(e.target.value)}
                  placeholder="Filter drill transactions by party or particulars..."
                  className="w-full pl-9 pr-3 bg-white border border-slate-250 rounded-xl text-xs h-9 focus:outline-none font-bold"
                />
              </div>
              {drillSearchQuery && (
                <button
                  onClick={() => setDrillSearchQuery('')}
                  className="text-xs font-bold text-slate-500 uppercase hover:underline"
                >
                  Clear filter
                </button>
              )}
            </div>

            {/* Modal Body & Table */}
            <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-3">
              <div className="flex flex-wrap gap-4 p-3 bg-slate-100 border border-slate-200 rounded-xl text-[14px] font-bold uppercase items-center justify-between font-mono">
                <div>Total Cr: <span className="text-emerald-700 font-black">{drillTotals.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                <div className="w-px h-4 bg-slate-300"></div>
                <div>Total Dr: <span className="text-rose-700 font-black">{drillTotals.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                <div className="w-px h-4 bg-slate-300"></div>
                <div>Net Balance: <span className={`${drillTotals.balance >= 0 ? 'text-emerald-800' : 'text-rose-800'} font-black`}>{drillTotals.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="fit-table w-full divide-y divide-slate-200 border-collapse tabular-nums">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase">
                    <tr className="text-[12px] min-[1400px]:text-[13px] min-[1600px]:text-[14px]">
                      <th className="px-3.5 py-3 text-left whitespace-nowrap">Date</th>
                      <th className="px-3.5 py-3 text-left whitespace-nowrap">Account/Loan</th>
                      <th className="px-3.5 py-3 text-left whitespace-nowrap">Party/Customer</th>
                      <th className="px-3.5 py-3 text-left whitespace-nowrap">Particulars</th>
                      <th className="px-3.5 py-3 text-right text-emerald-800 whitespace-nowrap">Credit (Cr)</th>
                      <th className="px-3.5 py-3 text-right text-rose-800 whitespace-nowrap">Debit (Dr)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white font-mono">
                    {drillDownEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-bold uppercase italic">
                          No transaction records matching filter.
                        </td>
                      </tr>
                    ) : (
                      drillDownEntries.map(e => (
                        <tr key={e.id} className="hover:bg-blue-50/40 transition-colors text-[12px] min-[1400px]:text-[13px] min-[1600px]:text-[14px]">
                          <td className="fit-nowrap px-3.5 py-2.5 font-bold">{formatDateOld(e.transactionDate)}</td>
                          <td className={`px-3.5 py-2.5 font-bold text-blue-900 uppercase ${(e.accountOrLoanNo || '').length > 14 ? 'break-all' : 'fit-nowrap'}`}>{e.accountOrLoanNo || '—'}</td>
                          <td className="fit-name px-3.5 py-2.5 font-sans font-medium">{e.customerName || e.partnerName || '—'}</td>
                          <td className="fit-particulars min-[1600px]:!min-w-[14rem] px-3.5 py-2.5 font-sans text-slate-700" title={e.particulars}>{e.particulars || '—'}</td>
                          <td className="fit-nowrap px-3.5 py-2.5 text-right text-emerald-700 font-bold">{e.credit > 0 ? e.credit.toLocaleString('en-IN') : '—'}</td>
                          <td className="fit-nowrap px-3.5 py-2.5 text-right text-rose-700 font-bold">{e.debit > 0 ? e.debit.toLocaleString('en-IN') : '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 flex justify-end bg-slate-50">
              <button
                onClick={() => { setSelectedHead(null); setDrillSearchQuery(''); }}
                className="px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 font-bold text-xs uppercase rounded-xl transition-colors"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT PREVIEW */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="General Ledger Report"
        documentTitle={`GENERAL LEDGER STATEMENT OF ACCOUNT: ${displayDateRange}`}
      >
        <div className="text-center pb-4 border-b-2 border-slate-900 font-sans">
          <h2 className="text-lg font-black uppercase text-slate-900">General Ledger Reconciled Audit Summary</h2>
          <p className="text-[10px] text-slate-500 uppercase font-mono mt-0.5">
            Period: {displayDateRange}
          </p>
        </div>

        {/* Overall summary numbers */}
        <div className="grid grid-cols-4 gap-4 py-4 border-b border-slate-300 font-mono text-[11px] text-center">
          <div>
            <span className="text-slate-500 text-[9px] uppercase font-sans font-bold block">Opening Balance</span>
            <span className="text-slate-900 font-black">{Math.abs(overallTotals.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {overallTotals.opening >= 0 ? 'Cr' : 'Dr'}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[9px] uppercase font-sans font-bold block">Total Credits (Cr)</span>
            <span className="text-emerald-800 font-black">{overallTotals.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[9px] uppercase font-sans font-bold block">Total Debits (Dr)</span>
            <span className="text-rose-800 font-black">{overallTotals.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[9px] uppercase font-sans font-bold block">Closing Balance</span>
            <span className="text-slate-900 font-black">{Math.abs(overallTotals.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {overallTotals.closing >= 0 ? 'Cr' : 'Dr'}</span>
          </div>
        </div>

        {/* Summary Table */}
        <div className="py-4">
          <table className="w-full text-[10px] border-collapse font-mono">
            <thead>
              <tr className="bg-slate-100 font-sans font-bold text-slate-700 uppercase border-b border-slate-300">
                <th className="py-2 px-2 text-left">Head of Account</th>
                <th className="py-2 px-2 text-right">Opening</th>
                <th className="py-2 px-2 text-right text-emerald-800">Credit (Cr)</th>
                <th className="py-2 px-2 text-right text-rose-800">Debit (Dr)</th>
                <th className="py-2 px-2 text-right">Closing</th>
                <th className="py-2 px-2 text-center">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {summaryData.map(s => (
                <tr key={s.head}>
                  <td className="py-1.5 px-2 font-bold uppercase">{s.head}</td>
                  <td className="py-1.5 px-2 text-right">{Math.abs(s.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {s.opening >= 0 ? 'Cr' : 'Dr'}</td>
                  <td className="py-1.5 px-2 text-right text-emerald-700 font-bold">{s.credit > 0 ? s.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</td>
                  <td className="py-1.5 px-2 text-right text-rose-700 font-bold">{s.debit > 0 ? s.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</td>
                  <td className="py-1.5 px-2 text-right font-black">{Math.abs(s.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {s.closing >= 0 ? 'Cr' : 'Dr'}</td>
                  <td className="py-1.5 px-2 text-center font-bold">{s.count}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-black border-t-2 border-slate-400">
                <td className="py-2 px-2 uppercase font-sans font-bold">Grand Total:</td>
                <td className="py-2 px-2 text-right">{Math.abs(overallTotals.opening).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {overallTotals.opening >= 0 ? 'Cr' : 'Dr'}</td>
                <td className="py-2 px-2 text-right text-emerald-800">{overallTotals.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="py-2 px-2 text-right text-rose-800">{overallTotals.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="py-2 px-2 text-right">{Math.abs(overallTotals.closing).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {overallTotals.closing >= 0 ? 'Cr' : 'Dr'}</td>
                <td className="py-2 px-2 text-center">{overallTotals.totalCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </FinancePrintPreview>

    </div>
  );
};

export default GeneralLedger;
