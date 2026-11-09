import LoadMoreBar, { LOAD_STEP } from '../../components/UI/LoadMoreBar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { AlertCircle, Book, Calendar, Check, Eye, Loader2, RotateCcw, Search, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabaseFinance, FinanceTransactionReview } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { dailyFinancialTransactionService } from '../../services/dailyFinancialTransactionService';
import { displayHeadName } from '../../utils/financeLabels';

/**
 * Finance > Approve Records.
 * Same layout as Regular's Approve Records (filters and summary on top, then the tables).
 * The approval logic is the existing Finance one: approveTransactionReview,
 * approveTransactionsBulk, rejectTransactionReview and getTransactionReviewDetails.
 */

const todayISO = () => new Date().toISOString().split('T')[0];

type LoanJoin = { loan_id?: string; customer?: { name?: string } | null } | null;
// The Supabase client maps finance_loans to the loans table, so the joined row arrives as "loans"
type ReviewRow = FinanceTransactionReview & { finance_loans?: LoanJoin; loans?: LoanJoin };

const fmtDate = (value?: string | null, pattern = 'dd/MM/yyyy') => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : format(d, pattern);
};

const fmtAmount = (val?: number | null) => {
  const n = Number(val || 0);
  const hasDecimals = n % 1 !== 0;
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  });
};
const fmtPart = (val?: number | null) => (Number(val || 0) > 0 ? fmtAmount(val) : '-');

const loanOf = (r: ReviewRow) => r.loans || r.finance_loans || null;
const customerOf = (r: ReviewRow) => loanOf(r)?.customer?.name || (r.loan_id ? '—' : 'Manual Daybook Entry');
const loanNoOf = (r: ReviewRow) => loanOf(r)?.loan_id || '—';

// NPA rows are red (loss), NPA Pending rows are light blue
const typeUpper = (t?: string | null) => displayHeadName(t).toUpperCase();
const rowTone = (r: ReviewRow) => {
  const t = typeUpper(r.transaction_type);
  if (t.includes('NPA PENDING')) return 'bg-sky-50';
  if (t.includes('NPA')) return 'bg-red-50 text-red-800';
  return 'even:bg-gray-50/60 odd:bg-white';
};

const ActionBadge: React.FC<{ action?: string }> = ({ action }) => {
  const a = action || 'CREATE';
  const tone = a === 'EDIT'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : a === 'DELETE'
    ? 'bg-rose-100 text-rose-800 border-rose-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex px-2 py-0.5 rounded border font-bold ${tone}`}>{a}</span>;
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const tone = status === 'APPROVED'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : status === 'REJECTED'
    ? 'bg-rose-100 text-rose-800 border-rose-200'
    : 'bg-amber-100 text-amber-800 border-amber-200';
  return <span className={`inline-flex px-2 py-0.5 rounded-full border font-bold ${tone}`}>{status}</span>;
};

interface ReviewTableProps {
  rows: ReviewRow[];
  visible: number;
  selectable?: boolean;
  selected?: Set<string>;
  allSelected?: boolean;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  onView: (r: ReviewRow) => void;
  onApprove?: (id: string) => void;
  actioningId?: string | null;
  canApprove?: boolean;
  showDecision?: boolean;
}

