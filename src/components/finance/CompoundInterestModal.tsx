import React, { useState } from 'react';
import { X, Printer, Calculator } from 'lucide-react';
import FinancePrintPreview from './FinancePrintPreview';

interface CompoundInterestModalProps {
  isOpen: boolean;
  onClose: () => void;
  cdNumber: string;
  customerName: string;
  interestRate: number;
  penaltyPercent: number;
  loanDate: string;
  reportRows: any[];
  summary: any;
}

const formatDateDisplay = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
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
  } catch (e) {
    // fallback
  }
  return dateStr || '-';
};

const CompoundInterestModal: React.FC<CompoundInterestModalProps> = ({
  isOpen,
  onClose,
  cdNumber,
  customerName,
  interestRate,
  penaltyPercent,
  loanDate,
  reportRows,
  summary
}) => {
  const [isPrinting, setIsPrinting] = useState(false);

  if (!isOpen || !summary) return null;

  const printableContent = (
    <div className="p-8 bg-white text-slate-900 font-sans">
      <div className="text-center border-b-2 border-slate-800 pb-4 mb-6">
        <h2 className="text-2xl font-black uppercase tracking-widest">Compound Interest Calculation Report</h2>
      </div>

      <div className="mb-8">
        <div className="grid grid-cols-6 gap-4 bg-slate-50 p-4 rounded-t-lg border border-b-0 border-slate-200">
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase">Borrower</p>
            <p className="text-sm font-bold truncate" title={customerName}>{customerName || '-'}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase">CD Number</p>
            <p className="text-sm font-mono font-bold">{cdNumber || '-'}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase">Rate</p>
            <p className="text-sm font-mono font-bold">{Number(interestRate || 0).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase">Penalty</p>
            <p className="text-sm font-mono font-bold">{Number(penaltyPercent || 0).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase">Loan Date</p>
            <p className="text-sm font-mono font-bold">{formatDateDisplay(loanDate)}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase">Calculated Until</p>
            <p className="text-sm font-mono font-bold">
              {formatDateDisplay(summary.calculatedUntilDate || summary.calculatedUntil)}
            </p>
          </div>
        </div>
        {/* Loan amount + compound interest - payments = final balance after compounding */}
        <div className="grid grid-cols-4 gap-4 bg-slate-100 p-4 rounded-b-lg border border-slate-200 text-center items-center">
          <div>
            <p className="text-[11px] font-black text-slate-500 uppercase">Loan Amount</p>
            <p className="text-lg font-mono font-bold text-slate-700">₹{(summary.initialPrincipal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-[11px] font-black text-slate-500 uppercase">+ Compound Interest</p>
            <p className="text-lg font-mono font-bold text-red-600">₹{(summary.compoundInterestEarned || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-[11px] font-black text-slate-500 uppercase">− Payments Received</p>
            <p className="text-lg font-mono font-bold text-emerald-700">₹{(summary.totalPaymentsReceived || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-[11px] font-black text-slate-500 uppercase">= Final Balance after Compound Interest</p>
            <p className="text-xl font-mono font-black text-slate-900">₹{(summary.finalCompoundBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>

        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs font-semibold flex items-center justify-between">
          <span>ℹ️ {summary.tooltipText || "Estimated compounded value based on pure 30-day time cycles, payments and principal reductions. Informational only."}</span>
          {summary.isClosed && (
            <span className="ml-2 px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-black uppercase rounded tracking-wider">Loan Closed (Simulation Frozen)</span>
          )}
        </div>
      </div>

      <table className="w-full border-collapse border border-slate-300 text-sm">
        <thead>
          <tr className="bg-slate-100 uppercase text-xs font-black tracking-wider text-slate-700">
            <th className="border border-slate-300 p-2 text-center">Date</th>
            <th className="border border-slate-300 p-2 text-left">Period</th>
            <th className="border border-slate-300 p-2 text-center">Days</th>
            <th className="border border-slate-300 p-2 text-right">Start Balance</th>
            <th className="border border-slate-300 p-2 text-right">Interest</th>
            <th className="border border-slate-300 p-2 text-right">Payment</th>
            <th className="border border-slate-300 p-2 text-right">End / Future Value</th>
          </tr>
        </thead>
        <tbody>
          {reportRows.map((row, idx) => {
            const daysVal = row.days ?? row.daysElapsed ?? 0;
            const startVal = row.startBalance ?? row.startingBalance ?? 0;
            const intVal = row.interest ?? row.interestAdded ?? 0;
            const payVal = row.payment ?? row.paymentReceived ?? 0;
            const endVal = row.endBalance ?? row.endingBalance ?? row.futureValue ?? 0;

            return (
              <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="border border-slate-300 p-2 text-center font-mono font-bold text-slate-900 whitespace-nowrap">
                  {formatDateDisplay(row.date)}
                </td>
                <td className="border border-slate-300 p-2 text-left font-semibold text-slate-800">
                  {row.period || row.particulars}
                </td>
                <td className="border border-slate-300 p-2 text-center font-mono text-slate-600 font-bold">
                  {daysVal}
                </td>
                <td className="border border-slate-300 p-2 text-right font-mono text-slate-700">
                  ₹{Number(startVal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="border border-slate-300 p-2 text-right font-mono text-red-600 font-bold">
                  {intVal > 0 ? `+₹${Number(intVal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                </td>
                <td className="border border-slate-300 p-2 text-right font-mono text-emerald-700 font-bold">
                  {payVal > 0 ? `-₹${Number(payVal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                </td>
                <td className="border border-slate-300 p-2 text-right font-mono font-black text-slate-950">
                  ₹{Number(endVal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
          
          <div className="flex items-center justify-between p-4 md:p-5 border-b border-slate-100 bg-slate-50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-wide">Compound Interest Calculation Report</h3>
                <p className="text-[11px] font-bold text-slate-500 uppercase mt-0.5 tracking-wider">A/C: {cdNumber} | {customerName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPrinting(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs uppercase rounded-lg transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-rose-500 p-2 bg-white hover:bg-rose-50 rounded-lg transition-colors border border-slate-200 hover:border-rose-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-0">
            {printableContent}
          </div>
          
        </div>
      </div>

      <FinancePrintPreview
        isOpen={isPrinting}
        onClose={() => setIsPrinting(false)}
        title="Compound Interest Calculation Report"
        documentTitle={`Compound_Interest_${cdNumber}`}
      >
        {printableContent}
      </FinancePrintPreview>
    </>
  );
};

export default CompoundInterestModal;
