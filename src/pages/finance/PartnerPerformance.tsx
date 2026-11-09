import React, { useEffect, useState } from 'react';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar, isoToDisplayFormatted } from '../../components/finance/FinanceSmartCalendar';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { Printer, RefreshCw, Download, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import { useNavigate } from 'react-router-dom';
import { dailyFinancialTransactionService } from '../../services/dailyFinancialTransactionService';
import { exportToExcel } from '../../utils/excel';
import { FinanceCalculationEngine, PartnerMetrics } from '../../services/FinanceCalculationEngine';

interface PartnerPerfRow extends PartnerMetrics {
  id: string;
  name: string;
  principalFinanced: number;
  principalCollected: number;
  interestEarned: number;
  penaltyEarned: number;
}

const PartnerPerformance: React.FC = () => {
  const navigate = useNavigate();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(() => getLocalBusinessDateISO());

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PartnerPerfRow[]>([]);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  useEffect(() => {
    const loadDefaultStartDate = async () => {
      try {
        const oldest = await dailyFinancialTransactionService.getOldestTransactionDate();
        if (oldest) {
          setStartDate(oldest);
        } else {
          setStartDate('2024-01-01');
        }
      } catch (err) {
        console.error(err);
        setStartDate('2024-01-01');
      }
    };
    loadDefaultStartDate();
  }, []);

  useEffect(() => {
    if (startDate) {
      fetchPerformanceData();
    }
  }, [startDate, endDate]);

  const handleExportExcel = () => {
    const data: any[] = rows.map(row => ({
      'Partner Name': row.name,
      'Role': row.role,
      'Capital Invested': row.netCapital,
      'Loans Introduced': row.loansIntroduced,
      'Loans Active': row.activeLoans,
      'Loans Closed': row.closedLoans,
      'Principal Financed': row.principalFinanced,
      'Principal Collected': row.principalCollected,
      'Interest Earned': Math.round(row.interestEarned),
      'Penalty Earned': Math.round(row.penaltyEarned),
      'Outstanding Principal': Math.round(row.outstanding),
      'Present Due': Math.round(row.presentDue),
      'Pending Interest': Math.round(row.pendingInterest),
      'Pending Penalty': Math.round(row.pendingPenalty),
      'Recovery %': Number(row.recoveryPct.toFixed(1)),
      'NPA Count': row.npaCount
    }));

    // Add Grand Total Row
    data.push({
      'Partner Name': 'GRAND TOTAL',
      'Role': 'SUMMARY',
      'Capital Invested': grandTotals.netCapital,
      'Loans Introduced': grandTotals.loansIntroduced,
      'Loans Active': grandTotals.activeLoans,
      'Loans Closed': grandTotals.closedLoans,
      'Principal Financed': grandTotals.principalFinanced,
      'Principal Collected': grandTotals.principalCollected,
      'Interest Earned': Math.round(grandTotals.interestEarned),
      'Penalty Earned': Math.round(grandTotals.penaltyEarned),
      'Outstanding Principal': Math.round(grandTotals.outstanding),
      'Present Due': Math.round(grandTotals.presentDue),
      'Pending Interest': Math.round(grandTotals.pendingInterest),
      'Pending Penalty': Math.round(grandTotals.pendingPenalty),
      'Recovery %': Number(overallRecoveryPct.toFixed(1)),
      'NPA Count': grandTotals.npaCount
    });

    exportToExcel(data, `Partner_Performance_${startDate}_to_${endDate}`);
    toast.success('Excel Statement Exported!');
  };

  const fetchPerformanceData = async () => {
    setLoading(true);
    try {
      const partners = await supabaseFinance.getPartners();
      
      const metrics = await FinanceCalculationEngine.computeAllPartnersMetrics(
        partners as any,
        startDate,
        endDate
      );

      const mappedRows: PartnerPerfRow[] = metrics.map(m => ({
        ...m,
        id: m.partnerId,
        name: m.partnerName,
        principalFinanced: m.lifetimePrincipalFinanced,
        principalCollected: m.lifetimePrincipalCollected,
        interestEarned: m.lifetimeInterestEarned,
        penaltyEarned: m.lifetimePenaltyEarned
      }));

      setRows(mappedRows);
    } catch (err) {
      console.error(err);
      toast.error('Failed to calculate partner metrics');
    } finally {
      setLoading(false);
    }
  };

  const grandTotals = rows.reduce(
    (acc, row) => ({
      netCapital: acc.netCapital + row.netCapital,
      loansIntroduced: acc.loansIntroduced + row.loansIntroduced,
      principalFinanced: acc.principalFinanced + row.principalFinanced,
      principalCollected: acc.principalCollected + row.principalCollected,
      interestEarned: acc.interestEarned + row.interestEarned,
      penaltyEarned: acc.penaltyEarned + row.penaltyEarned,
      outstanding: acc.outstanding + row.outstanding,
      presentDue: acc.presentDue + row.presentDue,
      pendingInterest: acc.pendingInterest + row.pendingInterest,
      pendingPenalty: acc.pendingPenalty + row.pendingPenalty,
      npaCount: acc.npaCount + row.npaCount,
      activeLoans: acc.activeLoans + row.activeLoans,
      closedLoans: acc.closedLoans + row.closedLoans,
    }),
    {
      netCapital: 0,
      loansIntroduced: 0,
      principalFinanced: 0,
      principalCollected: 0,
      interestEarned: 0,
      penaltyEarned: 0,
      outstanding: 0,
      presentDue: 0,
      pendingInterest: 0,
      pendingPenalty: 0,
      npaCount: 0,
      activeLoans: 0,
      closedLoans: 0,
    }
  );

  // Approved Business Formula: Recovery % = (Principal Collected / Principal Financed) * 100
  const overallRecoveryPct = grandTotals.principalFinanced > 0 ? (grandTotals.principalCollected / grandTotals.principalFinanced) * 100 : 0;

  const partnerColors = [
    { bar: 'bg-indigo-600', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-600' },
    { bar: 'bg-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-600' },
    { bar: 'bg-blue-600', badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-600' },
    { bar: 'bg-purple-600', badge: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-600' },
    { bar: 'bg-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-600' },
  ];

  const partnerSplitData = rows.map((row, idx) => {
    const pct = grandTotals.principalFinanced > 0
      ? (row.principalFinanced / grandTotals.principalFinanced) * 100
      : 0;
    return {
      ...row,
      pct,
      pctFormatted: pct.toFixed(1) + '%',
      color: partnerColors[idx % partnerColors.length]
    };
  }).sort((a, b) => b.pct - a.pct);

  return (
    <div className="space-y-4 w-full select-none px-2 sm:px-4 py-3 print:p-0 text-slate-900 font-sans">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-slate-200 p-3.5 rounded-xl shadow-sm gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 leading-none">Partner Performance</h1>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1.5">
            Portfolio &amp; Collection Performance
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            onClick={() => navigate(-1)} 
            variant="secondary" 
            size="sm" 
            icon={ArrowLeft} 
            className="h-[38px] min-w-[85px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Back
          </Button>
          <Button 
            onClick={fetchPerformanceData} 
            variant="secondary" 
            size="sm" 
            icon={RefreshCw} 
            className="h-[38px] min-w-[95px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Refresh
          </Button>
          <Button 
            onClick={() => setShowPrintPreview(true)} 
            variant="primary" 
            size="sm" 
            icon={Printer} 
            className="h-[38px] min-w-[85px] justify-center bg-slate-900 hover:bg-slate-800 text-white rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Print
          </Button>
          <Button 
            onClick={handleExportExcel} 
            variant="secondary" 
            size="sm" 
            icon={Download} 
            className="h-[38px] min-w-[85px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm"
          >
            Excel
          </Button>
        </div>
      </div>

      {/* Date Filters + Partner Performance Split KPI Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
        
        {/* Date Filter Box (Left - 4 Columns) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 flex flex-col justify-between gap-2.5">
          <div className="border-b border-slate-100 pb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-black text-slate-500 uppercase tracking-wider block">DATE FILTER RANGE</span>
            <span className="text-[11px] font-bold text-slate-500 font-mono whitespace-nowrap">
              {isoToDisplayFormatted(startDate) || 'Beginning'} → {isoToDisplayFormatted(endDate) || 'Today'}
            </span>
          </div>

          <div className="grid grid-cols-1 min-[1600px]:grid-cols-2 gap-3 w-full">
            <div>
              <FinanceSmartCalendar
                label="FROM DATE"
                value={startDate}
                onChange={setStartDate}
                module="PARTNER_PERFORMANCE"
                compact={true}
              />
            </div>
            <div>
              <FinanceSmartCalendar
                label="TO DATE"
                value={endDate}
                onChange={setEndDate}
                module="PARTNER_PERFORMANCE"
                compact={true}
              />
            </div>
          </div>
        </div>

        {/* Partner Performance Split Summary Card (Right - 8 Columns) */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">Partner Performance Split</h3>
            </div>
            <span className="text-xs font-mono font-black text-blue-900 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">
              Total Financed: {grandTotals.principalFinanced.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-x-5 gap-y-2.5 pt-2.5">
            {partnerSplitData.map((p) => (
              <div key={p.id} className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.color.dot}`}></span>
                    <span className="font-bold text-slate-900 uppercase text-[12px] min-[1600px]:text-[13px] leading-tight">{p.name}</span>
                    <span className="text-[10px] text-slate-400 font-semibold">({p.role})</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 font-sans tabular-nums">
                    <span className="text-[12px] min-[1600px]:text-[14px] text-slate-700 font-bold whitespace-nowrap">{p.principalFinanced.toLocaleString('en-IN')}</span>
                    <span className={`text-[11px] min-[1600px]:text-[12px] font-black px-1.5 py-0.2 rounded border whitespace-nowrap ${p.color.badge}`}>
                      {p.pctFormatted}
                    </span>
                  </div>
                </div>
                {/* Horizontal Progress Bar */}
                <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${p.color.bar}`} 
                    style={{ width: `${Math.max(1, p.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12 bg-white rounded-xl border border-slate-200">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-slate-900"></div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xs font-black uppercase text-slate-800 tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-700"></span>
              Partner Portfolio Registry ({rows.length} Partners)
            </h2>
            <span className="text-[11px] font-bold text-slate-500 uppercase hidden sm:inline">
              Click any row to view Partner Business Details
            </span>
          </div>

          <div className="w-full">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100/90 text-slate-700 uppercase tracking-wider text-[11px] min-[1600px]:text-[12px] font-bold border-b border-slate-200 sticky top-0 z-10 leading-tight">
                <tr>
                  <th className="px-1.5 py-2.5 text-left align-bottom">Partner Name</th>
                  <th className="px-1.5 py-2.5 text-right text-slate-700 align-bottom">Capital</th>
                  <th className="px-1.5 py-2.5 text-center text-slate-600 align-bottom">Introduced</th>
                  <th className="px-1.5 py-2.5 text-right text-blue-900 align-bottom">Financed</th>
                  <th className="px-1.5 py-2.5 text-right text-emerald-800 align-bottom">Collected</th>
                  <th className="px-1.5 py-2.5 text-right text-emerald-800 align-bottom">Int Earned</th>
                  <th className="px-1.5 py-2.5 text-right text-emerald-800 align-bottom">Pen Earned</th>
                  <th className="px-1.5 py-2.5 text-right text-rose-800 align-bottom">Outstanding</th>
                  <th className="px-1.5 py-2.5 text-right text-rose-800 align-bottom">Present Due</th>
                  <th className="px-1.5 py-2.5 text-center text-emerald-900 bg-emerald-50/80 align-bottom">Recovery %</th>
                  <th className="px-1.5 py-2.5 text-center text-rose-800 align-bottom">NPA</th>
                  <th className="px-1.5 py-2.5 text-center text-slate-700 align-bottom">Act / Cls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 bg-white font-sans tabular-nums text-[12px] min-[1500px]:text-[13px] min-[1600px]:text-[14px]">
                {rows.map((row) => (
                  <tr 
                    key={row.id} 
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    onClick={() => navigate('/finance/business-report', { state: { targetPartnerId: row.id } })}
                  >
                    <td className="px-1.5 py-2.5 text-slate-900 font-sans font-bold uppercase leading-tight">
                      {row.name} <span className="inline-block text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1 py-0.5 rounded font-bold uppercase whitespace-nowrap">{row.role}</span>
                    </td>
                    <td className={`px-1.5 py-2.5 text-right font-bold whitespace-nowrap ${row.netCapital >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{row.netCapital.toLocaleString('en-IN')}
                    </td>
                    <td className="px-1.5 py-2.5 text-center font-bold text-slate-700 whitespace-nowrap">{row.loansIntroduced}</td>
                    <td className="px-1.5 py-2.5 text-right text-blue-700 font-black whitespace-nowrap">{row.principalFinanced.toLocaleString('en-IN')}</td>
                    <td className="px-1.5 py-2.5 text-right text-emerald-700 font-black whitespace-nowrap">{row.principalCollected.toLocaleString('en-IN')}</td>
                    <td className="px-1.5 py-2.5 text-right text-emerald-700 font-bold whitespace-nowrap">{Math.round(row.interestEarned).toLocaleString('en-IN')}</td>
                    <td className="px-1.5 py-2.5 text-right text-emerald-700 font-bold whitespace-nowrap">{Math.round(row.penaltyEarned).toLocaleString('en-IN')}</td>
                    <td className="px-1.5 py-2.5 text-right text-rose-700 font-black whitespace-nowrap">{Math.round(row.outstanding).toLocaleString('en-IN')}</td>
                    <td className="px-1.5 py-2.5 text-right text-rose-700 font-black whitespace-nowrap">{Math.round(row.presentDue).toLocaleString('en-IN')}</td>
                    <td className="px-1.5 py-2.5 text-center text-emerald-900 font-black bg-emerald-50/80 whitespace-nowrap">
                      {row.recoveryPct.toFixed(1)}%
                    </td>
                    <td className="px-1.5 py-2.5 text-center text-rose-800 font-black whitespace-nowrap">
                      {row.npaCount}
                    </td>
                    <td className="px-1.5 py-2.5 text-center text-slate-700 font-sans font-bold whitespace-nowrap">{row.activeLoans} / {row.closedLoans}</td>
                  </tr>
                ))}

                {/* Grand Total Reconciliation Row */}
                <tr className="bg-slate-100 font-sans tabular-nums font-black border-t-2 border-slate-300 text-slate-900 text-[12px] min-[1500px]:text-[13px] min-[1600px]:text-[14px]">
                  <td className="px-1.5 py-3 font-sans font-black uppercase text-left">GRAND TOTAL:</td>
                  <td className="px-1.5 py-3 text-right font-bold text-emerald-800 whitespace-nowrap">{grandTotals.netCapital.toLocaleString('en-IN')}
                  </td>
                  <td className="px-1.5 py-3 text-center font-bold">{grandTotals.loansIntroduced}</td>
                  <td className="px-1.5 py-3 text-right font-black text-blue-900 whitespace-nowrap">{grandTotals.principalFinanced.toLocaleString('en-IN')}
                  </td>
                  <td className="px-1.5 py-3 text-right font-black text-emerald-800 whitespace-nowrap">{grandTotals.principalCollected.toLocaleString('en-IN')}
                  </td>
                  <td className="px-1.5 py-3 text-right font-bold text-emerald-800 whitespace-nowrap">{Math.round(grandTotals.interestEarned).toLocaleString('en-IN')}
                  </td>
                  <td className="px-1.5 py-3 text-right font-bold text-emerald-800 whitespace-nowrap">{Math.round(grandTotals.penaltyEarned).toLocaleString('en-IN')}
                  </td>
                  <td className="px-1.5 py-3 text-right font-black text-rose-800 whitespace-nowrap">{Math.round(grandTotals.outstanding).toLocaleString('en-IN')}
                  </td>
                  <td className="px-1.5 py-3 text-right font-black text-rose-800 whitespace-nowrap">{Math.round(grandTotals.presentDue).toLocaleString('en-IN')}
                  </td>
                  <td className="px-1.5 py-3 text-center font-black bg-emerald-100 text-emerald-950 whitespace-nowrap">
                    {overallRecoveryPct.toFixed(1)}%
                  </td>
                  <td className="px-1.5 py-3 text-center font-black text-rose-900 whitespace-nowrap">
                    {grandTotals.npaCount}
                  </td>
                  <td className="px-1.5 py-3 text-center font-sans font-bold whitespace-nowrap">
                    {grandTotals.activeLoans} / {grandTotals.closedLoans}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PRINT PREVIEW */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="Partner Performance Report"
        documentTitle="PARTNER PERFORMANCE REPORT"
      >
        {!loading && (
          <div className="space-y-6 mt-6 text-[10px]">
            <div className="flex justify-between items-end border-b-2 border-slate-900 pb-2 mb-4">
              <div>
                <p className="text-[12px] uppercase text-slate-700 font-bold">Partner Business & Recovery Report</p>
              </div>
              <div className="text-right text-[11px] text-slate-800 font-semibold">
                <p>Period: {startDate ? startDate.split('-').reverse().join('/') : 'Beginning'} to {endDate.split('-').reverse().join('/')}</p>
              </div>
            </div>

            <table className="w-full border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[9px]">
                  <th className="p-2 text-left border-r border-slate-300">Partner Name</th>
                  <th className="p-2 text-right border-r border-slate-300">Capital</th>
                  <th className="p-2 text-center border-r border-slate-300">Intr.</th>
                  <th className="p-2 text-right border-r border-slate-300">Financed</th>
                  <th className="p-2 text-right border-r border-slate-300">Collected</th>
                  <th className="p-2 text-right border-r border-slate-300">Int Earned</th>
                  <th className="p-2 text-right border-r border-slate-300">Pen Earned</th>
                  <th className="p-2 text-right border-r border-slate-300">Outstanding</th>
                  <th className="p-2 text-right border-r border-slate-300">Present Due</th>
                  <th className="p-2 text-center border-r border-slate-300 bg-emerald-50">Rec. %</th>
                  <th className="p-2 text-center border-r border-slate-300 text-red-700">NPA</th>
                  <th className="p-2 text-center border-r border-slate-300">Act.</th>
                  <th className="p-2 text-center">Cls.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-200">
                    <td className="p-2 uppercase font-bold border-r border-slate-300">{row.name}</td>
                    <td className="p-2 text-right border-r border-slate-300">{row.netCapital.toLocaleString('en-IN')}</td>
                    <td className="p-2 text-center border-r border-slate-300">{row.loansIntroduced}</td>
                    <td className="p-2 text-right border-r border-slate-300 font-bold text-blue-700">{row.principalFinanced.toLocaleString('en-IN')}</td>
                    <td className="p-2 text-right border-r border-slate-300">{row.principalCollected.toLocaleString('en-IN')}</td>
                    <td className="p-2 text-right border-r border-slate-300">{Math.round(row.interestEarned).toLocaleString('en-IN')}</td>
                    <td className="p-2 text-right border-r border-slate-300">{Math.round(row.penaltyEarned).toLocaleString('en-IN')}</td>
                    <td className="p-2 text-right border-r border-slate-300 text-rose-700 font-bold">{Math.round(row.outstanding).toLocaleString('en-IN')}</td>
                    <td className="p-2 text-right border-r border-slate-300 text-rose-700 font-bold">{Math.round(row.presentDue).toLocaleString('en-IN')}</td>
                    <td className="p-2 text-center border-r border-slate-300 font-black bg-emerald-50">{row.recoveryPct.toFixed(1)}%</td>
                    <td className="p-2 text-center border-r border-slate-300 font-black text-red-600">{row.npaCount}</td>
                    <td className="p-2 text-center border-r border-slate-300">{row.activeLoans}</td>
                    <td className="p-2 text-center">{row.closedLoans}</td>
                  </tr>
                ))}
                
                {/* Grand Total Row in Print */}
                <tr className="border-t-2 border-slate-900 bg-slate-100 font-black">
                  <td className="p-2 uppercase border-r border-slate-300">GRAND TOTAL</td>
                  <td className="p-2 text-right border-r border-slate-300">{grandTotals.netCapital.toLocaleString('en-IN')}</td>
                  <td className="p-2 text-center border-r border-slate-300">{grandTotals.loansIntroduced}</td>
                  <td className="p-2 text-right border-r border-slate-300 text-blue-900">{grandTotals.principalFinanced.toLocaleString('en-IN')}</td>
                  <td className="p-2 text-right border-r border-slate-300 text-green-800">{grandTotals.principalCollected.toLocaleString('en-IN')}</td>
                  <td className="p-2 text-right border-r border-slate-300">{Math.round(grandTotals.interestEarned).toLocaleString('en-IN')}</td>
                  <td className="p-2 text-right border-r border-slate-300">{Math.round(grandTotals.penaltyEarned).toLocaleString('en-IN')}</td>
                  <td className="p-2 text-right border-r border-slate-300 text-rose-700">{Math.round(grandTotals.outstanding).toLocaleString('en-IN')}</td>
                  <td className="p-2 text-right border-r border-slate-300 text-rose-700">{Math.round(grandTotals.presentDue).toLocaleString('en-IN')}</td>
                  <td className="p-2 text-center border-r border-slate-300 bg-emerald-100 text-emerald-950">{overallRecoveryPct.toFixed(1)}%</td>
                  <td className="p-2 text-center border-r border-slate-300 text-red-600">{grandTotals.npaCount}</td>
                  <td className="p-2 text-center border-r border-slate-300">{grandTotals.activeLoans}</td>
                  <td className="p-2 text-center">{grandTotals.closedLoans}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </FinancePrintPreview>
    </div>
  );
};

export default PartnerPerformance;