const ReviewTable: React.FC<ReviewTableProps> = ({
  rows, visible, selectable, selected, allSelected, onToggle, onToggleAll,
  onView, onApprove, actioningId, canApprove, showDecision,
}) => {
  const th = 'px-2 py-2 font-medium text-gray-700';
  const pageRows = rows.slice(0, visible);
  return (
    <table className='fit-table' data-no-load-more>
      <thead className='bg-gray-50 border-b border-gray-200'>
        <tr>
          {selectable && (
            <th className={`${th} text-center`}>
              <input type='checkbox' checked={!!allSelected} onChange={onToggleAll} className='h-4 w-4 rounded border-gray-300' aria-label='Select all' />
            </th>
          )}
          <th className={`${th} text-left`}>S.No</th>
          <th className={`${th} text-left`}>Date</th>
          <th className={`${th} text-left`}>Loan No</th>
          <th className={`${th} text-left`}>Receipt</th>
          <th className={`${th} text-left`}>Customer</th>
          <th className={`${th} text-left`}>Type</th>
          <th className={`${th} text-center`}>Action</th>
          <th className={`${th} text-right`}>Principal</th>
          <th className={`${th} text-right`}>Interest</th>
          <th className={`${th} text-right`}>Penalty</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={`${th} text-left`}>Entered By</th>
          {showDecision && <th className={`${th} text-left`}>Decided By</th>}
          <th className={`${th} text-center`}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {pageRows.map((r, i) => (
          <tr
            key={r.id}
            onDoubleClick={() => onView(r)}
            title='Double click to view details'
            className={`border-b transition-colors ${selected?.has(r.id) ? 'bg-indigo-50' : rowTone(r)}`}
          >
            {selectable && (
              <td className='px-2 py-2 text-center'>
                <input type='checkbox' checked={!!selected?.has(r.id)} onChange={() => onToggle?.(r.id)} className='h-4 w-4 rounded border-gray-300' aria-label='Select record' />
              </td>
            )}
            <td className='fit-nowrap px-2 py-2 font-medium'>{i + 1}</td>
            <td className='fit-nowrap px-2 py-2'>{fmtDate(r.transaction_date)}</td>
            <td className='fit-nowrap px-2 py-2 font-bold text-blue-700'>{loanNoOf(r)}</td>
            <td className='fit-nowrap px-2 py-2'>{r.receipt_number || '—'}</td>
            <td className='fit-name px-2 py-2 font-bold uppercase'>{customerOf(r)}</td>
            <td className='px-2 py-2'>{displayHeadName(r.transaction_type) || '—'}</td>
            <td className='fit-nowrap px-2 py-2 text-center'><ActionBadge action={r.action_type} /></td>
            <td className='fit-nowrap px-2 py-2 text-right tabular-nums'>{fmtPart(r.principal_amount)}</td>
            <td className='fit-nowrap px-2 py-2 text-right tabular-nums'>{fmtPart(r.interest_amount)}</td>
            <td className='fit-nowrap px-2 py-2 text-right tabular-nums'>{fmtPart(r.penalty_amount)}</td>
            <td className='fit-nowrap px-2 py-2 text-right tabular-nums font-bold'>{fmtAmount(r.amount)}</td>
            <td className='px-2 py-2'>
              <div className='font-semibold uppercase'>{r.entered_by}</div>
              <div className='fit-nowrap text-gray-500'>{fmtDate(r.entered_at, 'dd/MM/yy hh:mm a')}</div>
            </td>
            {showDecision && (
              <td className='px-2 py-2'>
                <div className='font-semibold uppercase'>{r.approved_by || '—'}</div>
                {r.approved_at && <div className='fit-nowrap text-gray-500'>{fmtDate(r.approved_at, 'dd/MM/yy hh:mm a')}</div>}
              </td>
            )}
            <td className='px-2 py-2 text-center'>
              <div className='flex items-center justify-center gap-1' style={{ flexWrap: 'nowrap' }}>
                <button type='button' onClick={() => onView(r)} title='View Details' className='inline-flex items-center gap-1 rounded border border-gray-300 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold'>
                  <Eye className='w-3.5 h-3.5' /> <span className='max-[1399px]:hidden'>View</span>
                </button>
                {r.review_status === 'PENDING' && canApprove && (
                    <button type='button' onClick={() => onApprove?.(r.id)} disabled={actioningId === r.id} title='Approve Transaction' className='inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50'>
                      {actioningId === r.id ? <Loader2 className='w-3.5 h-3.5 animate-spin' /> : <Check className='w-3.5 h-3.5' />} <span className='max-[1399px]:hidden'>Approve</span>
                    </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const FinanceApproveRecords: React.FC = () => {
  const { user } = useAuth();
  const canApprove = !!user?.is_admin || (Array.isArray(user?.features) && user!.features.includes('finance_approve_records'));

  const [pendingRows, setPendingRows] = useState<ReviewRow[]>([]);
  const [approvedRows, setApprovedRows] = useState<ReviewRow[]>([]);
  const [rejectedRows, setRejectedRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const [pendingVisible, setPendingVisible] = useState(LOAD_STEP);
  const [approvedVisible, setApprovedVisible] = useState(LOAD_STEP);
  const [rejectedVisible, setRejectedVisible] = useState(LOAD_STEP);

  // Bulk approval
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  // Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [oldestDate, setOldestDate] = useState('2020-01-01');
  const [filterOperator, setFilterOperator] = useState('ALL');
  const [actionType, setActionType] = useState<'ALL' | 'EDIT' | 'DELETE' | 'CREATE'>('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [filterAccountNo, setFilterAccountNo] = useState('');
  const [filterReceiptNo, setFilterReceiptNo] = useState('');
  const [operators, setOperators] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [summary, setSummary] = useState({ pending: 0, editPending: 0, deletePending: 0, approvedToday: 0 });

  // Quick date navigation
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const [activityDates, setActivityDates] = useState<{ c_date: string }[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarStyle, setCalendarStyle] = useState<React.CSSProperties>({});
  const calendarRef = useRef<HTMLDivElement>(null);
  const calendarButtonRef = useRef<HTMLButtonElement>(null);

  // Dialogs
  const [viewRow, setViewRow] = useState<ReviewRow | null>(null);
  const [details, setDetails] = useState<Record<string, any[]>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [printMode, setPrintMode] = useState<'PENDING' | 'ALL' | null>(null);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      setQueryError(null);
      const base = {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        enteredBy: filterOperator !== 'ALL' && filterOperator.trim() ? filterOperator : undefined,
        loanType: filterType !== 'ALL' ? filterType : undefined,
        accountNo: filterAccountNo.trim() || undefined,
        receiptNo: filterReceiptNo.trim() || undefined,
        actionType: actionType !== 'ALL' ? actionType : undefined,
      };
      const [pending, approved, rejected] = await Promise.all([
        supabaseFinance.getTransactionReviews({ ...base, status: 'PENDING' }),
        supabaseFinance.getTransactionReviews({ ...base, status: 'APPROVED' }),
        supabaseFinance.getTransactionReviews({ ...base, status: 'REJECTED' }),
      ]);
      setPendingRows(pending as ReviewRow[]);
      setApprovedRows(approved as ReviewRow[]);
      setRejectedRows(rejected as ReviewRow[]);
      setPendingVisible(LOAD_STEP);
      setApprovedVisible(LOAD_STEP);
      setRejectedVisible(LOAD_STEP);
    } catch (err: any) {
      console.error('Error fetching transaction reviews:', err);
      setQueryError(err?.message || 'Failed to load transaction reviews');
      setPendingRows([]);
      setApprovedRows([]);
      setRejectedRows([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchMeta = async () => {
    try {
      let data: any[] = [];
      for (let page = 0; page < 100; page++) {
        const { data: chunk, error } = await supabase
          .from('finance_transaction_reviews')
          .select('entered_by, transaction_type, review_status, action_type, approved_at')
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        data = data.concat(chunk || []);
        if (!chunk || chunk.length < 1000) break;
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let pending = 0, editPending = 0, deletePending = 0, approvedToday = 0;
      (data || []).forEach((r: any) => {
        if (r.review_status === 'PENDING') {
          pending++;
          if (r.action_type === 'EDIT') editPending++;
          else if (r.action_type === 'DELETE') deletePending++;
        } else if (r.review_status === 'APPROVED' && r.approved_at && new Date(r.approved_at) >= todayStart) {
          approvedToday++;
        }
      });
      setSummary({ pending, editPending, deletePending, approvedToday });
      setOperators(Array.from(new Set((data || []).map((r: any) => r.entered_by).filter(Boolean))) as string[]);
      setTypes((Array.from(new Set((data || []).map((r: any) => r.transaction_type).filter(Boolean))) as string[]).sort());
    } catch (err) {
      console.error('Error loading approval summary:', err);
    }
    try {
      setActivityDates((await supabaseFinance.getAllTransactionReviewDates()) || []);
    } catch (err) {
      console.error('Error loading review activity dates:', err);
    }
  };

  useEffect(() => {
    (async () => {
      const oldest = (await dailyFinancialTransactionService.getOldestTransactionDate()) || '2020-01-01';
      setOldestDate(oldest);
      setFromDate(oldest);
      setToDate(todayISO());
    })();
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
    if (!fromDate && !toDate) return; // first load waits for the oldest date
    fetchReviews();
    fetchMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, filterOperator, actionType, filterType]);

  // Calendar popover: close on outside click / ESC
  useEffect(() => {
    if (!showCalendar) return;
    const onDown = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)
        && calendarButtonRef.current && !calendarButtonRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCalendar(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showCalendar]);

  const toggleCalendar = () => {
    if (!showCalendar && calendarButtonRef.current) {
      const rect = calendarButtonRef.current.getBoundingClientRect();
      let top = rect.bottom + 8;
      if (top + 340 > window.innerHeight - 16) top = Math.max(16, rect.top - 348);
      setCalendarStyle({ position: 'fixed', top, left: Math.max(16, Math.min(rect.left, window.innerWidth - 326)), zIndex: 99999 });
    }
    setShowCalendar(v => !v);
  };

  const goToDate = (d: string) => {
    setSelectedDate(d);
    setFromDate(d);
    setToDate(d);
  };
  const stepDate = (dir: -1 | 1) => {
    const sorted = Array.from(new Set(activityDates.map(a => a.c_date))).sort();
    const candidates = dir < 0 ? sorted.filter(d => d < selectedDate) : sorted.filter(d => d > selectedDate);
    if (candidates.length > 0) {
      goToDate(dir < 0 ? candidates[candidates.length - 1] : candidates[0]);
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + dir);
      goToDate(format(d, 'yyyy-MM-dd'));
    }
  };

  const resetFilters = () => {
    setFromDate(oldestDate);
    setToDate(todayISO());
    setFilterOperator('ALL');
    setActionType('ALL');
    setFilterType('ALL');
    setFilterAccountNo('');
    setFilterReceiptNo('');
  };

  const showAllDates = (action: 'ALL' | 'EDIT' | 'DELETE') => {
    setActionType(action);
    setFilterOperator('ALL');
    setFromDate(oldestDate);
    setToDate(todayISO());
  };

  // ---- Actions (same service calls as before) ----
  const openView = async (r: ReviewRow) => {
    setViewRow(r);
    if (details[r.id]) return;
    setDetailsLoading(true);
    try {
      const d = await supabaseFinance.getTransactionReviewDetails(r.id);
      setDetails(prev => ({ ...prev, [r.id]: d }));
    } catch (err) {
      console.error(err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (!canApprove) {
      toast.error('Access Denied: You do not have permission to approve transactions.');
      return;
    }
    if (!window.confirm('Are you sure you want to approve this transaction?')) return;
    try {
      setActioningId(id);
      const ok = await supabaseFinance.approveTransactionReview(id, user!.username);
      if (ok) {
        toast.success('Transaction approved successfully');
        setViewRow(null);
        fetchReviews();
        fetchMeta();
      } else {
        toast.error('Failed to approve transaction');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error occurred during approval');
    } finally {
      setActioningId(null);
    }
  };

  const allSelected = pendingRows.length > 0 && pendingRows.every(r => selectedIds.has(r.id));
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(pendingRows.map(r => r.id)));

  const startBulk = (mode: 'SELECTED' | 'ALL_FILTERED') => {
    if (!canApprove) {
      toast.error('Access Denied: You do not have permission to bulk approve transactions.');
      return;
    }
    const targets = mode === 'SELECTED' ? Array.from(selectedIds) : pendingRows.map(r => r.id);
    if (targets.length === 0) {
      toast.error('No pending transactions available to approve.');
      return;
    }
    setBulkTargetIds(targets);
    setShowBulkConfirm(true);
  };

  const runBulk = async (ids: string[]) => {
    try {
      setIsBulkApproving(true);
      const result = await supabaseFinance.approveTransactionsBulk({
        transactionIds: ids,
        approvedBy: user?.username || 'System',
      });
      setBulkResult(result);
      setSelectedIds(new Set());
      setBulkTargetIds([]);
      fetchReviews();
      fetchMeta();
    } catch (err: any) {
      console.error('Bulk approval failed:', err);
      toast.error(err.message || 'Bulk approval failed unexpectedly');
    } finally {
      setIsBulkApproving(false);
      setShowBulkConfirm(false);
    }
  };

  const approveAllNow = () => {
    if (!canApprove) {
      toast.error('Access Denied: You do not have permission to bulk approve transactions.');
      return;
    }
    if (isBulkApproving) return;
    const ids = pendingRows.map(r => r.id);
    if (ids.length === 0) {
      toast.error('No pending transactions available to approve.');
      return;
    }
    runBulk(ids);
  };

  const bulkBreakdown = useMemo(() => {
    const targets = pendingRows.filter(r => bulkTargetIds.includes(r.id));
    const dates = targets.map(r => r.transaction_date).filter(Boolean).sort();
    return {
      editCount: targets.filter(r => r.action_type === 'EDIT').length,
      deleteCount: targets.filter(r => r.action_type === 'DELETE').length,
      createCount: targets.filter(r => !r.action_type || r.action_type === 'CREATE').length,
      operators: Array.from(new Set(targets.map(r => r.entered_by).filter(Boolean))),
      dateRange: dates.length === 0
        ? 'N/A'
        : dates[0] === dates[dates.length - 1]
        ? fmtDate(dates[0], 'dd MMM yyyy')
        : `${fmtDate(dates[0], 'dd MMM yyyy')} to ${fmtDate(dates[dates.length - 1], 'dd MMM yyyy')}`,
    };
  }, [pendingRows, bulkTargetIds]);

  const cardClass = (active: boolean, on: string, off: string) =>
    `text-left rounded-lg p-4 border shadow-sm transition-colors ${active ? on : off}`;

  const printSections: { title: string; rows: ReviewRow[] }[] = printMode === 'ALL'
    ? [
        { title: 'Records for Approval', rows: pendingRows },
        { title: 'Approved Records', rows: approvedRows },
        { title: 'Rejected Records', rows: rejectedRows },
      ]
    : [{ title: 'Records for Approval', rows: pendingRows }];

  return (
    <div className='space-y-6 p-2'>
      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2.5'>
            Approve Records
            <span className='px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700'>Finance Mode</span>
          </h1>
          <p className='text-gray-600'>Review and approve operator-entered financial transactions</p>
        </div>
        <div className='flex items-center gap-3'>
          <Button variant='secondary' onClick={() => { fetchReviews(); fetchMeta(); }}>Refresh</Button>
          <Button variant='secondary' onClick={() => setPrintMode('PENDING')}>Print</Button>
          <Button variant='secondary' onClick={() => setPrintMode('ALL')}>Print All</Button>
        </div>
      </div>

      {/* Filters */}
      <Card className='bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'>
        <form
          onSubmit={(e) => { e.preventDefault(); fetchReviews(); }}
          className='p-4 grid grid-cols-1 md:grid-cols-12 gap-4'
        >
          <div className='md:col-span-6'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Date (dd/MM/yyyy)</label>
            <div className='flex items-center gap-2'>
              <Button type='button' size='sm' variant='secondary' onClick={() => stepDate(-1)} className='shrink-0'>Previous</Button>
              <button
                ref={calendarButtonRef}
                type='button'
                onClick={toggleCalendar}
                className='flex-1 h-10 px-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold tabular-nums inline-flex items-center justify-center gap-2 whitespace-nowrap'
              >
                <Calendar className='w-4 h-4 text-indigo-600' />
                {fmtDate(selectedDate)}
              </button>
              <Button type='button' size='sm' variant='secondary' onClick={() => stepDate(1)} className='shrink-0'>Next</Button>
              <Button type='button' size='sm' onClick={() => goToDate(todayISO())} className='shrink-0'>Today</Button>
            </div>
            {showCalendar && (
              <div ref={calendarRef} style={calendarStyle} className='bg-white rounded-xl p-2 border border-gray-200 shadow-2xl'>
                <FinanceSmartCalendar
                  mode='inline'
                  value={selectedDate}
                  onChange={(d) => { goToDate(d); setShowCalendar(false); }}
                  module='TRANSACTION_APPROVAL'
                />
              </div>
            )}
          </div>
          <div className='md:col-span-3'>
            <FinanceSmartCalendar label='From Date' value={fromDate} onChange={setFromDate} module='TRANSACTION_APPROVAL' />
          </div>
          <div className='md:col-span-3'>
            <FinanceSmartCalendar label='To Date' value={toDate} onChange={setToDate} module='TRANSACTION_APPROVAL' />
          </div>
          <div className='md:col-span-2'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Operator</label>
            <select value={filterOperator} onChange={e => setFilterOperator(e.target.value)} className='w-full h-10 px-2 bg-white border border-gray-300 rounded-lg'>
              <option value='ALL'>All Operators</option>
              {operators.map(op => <option key={op} value={op}>{op.toUpperCase()}</option>)}
            </select>
          </div>
          <div className='md:col-span-2'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Action Type</label>
            <select value={actionType} onChange={e => setActionType(e.target.value as any)} className='w-full h-10 px-2 bg-white border border-gray-300 rounded-lg'>
              <option value='ALL'>All</option>
              <option value='CREATE'>Create</option>
              <option value='EDIT'>Edit</option>
              <option value='DELETE'>Delete</option>
            </select>
          </div>
          <div className='md:col-span-2'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Type</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className='w-full h-10 px-2 bg-white border border-gray-300 rounded-lg'>
              <option value='ALL'>All Types</option>
              {types.map(t => <option key={t} value={t}>{displayHeadName(t)}</option>)}
            </select>
          </div>
          <div className='md:col-span-2'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Loan No</label>
            <input value={filterAccountNo} onChange={e => setFilterAccountNo(e.target.value)} placeholder='CD505' className='w-full h-10 px-2 bg-white border border-gray-300 rounded-lg' />
          </div>
          <div className='md:col-span-2'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>Receipt No</label>
            <input value={filterReceiptNo} onChange={e => setFilterReceiptNo(e.target.value)} placeholder='RC2647' className='w-full h-10 px-2 bg-white border border-gray-300 rounded-lg' />
          </div>
          <div className='md:col-span-2 flex items-end gap-2'>
            <Button type='submit' className='flex-1 min-w-0 inline-flex items-center justify-center gap-1'><Search className='w-4 h-4' /> Search</Button>
            <Button type='button' variant='secondary' onClick={resetFilters} className='inline-flex items-center justify-center shrink-0' title='Reset Filters' aria-label='Reset Filters'><RotateCcw className='w-4 h-4' /></Button>
          </div>
        </form>
      </Card>

      {/* Summary */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
        <button type='button' onClick={() => showAllDates('ALL')} className={cardClass(actionType === 'ALL', 'bg-amber-100 border-amber-400', 'bg-amber-50 border-amber-100 hover:bg-amber-100/60')}>
          <span className='block text-sm font-semibold text-gray-600'>Total Pending</span>
          <span className='block text-2xl font-bold text-amber-900 tabular-nums mt-1'>{summary.pending}</span>
        </button>
        <button type='button' onClick={() => showAllDates('EDIT')} className={cardClass(actionType === 'EDIT', 'bg-blue-100 border-blue-400', 'bg-blue-50 border-blue-100 hover:bg-blue-100/60')}>
          <span className='block text-sm font-semibold text-gray-600'>Edit Pending</span>
          <span className='block text-2xl font-bold text-blue-900 tabular-nums mt-1'>{summary.editPending}</span>
        </button>
        <button type='button' onClick={() => showAllDates('DELETE')} className={cardClass(actionType === 'DELETE', 'bg-rose-100 border-rose-400', 'bg-rose-50 border-rose-100 hover:bg-rose-100/60')}>
          <span className='block text-sm font-semibold text-gray-600'>Delete Pending</span>
          <span className='block text-2xl font-bold text-rose-900 tabular-nums mt-1'>{summary.deletePending}</span>
        </button>
        <button type='button' onClick={() => { setActionType('ALL'); setFilterOperator('ALL'); goToDate(todayISO()); }} className={cardClass(false, '', 'bg-emerald-50 border-emerald-100 hover:bg-emerald-100/60')}>
          <span className='block text-sm font-semibold text-gray-600'>Approved Today</span>
          <span className='block text-2xl font-bold text-emerald-900 tabular-nums mt-1'>{summary.approvedToday}</span>
        </button>
      </div>

      {queryError && (
        <div className='bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-800'>
          <AlertCircle className='w-5 h-5 shrink-0' />
          <div>
            <p className='font-bold'>Query Error</p>
            <p className='text-sm'>{queryError}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className='flex items-center justify-center gap-3 py-16 text-gray-500'>
          <Loader2 className='w-6 h-6 animate-spin' /> Loading records...
        </div>
      ) : (
        <>
          {/* Records for Approval */}
          <Card
            title='Records for Approval'
            subtitle={`Showing ${Math.min(pendingRows.length, pendingVisible)} of ${pendingRows.length} records${selectedIds.size ? ` · ${selectedIds.size} selected` : ''}`}
            headerActions={canApprove && pendingRows.length > 0 ? (
              <div className='flex flex-wrap items-center gap-2'>
                {selectedIds.size > 0 && (
                  <>
                    <Button variant='secondary' size='sm' onClick={() => setSelectedIds(new Set())}>Clear</Button>
                    <Button size='sm' onClick={() => startBulk('SELECTED')}>Approve Selected ({selectedIds.size})</Button>
                  </>
                )}
                <Button size='sm' onClick={() => startBulk('ALL_FILTERED')} disabled={isBulkApproving}>Approve All With Confirmation ({pendingRows.length})</Button>
                <Button size='sm' variant='danger' onClick={approveAllNow} disabled={isBulkApproving} title='Approves every record in the current filters straight away. There is no confirmation and no undo.'>
                  {isBulkApproving ? 'Approving...' : `Approve All Without Confirmation (${pendingRows.length})`}
                </Button>
              </div>
            ) : undefined}
          >
            {pendingRows.length === 0 ? (
              <p className='p-6 text-center text-gray-500'>No records waiting for approval.</p>
            ) : (
              <>
                <ReviewTable
                  rows={pendingRows}
                  visible={pendingVisible}
                  selectable={canApprove}
                  selected={selectedIds}
                  allSelected={allSelected}
                  onToggle={toggleOne}
                  onToggleAll={toggleAll}
                  onView={openView}
                  onApprove={handleApprove}
                  actioningId={actioningId}
                  canApprove={canApprove}
                />
                <LoadMoreBar shown={Math.min(pendingVisible, pendingRows.length)} total={pendingRows.length} onMore={() => setPendingVisible(v => v + LOAD_STEP)} onRefresh={() => setPendingVisible(LOAD_STEP)} />
              </>
            )}
          </Card>

          {/* Approved Records */}
          <Card title='Approved Records' subtitle={`Showing ${Math.min(approvedRows.length, approvedVisible)} of ${approvedRows.length} records`}>
            {approvedRows.length === 0 ? (
              <p className='p-6 text-center text-gray-500'>No approved records for these filters.</p>
            ) : (
              <>
                <ReviewTable rows={approvedRows} visible={approvedVisible} onView={openView} showDecision />
                <LoadMoreBar shown={Math.min(approvedVisible, approvedRows.length)} total={approvedRows.length} onMore={() => setApprovedVisible(v => v + LOAD_STEP)} onRefresh={() => setApprovedVisible(LOAD_STEP)} />
              </>
            )}
          </Card>

          {/* Rejected Records */}
          <Card title='Rejected Records' subtitle={`Showing ${Math.min(rejectedRows.length, rejectedVisible)} of ${rejectedRows.length} records`}>
            {rejectedRows.length === 0 ? (
              <p className='p-6 text-center text-gray-500'>No rejected records for these filters.</p>
            ) : (
              <>
                <ReviewTable rows={rejectedRows} visible={rejectedVisible} onView={openView} showDecision />
                <LoadMoreBar shown={Math.min(rejectedVisible, rejectedRows.length)} total={rejectedRows.length} onMore={() => setRejectedVisible(v => v + LOAD_STEP)} onRefresh={() => setRejectedVisible(LOAD_STEP)} />
              </>
            )}
          </Card>
        </>
      )}

      {/* View dialog */}
      {viewRow && (
        <div className='fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4'>
          <div className='bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col'>
            <div className='flex items-center justify-between px-5 py-3 border-b'>
              <div className='flex items-center gap-2'>
                <h3 className='text-lg font-semibold'>Entry Details</h3>
                <ActionBadge action={viewRow.action_type} />
                <StatusBadge status={viewRow.review_status} />
              </div>
              <button type='button' onClick={() => setViewRow(null)} className='text-gray-500 hover:text-gray-800' aria-label='Close'><X className='w-5 h-5' /></button>
            </div>
            <div className='p-5 overflow-y-auto space-y-4'>
              <div className='grid grid-cols-2 md:grid-cols-4 gap-3 text-[14px]'>
                {[
                  ['Date', fmtDate(viewRow.transaction_date)],
                  ['Loan No', loanNoOf(viewRow)],
                  ['Receipt No', viewRow.receipt_number || '—'],
                  ['Customer', customerOf(viewRow)],
                  ['Type', displayHeadName(viewRow.transaction_type) || '—'],
                  ['Source', viewRow.source_type || '—'],
                  ['Entered By', viewRow.entered_by || '—'],
                  ['Entered At', fmtDate(viewRow.entered_at, 'dd/MM/yyyy hh:mm a')],
                  ['Decided By', viewRow.approved_by || '—'],
                  ['Decided At', fmtDate(viewRow.approved_at, 'dd/MM/yyyy hh:mm a')],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span className='block text-xs font-semibold text-gray-500'>{label}</span>
                    <span className='font-semibold text-gray-900'>{value}</span>
                  </div>
                ))}
              </div>

              <div className='grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3 tabular-nums'>
                <div><span className='block text-xs font-semibold text-gray-500'>Total Amount</span><span className='text-lg font-bold'>{fmtAmount(viewRow.amount)}</span></div>
                <div><span className='block text-xs font-semibold text-gray-500'>Principal</span><span className='text-lg font-semibold'>{fmtAmount(viewRow.principal_amount)}</span></div>
                <div><span className='block text-xs font-semibold text-gray-500'>Interest</span><span className='text-lg font-semibold text-amber-700'>{fmtAmount(viewRow.interest_amount)}</span></div>
                <div><span className='block text-xs font-semibold text-gray-500'>Penalty</span><span className='text-lg font-semibold text-rose-700'>{fmtAmount(viewRow.penalty_amount)}</span></div>
              </div>

              <div>
                <h4 className='text-sm font-semibold text-gray-800 flex items-center gap-1.5 mb-2'>
                  <Book className='w-4 h-4 text-indigo-500' /> Ledger / Cashbook Journal Entries
                </h4>
                {detailsLoading && !details[viewRow.id] ? (
                  <div className='flex items-center justify-center gap-2 py-4 text-gray-500'><Loader2 className='w-4 h-4 animate-spin' /> Loading journal details...</div>
                ) : !details[viewRow.id] || details[viewRow.id].length === 0 ? (
                  <p className='text-sm text-gray-500 py-2'>No detailed journal ledger records found for this transaction.</p>
                ) : (
                  <table className='fit-table border border-gray-200'>
                    <thead className='bg-gray-50'>
                      <tr>
                        <th className='px-2 py-2 text-left'>Date</th>
                        <th className='px-2 py-2 text-left'>Account Name</th>
                        <th className='px-2 py-2 text-left'>Particulars</th>
                        <th className='px-2 py-2 text-right'>Credit</th>
                        <th className='px-2 py-2 text-right'>Debit</th>
                        <th className='px-2 py-2 text-left'>Entered By</th>
                        <th className='px-2 py-2 text-center'>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details[viewRow.id].map((d: any, i: number) => (
                        <tr key={i} className='border-t border-gray-100'>
                          <td className='fit-nowrap px-2 py-1.5'>{fmtDate(d.date)}</td>
                          <td className='px-2 py-1.5 font-semibold'>{displayHeadName(d.account_name)}</td>
                          <td className='fit-particulars px-2 py-1.5'>{d.particulars}</td>
                          <td className='fit-nowrap px-2 py-1.5 text-right tabular-nums'>{d.credit > 0 ? fmtAmount(d.credit) : '-'}</td>
                          <td className='fit-nowrap px-2 py-1.5 text-right tabular-nums'>{d.debit > 0 ? fmtAmount(d.debit) : '-'}</td>
                          <td className='px-2 py-1.5 uppercase'>{d.entered_by}</td>
                          <td className='fit-nowrap px-2 py-1.5 text-center'><StatusBadge status={d.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <div className='flex justify-end gap-2 px-5 py-3 border-t'>
              {viewRow.review_status === 'PENDING' && canApprove && (
                <Button onClick={() => handleApprove(viewRow.id)} disabled={actioningId === viewRow.id}>Approve</Button>
              )}
              <Button variant='secondary' onClick={() => setViewRow(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk confirm */}
      {showBulkConfirm && (
        <div className='fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4'>
          <div className='bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden'>
            <div className='px-5 py-3 border-b'><h3 className='text-lg font-semibold'>Confirm Bulk Approval</h3></div>
            <div className='p-5 space-y-4'>
              <p className='text-sm text-gray-700'>You are about to approve <strong>{bulkTargetIds.length}</strong> transactions together.</p>
              <div className='bg-gray-50 rounded-lg p-3 border border-gray-200 text-sm space-y-1.5'>
                <div className='flex justify-between'><span className='font-semibold'>Create Actions:</span><span>{bulkBreakdown.createCount}</span></div>
                <div className='flex justify-between'><span className='font-semibold'>Edit Actions:</span><span>{bulkBreakdown.editCount}</span></div>
                <div className='flex justify-between'><span className='font-semibold'>Delete Actions:</span><span>{bulkBreakdown.deleteCount}</span></div>
                <div className='flex justify-between gap-3'><span className='font-semibold shrink-0'>Operator(s):</span><span className='text-right'>{bulkBreakdown.operators.join(', ') || 'N/A'}</span></div>
                <div className='flex justify-between gap-3'><span className='font-semibold shrink-0'>Date Range:</span><span className='text-right'>{bulkBreakdown.dateRange}</span></div>
              </div>
              <div className='bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm'>
                <p className='font-semibold flex items-center gap-2'><AlertCircle className='w-4 h-4' /> Ledger Rebuild</p>
                <p className='mt-1'>This will post all associated financial ledgers and recalculate the affected CD loans.</p>
              </div>
            </div>
            <div className='bg-gray-50 px-5 py-3 border-t flex justify-end gap-2'>
              <Button variant='secondary' onClick={() => setShowBulkConfirm(false)} disabled={isBulkApproving}>Cancel</Button>
              <Button onClick={() => runBulk(bulkTargetIds)} disabled={isBulkApproving}>{isBulkApproving ? 'Approving...' : 'Confirm Approve'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk result */}
      {bulkResult && (
        <div className='fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4'>
          <div className='bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden'>
            <div className={`px-5 py-3 text-white flex items-center justify-between ${bulkResult.failed > 0 ? 'bg-amber-600' : 'bg-emerald-600'}`}>
              <h3 className='font-semibold text-lg'>Bulk Approval Complete</h3>
              <button type='button' onClick={() => setBulkResult(null)} aria-label='Close'><X className='w-5 h-5' /></button>
            </div>
            <div className='p-5'>
              <div className='grid grid-cols-4 gap-3 mb-4 text-center'>
                {[
                  ['Requested', bulkResult.requested, 'text-gray-800'],
                  ['Approved', bulkResult.approved, 'text-emerald-700'],
                  ['Skipped', bulkResult.skipped, 'text-gray-500'],
                  ['Failed', bulkResult.failed, 'text-rose-700'],
                ].map(([label, value, tone]) => (
                  <div key={label as string} className='bg-gray-50 p-3 rounded-lg border border-gray-100'>
                    <div className={`text-2xl font-bold ${tone}`}>{value}</div>
                    <div className='text-xs font-semibold text-gray-500 mt-1'>{label}</div>
                  </div>
                ))}
              </div>
              {bulkResult.failures?.length > 0 && (
                <div>
                  <h4 className='text-sm font-semibold text-gray-700 mb-2'>Failure Details</h4>
                  <ul className='max-h-40 overflow-y-auto bg-rose-50 border border-rose-100 rounded-lg p-2 text-sm text-rose-800 space-y-1.5'>
                    {bulkResult.failures.map((f: any, i: number) => (
                      <li key={i}><span className='font-bold'>{f.receiptNo}:</span> {f.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className='bg-gray-50 px-5 py-3 border-t flex justify-end'>
              <Button onClick={() => setBulkResult(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Print */}
      <FinancePrintPreview
        isOpen={!!printMode}
        onClose={() => setPrintMode(null)}
        title='Approve Records'
        subtitle={`${fmtDate(fromDate)} to ${fmtDate(toDate)}`}
        documentTitle='APPROVE RECORDS'
      >
        {printSections.map(section => (
          <div key={section.title} className='mb-5'>
            <h3 className='font-bold text-sm mb-1'>{section.title} ({section.rows.length})</h3>
            <table className='w-full border-collapse text-[11px]'>
              <thead>
                <tr className='border-b-2 border-gray-800'>
                  <th className='text-left p-1'>S.No</th>
                  <th className='text-left p-1'>Date</th>
                  <th className='text-left p-1'>Loan</th>
                  <th className='text-left p-1'>Receipt</th>
                  <th className='text-left p-1'>Customer</th>
                  <th className='text-left p-1'>Type</th>
                  <th className='text-left p-1'>Action</th>
                  <th className='text-right p-1'>Amount</th>
                  <th className='text-left p-1'>By</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((r, i) => (
                  <tr key={r.id} className='border-b border-gray-300'>
                    <td className='p-1'>{i + 1}</td>
                    <td className='p-1 whitespace-nowrap'>{fmtDate(r.transaction_date)}</td>
                    <td className='p-1 whitespace-nowrap'>{loanNoOf(r)}</td>
                    <td className='p-1 whitespace-nowrap'>{r.receipt_number || '—'}</td>
                    <td className='p-1'>{customerOf(r)}</td>
                    <td className='p-1'>{displayHeadName(r.transaction_type)}</td>
                    <td className='p-1'>{r.action_type || 'CREATE'}</td>
                    <td className='p-1 text-right whitespace-nowrap'>{fmtAmount(r.amount)}</td>
                    <td className='p-1'>{r.entered_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </FinancePrintPreview>
    </div>
  );
};

export default FinanceApproveRecords;
