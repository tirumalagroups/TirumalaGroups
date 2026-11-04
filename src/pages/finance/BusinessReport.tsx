import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import { sortNumerically } from '../../lib/financialCalculations';
import Button from '../../components/UI/Button';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { Printer, ArrowLeft, FileText, ChevronRight, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { dailyFinancialTransactionService } from '../../services/dailyFinancialTransactionService';
import { exportToExcel } from '../../utils/excel';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { FinanceCalculationEngine } from '../../services/FinanceCalculationEngine';

interface BusinessLoanRow {
  loanId: string;
  cdNumber: string;
  borrower: string;
  principal: number;
  interestReceived: number;
  penaltyReceived: number;
  pendingInterest: number;
  pendingPenalty: number;
  presentDue: number;
  status: string;
}

const BusinessReport: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(() => getLocalBusinessDateISO());
  const [loading, setLoading] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [partners, setPartners] = useState<any[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>(() => {
    return location.state?.targetPartnerId || 'ALL';
  });

  const [loans, setLoans] = useState<BusinessLoanRow[]>([]);
  const [summary, setSummary] = useState({
    capitalInvested: 0,
    totalLoans: 0,
    activeLoans: 0,
    closedLoans: 0,
    npaClosedLoans: 0,
    writtenOffLoans: 0,
    principalOutstanding: 0,
    interestReceived: 0,
    penaltyReceived: 0,
    pendingInterest: 0,
    pendingPenalty: 0,
    totalDue: 0,
  });

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
      fetchBusinessData();
    }
  }, [startDate, endDate, selectedPartnerId]);

  const navigateToLedger = (loanId: string, cdNumber: string) => {
    const num = cdNumber.toUpperCase();
    if (num.startsWith('CD')) {
      navigate(`/finance/cd-ledger?loanId=${loanId}`);
    } else if (num.startsWith('HP')) {
      navigate(`/finance/hp-ledger?loanId=${loanId}`);
    } else if (num.startsWith('STBD')) {
      navigate(`/finance/stbd-ledger?loanId=${loanId}`);
    } else if (num.startsWith('TBD')) {
      navigate(`/finance/tbd-ledger?loanId=${loanId}`);
    } else {
      navigate(`/finance/cd-ledger?loanId=${loanId}`);
    }
  };

  const handleExportExcel = () => {
    const data = [
      {
        'Capital Invested': summary.capitalInvested,
        'Total Loans': summary.totalLoans,
        'Active Loans': summary.activeLoans,
        'Closed Loans': summary.closedLoans,
        'NPA Closed Loans': summary.npaClosedLoans,
        'Written Off Loans': summary.writtenOffLoans,
        'Principal Outstanding': summary.principalOutstanding,
        'Interest Received': summary.interestReceived,
        'Penalty Received': summary.penaltyReceived,
        'Pending Interest': summary.pendingInterest,
        'Pending Penalty': summary.pendingPenalty,
        'Total Due': summary.totalDue
      },
      ...loans.map(row => ({
        'CD Number': row.cdNumber,
        'Borrower': row.borrower,
        'Principal': row.principal,
        'Interest Received': row.interestReceived,
        'Penalty Received': row.penaltyReceived,
        'Pending Interest': row.pendingInterest,
        'Pending Penalty': row.pendingPenalty,
        'Present Due': row.presentDue,
        'Status': row.status
      }))
    ];
    exportToExcel(data, `Business_Details_${startDate}_to_${endDate}`);
    toast.success('Excel Statement Exported!');
  };

  const fetchBusinessData = async () => {
    setLoading(true);
    try {
      const fetchedPartners = await supabaseFinance.getPartners();
      setPartners(fetchedPartners);

      const targetPartner =
        selectedPartnerId === 'ALL'
          ? null
          : fetchedPartners.find(p => p.id === selectedPartnerId);

      const { dues } = await supabaseFinance.getDuesLedgerSummary(endDate);
      const allLoans = await supabaseFinance.getLoans();

      const filteredLoans = allLoans.filter(l => {
        if (l.date < startDate || l.date > endDate) return false;
        if (targetPartner && l.customer?.partner_name !== targetPartner.name)
          return false;
        return true;
      });

      const processedLoans: BusinessLoanRow[] = [];
      let cap = 0, tot = 0, pOut = 0, iRec = 0, pRec = 0, pInt = 0, pPen = 0, tDue = 0;
      let act = 0, clo = 0, npaClo = 0, wOff = 0;

      filteredLoans.forEach(l => {
        tot++;
        
        const rawStatus = String(l.status || '').trim().toUpperCase();
        const isNpaClosed = rawStatus === 'NPA_CLOSED' || rawStatus === 'NPA CLOSED' || rawStatus === 'NPA' || l.npa_closed === true || (l as any).is_npa === true || (l as any).is_npa_closed === true;

        let displayStatus = 'Active';
        if (isNpaClosed) {
          npaClo++;
          displayStatus = 'NPA Closed';
        } else if (rawStatus === 'CLOSED') {
          clo++;
          displayStatus = 'Closed';
        } else if (rawStatus === 'WRITTEN_OFF' || rawStatus === 'WRITTEN OFF') {
          wOff++;
          displayStatus = 'Written Off';
        } else {
          act++;
          displayStatus = 'Active';
        }

        const metrics = FinanceCalculationEngine.computeLoanMetrics(l, dues);

        cap += metrics.principalFinanced;
        iRec += metrics.interestEarned;
        pRec += metrics.penaltyEarned;
        pOut += metrics.outstanding;
        pInt += metrics.pendingInterest;
        pPen += metrics.pendingPenalty;
        tDue += metrics.presentDue;

        processedLoans.push({
          loanId: l.id,
          cdNumber: l.loan_id,
          borrower: l.customer?.name || 'Unknown',
          principal: metrics.outstanding,
          interestReceived: metrics.interestEarned,
          penaltyReceived: metrics.penaltyEarned,
          pendingInterest: metrics.pendingInterest,
          pendingPenalty: metrics.pendingPenalty,
          presentDue: metrics.presentDue,
          status: displayStatus,
        });
      });

      setLoans(processedLoans);
      setSummary({
        capitalInvested: cap,
        totalLoans: tot,
        activeLoans: act,
        closedLoans: clo,
        npaClosedLoans: npaClo,
        writtenOffLoans: wOff,
        principalOutstanding: pOut,
        interestReceived: iRec,
        penaltyReceived: pRec,
        pendingInterest: pInt,
        pendingPenalty: pPen,
        totalDue: tDue,
      });
   } catch (err) {
      console.error(err);
      toast.error('Failed to load business details');
   } finally {
      setLoading(false);
   }
  };

  const selectedPartnerName =
    selectedPartnerId === 'ALL'
      ? 'All Partners'
      : partners.find(p => p.id === selectedPartnerId)?.name || 'Unknown';

  return (
    <div className='space-y-6 max-w-[1400px] mx-auto p-6 print:p-0'>
      <div
        className={`flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm`}
      >
        <div>
          <h1 className='finance-h1'>Business Report</h1>
        </div>
        <div className='flex gap-2'>
          <Button
            onClick={() => navigate(-1)}
            variant='secondary'
            size='sm'
            icon={ArrowLeft}
            className='bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 finance-header-time uppercase'
          >
            Back
          </Button>
          <Button
            onClick={() => setShowPrintPreview(true)}
            variant='primary'
            size='sm'
            icon={Printer}
            className='bg-[#0b1329] hover:bg-slate-800 text-white finance-header-time uppercase'
          >
            Print
          </Button>
          <Button
            onClick={handleExportExcel}
            variant='secondary'
            size='sm'
            icon={Download}
            className='bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 finance-header-time uppercase'
          >
            Excel
          </Button>
        </div>
      </div>

      <div
        className={`grid grid-cols-2 md:grid-cols-4 gap-4`}
      >
        <div className='flex flex-col justify-end w-full'>
          <FinanceSmartCalendar
            label="From Date"
            value={startDate}
            onChange={setStartDate}
            module="BUSINESS_DETAILS"
            compact={true}
          />
        </div>
        <div className='flex flex-col justify-end w-full'>
          <FinanceSmartCalendar
            label="To Date"
            value={endDate}
            onChange={setEndDate}
            module="BUSINESS_DETAILS"
            compact={true}
          />
        </div>
        <div className='bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex flex-col justify-center'>
          <label className='text-slate-400 mb-1 finance-small-label uppercase'>
            Partner Filter
          </label>
          <select
            value={selectedPartnerId}
            onChange={e => setSelectedPartnerId(e.target.value)}
            className='w-full bg-transparent border-none p-0 text-[#0b1329] font-black focus:ring-0 finance-h1 uppercase'
          >
            <option value='ALL'>All Partners</option>
            {partners.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className='bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex flex-col justify-center bg-slate-50'>
          <label className='text-slate-400 mb-1 finance-small-label uppercase'>
            Selected Partner
          </label>
          <span className='text-[#0b1329] finance-h1 leading-tight break-words'>
            {selectedPartnerName}
          </span>
        </div>
      </div>

      {loading ? (
        <div className='flex justify-center py-20'>
          <div className='animate-spin rounded-full h-10 w-10 border-t-2 border-green-500'></div>
        </div>
      ) : (
        <>
          {/* Partner Summary Section */}
          <div
            className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden  mb-6`}
          >
            <div className='p-4 bg-slate-50 border-b border-slate-100'>
              <h2 className='text-slate-900 font-bold uppercase text-xs flex items-center gap-2'>
                <FileText className='w-4 h-4 text-slate-500' />
                Partner Summary
              </h2>
            </div>

            <div className='grid grid-cols-2 md:grid-cols-6 gap-3 p-4 bg-slate-50/50'>
              <div className='bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center'>
                <span className='text-slate-500 finance-small-label uppercase font-bold text-[10px]'>
                  Capital Invested
                </span>
                <span className='text-base font-black text-slate-900'>
                  {summary.capitalInvested.toLocaleString('en-IN')}
                </span>
              </div>
              <div className='bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center'>
                <span className='text-blue-700 finance-small-label uppercase font-bold text-[10px]'>
                  Total Loans
                </span>
                <span className='text-base font-black text-blue-800'>
                  {summary.totalLoans}
                </span>
              </div>
              <div className='bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-100 shadow-sm flex flex-col justify-center'>
                <span className='text-emerald-700 finance-small-label uppercase font-bold text-[10px]'>
                  Active Loans
                </span>
                <span className='text-base font-black text-emerald-800'>
                  {summary.activeLoans}
                </span>
              </div>
              <div className='bg-slate-50 p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center'>
                <span className='text-slate-500 finance-small-label uppercase font-bold text-[10px]'>
                  Closed Loans
                </span>
                <span className='text-base font-black text-slate-800'>
                  {summary.closedLoans}
                </span>
              </div>
              <div className='bg-amber-50/80 p-3.5 rounded-xl border border-amber-200 shadow-sm flex flex-col justify-center'>
                <span className='text-amber-800 finance-small-label uppercase font-bold text-[10px]'>
                  NPA Closed
                </span>
                <span className='text-base font-black text-amber-900'>
                  {summary.npaClosedLoans}
                </span>
              </div>
              <div className='bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center'>
                <span className='text-slate-500 finance-small-label uppercase font-bold text-[10px]'>
                  Principal Out
                </span>
                <span className='text-base font-black text-slate-900'>
                  {Math.round(summary.principalOutstanding).toLocaleString('en-IN')}
                </span>
              </div>
              <div className='bg-emerald-50 p-4 rounded-xl border border-emerald-100 shadow-sm flex flex-col justify-center'>
                <span className='text-emerald-700 finance-small-label uppercase font-bold'>
                  Interest Received
                </span>
                <span className='text-lg font-black text-emerald-800'>
                  
                  {Math.round(summary.interestReceived).toLocaleString('en-IN')}
                </span>
              </div>
              <div className='bg-emerald-50 p-4 rounded-xl border border-emerald-100 shadow-sm flex flex-col justify-center'>
                <span className='text-emerald-700 finance-small-label uppercase font-bold'>
                  Penalty Received
                </span>
                <span className='text-lg font-black text-emerald-800'>
                  {Math.round(summary.penaltyReceived).toLocaleString('en-IN')}
                </span>
              </div>
              <div className='bg-rose-50 p-4 rounded-xl border border-rose-100 shadow-sm flex flex-col justify-center'>
                <span className='text-rose-700 finance-small-label uppercase font-bold'>
                  Pending Interest
                </span>
                <span className='text-lg font-black text-rose-800'>
                  {Math.round(summary.pendingInterest).toLocaleString('en-IN')}
                </span>
              </div>
              <div className='bg-rose-50 p-4 rounded-xl border border-rose-100 shadow-sm flex flex-col justify-center'>
                <span className='text-rose-700 finance-small-label uppercase font-bold'>
                  Pending Penalty
                </span>
                <span className='text-lg font-black text-rose-800'>
                  {Math.round(summary.pendingPenalty).toLocaleString('en-IN')}
                </span>
              </div>
              <div className='bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-center'>
                <span className='text-slate-400 finance-small-label uppercase font-bold'>
                  Total Due
                </span>
                <span className='text-lg font-black text-rose-700'>
                  {Math.round(summary.totalDue).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>

          {/* Loan Details Section */}
          <div
            className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`}
          >
            <div className='p-4 bg-slate-50 border-b border-slate-100'>
              <h2 className='text-slate-900 font-bold uppercase text-xs flex items-center gap-2'>
                <FileText className='w-4 h-4 text-slate-500' />
                Loan Details ({loans.length})
              </h2>
            </div>
            <div className='w-full'>
              <table className='w-full text-left border-collapse finance-caption tabular-nums'>
                <thead>
                  <tr className='bg-white border-b border-slate-200 text-slate-500 text-[11px] min-[1600px]:text-[12px] leading-tight'>
                    <th className='px-2 py-2 uppercase font-bold'>CD No</th>
                    <th className='px-2 py-2 uppercase font-bold'>Borrower</th>
                    <th className='px-2 py-2 uppercase font-bold text-right'>
                      Principal
                    </th>
                    <th className='px-2 py-2 uppercase font-bold text-right text-emerald-600'>
                      Int Recv
                    </th>
                    <th className='px-2 py-2 uppercase font-bold text-right text-emerald-600'>
                      Pen Recv
                    </th>
                    <th className='px-2 py-2 uppercase font-bold text-right text-rose-500'>
                      Pend Int
                    </th>
                    <th className='px-2 py-2 uppercase font-bold text-right text-rose-500'>
                      Pend Pen
                    </th>
                    <th className='px-2 py-2 uppercase font-bold text-right text-rose-700'>
                      Present Due
                    </th>
                    <th className='px-2 py-2 uppercase font-bold text-center'>
                      Status
                    </th>
                    <th className='px-2 py-2 w-10'></th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-slate-100'>
                  {loans.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className='px-4 py-8 text-center text-slate-400 font-bold uppercase'
                      >
                        No transactions found.
                      </td>
                    </tr>
                  ) : (
                    loans
                      .sort((a, b) => sortNumerically(a.cdNumber, b.cdNumber))
                      .map(row => (
                        <tr
                          key={row.loanId}
                          className='hover:bg-slate-50/50 transition-colors cursor-pointer'
                          onClick={() => navigateToLedger(row.loanId, row.cdNumber)}
                        >
                          <td className='px-2 py-2.5 font-mono text-slate-900 font-black whitespace-nowrap'>
                            {row.cdNumber}
                          </td>
                          <td className='px-2 py-2.5 text-slate-900 font-bold uppercase leading-snug'>
                            {row.borrower}
                          </td>
                          <td className='px-2 py-2.5 text-right whitespace-nowrap text-slate-900 font-medium'>
                            {row.principal.toLocaleString('en-IN')}
                          </td>
                          <td className='px-2 py-2.5 text-right whitespace-nowrap text-emerald-650 font-bold'>
                            
                            {Math.round(row.interestReceived).toLocaleString(
                              'en-IN'
                            )}
                          </td>
                          <td className='px-2 py-2.5 text-right whitespace-nowrap text-emerald-600'>
                            
                            {Math.round(row.penaltyReceived).toLocaleString(
                              'en-IN'
                            )}
                          </td>
                          <td className='px-2 py-2.5 text-right whitespace-nowrap text-rose-500'>
                            
                            {Math.round(row.pendingInterest).toLocaleString(
                              'en-IN'
                            )}
                          </td>
                          <td className='px-2 py-2.5 text-right whitespace-nowrap text-rose-500'>
                            
                            {Math.round(row.pendingPenalty).toLocaleString(
                              'en-IN'
                            )}
                          </td>
                          <td className='px-2 py-2.5 text-right whitespace-nowrap text-rose-700 font-black'>
                            
                            {Math.round(row.presentDue).toLocaleString('en-IN')}
                          </td>
                          <td className='px-2 py-2.5 text-center'>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                                row.status === 'Active'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                                  : row.status === 'NPA Closed'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-300'
                                  : row.status === 'Closed'
                                  ? 'bg-slate-100 text-slate-700 border border-slate-300'
                                  : 'bg-rose-50 text-rose-800 border border-rose-300'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className='px-2 py-2.5 text-slate-400 text-center'>
                            <ChevronRight className='w-4 h-4' />
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Print Preview Modal */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title='Business Details Report'
        documentTitle={`BUSINESS DETAILS REPORT`}
      >
        <div className='space-y-6 pb-12'>
          <div className='flex justify-between items-end border-b border-slate-950 pb-2'>
            <div>
              <h2 className='text-xl font-bold uppercase text-slate-900'>
                Thirumala Group Finance
              </h2>
              <p className='text-[13px] uppercase text-slate-500'>
                Business Details & Portfolio Overview
              </p>
            </div>
            <div className='text-right text-[12px] text-slate-600'>
              <p>
                Period: {startDate.split('-').reverse().join('/')} to{''}
                {endDate.split('-').reverse().join('/')}
              </p>
              <p>Partner: {selectedPartnerName}</p>
            </div>
          </div>

          {/* Partner Summary - 11 Items Reconciled */}
          <div className='grid grid-cols-6 gap-2 mb-4'>
            <div className='border p-2 rounded'>
              <span className='font-bold uppercase text-[9px] block text-slate-500'>
                Capital Invested
              </span>
              <p className='font-black text-sm'>
                {summary.capitalInvested.toLocaleString('en-IN')}
              </p>
            </div>
            <div className='border p-2 rounded'>
              <span className='font-bold uppercase text-[9px] block text-slate-500'>
                Total Loans
              </span>
              <p className='font-black text-sm text-blue-800'>
                {summary.totalLoans}
              </p>
            </div>
            <div className='border p-2 rounded bg-emerald-50/50'>
              <span className='font-bold uppercase text-[9px] block text-emerald-800'>
                Active Loans
              </span>
              <p className='font-black text-sm text-emerald-900'>
                {summary.activeLoans}
              </p>
            </div>
            <div className='border p-2 rounded'>
              <span className='font-bold uppercase text-[9px] block text-slate-500'>
                Closed Loans
              </span>
              <p className='font-black text-sm text-slate-800'>
                {summary.closedLoans}
              </p>
            </div>
            <div className='border p-2 rounded bg-amber-50/50'>
              <span className='font-bold uppercase text-[9px] block text-amber-800'>
                NPA Closed
              </span>
              <p className='font-black text-sm text-amber-900'>
                {summary.npaClosedLoans}
              </p>
            </div>
            <div className='border p-2 rounded'>
              <span className='font-bold uppercase text-[9px] block text-slate-500'>
                Principal Out
              </span>
              <p className='font-black text-sm'>
                
                {Math.round(summary.principalOutstanding).toLocaleString(
                  'en-IN'
                )}
              </p>
            </div>

            <div className='border p-2 rounded bg-emerald-50'>
              <span className='font-bold uppercase text-[9px] block text-emerald-700'>
                Int Received
              </span>
              <p className='font-black text-sm text-emerald-800'>
                {Math.round(summary.interestReceived).toLocaleString('en-IN')}
              </p>
            </div>
            <div className='border p-2 rounded bg-emerald-50'>
              <span className='font-bold uppercase text-[9px] block text-emerald-700'>
                Pen Received
              </span>
              <p className='font-black text-sm text-emerald-800'>
                {Math.round(summary.penaltyReceived).toLocaleString('en-IN')}
              </p>
            </div>
            <div className='border p-2 rounded bg-rose-50'>
              <span className='font-bold uppercase text-[9px] block text-rose-700'>
                Pend Int
              </span>
              <p className='font-black text-sm text-rose-800'>
                {Math.round(summary.pendingInterest).toLocaleString('en-IN')}
              </p>
            </div>
            <div className='border p-2 rounded bg-rose-50'>
              <span className='font-bold uppercase text-[9px] block text-rose-700'>
                Pend Pen
              </span>
              <p className='font-black text-sm text-rose-800'>
                {Math.round(summary.pendingPenalty).toLocaleString('en-IN')}
              </p>
            </div>
            <div className='border p-2 rounded'>
              <span className='font-bold uppercase text-[9px] block text-slate-500'>
                Total Due
              </span>
              <p className='font-black text-sm text-rose-700'>
                {Math.round(summary.totalDue).toLocaleString('en-IN')}
              </p>
            </div>
          </div>

          <table className='w-full text-left border-collapse border border-slate-300'>
            <thead>
              <tr className='bg-slate-100 border-b border-slate-300'>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold'>
                  CD No
                </th>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold'>
                  Borrower
                </th>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold text-right'>
                  Principal
                </th>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold text-right'>
                  Int Recv
                </th>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold text-right'>
                  Pen Recv
                </th>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold text-right'>
                  Pend Int
                </th>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold text-right'>
                  Pend Pen
                </th>
                <th className='px-2 py-1.5 border-r border-slate-300 font-bold text-right'>
                  Present Due
                </th>
                <th className='px-2 py-1.5 border-slate-300 font-bold text-center'>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {loans
                .sort((a, b) => sortNumerically(a.cdNumber, b.cdNumber))
                .map(row => (
                  <tr key={row.loanId} className='border-b border-slate-200'>
                    <td className='px-2 py-1 border-r border-slate-300 font-bold'>
                      {row.cdNumber}
                    </td>
                    <td className='px-2 py-1 border-r border-slate-300 uppercase truncate max-w-[150px]'>
                      {row.borrower}
                    </td>
                    <td className='px-2 py-1 border-r border-slate-300 text-right'>
                      {row.principal.toLocaleString('en-IN')}
                    </td>
                    <td className='px-2 py-1 border-r border-slate-300 text-right'>
                      
                      {Math.round(row.interestReceived).toLocaleString('en-IN')}
                    </td>
                    <td className='px-2 py-1 border-r border-slate-300 text-right'>
                      {Math.round(row.penaltyReceived).toLocaleString('en-IN')}
                    </td>
                    <td className='px-2 py-1 border-r border-slate-300 text-right'>
                      {Math.round(row.pendingInterest).toLocaleString('en-IN')}
                    </td>
                    <td className='px-2 py-1 border-r border-slate-300 text-right'>
                      {Math.round(row.pendingPenalty).toLocaleString('en-IN')}
                    </td>
                    <td className='px-2 py-1 border-r border-slate-300 text-right font-black'>
                      {Math.round(row.presentDue).toLocaleString('en-IN')}
                    </td>
                    <td className='px-2 py-1 text-center font-bold text-[10px] uppercase'>
                      {row.status}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </FinancePrintPreview>
    </div>
  );
};

export default BusinessReport;
