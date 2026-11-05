import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { dailyFinancialTransactionService } from '../../services/dailyFinancialTransactionService';
import { 
  FinanceCalculationEngine, 
  FinalStatementMetrics, 
  FinalStatementAccount
} from '../../services/FinanceCalculationEngine';
import {
  Printer,
  ArrowLeft,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { buildFinalStatementHtml } from '../../utils/finalStatementPrint';
import { printPreviewFrame } from '../../utils/print';
import { useNavigate } from 'react-router-dom';
import { exportToExcelMultiSheet } from '../../utils/excel';
import { displayHeadName } from '../../utils/financeLabels';

const formatDateOld = (dateStr?: string | null): string => {
  if (!dateStr) return '—';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

const FinalStatement: React.FC = () => {
  const navigate = useNavigate();
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(() => getLocalBusinessDateISO());
  
  const [loading, setLoading] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [expandedHeadNames, setExpandedHeadNames] = useState<Set<string>>(new Set());
  const printFrameRef = useRef<HTMLIFrameElement>(null);

  const [metrics, setMetrics] = useState<FinalStatementMetrics>({
    openingCash: 0,
    closingCash: 0,
    totalInflows: 0,
    totalOutflows: 0,
    totalIncome: 0,
    totalExpenses: 0,
    netProfit: 0,
    totalAssets: 0,
    totalLoanPrincipal: 0,
    totalLiabilities: 0,
    totalCapital: 0,
    totalLiabilitiesAndCapital: 0,
    netWorth: 0,
    incomeHeads: [],
    expenseHeads: [],
    accounts: []
  });

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

  const fetchStatementData = async () => {
    setLoading(true);
    try {
      const data = await FinanceCalculationEngine.getFinalStatementMetrics(startDate, endDate, financeMode);
      setMetrics(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load statement data');
    } finally {
      setLoading(false);
    }
  };

  const navigateToDetailedLedger = (head: string) => {
    navigate(`/finance/detailed-ledger?head=${encodeURIComponent(head)}&from=${startDate}&to=${endDate}`);
  };

  // Classified Balance Sheet components
  const loanPrincipalAccounts = useMemo(() => 
    metrics.accounts.filter(acc => 
      acc.category === 'ASSET' && (
        acc.accountName.toUpperCase().includes('DISBURSEMENT') ||
        acc.accountName.toUpperCase().includes('PRINCIPAL') ||
        acc.accountName.toUpperCase().includes('RECEIVABLE')
      )
    ), [metrics.accounts]);

  const bankAndOtherAssetAccounts = useMemo(() => 
    metrics.accounts.filter(acc => 
      acc.category === 'ASSET' && !loanPrincipalAccounts.some(lp => lp.accountName === acc.accountName)
    ), [metrics.accounts, loanPrincipalAccounts]);

  const capitalAccounts = useMemo(() => 
    metrics.accounts.filter(acc => acc.category === 'CAPITAL'), [metrics.accounts]);

  const liabilityAccounts = useMemo(() => 
    metrics.accounts.filter(acc => acc.category === 'LIABILITY'), [metrics.accounts]);

  const handleExportExcel = () => {
    const summaryData = [
      { 'Business Metric': 'Total Assets', 'Amount': metrics.totalAssets },
      { 'Business Metric': 'Total Liabilities', 'Amount': metrics.totalLiabilities },
      { 'Business Metric': 'Total Capital', 'Amount': metrics.totalCapital },
      { 'Business Metric': 'Net Worth', 'Amount': metrics.netWorth },
      { 'Business Metric': 'Opening Cash', 'Amount': metrics.openingCash },
      { 'Business Metric': 'Closing Cash', 'Amount': metrics.closingCash },
      { 'Business Metric': 'Total Operating Income', 'Amount': metrics.totalIncome },
      { 'Business Metric': 'Total Operating Expenses', 'Amount': metrics.totalExpenses },
      { 'Business Metric': 'Net Profit / Loss', 'Amount': metrics.netProfit }
    ];

    const plData = [
      ...metrics.incomeHeads.map(head => ({
        'Category': 'INCOME',
        'Head Name': head.name,
        'Opening Balance': head.opening,
        'Current Period': head.currentPeriod,
        'Total': head.total,
        '% Share': `${head.percentage}%`,
        'Entries': head.ledgerCount
      })),
      { 'Category': 'TOTAL INCOME', 'Head Name': '', 'Opening Balance': 0, 'Current Period': metrics.totalIncome, 'Total': metrics.totalIncome, '% Share': '100%', 'Entries': 0 },
      ...metrics.expenseHeads.map(head => ({
        'Category': 'EXPENSE',
        'Head Name': head.name,
        'Opening Balance': head.opening,
        'Current Period': head.currentPeriod,
        'Total': head.total,
        '% Share': `${head.percentage}%`,
        'Entries': head.ledgerCount
      })),
      { 'Category': 'TOTAL EXPENSES', 'Head Name': '', 'Opening Balance': 0, 'Current Period': metrics.totalExpenses, 'Total': metrics.totalExpenses, '% Share': '100%', 'Entries': 0 },
      { 'Category': 'NET PROFIT / LOSS', 'Head Name': '', 'Opening Balance': 0, 'Current Period': metrics.netProfit, 'Total': metrics.netProfit, '% Share': '—', 'Entries': 0 }
    ];

    const bsData = [
      { 'Section': 'ASSETS', 'Account Name': 'Loan Principal / Receivables', 'Amount': metrics.totalLoanPrincipal },
      { 'Section': 'ASSETS', 'Account Name': 'Cash in Hand (Closing Cash)', 'Amount': metrics.closingCash },
      ...bankAndOtherAssetAccounts.map(acc => ({
        'Section': 'ASSETS',
        'Account Name': displayHeadName(acc.accountName),
        'Amount': Math.abs(acc.closing)
      })),
      { 'Section': 'TOTAL ASSETS', 'Account Name': '', 'Amount': metrics.totalAssets },
      ...capitalAccounts.map(acc => ({
        'Section': 'LIABILITIES & CAPITAL',
        'Account Name': displayHeadName(acc.accountName),
        'Amount': acc.closing
      })),
      { 'Section': 'LIABILITIES & CAPITAL', 'Account Name': 'Retained Net Profit', 'Amount': metrics.netProfit },
      ...liabilityAccounts.map(acc => ({
        'Section': 'LIABILITIES & CAPITAL',
        'Account Name': displayHeadName(acc.accountName),
        'Amount': Math.abs(acc.closing)
      })),
      { 'Section': 'TOTAL LIABILITIES & CAPITAL', 'Account Name': '', 'Amount': metrics.totalLiabilitiesAndCapital }
    ];

    const accountData = metrics.accounts.map((acc: FinalStatementAccount) => ({
      'Account Name': displayHeadName(acc.accountName),
      'Category': acc.category,
      'Classification': acc.reportClassification,
      'Opening Balance': acc.opening,
      'Credit': acc.credit,
      'Debit': acc.debit,
      'Net Movement': acc.netMovement,
      'Closing Balance': acc.closing,
      'Entries': acc.ledgerCount
    }));

    const sheets = [
      { name: 'Financial Summary', data: summaryData },
      { name: 'Profit & Loss', data: plData },
      { name: 'Financial Position', data: bsData },
      { name: 'General Ledger Accounts', data: accountData }
    ];

    exportToExcelMultiSheet(sheets, `Final_Statement_${startDate}_to_${endDate}`);
    toast.success('Final Statement exported to Excel!');
  };

  // ─── Final Statement (two sides) ────────────────────────────────────────
  // Each account's movement in the period goes to the Credit side (more credit than debit)
  // or the Debit side. Capital accounts are shown on their own "Capital" line.
  // Credit Total + Opening Cash + Capital = Debit Total + Closing Cash.
  const statement = useMemo(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const nonCapital = metrics.accounts.filter(a => a.category !== 'CAPITAL');
    const capitalAccs = metrics.accounts.filter(a => a.category === 'CAPITAL');

    const creditRows = nonCapital.filter(a => a.netMovement > 0.004).map(a => ({ acc: a, amount: a.netMovement }));
    const debitRows = nonCapital.filter(a => a.netMovement < -0.004).map(a => ({ acc: a, amount: -a.netMovement }));

    const creditTotal = r2(creditRows.reduce((s, r) => s + r.amount, 0));
    const debitTotal = r2(debitRows.reduce((s, r) => s + r.amount, 0));
    const capital = r2(capitalAccs.reduce((s, a) => s + a.netMovement, 0));

    // Cash movements that have no account name (should normally be 0)
    const accountedNet = metrics.accounts.reduce((s, a) => s + a.netMovement, 0);
    const unclassified = r2((metrics.totalInflows - metrics.totalOutflows) - accountedNet);

    const grandCredit = r2(creditTotal + metrics.openingCash + capital + (unclassified > 0 ? unclassified : 0));
    const grandDebit = r2(debitTotal + metrics.closingCash + (unclassified < 0 ? -unclassified : 0));

    return {
      creditRows,
      debitRows,
      creditTotal,
      debitTotal,
      capital,
      capitalAccs,
      unclassified,
      grandCredit,
      grandDebit,
      difference: r2(grandCredit - grandDebit)
    };
  }, [metrics]);

  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const printHtml = useMemo(() => {
    if (!showPrintPreview) return '';
    const rows = [
      ...statement.creditRows.map(r => ({ account: r.acc.accountName, amount: r.amount, side: 'CREDIT' as const })),
      ...statement.debitRows.map(r => ({ account: r.acc.accountName, amount: r.amount, side: 'DEBIT' as const }))
    ].sort((a, b) => a.account.localeCompare(b.account));
    if (statement.unclassified !== 0) {
      rows.push({
        account: 'Unclassified Entries',
        amount: Math.abs(statement.unclassified),
        side: statement.unclassified > 0 ? 'CREDIT' : 'DEBIT'
      });
    }
    return buildFinalStatementHtml({
      fromDate: startDate,
      toDate: endDate,
      rows,
      creditTotal: statement.creditTotal + (statement.unclassified > 0 ? statement.unclassified : 0),
      debitTotal: statement.debitTotal + (statement.unclassified < 0 ? -statement.unclassified : 0),
      openingCash: metrics.openingCash,
      closingCash: metrics.closingCash,
      capital: statement.capital,
      grandCredit: statement.grandCredit,
      grandDebit: statement.grandDebit
    });
  }, [showPrintPreview, statement, metrics.openingCash, metrics.closingCash, startDate, endDate]);

  const renderSide = (
    side: 'CREDIT' | 'DEBIT',
    rows: { acc: FinalStatementAccount; amount: number }[],
    total: number
  ) => {
    const isCredit = side === 'CREDIT';
    const tone = isCredit ? 'text-emerald-800' : 'text-rose-800';
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className={`px-3.5 py-2.5 border-b flex items-center justify-between ${isCredit ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
          <h3 className={`text-[15px] font-black uppercase tracking-wide ${tone}`}>
            {isCredit ? 'Credit Balances' : 'Debit Balances'}
          </h3>
          <span className="text-[12px] font-bold uppercase text-slate-500">{rows.length} accounts</span>
        </div>
        <div className="max-h-[560px] overflow-y-auto flex-1">
          <table className="fit-table fit-lg w-full border-collapse">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr className="border-b border-slate-200 text-slate-700">
                <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-wider">Account</th>
                <th className={`px-3 py-2 text-right text-[12px] font-bold uppercase tracking-wider ${tone}`}>
                  {isCredit ? 'Credit' : 'Debit'}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ acc, amount }) => {
                const isExpanded = expandedHeadNames.has(acc.accountName);
                return (
                  <React.Fragment key={acc.accountName}>
                    <tr
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => toggleExpandHead(acc.accountName)}
                      title="Click to see the entries"
                    >
                      <td className="px-3 py-2 font-bold uppercase text-slate-900">
                        <span className="inline-flex items-start gap-1.5">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 mt-0.5 text-slate-700 shrink-0" />
                            : <ChevronRight className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />}
                          <span>
                            {displayHeadName(acc.accountName)}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); navigateToDetailedLedger(acc.accountName); }}
                              className="ml-1.5 inline-flex align-middle text-slate-500 hover:text-slate-900"
                              title="Open ledger"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </span>
                      </td>
                      <td className={`fit-nowrap px-3 py-2 text-right font-mono font-black tabular-nums ${tone}`}>
                        {fmt(amount)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50">
                        <td colSpan={2} className="px-2 py-2 border-b border-slate-200">
                          <div className="text-[12px] font-bold uppercase text-slate-600 mb-1 flex justify-between">
                            <span>{acc.ledgerCount} entries · Credit {fmt(acc.credit)} · Debit {fmt(acc.debit)}</span>
                          </div>
                          <div className="max-h-[260px] overflow-y-auto bg-white border border-slate-200 rounded">
                            <table className="fit-table w-full border-collapse">
                              <thead className="sticky top-0 bg-slate-100">
                                <tr className="text-slate-700">
                                  <th className="px-2 py-1 text-left">Date</th>
                                  <th className="px-2 py-1 text-left">Particulars</th>
                                  <th className="px-2 py-1 text-right text-emerald-700">Credit</th>
                                  <th className="px-2 py-1 text-right text-rose-700">Debit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {acc.entries.map((entry: any) => (
                                  <tr key={entry.id} className="border-t border-slate-100">
                                    <td className="fit-nowrap px-2 py-1 font-mono">{formatDateOld(entry.transactionDate)}</td>
                                    <td className="fit-particulars px-2 py-1">
                                      {entry.receiptOrVoucherNo ? <span className="font-bold mr-1">{entry.receiptOrVoucherNo}</span> : null}
                                      {entry.particulars || '—'}
                                    </td>
                                    <td className="fit-nowrap px-2 py-1 text-right font-mono font-bold text-emerald-700">
                                      {entry.credit > 0 ? fmt(entry.credit) : '—'}
                                    </td>
                                    <td className="fit-nowrap px-2 py-1 text-right font-mono font-bold text-rose-700">
                                      {entry.debit > 0 ? fmt(entry.debit) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="text-center py-6 text-slate-400 font-bold uppercase">No {isCredit ? 'credit' : 'debit'} balances</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={`px-3.5 py-2.5 border-t flex justify-between items-center ${isCredit ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
          <span className="text-[14px] font-black uppercase text-slate-800">{isCredit ? 'Credit Total' : 'Debit Total'}</span>
          <span className={`font-mono font-black text-[18px] tabular-nums ${tone}`}>{fmt(total)}</span>
        </div>
      </div>
    );
  };

  const TotalLine: React.FC<{ label: string; value: number | null; strong?: boolean; tone?: string }> = ({ label, value, strong, tone }) => (
    <div className={`flex justify-between items-baseline gap-3 px-3.5 py-2 ${strong ? 'bg-slate-900 text-white rounded-lg' : 'border-b border-slate-100'}`}>
      <span className={`uppercase font-bold ${strong ? 'text-[15px]' : 'text-[14px] text-slate-700'}`}>{label || ' '}</span>
      <span className={`font-mono font-black tabular-nums whitespace-nowrap ${strong ? 'text-[20px]' : `text-[17px] ${tone || 'text-slate-900'}`}`}>
        {value === null ? ' ' : fmt(value)}
      </span>
    </div>
  );

  return (
    <div className="space-y-4 w-full select-none pb-8 px-1 sm:px-2 text-slate-900 font-sans">

      {/* Header Bar & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-slate-200 p-3.5 sm:p-4 rounded-xl shadow-sm gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-900 leading-none">FINAL STATEMENT</h1>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1.5">
            Credit and debit balances of every account between the selected dates
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => navigate(-1)} variant="secondary" size="sm" icon={ArrowLeft}
            className="h-[38px] min-w-[85px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm">
            Back
          </Button>
          <Button onClick={fetchStatementData} variant="secondary" size="sm" icon={RefreshCw}
            className="h-[38px] min-w-[95px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm">
            Refresh
          </Button>
          <Button onClick={handleExportExcel} variant="secondary" size="sm" icon={Download}
            className="h-[38px] min-w-[85px] justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg uppercase font-bold text-xs shadow-sm">
            Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] gap-4 items-start">

        {/* LEFT PANEL: dates, print, summary */}
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 space-y-3">
            <div className="text-[13px] font-black uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-1.5">Between Dates</div>
            <FinanceSmartCalendar label="FROM" value={startDate} onChange={setStartDate} module="FINAL_STATEMENT" compact={true} />
            <FinanceSmartCalendar label="TO" value={endDate} onChange={setEndDate} module="FINAL_STATEMENT" compact={true} />
            <button
              type="button"
              onClick={() => setShowPrintPreview(true)}
              disabled={loading}
              className="w-full h-[44px] inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg uppercase font-bold text-[14px] shadow-sm disabled:opacity-50"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[13px] font-black uppercase tracking-wider text-slate-800">Summary</div>
            <div className="p-3 space-y-2.5">
              {[
                { label: 'Opening Cash', value: metrics.openingCash, tone: 'text-slate-900' },
                { label: 'Closing Cash', value: metrics.closingCash, tone: metrics.closingCash < 0 ? 'text-rose-700' : 'text-slate-900' },
                { label: 'Total Income', value: metrics.totalIncome, tone: 'text-emerald-700' },
                { label: 'Total Expenses', value: metrics.totalExpenses, tone: 'text-rose-700' },
                { label: 'Net Profit / Loss', value: metrics.netProfit, tone: metrics.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700' }
              ].map(item => (
                <div key={item.label} className="leading-tight">
                  <div className="text-[12px] font-bold uppercase text-slate-500">{item.label}</div>
                  <div className={`font-mono font-black text-[18px] tabular-nums text-right ${item.tone}`}>{fmt(item.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: credit side | debit side, then the totals */}
        <div className="space-y-4 min-w-0">
          {loading ? (
            <div className="flex justify-center py-16 bg-white rounded-xl border border-slate-200">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-slate-900"></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {renderSide('CREDIT', statement.creditRows, statement.creditTotal)}
                {renderSide('DEBIT', statement.debitRows, statement.debitTotal)}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                  <div className="space-y-1">
                    <TotalLine label="Credit Total" value={statement.creditTotal} tone="text-emerald-800" />
                    <TotalLine label="Opening Cash Balance" value={metrics.openingCash} />
                    <TotalLine label="Capital" value={statement.capital} tone="text-purple-800" />
                    {statement.unclassified > 0 && <TotalLine label="Unclassified Entries" value={statement.unclassified} />}
                    <TotalLine label="Grand Total" value={statement.grandCredit} strong />
                  </div>
                  <div className="space-y-1">
                    <TotalLine label="Debit Total" value={statement.debitTotal} tone="text-rose-800" />
                    <TotalLine label="Closing Cash Balance" value={metrics.closingCash} tone={metrics.closingCash < 0 ? 'text-rose-700' : 'text-slate-900'} />
                    <TotalLine label="" value={null} />
                    {statement.unclassified < 0 && <TotalLine label="Unclassified Entries" value={-statement.unclassified} />}
                    <TotalLine label="Grand Total" value={statement.grandDebit} strong />
                  </div>
                </div>
                {statement.difference !== 0 && (
                  <div className="mt-2 text-[13px] font-bold text-rose-700 uppercase">
                    Sides differ by {fmt(statement.difference)}
                  </div>
                )}
                {statement.capitalAccs.length > 0 && (
                  <div className="mt-2 text-[12px] font-semibold text-slate-500 uppercase">
                    Capital = {statement.capitalAccs.map(a => `${a.accountName} ${fmt(a.netMovement)}`).join(' · ')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* A4 Print Preview: the page itself, enlarged to fill the window */}
      {showPrintPreview && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex flex-col p-3 md:p-5">
          <div className="bg-white rounded-t-xl border border-slate-200 px-4 py-2.5 flex items-center justify-between">
            <div className="text-[15px] font-black uppercase text-slate-900">Print Preview – Final Statement</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => printPreviewFrame(printFrameRef.current)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#0b1329] text-white rounded-lg hover:bg-slate-800 font-bold uppercase text-[13px]"
              >
                <Printer className="w-4 h-4" /> Print
              </button>
              <button
                type="button"
                onClick={() => setShowPrintPreview(false)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 font-bold uppercase text-[13px]"
              >
                <X className="w-4 h-4" /> Close
              </button>
            </div>
          </div>
          <iframe
            ref={printFrameRef}
            title="Final Statement print preview"
            srcDoc={printHtml}
            className="flex-1 w-full bg-slate-200 rounded-b-xl border border-t-0 border-slate-200"
          />
        </div>
      )}

    </div>
  );
};

export default FinalStatement;
