import React, { useEffect, useState, useMemo } from 'react';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { FinanceCalculationEngine, OverdueDueItem, DuesReportType } from '../../services/FinanceCalculationEngine';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { Printer, Search, AlertTriangle, RotateCcw, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import toast from 'react-hot-toast';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';

type ReportType = DuesReportType;

const DuesLedger: React.FC = () => {
  const [dues, setDues] = useState<OverdueDueItem[]>([]);
  const [integrityErrors, setIntegrityErrors] = useState<any[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  
  const [activeReport, setActiveReport] = useState<ReportType>('OUTSTANDING');
  const [selectedPartner, setSelectedPartner] = useState<string>('ALL PARTNERS');
  const [loanTypeFilter, setLoanTypeFilter] = useState<'ALL' | 'CD' | 'HP' | 'STBD' | 'TBD'>('ALL');
  
  const [searchName, setSearchName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dueDaysSort, setDueDaysSort] = useState<'DEFAULT' | 'ASC' | 'DESC'>('DEFAULT');
  
  const [loading, setLoading] = useState(true);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Partners
      const partnersData = await supabaseFinance.getPartners();
      setPartners(partnersData.map(p => ({ id: p.id, name: p.name })));

      // 2. Fetch Aggregated Dues Summary via RPC
      const summaryResult = await supabaseFinance.getDuesLedgerSummary();
      const summaryData = summaryResult.dues || [];
      const errorsData = summaryResult.integrityErrors || [];
      
      const formatted: OverdueDueItem[] = summaryData.map((row: any) => ({
        id: row.id,
        loanId: row.loan_id,
        customerName: row.customer_name,
        loanCategory: row.loan_category,
        loanType: row.loan_type,
        loanAmount: Number(row.loan_amount),
        currentPrincipal: Number(row.current_principal),
        loanDate: row.loan_date,
        currentDueDate: row.current_due_date,
        interestPaid: Number(row.interest_paid || 0),
        pendingInterest: Number(row.pending_interest || 0),
        penalty: Number(row.penalty || 0),
        penaltyPaid: Number(row.penalty_paid || 0),
        presentDue: Number(row.present_due || 0),
        dueDays: Number(row.due_days || 0),
        isNPA: Boolean(row.is_npa),
        phone: row.phone || '',
        g1Name: row.g1_name || '',
        g1Phone: row.g1_phone || '',
        g2Name: row.g2_name || '',
        g2Phone: row.g2_phone || '',
        partnerName: row.partner_name || 'Unassigned',
        status: row.status || 'Active',
        pendingPenalty: Number(row.pending_penalty || 0),
        closingAmount: row.closing_amount !== undefined ? Number(row.closing_amount) : (Number(row.current_principal || 0) + Number(row.pending_interest || 0) + Number(row.penalty || 0)),
        totalPaid: row.total_paid !== undefined ? Number(row.total_paid) : (Number(row.interest_paid || 0) + Number(row.penalty_paid || 0))
      }));

      setDues(formatted);
      setIntegrityErrors(errorsData);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load dues ledger');
    } finally {
      setLoading(false);
    }
  };

  const filteredDues = useMemo(() => {
    return FinanceCalculationEngine.filterDueList(
      dues,
      activeReport,
      selectedPartner,
      loanTypeFilter,
      searchName,
      startDate,
      endDate,
      dueDaysSort
    );
  }, [dues, activeReport, selectedPartner, loanTypeFilter, searchName, startDate, endDate, dueDaysSort]);

  const totals = useMemo(() => {
    return FinanceCalculationEngine.computeDueListTotals(filteredDues);
  }, [filteredDues]);

  const options: { id: ReportType; label: string }[] = [
    { id: 'OUTSTANDING', label: 'Outstanding' },
    { id: 'TOTAL DUE LIST', label: 'Due List' },
    { id: 'CD DUE LIST', label: 'CD Due List' },
    { id: 'A -> B DUE LIST', label: 'A→B Due List' },
    { id: 'NPA LIST', label: 'NPA List' },
    { id: 'DUE DAYS', label: 'Due Days' }
  ];

  const handleResetFilters = () => {
    setSelectedPartner('ALL PARTNERS');
    setLoanTypeFilter('ALL');
    setSearchName('');
    setStartDate('');
    setEndDate('');
    setDueDaysSort(activeReport === 'DUE DAYS' ? 'ASC' : 'DEFAULT');
  };

  const handleToggleDueDaysSort = () => {
    setDueDaysSort(prev => {
      if (activeReport === 'DUE DAYS') {
        return prev === 'DESC' ? 'ASC' : 'DESC';
      }
      if (prev === 'DEFAULT') return 'ASC';
      if (prev === 'ASC') return 'DESC';
      return 'DEFAULT';
    });
  };

  const handleTabClick = (tabId: ReportType) => {
    if (tabId === 'DUE DAYS') {
      if (activeReport === 'DUE DAYS') {
        // Toggle sort between ASC and DESC
        setDueDaysSort(prev => (prev === 'DESC' ? 'ASC' : 'DESC'));
      } else {
        setActiveReport('DUE DAYS');
        if (dueDaysSort !== 'DESC') {
          setDueDaysSort('ASC');
        }
      }
    } else {
      setActiveReport(tabId);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 w-full mx-auto px-4 pt-2.5 pb-4 print:p-0">

      {/* ── ROW 1: Compact Header (DUE LIST • Date Pickers • PRINT) ───────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-3 bg-white border border-slate-200 px-4 py-2.5 rounded-xl shadow-2xs w-full">
        {/* Title Section */}
        <div>
          <h1 className="text-lg font-black uppercase text-slate-900 tracking-wide leading-none">DUE LIST</h1>
        </div>

        {/* Date Pickers (190px each) & Print Button (120px, 46px high) */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-[190px]">
            <FinanceSmartCalendar
              value={startDate}
              onChange={setStartDate}
              module="DUES_LIST"
              placeholder="FROM DATE"
            />
          </div>
          <div className="w-[190px]">
            <FinanceSmartCalendar
              value={endDate}
              onChange={setEndDate}
              module="DUES_LIST"
              placeholder="TO DATE"
            />
          </div>
          <button
            onClick={() => setShowPrintPreview(true)}
            className="inline-flex items-center justify-center gap-1.5 w-[120px] h-[46px] bg-[#0b1329] text-white rounded-[14px] hover:bg-slate-800 text-xs font-bold uppercase transition-colors shrink-0 shadow-2xs cursor-pointer"
          >
            <Printer className="w-4 h-4" /> PRINT
          </button>
        </div>
      </div>

      {/* ── ROW 2: Filter Bar (Partner, Loan Type, Search, SEARCH, RESET, Accounts KPI) ── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs p-2.5 px-4 w-full">
        <div className="flex flex-wrap items-center gap-2.5 w-full">
          {/* Partner (170px) */}
          <div className="w-full sm:w-[170px] shrink-0">
            <select
              value={selectedPartner}
              onChange={(e) => setSelectedPartner(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-2.5 text-slate-800 focus:ring-2 focus:ring-slate-900 focus:outline-none h-[38px] font-bold text-xs uppercase cursor-pointer shadow-2xs"
            >
              <option value="ALL PARTNERS">ALL PARTNERS</option>
              {partners.map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Loan Type (140px) */}
          <div className="w-full sm:w-[140px] shrink-0">
            <select
              value={loanTypeFilter}
              onChange={(e) => setLoanTypeFilter(e.target.value as any)}
              className="w-full bg-white border border-slate-200 rounded-xl px-2.5 text-slate-800 focus:ring-2 focus:ring-slate-900 focus:outline-none h-[38px] font-bold text-xs uppercase cursor-pointer shadow-2xs"
            >
              <option value="ALL">ALL TYPES</option>
              <option value="CD">CD LOANS</option>
              <option value="HP">HP LOANS</option>
              <option value="STBD">STBD LOANS</option>
              <option value="TBD">TBD LOANS</option>
            </select>
          </div>

          {/* Search Bar (360px) */}
          <div className="w-full sm:w-[360px] shrink-0">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search account / borrower..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl pl-9 pr-3 text-xs text-slate-800 font-bold bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 h-[38px] shadow-2xs"
              />
            </div>
          </div>

          {/* SEARCH Button (≈130px) */}
          <button
            type="button"
            onClick={() => fetchData()}
            className="inline-flex items-center justify-center gap-1.5 w-[130px] h-[38px] bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-xs font-black uppercase transition-colors shadow-2xs cursor-pointer shrink-0"
          >
            <Search className="w-3.5 h-3.5" />
            SEARCH
          </button>

          {/* RESET Button (≈110px) */}
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center justify-center gap-1.5 w-[110px] h-[38px] bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 border border-slate-250 text-xs font-black uppercase transition-colors shadow-2xs cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            RESET
          </button>

          {/* Accounts Compact KPI Card (Height matches buttons, beside Reset) */}
          <div className="inline-flex flex-col justify-center px-3.5 h-[38px] bg-slate-50 border border-slate-200 rounded-xl shrink-0 w-[130px] sm:ml-auto select-none">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider leading-none mb-0.5">ACCOUNTS</span>
            <span className="text-slate-900 text-[20px] font-black font-mono leading-none">{filteredDues.length}</span>
          </div>
        </div>
      </div>

      {/* ── ROW 3: Tabs Selection + Present Dues KPI (Right Aligned) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-1.5 gap-2 w-full">
        {/* Tabs (Left) */}
        <div className="flex items-center gap-1 flex-wrap">
          {options.map(opt => {
            const isActive = activeReport === opt.id;
            const isDueDays = opt.id === 'DUE DAYS';
            const currentSort = dueDaysSort === 'DESC' ? 'DESC' : 'ASC';

            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleTabClick(opt.id)}
                className={`px-3.5 py-1.5 border-b-2 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  isActive 
                    ? 'border-slate-900 text-slate-900 bg-slate-100/60 rounded-t-lg' 
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                }`}
                title={isDueDays ? `Due Days (${currentSort === 'ASC' ? 'Lowest first ↑' : 'Highest first ↓'} - click to toggle)` : opt.label}
              >
                <span>{opt.label}</span>
                {isDueDays && (
                  <span className={`inline-flex items-center justify-center p-0.5 rounded transition-transform ${isActive ? 'text-slate-950 font-black' : 'text-slate-400'}`}>
                    {currentSort === 'DESC' ? (
                      <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : (
                      <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Present Dues KPI (Right Aligned in Tab Bar - Hidden/0 for NPA List) */}
        <div className="flex items-center gap-2.5 shrink-0 px-2 py-0.5 sm:ml-auto">
          <span className="text-xs font-black text-red-600 uppercase tracking-wider">
            {activeReport === 'NPA LIST' ? 'Settlement Total' : 'Present Dues'}
          </span>
          <span className="text-red-700 text-xl font-black font-mono tracking-tight">
            {activeReport === 'NPA LIST' 
              ? totals.amountToClose.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : totals.presentDue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* ── ROW 4: Integrity Warnings Box ────────────────────────────────────── */}
      {!loading && integrityErrors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5 text-xs text-amber-900 font-medium">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-extrabold uppercase text-[11px] text-amber-850 block">Database Consistency Warnings ({integrityErrors.length})</span>
            <p className="text-[11px] leading-relaxed">
              Below entries failed check audits (duplicate profiles, missing principal rows). Report displayed totals might be skewed.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] pt-1">
              {integrityErrors.slice(0, 10).map((err, i) => (
                <div key={i} className="bg-white/60 px-1.5 py-0.5 rounded border border-amber-100">
                  <span className="font-bold text-amber-950 uppercase">{err.loanId || 'Unknown'}</span>: {err.error_type}
                </div>
              ))}
              {integrityErrors.length > 10 && (
                <div className="font-bold text-amber-700">+ {integrityErrors.length - 10} more warnings</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ROW 5: Main Ledger Table grid ────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[300px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 font-bold uppercase text-[12px]">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-slate-900 mb-2.5"></div>
            Loading database dues entries...
          </div>
        ) : filteredDues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 font-bold uppercase text-[12px]">
            No matching overdue profiles found.
          </div>
        ) : (
          <div className="w-full">
            <table className="w-full text-left border-collapse border-spacing-0">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 select-none">
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-center text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">SL</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">CD Number</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Borrower / Contact</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Paid Interest</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Paid Penalty</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Pending Interest</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Pending Penalty</th>
                  
                  {/* Present Due: Shown for active tabs, Hidden for NPA LIST */}
                  {activeReport !== 'NPA LIST' && (
                    <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 font-black text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Present Due</th>
                  )}
                  
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Principal</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 font-black text-blue-900 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Closing Amount</th>
                  
                  {/* Total Paid: Shown for NPA LIST */}
                  {activeReport === 'NPA LIST' && (
                    <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 font-black text-emerald-800 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Total Paid</th>
                  )}

                  {/* Loan Date: Renamed from Date */}
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">{activeReport !== 'NPA LIST' ? <>Loan Date<br />Due Date</> : 'Loan Date'}</th>


                  {/* Days / Due Days: Sortable on all active-loan tabs, hidden for NPA LIST */}
                  {activeReport !== 'NPA LIST' && (
                    <th
                      onClick={handleToggleDueDaysSort}
                      className="px-2 py-1.5 border-r border-slate-200 text-center text-slate-800 w-24 bg-slate-50 finance-small-label cursor-pointer hover:bg-slate-100 transition-colors select-none"
                      title={activeReport === 'DUE DAYS'
                        ? `Due Days: ${dueDaysSort === 'DESC' ? 'Highest first (Descending)' : 'Lowest first (Ascending)'} - click to toggle`
                        : "Click to sort by Due Days (ascending / descending)"}
                    >
                      <div className="inline-flex items-center justify-center gap-1">
                        <span>{activeReport === 'DUE DAYS' ? 'Due Days' : 'Days'}</span>
                        {activeReport === 'DUE DAYS' ? (
                          dueDaysSort === 'DESC' ? (
                            <ArrowDown className="w-3.5 h-3.5 text-blue-600 stroke-[2.5]" />
                          ) : (
                            <ArrowUp className="w-3.5 h-3.5 text-blue-600 stroke-[2.5]" />
                          )
                        ) : (
                          <>
                            {dueDaysSort === 'ASC' && <ArrowUp className="w-3.5 h-3.5 text-blue-600 stroke-[2.5]" />}
                            {dueDaysSort === 'DESC' && <ArrowDown className="w-3.5 h-3.5 text-blue-600 stroke-[2.5]" />}
                            {dueDaysSort === 'DEFAULT' && <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-60" />}
                          </>
                        )}
                      </div>
                    </th>
                  )}

                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 font-sans tabular-nums text-[12px] min-[1500px]:text-[13px] min-[1600px]:text-[14px]">
                {filteredDues.map((due, idx) => (
                  <tr key={due.id} className={`hover:bg-slate-50/40 transition-colors ${due.isNPA ? 'bg-red-50/20' : ''}`}>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-slate-500 font-sans text-center font-bold">{idx + 1}</td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 font-black text-blue-650 whitespace-nowrap">{due.loanId}</td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-slate-905 font-sans font-bold">
                      <div>{due.customerName}</div>
                      <div className="font-normal text-slate-600 leading-snug mt-0.5">
                        <div><span className="font-semibold text-slate-900">B:</span> {due.phone || '—'}</div>
                        {due.g1Name && (
                          <div><span className="font-semibold text-slate-900">G1:</span> {due.g1Name} {due.g1Phone ? `(${due.g1Phone})` : ''}</div>
                        )}
                        {due.g2Name && (
                          <div><span className="font-semibold text-slate-900">G2:</span> {due.g2Name} {due.g2Phone ? `(${due.g2Phone})` : ''}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-emerald-700 font-bold whitespace-nowrap">
                      {due.interestPaid < 0 ? `-${Math.abs(Math.round(due.interestPaid)).toLocaleString('en-IN')}` : `${Math.round(due.interestPaid).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-emerald-700 font-bold whitespace-nowrap">
                      {due.penaltyPaid < 0 ? `-${Math.abs(Math.round(due.penaltyPaid)).toLocaleString('en-IN')}` : `${Math.round(due.penaltyPaid).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-orange-605 font-bold whitespace-nowrap">
                      {due.pendingInterest < 0 ? `-${Math.abs(Math.round(due.pendingInterest)).toLocaleString('en-IN')}` : `${Math.round(due.pendingInterest).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-red-650 font-bold whitespace-nowrap">
                      {(due.pendingPenalty ?? due.penalty) < 0 ? `-${Math.abs(Math.round(due.pendingPenalty ?? due.penalty)).toLocaleString('en-IN')}` : `${Math.round(due.pendingPenalty ?? due.penalty).toLocaleString('en-IN')}`}
                    </td>
                    
                    {/* Present Due: Active tabs only */}
                    {activeReport !== 'NPA LIST' && (
                      <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-slate-950 font-sans font-black whitespace-nowrap">
                        {due.presentDue < 0 ? `-${Math.abs(Math.round(due.presentDue)).toLocaleString('en-IN')}` : `${Math.round(due.presentDue).toLocaleString('en-IN')}`}
                      </td>
                    )}

                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-slate-700 font-bold whitespace-nowrap">
                      {(due.loanAmount || due.currentPrincipal) < 0 ? `-${Math.abs(Math.round(due.loanAmount || due.currentPrincipal)).toLocaleString('en-IN')}` : `${Math.round(due.loanAmount || due.currentPrincipal).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-blue-900 font-sans font-black whitespace-nowrap">
                      {(due.closingAmount ?? (due.currentPrincipal + due.pendingInterest + due.penalty)) < 0 
                        ? `-${Math.abs(Math.round(due.closingAmount ?? (due.currentPrincipal + due.pendingInterest + due.penalty))).toLocaleString('en-IN')}` 
                        : `${Math.round(due.closingAmount ?? (due.currentPrincipal + due.pendingInterest + due.penalty)).toLocaleString('en-IN')}`}
                    </td>

                    {/* Total Paid: NPA LIST only */}
                    {activeReport === 'NPA LIST' && (
                      <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-emerald-800 font-sans font-black whitespace-nowrap">
                        {(due.totalPaid ?? (due.interestPaid + due.penaltyPaid)) < 0 
                          ? `-${Math.abs(Math.round(due.totalPaid ?? (due.interestPaid + due.penaltyPaid))).toLocaleString('en-IN')}` 
                          : `${Math.round(due.totalPaid ?? (due.interestPaid + due.penaltyPaid)).toLocaleString('en-IN')}`}
                      </td>
                    )}

                    {/* Loan Date: Formatted loan disbursement date */}
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-slate-600 font-sans whitespace-nowrap">
                      <div>{due.loanDate ? due.loanDate.split('-').reverse().join('/') : '—'}</div>
                      {activeReport !== 'NPA LIST' && (
                        <div className="font-bold">{due.currentDueDate ? due.currentDueDate.split('-').reverse().join('/') : '—'}</div>
                      )}
                    </td>


                    {/* Days / Due Days: Active tabs only */}
                    {activeReport !== 'NPA LIST' && (
                      <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-center text-red-650 font-black whitespace-nowrap">
                        {due.dueDays}
                      </td>
                    )}

                  </tr>
                ))}
                
                {/* Grand Total Row */}
                <tr className="bg-slate-50 font-sans font-black border-t-2 border-slate-200 tabular-nums text-[12px] min-[1500px]:text-[13px] min-[1600px]:text-[14px]">
                  <td colSpan={3} className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 uppercase">Grand Total:</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-emerald-700 font-bold whitespace-nowrap">{Math.round(totals.interestPaid).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-emerald-700 font-bold whitespace-nowrap">{Math.round(totals.penaltyPaid).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-orange-750 font-bold whitespace-nowrap">{Math.round(totals.interest).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-red-655 font-bold whitespace-nowrap">{Math.round(totals.penalty).toLocaleString('en-IN')}</td>
                  
                  {activeReport !== 'NPA LIST' && (
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-slate-950 font-black whitespace-nowrap">{Math.round(totals.presentDue).toLocaleString('en-IN')}</td>
                  )}
                  
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-slate-800 font-bold whitespace-nowrap">{Math.round(totals.principal).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-blue-955 font-black whitespace-nowrap">{Math.round(totals.amountToClose).toLocaleString('en-IN')}</td>
                  
                  {activeReport === 'NPA LIST' && (
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-emerald-800 font-black whitespace-nowrap">{Math.round(totals.totalPaid).toLocaleString('en-IN')}</td>
                  )}
                  
                  {activeReport === 'NPA LIST' ? (
                    <td colSpan={1}></td>
                  ) : (
                    <td colSpan={2}></td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PRINT PREVIEW */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="Collection Dues Report"
        documentTitle={`DUES LIST — ${activeReport}`}
        orientation="landscape"
      >
        {!loading && (
          <div className="space-y-4">
            {/* Print Header */}
            <div className="flex justify-between items-end border-b-2 border-slate-900 pb-2 mb-4" style={{ fontSize: '9px' }}>
              <div>
                <h3 className="font-bold uppercase text-slate-900" style={{ fontSize: '11px', margin: 0 }}>THIRUMALA GROUP FINANCE</h3>
                <p className="text-slate-500" style={{ margin: 0 }}>Collection Dues Ledger</p>
              </div>
              <div className="text-right text-slate-900">
                <p style={{ margin: 0 }}><span className="font-bold">DATE:</span> {getLocalBusinessDateISO()}</p>
                <p style={{ margin: 0 }}><span className="font-bold">PARTNER:</span> {selectedPartner}</p>
              </div>
            </div>

            {/* table-layout:auto — browser assigns widths based on content */}
            <table className="w-full border-collapse" style={{ fontSize: '8px' }}>
              <thead>
                <tr className="border-b-2 border-slate-900 bg-slate-100 font-bold" style={{ fontSize: '8px' }}>
                  <th className="p-1 border text-center print-nowrap">SL</th>
                  <th className="p-1 border text-left print-nowrap">CD NUMBER</th>
                  <th className="p-1 border text-left print-wrap">BORROWER</th>
                  <th className="p-1 border text-right print-nowrap">PD INT</th>
                  <th className="p-1 border text-right print-nowrap">PD PENALTY</th>
                  <th className="p-1 border text-right print-nowrap">PND INT</th>
                  <th className="p-1 border text-right print-nowrap">PND PENALTY</th>
                  
                  {activeReport !== 'NPA LIST' && (
                    <th className="p-1 border text-right print-nowrap">PRESENT DUE</th>
                  )}
                  
                  <th className="p-1 border text-right print-nowrap">PRINCIPAL</th>
                  <th className="p-1 border text-right print-nowrap">CLOSE AMT</th>
                  
                  {activeReport === 'NPA LIST' && (
                    <th className="p-1 border text-right print-nowrap">TOTAL PAID</th>
                  )}
                  
                  <th className="p-1 border text-left print-nowrap">LOAN DATE</th>

                  {activeReport !== 'NPA LIST' && (
                    <th className="p-1 border text-left print-nowrap">DUE DATE</th>
                  )}

                  {activeReport === 'DUE DAYS' && (
                    <th className="p-1 border text-center print-nowrap">DUE DAYS</th>
                  )}
                  {activeReport !== 'NPA LIST' && activeReport !== 'DUE DAYS' && (
                    <th className="p-1 border text-center print-nowrap">DAYS</th>
                  )}

                  <th className="p-1 border text-left print-nowrap">CONTACT</th>
                </tr>
              </thead>
              <tbody>
                {filteredDues.map((due, idx) => (
                  <tr key={due.id} className="border-b" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                    <td className="p-1 border text-center print-nowrap">{idx + 1}</td>
                    <td className="p-1 border font-black text-blue-800 print-nowrap">{due.loanId}</td>
                    <td className="p-1 border font-bold print-wrap" style={{ wordBreak: 'normal', overflowWrap: 'normal', whiteSpace: 'normal', minWidth: '60px', maxWidth: '110px' }}>
                      {due.customerName}
                    </td>
                    <td className="p-1 border text-right text-green-700 print-amount">
                      {due.interestPaid < 0 ? `-${Math.abs(Math.round(due.interestPaid)).toLocaleString('en-IN')}` : Math.round(due.interestPaid).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border text-right text-green-700 print-amount">
                      {due.penaltyPaid < 0 ? `-${Math.abs(Math.round(due.penaltyPaid)).toLocaleString('en-IN')}` : Math.round(due.penaltyPaid).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border text-right text-orange-700 print-amount">
                      {due.pendingInterest < 0 ? `-${Math.abs(Math.round(due.pendingInterest)).toLocaleString('en-IN')}` : Math.round(due.pendingInterest).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border text-right text-red-600 print-amount">
                      {(due.pendingPenalty ?? due.penalty) < 0 ? `-${Math.abs(Math.round(due.pendingPenalty ?? due.penalty)).toLocaleString('en-IN')}` : Math.round(due.pendingPenalty ?? due.penalty).toLocaleString('en-IN')}
                    </td>

                    {activeReport !== 'NPA LIST' && (
                      <td className="p-1 border text-right font-black print-amount">
                        {due.presentDue < 0 ? `-${Math.abs(Math.round(due.presentDue)).toLocaleString('en-IN')}` : Math.round(due.presentDue).toLocaleString('en-IN')}
                      </td>
                    )}

                    <td className="p-1 border text-right print-amount">
                      {(due.loanAmount || due.currentPrincipal) < 0 ? `-${Math.abs(Math.round(due.loanAmount || due.currentPrincipal)).toLocaleString('en-IN')}` : Math.round(due.loanAmount || due.currentPrincipal).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border text-right font-black text-blue-900 print-amount">
                      {Math.round(due.closingAmount ?? (due.currentPrincipal + due.pendingInterest + due.penalty)).toLocaleString('en-IN')}
                    </td>

                    {activeReport === 'NPA LIST' && (
                      <td className="p-1 border text-right font-black text-emerald-800 print-amount">
                        {Math.round(due.totalPaid ?? (due.interestPaid + due.penaltyPaid)).toLocaleString('en-IN')}
                      </td>
                    )}

                    <td className="p-1 border print-nowrap">{due.loanDate ? due.loanDate.split('-').reverse().join('/') : ''}</td>

                    {activeReport !== 'NPA LIST' && (
                      <td className="p-1 border print-nowrap">{due.currentDueDate ? due.currentDueDate.split('-').reverse().join('/') : ''}</td>
                    )}

                    {activeReport !== 'NPA LIST' && (
                      <td className="p-1 border text-center text-red-600 font-bold print-nowrap">{due.dueDays}</td>
                    )}

                    <td className="p-1 border print-nowrap leading-tight" style={{ fontSize: '7.5px' }}>
                      {due.phone && <div><span className="font-semibold">B:</span> {due.phone}</div>}
                      {due.g1Phone && <div><span className="font-semibold">G1:</span> {due.g1Phone}</div>}
                      {due.g2Phone && <div><span className="font-semibold">G2:</span> {due.g2Phone}</div>}
                    </td>
                  </tr>
                ))}

                {/* Grand Total Row */}
                <tr className="border-t-2 border-slate-900 font-black" style={{ breakInside: 'avoid' }}>
                  <td colSpan={3} className="p-1 border text-right uppercase text-slate-700">GRAND TOTAL</td>
                  <td className="p-1 border text-right text-green-700 print-amount">{Math.round(totals.interestPaid).toLocaleString('en-IN')}</td>
                  <td className="p-1 border text-right text-green-700 print-amount">{Math.round(totals.penaltyPaid).toLocaleString('en-IN')}</td>
                  <td className="p-1 border text-right text-orange-700 print-amount">{Math.round(totals.interest).toLocaleString('en-IN')}</td>
                  <td className="p-1 border text-right text-red-600 print-amount">{Math.round(totals.penalty).toLocaleString('en-IN')}</td>
                  
                  {activeReport !== 'NPA LIST' && (
                    <td className="p-1 border text-right print-amount">{Math.round(totals.presentDue).toLocaleString('en-IN')}</td>
                  )}
                  
                  <td className="p-1 border text-right print-amount">{Math.round(totals.principal).toLocaleString('en-IN')}</td>
                  <td className="p-1 border text-right text-blue-900 print-amount">{Math.round(totals.amountToClose).toLocaleString('en-IN')}</td>
                  
                  {activeReport === 'NPA LIST' && (
                    <td className="p-1 border text-right text-emerald-800 print-amount">{Math.round(totals.totalPaid).toLocaleString('en-IN')}</td>
                  )}
                  
                  {activeReport === 'NPA LIST' ? (
                    <td colSpan={2} className="p-1 border"></td>
                  ) : (
                    <td colSpan={4} className="p-1 border"></td>
                  )}
                </tr>
              </tbody>
            </table>

            {/* Totals Summary Box */}
            <div className="mt-4 flex justify-end" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div className="border-2 border-slate-900 rounded p-3 bg-slate-50" style={{ fontSize: '9px', minWidth: '320px' }}>
                <h4 className="font-bold text-center border-b-2 border-slate-900 pb-1 mb-2 uppercase tracking-wider" style={{ fontSize: '10px', margin: 0 }}>Report Totals</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 12px' }}>
                  <span className="font-semibold text-slate-700 uppercase">Principal:</span>
                  <span className="font-bold text-right">{Math.round(totals.principal).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Interest Paid:</span>
                  <span className="font-bold text-right text-green-700">{Math.round(totals.interestPaid).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Pending Interest:</span>
                  <span className="font-bold text-right text-orange-700">{Math.round(totals.interest).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Paid Penalty:</span>
                  <span className="font-bold text-right text-green-700">{Math.round(totals.penaltyPaid).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Pending Penalty:</span>
                  <span className="font-bold text-right text-red-600">{Math.round(totals.penalty).toLocaleString('en-IN')}</span>
                  {activeReport !== 'NPA LIST' && (
                    <>
                      <span className="font-semibold text-slate-700 uppercase">Present Due:</span>
                      <span className="font-bold text-right text-red-700">{Math.round(totals.presentDue).toLocaleString('en-IN')}</span>
                    </>
                  )}
                  {activeReport === 'NPA LIST' && (
                    <>
                      <span className="font-semibold text-slate-700 uppercase">Total Paid:</span>
                      <span className="font-bold text-right text-emerald-800">{Math.round(totals.totalPaid).toLocaleString('en-IN')}</span>
                    </>
                  )}
                </div>
                <div className="mt-2 border-t-2 border-slate-900 pt-2 flex justify-between items-center bg-slate-900 text-white px-2 py-1 rounded" style={{ fontSize: '10px' }}>
                  <span className="font-black uppercase tracking-wide">
                    {activeReport === 'NPA LIST' ? 'Settlement / Close Total:' : 'Total to Close:'}
                  </span>
                  <span className="font-black">{Math.round(totals.amountToClose).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </FinancePrintPreview>
    </div>
  );
};

export default DuesLedger;
