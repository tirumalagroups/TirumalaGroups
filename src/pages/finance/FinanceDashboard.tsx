import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTableMode } from '../../contexts/TableModeContext';
import { useAuth } from '../../contexts/AuthContext';
import { FinanceCalculationEngine, DashboardMetrics } from '../../services/FinanceCalculationEngine';
import { 
  FileText, 
  Edit, 
  Users, 
  Shield, 
  BookOpen, 
  DollarSign, 
  Search, 
  Calculator, 
  Book, 
  TrendingUp, 
  AlertCircle, 
  ChevronRight,
  Plus, 
  AlertTriangle,
  Wallet,
  ArrowUpRight
} from 'lucide-react';
import toast from 'react-hot-toast';

const getAdaptiveCardFontSize = (amount: number, minimumFractionDigits = 0) => {
  const str = `${amount.toLocaleString('en-IN', { minimumFractionDigits })}`;
  const len = str.length;
  if (len >= 18) return 'text-[15px] sm:text-[17px] xl:text-[19px]';
  if (len >= 15) return 'text-[17px] sm:text-[19px] xl:text-[21px]';
  if (len >= 12) return 'text-[20px] sm:text-[22px] xl:text-[24px]';
  return 'text-[23px] sm:text-[26px] xl:text-[28px]';
};

const getPillNumberClass = (amount: number) => {
  const str = `${amount.toLocaleString('en-IN')}`;
  const len = str.length;
  if (len >= 13) return 'text-[13px] min-[1600px]:text-[14px] font-extrabold font-mono tabular-nums leading-tight whitespace-nowrap block';
  if (len >= 10) return 'text-[13px] min-[1600px]:text-[15px] font-extrabold font-mono tabular-nums leading-tight whitespace-nowrap block';
  return 'text-[14px] min-[1600px]:text-[16px] font-extrabold font-mono tabular-nums leading-tight whitespace-nowrap block';
};

const FinanceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { mode: tableMode } = useTableMode();
  const { user } = useAuth();

  useEffect(() => {
    if (tableMode !== 'finance') {
      navigate('/', { replace: true });
    }
  }, [tableMode, navigate]);

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalDisbursed: 0,
    activeLoansCount: 0,
    totalLoansCount: 0,
    avgLoanAmount: 0,
    largestLoanAmount: 0,
    totalOutstanding: 0,
    outstandingPrincipal: 0,
    pendingInterest: 0,
    pendingPenalty: 0,
    pendingCharges: 0,
    collectedTodayTotal: 0,
    collectedTodayPrincipal: 0,
    collectedTodayInterest: 0,
    collectedTodayPenalty: 0,
    collectedTodayCharges: 0,
    overdueLoansCount: 0,
    totalOverdueAmount: 0,
    highestOverdueAmount: 0,
    criticalOverdueCount: 0,
    recentLoans: [],
    pendingApprovalsCount: 0,
  });

  useEffect(() => {
    if (tableMode === 'finance') {
      fetchDashboardData();
    }
  }, [tableMode]);

  if (tableMode !== 'finance') {
    return null;
  }

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const data = await FinanceCalculationEngine.getDashboardMetrics();
      setMetrics(data);
    } catch (err) {
      console.error('Error fetching dashboard metrics:', err);
      toast.error('Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  const quickActions = [
    { label: 'New Loan', path: '/finance/loan-entry', icon: FileText },
    { label: 'Edit Loan', path: '/finance/edit-loan-entry', icon: Edit },
    { label: 'New Customer', path: '/finance/new-customer', icon: Users },
    { label: 'New Guarantor', path: '/finance/new-guarantor', icon: Shield },
    { label: 'Cash Book', path: '/finance/daybook', icon: BookOpen },
    { label: 'Capital', path: '/finance/capital-entry', icon: DollarSign },
    { label: 'Aadhaar Search', path: '/finance/search', icon: Search },
    { label: 'Calculator', path: '/finance/calculator', icon: Calculator },
    { label: 'CD Ledger', path: '/finance/cd-ledger', icon: Book },
    { label: 'HP Ledger', path: '/finance/hp-ledger', icon: Book },
    { label: 'STBD Ledger', path: '/finance/stbd-ledger', icon: Book },
    { label: 'TBD Ledger', path: '/finance/tbd-ledger', icon: Book },
  ];

  const reports = [
    { label: 'Day Book', path: '/finance/daybook', icon: BookOpen },
    { label: 'Daily Report', path: '/finance/new-customers', icon: FileText },
    { label: 'General Ledger', path: '/finance/general-ledger', icon: BookOpen },
    { label: 'Total Due List', path: '/finance/dues-ledger', icon: AlertCircle },
    { label: 'Outstanding List', path: '/finance/outstanding', icon: AlertTriangle },
    { label: 'P&L / Balance Sheet', path: '/finance/pl', icon: TrendingUp },
    { label: 'Final Statement', path: '/finance/final-statement', icon: FileText },
    { label: 'Business Details', path: '/finance/business-report', icon: FileText },
    { label: 'Partner Performance', path: '/finance/partner-performance', icon: Users },
  ];

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[450px] gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-slate-900"></div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Reconciling Financial Ledger Data...</p>
      </div>
    );
  }

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <div className="space-y-4 w-full select-none pb-6 px-1 text-slate-900 font-sans">
      
      {/* Header & Main Operations Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-slate-200 p-4 rounded-xl shadow-sm gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">DASHBOARD</h1>
            <span className="bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-0.5 rounded-full uppercase border border-slate-200">
              Live
            </span>
          </div>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1">
            OVERVIEW • AS OF {todayFormatted.toUpperCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/finance/loan-entry"
            className="inline-flex items-center justify-center gap-2 px-5 h-[44px] bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all font-bold text-sm uppercase shadow-sm"
          >
            <Plus className="w-4 h-4 stroke-[3px]" />
            NEW LOAN
          </Link>
          <Link
            to="/finance/daybook"
            className="inline-flex items-center justify-center gap-2 px-5 h-[44px] bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-all font-bold text-sm uppercase shadow-sm"
          >
            <BookOpen className="w-4 h-4 text-slate-600" />
            CASH BOOK
          </Link>
        </div>
      </div>

      {/* Pending Approvals Warning Card (Admin Only) */}
      {user?.is_admin && metrics.pendingApprovalsCount > 0 && (
        <div className="bg-amber-50/80 border border-amber-300 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-100 text-amber-700 rounded-lg border border-amber-200">
              <AlertCircle className="w-6 h-6 stroke-[2.5px]" />
            </div>
            <div>
              <h3 className="font-bold text-amber-900 text-base uppercase tracking-tight">
                {metrics.pendingApprovalsCount} Transactions Awaiting Approval
              </h3>
              <p className="text-amber-700 text-xs font-medium mt-0.5">
                Pending manager verification before posting
              </p>
            </div>
          </div>
          <Link
            to="/finance/transaction-approval"
            className="inline-flex items-center justify-center gap-1.5 px-4 h-[38px] bg-amber-600 text-white hover:bg-amber-700 rounded-lg text-xs font-bold uppercase transition-all shadow-sm shrink-0"
          >
            Verify Queue
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* FINANCIAL METRICS GRID */}
      <div>
        <div className="flex justify-between items-center mb-2 px-0.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            FINANCIAL OVERVIEW
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* Card 1: Total Disbursed */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all gap-3">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  DISBURSED (ALL-TIME)
                </span>
                <Wallet className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
              <div className={`font-black font-mono text-slate-900 tracking-tight leading-none ${getAdaptiveCardFontSize(metrics.totalDisbursed)}`}>
                {metrics.totalDisbursed.toLocaleString('en-IN')}
              </div>
            </div>

            <div className="grid grid-cols-1 min-[1600px]:grid-cols-2 gap-1.5 pt-2 border-t border-slate-100">
              <div className="bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                <span className="text-[11px] font-bold uppercase text-slate-400 block">Active Loans</span>
                <span className="text-[13px] min-[1600px]:text-[14px] font-extrabold text-slate-800 tabular-nums">{metrics.activeLoansCount} Accounts</span>
              </div>
              <div className="bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                <span className="text-[11px] font-bold uppercase text-slate-400 block">Total Loans</span>
                <span className="text-[13px] min-[1600px]:text-[14px] font-extrabold text-slate-800 tabular-nums">{metrics.totalLoansCount} Accounts</span>
              </div>
              <div className="bg-slate-50 px-2 py-1.5 rounded border border-slate-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-slate-400 block">Avg Loan</span>
                <span className={getPillNumberClass(metrics.avgLoanAmount)}>{metrics.avgLoanAmount.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-slate-50 px-2 py-1.5 rounded border border-slate-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-slate-400 block">Max Loan</span>
                <span className={getPillNumberClass(metrics.largestLoanAmount)}>{metrics.largestLoanAmount.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 font-semibold">Total principal disbursed across valid loans</p>
          </div>

          {/* Card 2: Total Outstanding (Actual Receivable) */}
          <div className="bg-white border border-rose-200 rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-rose-300 transition-all gap-3 bg-gradient-to-b from-rose-50/20 to-white">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-rose-600">
                  TOTAL OUTSTANDING
                </span>
                <TrendingUp className="w-4 h-4 text-rose-500 shrink-0" />
              </div>
              <div className={`font-black font-mono text-rose-700 tracking-tight leading-none ${getAdaptiveCardFontSize(metrics.totalOutstanding)}`}>
                {metrics.totalOutstanding.toLocaleString('en-IN')}
              </div>
            </div>

            <div className="grid grid-cols-1 min-[1600px]:grid-cols-2 gap-1.5 pt-2 border-t border-rose-100">
              <div className="bg-rose-50/50 px-2 py-1.5 rounded border border-rose-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-rose-500 block">Principal</span>
                <span className={`${getPillNumberClass(metrics.outstandingPrincipal)} text-rose-900`}>{metrics.outstandingPrincipal.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-rose-50/50 px-2 py-1.5 rounded border border-rose-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-rose-500 block">Interest</span>
                <span className={`${getPillNumberClass(metrics.pendingInterest)} text-rose-900`}>{metrics.pendingInterest.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-rose-50/50 px-2 py-1.5 rounded border border-rose-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-rose-500 block">Penalty</span>
                <span className={`${getPillNumberClass(metrics.pendingPenalty)} text-rose-900`}>{metrics.pendingPenalty.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-rose-50/50 px-2 py-1.5 rounded border border-rose-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-rose-500 block">Charges</span>
                <span className={`${getPillNumberClass(metrics.pendingCharges)} text-rose-900`}>{metrics.pendingCharges.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <p className="text-[11px] text-rose-500/80 font-semibold">Actual collectible receivable across active accounts</p>
          </div>

          {/* Card 3: Collected Today */}
          <div className="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-emerald-300 transition-all gap-3 bg-gradient-to-b from-emerald-50/20 to-white">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                  COLLECTED TODAY
                </span>
                <DollarSign className="w-4 h-4 text-emerald-500 shrink-0" />
              </div>
              <div className={`font-black font-mono text-emerald-700 tracking-tight leading-none ${getAdaptiveCardFontSize(metrics.collectedTodayTotal)}`}>
                {metrics.collectedTodayTotal.toLocaleString('en-IN')}
              </div>
            </div>

            <div className="grid grid-cols-1 min-[1600px]:grid-cols-2 gap-1.5 pt-2 border-t border-emerald-100">
              <div className="bg-emerald-50/50 px-2 py-1.5 rounded border border-emerald-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-emerald-600 block">Principal</span>
                <span className={`${getPillNumberClass(metrics.collectedTodayPrincipal)} text-emerald-900`}>{metrics.collectedTodayPrincipal.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-emerald-50/50 px-2 py-1.5 rounded border border-emerald-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-emerald-600 block">Interest</span>
                <span className={`${getPillNumberClass(metrics.collectedTodayInterest)} text-emerald-900`}>{metrics.collectedTodayInterest.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-emerald-50/50 px-2 py-1.5 rounded border border-emerald-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-emerald-600 block">Penalty</span>
                <span className={`${getPillNumberClass(metrics.collectedTodayPenalty)} text-emerald-900`}>{metrics.collectedTodayPenalty.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-emerald-50/50 px-2 py-1.5 rounded border border-emerald-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-emerald-600 block">Charges</span>
                <span className={`${getPillNumberClass(metrics.collectedTodayCharges)} text-emerald-900`}>{metrics.collectedTodayCharges.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <p className="text-[11px] text-emerald-600/80 font-semibold">Total collections received on today's business date</p>
          </div>

          {/* Card 4: Overdue Loans */}
          <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-amber-300 transition-all gap-3 bg-gradient-to-b from-amber-50/20 to-white">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
                  OVERDUE LOANS
                </span>
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              </div>
              <div className="text-3xl font-black font-mono text-amber-700 tracking-tight leading-none">
                {metrics.overdueLoansCount} <span className="text-base font-bold uppercase text-amber-600">Accounts</span>
              </div>
            </div>

            <div className="grid grid-cols-1 min-[1600px]:grid-cols-2 gap-1.5 pt-2 border-t border-amber-100">
              <div className="min-[1600px]:col-span-2 bg-amber-50/50 px-2 py-1.5 rounded border border-amber-100 flex justify-between items-center overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-amber-700">Total Due</span>
                <span className={`${getPillNumberClass(metrics.totalOverdueAmount)} text-amber-900`}>{metrics.totalOverdueAmount.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-amber-50/50 px-2 py-1.5 rounded border border-amber-100 overflow-hidden">
                <span className="text-[11px] font-bold uppercase text-amber-700 block">Highest Due</span>
                <span className={`${getPillNumberClass(metrics.highestOverdueAmount)} text-amber-900`}>{metrics.highestOverdueAmount.toLocaleString('en-IN')}</span>
              </div>
              <div className="bg-amber-50/50 px-2 py-1.5 rounded border border-amber-100">
                <span className="text-[11px] font-bold uppercase text-amber-700 block">Critical (&gt;90d)</span>
                <span className="text-[13px] min-[1600px]:text-[14px] font-extrabold text-amber-900 tabular-nums">{metrics.criticalOverdueCount} Accounts</span>
              </div>
            </div>
            <p className="text-[11px] text-amber-600/80 font-semibold">Active accounts past due date requiring recovery action</p>
          </div>

        </div>
      </div>

      {/* QUICK ACTIONS SECTION */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-0.5">
          QUICK OPERATIONS
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {quickActions.map((action, idx) => {
            const IconComponent = action.icon;
            return (
              <Link
                key={idx}
                to={action.path}
                className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-3 min-h-[46px] group"
              >
                <div className="text-slate-400 group-hover:text-slate-900 transition-colors">
                  <IconComponent className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold uppercase text-slate-800 leading-tight">
                  {action.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* RECENT DISBURSEMENTS & FINANCIAL REPORTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* Left Column: Recent Loans */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex justify-between items-center px-0.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              RECENT DISBURSEMENTS
            </h2>
            <Link
              to="/finance/search"
              className="text-xs font-bold text-slate-700 hover:text-slate-900 hover:underline uppercase flex items-center gap-1"
            >
              Search Loans
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {metrics.recentLoans.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center text-center bg-white min-h-[220px]">
              <div className="text-slate-800 font-bold text-sm uppercase">
                No disbursements yet
              </div>
              <div className="text-slate-500 mt-1 mb-4 text-xs">
                Start by creating your first loan entry.
              </div>
              <Link
                to="/finance/loan-entry"
                className="inline-flex items-center justify-center gap-1.5 px-4 h-[38px] bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-bold text-xs uppercase"
              >
                <Plus className="w-4 h-4" />
                Create loan
              </Link>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div>
                <table className="w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr className="divide-x divide-slate-200">
                      <th className="px-3 py-2.5 text-left font-bold uppercase text-[12px]">Loan ID</th>
                      <th className="px-3 py-2.5 text-left font-bold uppercase text-[12px]">Customer Name</th>
                      <th className="px-3 py-2.5 text-left font-bold uppercase text-[12px]">Date</th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase text-[12px]">Amount</th>
                      <th className="px-3 py-2.5 text-center font-bold uppercase text-[12px]">Category</th>
                      <th className="px-3 py-2.5 text-center font-bold uppercase text-[12px]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100 divide-x divide-slate-50">
                    {metrics.recentLoans.map((loan) => (
                      <tr key={loan.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="whitespace-nowrap px-3 py-2 text-[13px] min-[1600px]:text-[14px] font-mono text-slate-900 font-bold">
                          {loan.loan_id}
                        </td>
                        <td className="px-3 py-2 text-[13px] min-[1600px]:text-[14px] text-slate-900 font-bold uppercase">
                          {loan.customer?.name || 'N/A'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[13px] min-[1600px]:text-[14px] text-slate-600 font-medium tabular-nums">
                          {new Date(loan.date).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[13px] min-[1600px]:text-[14px] text-right text-slate-900 font-bold font-mono tabular-nums">
                          {Number(loan.amount).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-[13px] min-[1600px]:text-[14px] text-center font-bold uppercase text-slate-600">
                          {loan.loan_category?.trim().toUpperCase() || 'CD'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${ loan.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600' }`}
                          >
                            {loan.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Statements & Reports Navigation */}
        <div className="space-y-2">
          <div className="px-0.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              STATEMENTS &amp; REPORTS
            </h2>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-2 divide-y divide-slate-100 flex flex-col gap-1">
            {reports.map((report, idx) => {
              const IconComponent = report.icon;
              return (
                <Link
                  key={idx}
                  to={report.path}
                  className="flex items-center justify-between py-2.5 px-3 hover:bg-slate-50 transition-all rounded-lg group"
                >
                  <div className="flex items-center gap-3">
                    <IconComponent className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition-colors" />
                    <span className="text-slate-800 group-hover:text-slate-900 transition-colors text-xs font-bold uppercase">
                      {report.label}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
                </Link>
              );
            })}
          </div>
        </div>

      </div>

    </div>
  );
};

export default FinanceDashboard;
