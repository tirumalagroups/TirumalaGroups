import React, { useEffect, useState, useMemo } from 'react';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { FinanceCalculationEngine, OverdueDueItem } from '../../services/FinanceCalculationEngine';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { Printer, ArrowLeft, Search, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { dailyFinancialTransactionService } from '../../services/dailyFinancialTransactionService';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import { useNavigate } from 'react-router-dom';

type ReportType = 'OUTSTANDING' | 'TOTAL DUE LIST' | 'CD DUE LIST' | 'A -> B DUE LIST' | 'NPA LIST';

const OutstandingLedger: React.FC = () => {
  const navigate = useNavigate();
  
  const [dues, setDues] = useState<OverdueDueItem[]>([]);
  const [integrityErrors, setIntegrityErrors] = useState<any[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  
  const [activeReport, setActiveReport] = useState<ReportType>('OUTSTANDING');
  const [selectedPartner, setSelectedPartner] = useState<string>('ALL PARTNERS');
  const [loanTypeFilter, setLoanTypeFilter] = useState<'ALL' | 'CD' | 'HP' | 'STBD' | 'TBD'>('ALL');
  
  const [searchName, setSearchName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Load default dates
      const oldest = await dailyFinancialTransactionService.getOldestTransactionDate();
      setStartDate(oldest || '2020-01-01');
      setEndDate(new Date().toISOString().split('T')[0]);

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
        pendingPenalty: Number(row.pending_penalty || 0)
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
      endDate
    );
  }, [dues, activeReport, selectedPartner, loanTypeFilter, searchName, startDate, endDate]);

  const totals = useMemo(() => {
    return FinanceCalculationEngine.computeDueListTotals(filteredDues);
  }, [filteredDues]);

  const options: ReportType[] = ['OUTSTANDING', 'NPA LIST'];

  return (
    <div className="flex flex-col gap-2 w-full max-w-[100%] mx-auto px-4 pt-3 pb-4 print:p-0">

      {/* ── ROW 1: Header ───────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[15px] font-black uppercase text-slate-900 tracking-wide leading-none">Outstanding List</h1>
          <p className="text-[11px] text-slate-500 uppercase font-semibold mt-0.5">Overdue Loans · NPA</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 text-[12px] font-bold uppercase shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <button
            onClick={() => setShowPrintPreview(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0b1329] text-white rounded-lg hover:bg-slate-800 text-[12px] font-bold uppercase shadow-sm"
          >
            <Printer className="w-3.5 h-3.5" /> Print Landscape
          </button>
        </div>
      </div>

      {/* ── ROW 2: Filters + Summary (single horizontal bar) ────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2.5">
        <div className="flex flex-wrap items-end gap-3">

          {/* Partner */}
          <div className="flex flex-col min-w-[160px]">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Partner</label>
            <select
              value={selectedPartner}
              onChange={(e) => setSelectedPartner(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-slate-800 uppercase bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer h-[34px]"
            >
              <option value="ALL PARTNERS">ALL PARTNERS</option>
              {partners.map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Loan Type */}
          <div className="flex flex-col min-w-[130px]">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Loan Type</label>
            <select
              value={loanTypeFilter}
              onChange={(e) => setLoanTypeFilter(e.target.value as any)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-slate-800 uppercase bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer h-[34px]"
            >
              <option value="ALL">ALL TYPES</option>
              <option value="CD">CD LOANS</option>
              <option value="HP">HP LOANS</option>
              <option value="STBD">STBD LOANS</option>
              <option value="TBD">TBD LOANS</option>
            </select>
          </div>

          {/* Search */}
          <div className="flex flex-col flex-1 min-w-[180px]">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Search Account / Name</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="e.g. CD100, NARSIMULU"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-[13px] text-slate-800 font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 h-[34px]"
              />
            </div>
          </div>

          {/* Date filters — always shown */}
          <div className="min-w-[140px]">
            <FinanceSmartCalendar
              label="From Date"
              value={startDate}
              onChange={setStartDate}
              module="DUES_LIST"
            />
          </div>
          <div className="min-w-[140px]">
            <FinanceSmartCalendar
              label="To Date"
              value={endDate}
              onChange={setEndDate}
              module="DUES_LIST"
            />
          </div>

          {/* ── Summary Metrics (right side) ───────────────────────────────── */}
          <div className="flex items-stretch gap-2 ml-auto flex-wrap">
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 flex flex-col justify-center min-w-[140px]">
              <span className="text-[10px] font-black text-red-500 uppercase tracking-wider leading-none">Total Present Dues</span>
              <span className="text-red-655 text-[17px] font-black font-mono tracking-tight leading-tight mt-0.5 whitespace-nowrap">
                {totals.presentDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 flex flex-col justify-center min-w-[100px]">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider leading-none">Accounts</span>
              <span className="text-slate-900 text-[22px] font-black font-mono tracking-tight leading-tight mt-0.5">
                {filteredDues.length}
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* ── ROW 3: Tabs Selection ────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-200 mt-1 flex-wrap">
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => setActiveReport(opt)}
            className={`px-4 py-2 border-b-2 text-xs font-black uppercase tracking-wider transition-colors ${
              activeReport === opt 
                ? 'border-slate-900 text-slate-900 bg-slate-50/50' 
                : 'border-transparent text-slate-450 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {opt}
          </button>
        ))}
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
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 font-black text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Present Due</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Principal</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 bg-slate-50 font-black text-blue-900 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Closing Amount</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Due Date<br />Loan Date</th>
                  <th className="px-1.5 py-1.5 border-r border-slate-200 text-center text-slate-800 bg-slate-50 text-[11px] min-[1600px]:text-[12px] font-black uppercase tracking-wide leading-tight align-bottom">Days</th>
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
                      {due.penalty < 0 ? `-${Math.abs(Math.round(due.penalty)).toLocaleString('en-IN')}` : `${Math.round(due.penalty).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-slate-950 font-sans font-black whitespace-nowrap">
                      {due.presentDue < 0 ? `-${Math.abs(Math.round(due.presentDue)).toLocaleString('en-IN')}` : `${Math.round(due.presentDue).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-slate-700 font-bold whitespace-nowrap">
                      {due.currentPrincipal < 0 ? `-${Math.abs(Math.round(due.currentPrincipal)).toLocaleString('en-IN')}` : `${Math.round(due.currentPrincipal).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-right text-blue-900 font-sans font-black whitespace-nowrap">
                      {due.currentPrincipal + due.pendingInterest + due.penalty < 0 ? `-${Math.abs(Math.round(due.currentPrincipal + due.pendingInterest + due.penalty)).toLocaleString('en-IN')}` : `${Math.round(due.currentPrincipal + due.pendingInterest + due.penalty).toLocaleString('en-IN')}`}
                    </td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-slate-600 font-sans whitespace-nowrap"><div className="font-bold">{due.currentDueDate ? due.currentDueDate.split('-').reverse().join('/') : '—'}</div><div>{due.loanDate ? due.loanDate.split('-').reverse().join('/') : '—'}</div></td>
                    <td className="px-1.5 py-1.5 align-top border-r border-slate-100 text-center text-red-650 font-black whitespace-nowrap">{due.dueDays}</td>
                  </tr>
                ))}
                
                {/* Grand Total Row */}
                <tr className="bg-slate-50 font-sans font-black border-t-2 border-slate-200 tabular-nums text-[12px] min-[1500px]:text-[13px] min-[1600px]:text-[14px]">
                  <td colSpan={3} className="px-1.5 py-1.5 border-r border-slate-200 text-right text-slate-800 uppercase">Grand Total:</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-emerald-700 font-bold whitespace-nowrap">{Math.round(totals.interestPaid).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-emerald-700 font-bold whitespace-nowrap">{Math.round(totals.penaltyPaid).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-orange-750 font-bold whitespace-nowrap">{Math.round(totals.interest).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-red-655 font-bold whitespace-nowrap">{Math.round(totals.penalty).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-slate-950 font-black whitespace-nowrap">{Math.round(totals.presentDue).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-slate-800 font-bold whitespace-nowrap">{Math.round(totals.principal).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1.5 align-top border-r border-slate-200 text-right text-blue-955 font-black whitespace-nowrap">{Math.round(totals.amountToClose).toLocaleString('en-IN')}</td>
                  <td colSpan={2}></td>
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
                  <th className="p-1 border text-right print-nowrap">PRESENT DUE</th>
                  <th className="p-1 border text-right print-nowrap">PRINCIPAL</th>
                  <th className="p-1 border text-right print-nowrap">CLOSE AMT</th>
                  <th className="p-1 border text-left print-nowrap">DUE DATE</th>
                  <th className="p-1 border text-left print-nowrap">DATE</th>
                  <th className="p-1 border text-center print-nowrap">DAYS</th>
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
                      {due.penalty < 0 ? `-${Math.abs(Math.round(due.penalty)).toLocaleString('en-IN')}` : Math.round(due.penalty).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border text-right font-black print-amount">
                      {due.presentDue < 0 ? `-${Math.abs(Math.round(due.presentDue)).toLocaleString('en-IN')}` : Math.round(due.presentDue).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border text-right print-amount">
                      {due.currentPrincipal < 0 ? `-${Math.abs(Math.round(due.currentPrincipal)).toLocaleString('en-IN')}` : Math.round(due.currentPrincipal).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border text-right font-black text-blue-900 print-amount">
                      {Math.round(due.currentPrincipal + due.pendingInterest + due.penalty).toLocaleString('en-IN')}
                    </td>
                    <td className="p-1 border print-nowrap">{due.currentDueDate ? due.currentDueDate.split('-').reverse().join('/') : ''}</td>
                    <td className="p-1 border print-nowrap">{due.loanDate ? due.loanDate.split('-').reverse().join('/') : ''}</td>
                    <td className="p-1 border text-center text-red-600 font-bold print-nowrap">{due.dueDays}</td>
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
                  <td className="p-1 border text-right print-amount">{Math.round(totals.presentDue).toLocaleString('en-IN')}</td>
                  <td className="p-1 border text-right print-amount">{Math.round(totals.principal).toLocaleString('en-IN')}</td>
                  <td className="p-1 border text-right text-blue-900 print-amount">{Math.round(totals.amountToClose).toLocaleString('en-IN')}</td>
                  <td colSpan={4} className="p-1 border"></td>
                </tr>
              </tbody>
            </table>

            {/* Totals Summary Box */}
            <div className="mt-4 flex justify-end" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div className="border-2 border-slate-900 rounded p-3 bg-slate-50" style={{ fontSize: '9px', minWidth: '320px' }}>
                <h4 className="font-bold text-center border-b-2 border-slate-900 pb-1 mb-2 uppercase tracking-wider" style={{ fontSize: '10px', margin: 0 }}>Report Totals</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 12px' }}>
                  <span className="font-semibold text-slate-700 uppercase">Outstanding Principal:</span>
                  <span className="font-bold text-right">{Math.round(totals.principal).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Interest Paid:</span>
                  <span className="font-bold text-right text-green-700">{Math.round(totals.interestPaid).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Pending Interest:</span>
                  <span className="font-bold text-right text-orange-700">{Math.round(totals.interest).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Paid Penalty:</span>
                  <span className="font-bold text-right text-green-700">{Math.round(totals.penaltyPaid).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Pending Penalty:</span>
                  <span className="font-bold text-right text-red-600">{Math.round(totals.penalty).toLocaleString('en-IN')}</span>
                  <span className="font-semibold text-slate-700 uppercase">Present Due:</span>
                  <span className="font-bold text-right text-red-700">{Math.round(totals.presentDue).toLocaleString('en-IN')}</span>
                </div>
                <div className="mt-2 border-t-2 border-slate-900 pt-2 flex justify-between items-center bg-slate-900 text-white px-2 py-1 rounded" style={{ fontSize: '10px' }}>
                  <span className="font-black uppercase tracking-wide">Total to Close:</span>
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

export default OutstandingLedger;
