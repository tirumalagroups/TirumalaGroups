import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabaseFinance, FinanceTransactionReview } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import Card from '../../components/UI/Card';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { 
  Check, 
  Search, 
  RotateCcw, 
  FileCheck, 
  Loader2, 
  AlertCircle,
  Book,
  X,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronRight,
  Calendar
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { dailyFinancialTransactionService } from '../../services/dailyFinancialTransactionService';
import { displayHeadName } from '../../utils/financeLabels';

const TransactionApproval: React.FC = () => {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<FinanceTransactionReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Bulk Approval States
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [showBulkConfirmModal, setShowBulkConfirmModal] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterOperator, setFilterOperator] = useState('ALL');
  const [actionType, setActionType] = useState<'ALL' | 'EDIT' | 'DELETE' | 'CREATE'>('ALL');
  const [filterLoanType, setFilterLoanType] = useState('ALL');
  const [filterAccountNo, setFilterAccountNo] = useState('');
  const [filterReceiptNo, setFilterReceiptNo] = useState('');

  // Quick Transaction Date Navigation States & Popover Refs
  const [selectedTxDate, setSelectedTxDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [showHeaderCalendar, setShowHeaderCalendar] = useState(false);
  const [activityDates, setActivityDates] = useState<{ c_date: string }[]>([]);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const calendarRef = useRef<HTMLDivElement>(null);
  const calendarButtonRef = useRef<HTMLButtonElement>(null);

  const toggleCalendarPopover = () => {
    if (!showHeaderCalendar && calendarButtonRef.current) {
      const rect = calendarButtonRef.current.getBoundingClientRect();
      const calendarWidth = 310;
      const calendarHeight = 340;

      // X placement: align right edge of popover to right edge of button
      let left = rect.right - calendarWidth;
      if (left < 16) left = 16;
      if (left + calendarWidth > window.innerWidth - 16) {
        left = window.innerWidth - calendarWidth - 16;
      }

      // Y placement: open below button, or open above if bottom exceeds viewport
      let top = rect.bottom + 8;
      if (top + calendarHeight > window.innerHeight - 16) {
        top = rect.top - calendarHeight - 8;
        if (top < 16) top = 16;
      }

      setPopoverStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 99999,
      });
    }
    setShowHeaderCalendar((prev) => !prev);
  };

  // Close calendar popover on Click Outside or ESC key
  useEffect(() => {
    if (!showHeaderCalendar) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        calendarRef.current &&
        !calendarRef.current.contains(event.target as Node) &&
        calendarButtonRef.current &&
        !calendarButtonRef.current.contains(event.target as Node)
      ) {
        setShowHeaderCalendar(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHeaderCalendar(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showHeaderCalendar]);

  const fetchActivityDates = async () => {
    try {
      const dates = await supabaseFinance.getAllTransactionReviewDates();
      setActivityDates(dates || []);
    } catch (err) {
      console.error('Error loading review activity dates:', err);
    }
  };

  const handleTodayTxDate = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    setSelectedTxDate(todayStr);
    setFromDate(todayStr);
    setToDate(todayStr);
  };

  const handlePrevTxDate = () => {
    const sorted = Array.from(new Set(activityDates.map((a) => a.c_date))).sort();
    const earlier = sorted.filter((d) => d < selectedTxDate);
    if (earlier.length > 0) {
      const target = earlier[earlier.length - 1];
      setSelectedTxDate(target);
      setFromDate(target);
      setToDate(target);
    } else {
      const d = new Date(selectedTxDate);
      d.setDate(d.getDate() - 1);
      const prevStr = format(d, 'yyyy-MM-dd');
      setSelectedTxDate(prevStr);
      setFromDate(prevStr);
      setToDate(prevStr);
    }
  };

  const handleNextTxDate = () => {
    const sorted = Array.from(new Set(activityDates.map((a) => a.c_date))).sort();
    const later = sorted.filter((d) => d > selectedTxDate);
    if (later.length > 0) {
      const target = later[0];
      setSelectedTxDate(target);
      setFromDate(target);
      setToDate(target);
    } else {
      const d = new Date(selectedTxDate);
      d.setDate(d.getDate() + 1);
      const nextStr = format(d, 'yyyy-MM-dd');
      setSelectedTxDate(nextStr);
      setFromDate(nextStr);
      setToDate(nextStr);
    }
  };

  const handleSelectCalendarDate = (dateStr: string) => {
    setSelectedTxDate(dateStr);
    setFromDate(dateStr);
    setToDate(dateStr);
    setShowHeaderCalendar(false);
  };

  // Operators List & Summary Counts States
  const [operators, setOperators] = useState<string[]>([]);
  const [summaryCounts, setSummaryCounts] = useState({
    pending: 0,
    editPending: 0,
    deletePending: 0,
    approvedToday: 0
  });

  const fetchOperators = async () => {
    try {
      const { data, error } = await supabase
        .from('finance_transaction_reviews')
        .select('entered_by');
      if (error) throw error;
      const uniqueOps = Array.from(new Set((data || []).map(r => r.entered_by).filter(Boolean)));
      setOperators(uniqueOps as string[]);
    } catch (err) {
      console.error('Error loading operators:', err);
    }
  };

  const fetchSummaryCounts = async () => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('finance_transaction_reviews')
        .select('review_status, action_type, approved_at');

      if (error) throw error;

      let pending = 0;
      let editPending = 0;
      let deletePending = 0;
      let approvedToday = 0;

      (data || []).forEach(r => {
        if (r.review_status === 'PENDING') {
          pending++;
          if (r.action_type === 'EDIT') {
            editPending++;
          } else if (r.action_type === 'DELETE') {
            deletePending++;
          }
        } else if (r.review_status === 'APPROVED' && r.approved_at && new Date(r.approved_at) >= todayStart) {
          approvedToday++;
        }
      });

      setSummaryCounts({ pending, editPending, deletePending, approvedToday });
    } catch (err) {
      console.error('Error fetching summary counts:', err);
    }
  };

  const fetchReviews = async () => {
    try {
      setLoading(true);
      setQueryError(null);
      const data = await supabaseFinance.getTransactionReviews({
        status: statusFilter,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        enteredBy: filterOperator !== 'ALL' && filterOperator.trim() ? filterOperator : undefined,
        loanType: filterLoanType !== 'ALL' ? filterLoanType : undefined,
        accountNo: filterAccountNo.trim() || undefined,
        receiptNo: filterReceiptNo.trim() || undefined,
        actionType: actionType !== 'ALL' ? actionType : undefined
      });
      setReviews(data);
    } catch (err: any) {
      console.error('Error fetching transaction reviews:', err);
      setQueryError(err?.message || 'Failed to load transaction reviews');
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  const [oldestDate, setOldestDate] = useState('2020-01-01');

  useEffect(() => {
    const initDates = async () => {
      const oldest = await dailyFinancialTransactionService.getOldestTransactionDate();
      const initialOldest = oldest || '2020-01-01';
      setOldestDate(initialOldest);
      setFromDate(initialOldest);
      setToDate(new Date().toISOString().split('T')[0]);
    };
    initDates();
  }, []);

  // Clear stale selections on filter changes
  useEffect(() => {
    setSelectedReviewIds(new Set());
  }, [statusFilter, fromDate, toDate, filterOperator, actionType, filterLoanType]);

  // Fetch reviews on dependencies change
  useEffect(() => {
    fetchReviews();
    fetchOperators();
    fetchSummaryCounts();
    fetchActivityDates();
  }, [statusFilter, fromDate, toDate, filterOperator, actionType, filterLoanType]);

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReviews();
  };

  const handleResetFilters = () => {
    setFromDate(oldestDate);
    setToDate(new Date().toISOString().split('T')[0]);
    setFilterOperator('ALL');
    setActionType('ALL');
    setStatusFilter('PENDING');
    setFilterLoanType('ALL');
    setFilterAccountNo('');
    setFilterReceiptNo('');
  };

  const [expandedReviewIds, setExpandedReviewIds] = useState<Set<string>>(new Set());
  const [reviewDetails, setReviewDetails] = useState<Record<string, any[]>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});

  const toggleExpandReview = async (reviewId: string) => {
    const next = new Set(expandedReviewIds);
    if (next.has(reviewId)) {
      next.delete(reviewId);
    } else {
      next.add(reviewId);
      if (!reviewDetails[reviewId]) {
        setLoadingDetails(prev => ({ ...prev, [reviewId]: true }));
        try {
          const details = await supabaseFinance.getTransactionReviewDetails(reviewId);
          setReviewDetails(prev => ({ ...prev, [reviewId]: details }));
        } catch (err) {
          console.error(err);
        } finally {
          setLoadingDetails(prev => ({ ...prev, [reviewId]: false }));
        }
      }
    }
    setExpandedReviewIds(next);
  };

  const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);

  const handleApprove = async (reviewId: string) => {
    if (!user?.is_admin) {
      toast.error('Access Denied: Only administrators can approve transactions.');
      return;
    }

    if (!window.confirm('Are you sure you want to approve this transaction?')) {
      return;
    }

    try {
      setActioningId(reviewId);
      const success = await supabaseFinance.approveTransactionReview(reviewId, user.username);
      if (success) {
        toast.success('Transaction approved successfully');
        // Refresh review list and summary counts
        fetchReviews();
        fetchSummaryCounts();
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

  const handleSelectToggle = (reviewId: string) => {
    const next = new Set(selectedReviewIds);
    if (next.has(reviewId)) {
      next.delete(reviewId);
    } else {
      next.add(reviewId);
    }
    setSelectedReviewIds(next);
  };

  const handleSelectAll = () => {
    const pendingIds = reviews.filter(r => r.review_status === 'PENDING').map(r => r.id);
    const allSelected = pendingIds.every(id => selectedReviewIds.has(id));
    if (allSelected && pendingIds.length > 0) {
      const next = new Set(selectedReviewIds);
      pendingIds.forEach(id => next.delete(id));
      setSelectedReviewIds(next);
    } else {
      const next = new Set(selectedReviewIds);
      pendingIds.forEach(id => next.add(id));
      setSelectedReviewIds(next);
    }
  };

  const handleBulkApproveConfirm = (mode: 'SELECTED' | 'ALL_FILTERED') => {
    if (!user?.is_admin) {
      toast.error('Access Denied: Only administrators can bulk approve transactions.');
      return;
    }
    
    const targets = mode === 'SELECTED'
      ? Array.from(selectedReviewIds)
      : reviews.filter(r => r.review_status === 'PENDING').map(r => r.id);
      
    if (targets.length === 0) {
      toast.error('No pending transactions available to approve.');
      return;
    }
    
    setBulkTargetIds(targets);
    setShowBulkConfirmModal(true);
  };

  const executeBulkApproval = async () => {
    try {
      setIsBulkApproving(true);
      const result = await supabaseFinance.approveTransactionsBulk({
        transactionIds: bulkTargetIds,
        approvedBy: user?.username || 'System'
      });
      
      setBulkResult(result);
      setSelectedReviewIds(new Set());
      setBulkTargetIds([]);
      fetchReviews();
      fetchSummaryCounts();
    } catch (err: any) {
      console.error('Bulk approval failed:', err);
      toast.error(err.message || 'Bulk approval failed unexpectedly');
    } finally {
      setIsBulkApproving(false);
      setShowBulkConfirmModal(false);
    }
  };

  const handleReject = async (reviewId: string) => {
    if (!user?.is_admin) {
      toast.error('Access Denied: Only administrators can reject transactions.');
      return;
    }

    if (!window.confirm('Are you sure you want to REJECT this transaction?')) {
      return;
    }

    try {
      setActioningId(reviewId);
      const success = await supabaseFinance.rejectTransactionReview(reviewId, user.username);
      if (success) {
        toast.success('Transaction review status marked as REJECTED');
        fetchReviews();
        fetchSummaryCounts();
      } else {
        toast.error('Failed to reject transaction');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error occurred during rejection');
    } finally {
      setActioningId(null);
    }
  };

  const formatCurrency = (val: number | undefined) => {
    if (val === undefined) return '0.00';
    return val.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatCompactCurrency = (val: number | undefined) => {
    if (val === undefined || val === 0) return '0';
    const hasDecimals = val % 1 !== 0;
    return `${val.toLocaleString('en-IN', {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: hasDecimals ? 2 : 0,
    })}`;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto font-outfit select-none">
           {/* Header with Inline Quick Transaction Date Navigation */}
      <div>
        <span className="text-slate-500 finance-caption uppercase">ADMIN PANEL</span>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mt-1">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="finance-h1 text-[#0f172a] flex items-center gap-2">
              <FileCheck className="w-7 h-7 text-[#0f172a]" />
              TRANSACTION APPROVALS
            </h1>

            {/* Quick Transaction Date Navigator (Inline beside Title) */}
            <div className="flex items-center gap-1.5 relative">
              {/* TODAY Button */}
              <button
                type="button"
                onClick={handleTodayTxDate}
                className="px-3 h-9 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                TODAY
              </button>

              {/* PREVIOUS DAY Button (<) */}
              <button
                type="button"
                onClick={handlePrevTxDate}
                title="Previous Day"
                className="w-9 h-9 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-lg flex items-center justify-center shadow-2xs transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* NEXT DAY Button (>) */}
              <button
                type="button"
                onClick={handleNextTxDate}
                title="Next Day"
                className="w-9 h-9 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-lg flex items-center justify-center shadow-2xs transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* CALENDAR DISPLAY Button (📅 23/07/2026) */}
              <button
                ref={calendarButtonRef}
                type="button"
                onClick={toggleCalendarPopover}
                className="px-3 h-9 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-extrabold text-xs font-mono rounded-lg flex items-center gap-2 shadow-2xs transition-colors cursor-pointer"
              >
                <Calendar className="w-4 h-4 text-indigo-600" />
                <span>{format(new Date(selectedTxDate), 'dd/MM/yyyy')}</span>
              </button>

              {/* CustomCalendar Floating Popover (Fixed Overlay) */}
              {showHeaderCalendar && (
                <div
                  ref={calendarRef}
                  style={popoverStyle}
                  className="animate-in fade-in zoom-in-95 duration-150 drop-shadow-2xl z-50 bg-white rounded-xl p-2 border border-slate-200"
                >
                  <FinanceSmartCalendar
                    mode="inline"
                    value={selectedTxDate}
                    onChange={(d) => { handleSelectCalendarDate(d); setShowHeaderCalendar(false); }}
                    module="TRANSACTION_APPROVAL"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="text-slate-400 finance-small-label uppercase mt-1">
          Verify and approve operator-entered financial transactions
        </p>
      </div>

      {/* Summary Cards (Interactive Quick Filters) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Pending Card */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('PENDING');
            setActionType('ALL');
            setFilterOperator('ALL');
            setFromDate(oldestDate);
            setToDate(new Date().toISOString().split('T')[0]);
          }}
          className={`text-left rounded-xl p-4 transition-all duration-150 cursor-pointer shadow-sm border ${
            statusFilter === 'PENDING' && actionType === 'ALL'
              ? 'bg-amber-100/90 border-amber-400 ring-2 ring-amber-500 shadow-md scale-[1.01]'
              : 'bg-amber-50/70 border-amber-100 hover:bg-amber-100/50 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-slate-600 text-xs font-bold uppercase tracking-wider">Total Pending</span>
            {statusFilter === 'PENDING' && actionType === 'ALL' && (
              <span className="text-[10px] font-extrabold bg-amber-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">ACTIVE</span>
            )}
          </div>
          <span className="text-2xl font-black text-amber-900 mt-2 block">{summaryCounts.pending}</span>
        </button>

        {/* Edit Pending Card */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('PENDING');
            setActionType('EDIT');
            setFilterOperator('ALL');
            setFromDate(oldestDate);
            setToDate(new Date().toISOString().split('T')[0]);
          }}
          className={`text-left rounded-xl p-4 transition-all duration-150 cursor-pointer shadow-sm border ${
            statusFilter === 'PENDING' && actionType === 'EDIT'
              ? 'bg-blue-100/90 border-blue-400 ring-2 ring-blue-500 shadow-md scale-[1.01]'
              : 'bg-blue-50/70 border-blue-100 hover:bg-blue-100/50 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-slate-600 text-xs font-bold uppercase tracking-wider">Edit Pending</span>
            {statusFilter === 'PENDING' && actionType === 'EDIT' && (
              <span className="text-[10px] font-extrabold bg-blue-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">ACTIVE</span>
            )}
          </div>
          <span className="text-2xl font-black text-blue-900 mt-2 block">{summaryCounts.editPending}</span>
        </button>

        {/* Delete Pending Card */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('PENDING');
            setActionType('DELETE');
            setFilterOperator('ALL');
            setFromDate(oldestDate);
            setToDate(new Date().toISOString().split('T')[0]);
          }}
          className={`text-left rounded-xl p-4 transition-all duration-150 cursor-pointer shadow-sm border ${
            statusFilter === 'PENDING' && actionType === 'DELETE'
              ? 'bg-rose-100/90 border-rose-400 ring-2 ring-rose-500 shadow-md scale-[1.01]'
              : 'bg-rose-50/70 border-rose-100 hover:bg-rose-100/50 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-slate-600 text-xs font-bold uppercase tracking-wider">Delete Pending</span>
            {statusFilter === 'PENDING' && actionType === 'DELETE' && (
              <span className="text-[10px] font-extrabold bg-rose-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">ACTIVE</span>
            )}
          </div>
          <span className="text-2xl font-black text-rose-900 mt-2 block">{summaryCounts.deletePending}</span>
        </button>

        {/* Approved Today Card */}
        <button
          type="button"
          onClick={() => {
            const todayStr = new Date().toISOString().split('T')[0];
            setStatusFilter('APPROVED');
            setActionType('ALL');
            setFilterOperator('ALL');
            setFromDate(todayStr);
            setToDate(todayStr);
          }}
          className={`text-left rounded-xl p-4 transition-all duration-150 cursor-pointer shadow-sm border ${
            statusFilter === 'APPROVED'
              ? 'bg-emerald-100/90 border-emerald-400 ring-2 ring-emerald-500 shadow-md scale-[1.01]'
              : 'bg-emerald-50/70 border-emerald-100 hover:bg-emerald-100/50 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-slate-600 text-xs font-bold uppercase tracking-wider">Approved Today</span>
            {statusFilter === 'APPROVED' && (
              <span className="text-[10px] font-extrabold bg-emerald-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">ACTIVE</span>
            )}
          </div>
          <span className="text-2xl font-black text-emerald-900 mt-2 block">{summaryCounts.approvedToday}</span>
        </button>
      </div>

      {/* Filter Section */}
      <div className="bg-white rounded-xl border border-slate-150 shadow-sm p-5 space-y-5">
        
        {/* Filter Inputs Form */}
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          
          <div>
            <FinanceSmartCalendar
              label="From Date"
              value={fromDate}
              onChange={setFromDate}
              module="TRANSACTION_APPROVAL"
            />
          </div>

          <div>
            <FinanceSmartCalendar
              label="To Date"
              value={toDate}
              onChange={setToDate}
              module="TRANSACTION_APPROVAL"
            />
          </div>

          <div>
            <label className="finance-caption uppercase">Operator</label>
            <select
              value={filterOperator}
              onChange={(e) => setFilterOperator(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none h-10 shadow-sm finance-header-time"
            >
              <option value="ALL">ALL OPERATORS</option>
              {operators.map((op) => (
                <option key={op} value={op}>
                  {op.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="finance-caption uppercase">Action Type</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value as any)}
              className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none h-10 shadow-sm finance-header-time"
            >
              <option value="ALL">ALL</option>
              <option value="CREATE">CREATE</option>
              <option value="EDIT">EDIT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <div>
            <label className="finance-caption uppercase">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none h-10 shadow-sm finance-header-time"
            >
              <option value="PENDING">PENDING</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="ALL">ALL</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 bg-[#0f172a] text-white hover:bg-slate-800 h-10 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-1 shadow-sm transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              Search
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="bg-slate-100 hover:bg-slate-250 text-slate-600 h-10 w-10 rounded-lg flex items-center justify-center transition-colors shadow-inner"
              title="Reset Filters"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

        </form>
      </div>

      {/* Bulk Action Bar (Only show on PENDING tab when there are results) */}
      {statusFilter === 'PENDING' && reviews.length > 0 && !loading && !queryError && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 px-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={handleSelectAll}
              className="w-5 h-5 rounded border border-indigo-300 flex items-center justify-center bg-white text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all"
            >
              {selectedReviewIds.size > 0 && (
                selectedReviewIds.size === reviews.filter(r => r.review_status === 'PENDING').length 
                  ? <Check className="w-3.5 h-3.5 font-bold" />
                  : <div className="w-2.5 h-2.5 bg-indigo-500 rounded-sm" />
              )}
            </button>
            <span className="text-sm font-bold text-indigo-900 uppercase tracking-wide">
              {selectedReviewIds.size > 0 
                ? `${selectedReviewIds.size} Selected` 
                : `Showing ${reviews.filter(r => r.review_status === 'PENDING').length} Pending Transactions`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {selectedReviewIds.size > 0 && (
              <>
                <button
                  onClick={() => setSelectedReviewIds(new Set())}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 uppercase px-3 py-1.5 transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={() => handleBulkApproveConfirm('SELECTED')}
                  className="bg-indigo-600 hover:bg-indigo-750 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  APPROVE SELECTED ({selectedReviewIds.size})
                </button>
              </>
            )}
            <button
              onClick={() => handleBulkApproveConfirm('ALL_FILTERED')}
              className="bg-[#0f172a] hover:bg-slate-800 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              APPROVE ALL FILTERED ({reviews.filter(r => r.review_status === 'PENDING').length})
            </button>
          </div>
        </div>
      )}

      {/* Main List Table / Card */}
      <Card className="shadow-sm border-slate-150 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
            <span className="text-slate-400 finance-header-time uppercase">Loading reviews...</span>
          </div>
        ) : queryError ? (
          <div className="p-8 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center border border-red-100 shadow-inner">
              <AlertCircle className="w-7 h-7 text-red-500" />
            </div>
            <div>
              <h3 className="font-bold text-red-800 text-lg uppercase tracking-wide">Query Error</h3>
              <p className="text-slate-500 text-sm max-w-lg mt-1 mx-auto">
                {queryError.includes('relation') && queryError.includes('does not exist')
                  ? 'The transaction reviews table does not exist in the database yet. Please run the migration file "20260705180000_create_transaction_reviews.sql" in your Supabase SQL Editor.'
                  : queryError}
              </p>
            </div>
          </div>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100 shadow-inner">
              <FileCheck className="w-7 h-7 text-slate-350" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg uppercase tracking-wide">No Transactions Found</h3>
              <p className="text-slate-500 text-sm max-w-sm mt-1 font-medium">
                No transaction approvals found for {fromDate === toDate && fromDate ? format(new Date(fromDate), 'dd/MM/yyyy') : 'the selected date'}.
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse table-fixed text-xs">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  {statusFilter === 'PENDING' && (
                    <th className="w-10 px-2 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={
                          selectedReviewIds.size === reviews.filter(r => r.review_status === 'PENDING').length &&
                          reviews.filter(r => r.review_status === 'PENDING').length > 0
                        }
                        onChange={handleSelectAll}
                        className="h-4.5 w-4.5 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="w-10 px-2 py-2.5 text-center">#</th>
                  <th className="px-3 py-2.5">Transaction Details</th>
                  <th className="w-32 px-3 py-2.5 text-right">Amount</th>
                  <th className="w-28 px-3 py-2.5">Entered By</th>
                  <th className="w-28 px-2 py-2.5 text-center">Status</th>
                  <th className="w-64 px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reviews.map((item, index) => {
                  const isExpanded = expandedReviewIds.has(item.id);
                  const details = reviewDetails[item.id] || [];
                  const isDetailsLoading = loadingDetails[item.id];
                  
                  const customerName = (item as any).finance_loans?.customer?.name || 'Manual Daybook Entry';
                  const refNo = item.receipt_number || (item as any).finance_loans?.loan_id || (item.loan_id ? `ID:${item.loan_id}` : 'RC2258');

                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        onClick={() => toggleExpandReview(item.id)}
                        title="Click row to expand/collapse details"
                        className={`transition-colors cursor-pointer select-none even:bg-slate-50/50 odd:bg-white hover:bg-slate-100/90 ${
                          selectedReviewIds.has(item.id) ? '!bg-indigo-50/90' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        {statusFilter === 'PENDING' && (
                          <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedReviewIds.has(item.id)}
                              onChange={() => handleSelectToggle(item.id)}
                              className="h-4.5 w-4.5 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
                            />
                          </td>
                        )}

                        {/* S.No */}
                        <td className="px-2 py-3 text-center font-mono font-black text-slate-900 text-sm">
                          {index + 1}
                        </td>

                        {/* Transaction Details Hierarchy */}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col min-w-0">
                            {/* Primary (Bold Ref / CD) */}
                            <span className="text-sm font-black font-mono text-blue-700 tracking-tight uppercase">
                              {refNo}
                            </span>
                            {/* Secondary (Customer / Entry Name) */}
                            <span className="text-xs font-bold text-slate-900 uppercase truncate mt-0.5">
                              {customerName}
                            </span>
                            {/* Muted Text + Prominent Bold Date */}
                            <div className="text-xs font-medium text-slate-600 truncate mt-0.5 flex items-center gap-1">
                              <span>{item.transaction_type}</span>
                              <span className="text-slate-400 font-bold">•</span>
                              <span className="text-xs font-black text-slate-900 font-mono tracking-tight">
                                {format(new Date(item.transaction_date), 'dd-MMM-yyyy')}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Amount */}
                        <td className="px-3 py-2.5 text-right font-mono">
                          <span className="text-sm font-black text-slate-900">
                            {formatCompactCurrency(item.amount)}
                          </span>
                        </td>

                        {/* Operator & Prominent Time */}
                        <td className="px-3 py-2.5 font-mono">
                          <div className="flex flex-col leading-tight">
                            <span className="font-bold text-slate-800 text-xs uppercase truncate">
                              {item.entered_by.toUpperCase()}
                            </span>
                            <span className="text-xs font-black text-indigo-700 font-mono mt-0.5 uppercase">
                              {format(new Date(item.entered_at), 'hh:mm a')}
                            </span>
                          </div>
                        </td>

                        {/* Status Pill */}
                        <td className="px-2 py-2.5 text-center">
                          {item.review_status === 'APPROVED' ? (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-2xs uppercase">
                              Approved
                            </span>
                          ) : item.review_status === 'REJECTED' ? (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200 shadow-2xs uppercase">
                              Rejected
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200 shadow-2xs uppercase">
                              Pending
                            </span>
                          )}
                        </td>

                        {/* Actions (Order: View -> Approve -> Delete) */}
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {/* 1. VIEW Button */}
                            <button
                              onClick={() => toggleExpandReview(item.id)}
                              title={isExpanded ? 'Hide Details' : 'View Details'}
                              className={`min-h-[36px] px-3 font-bold text-xs rounded-lg inline-flex items-center gap-1.5 transition-colors uppercase border cursor-pointer ${
                                isExpanded
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300/80'
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </button>

                            {item.review_status === 'PENDING' && (
                              <>
                                {/* 2. APPROVE Button */}
                                <button
                                  onClick={() => handleApprove(item.id)}
                                  disabled={actioningId === item.id}
                                  title="Approve Transaction"
                                  className="min-h-[36px] px-3 font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg inline-flex items-center gap-1.5 shadow-sm transition-colors uppercase disabled:opacity-50 cursor-pointer"
                                >
                                  {actioningId === item.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  Approve
                                </button>

                                {/* 3. DELETE Button */}
                                <button
                                  onClick={() => handleReject(item.id)}
                                  disabled={actioningId === item.id}
                                  title="Delete / Reject Transaction"
                                  className="min-h-[36px] px-3 font-bold text-xs bg-rose-600 hover:bg-rose-700 text-white rounded-lg inline-flex items-center gap-1.5 shadow-sm transition-colors uppercase disabled:opacity-50 cursor-pointer"
                                >
                                  {actioningId === item.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* View Details Sub-table */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={statusFilter === 'PENDING' ? 7 : 6} className="px-5 py-4 border-b border-slate-200">
                            <div className="space-y-3">
                              {/* Financial Amount Breakdown Banner */}
                              <div className="bg-white p-3.5 border border-slate-200 rounded-xl shadow-2xs text-xs font-mono">
                                <h5 className="font-bold text-slate-800 uppercase text-[11px] tracking-wider mb-2">Financial Breakdown</h5>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-slate-700">
                                  <div>
                                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Amount</span>
                                    <span className="font-black text-slate-900 text-sm">{formatCompactCurrency(item.amount)}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Principal</span>
                                    <span className="font-bold text-slate-800">{formatCompactCurrency(item.principal_amount || 0)}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Interest</span>
                                    <span className="font-bold text-amber-700">{formatCompactCurrency(item.interest_amount || 0)}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Penalty</span>
                                    <span className="font-bold text-rose-700">{formatCompactCurrency(item.penalty_amount || 0)}</span>
                                  </div>
                                </div>
                              </div>

                              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <Book className="w-4 h-4 text-indigo-500" />
                                Ledger / Cashbook Journal Entries Splits
                              </h4>
                              {isDetailsLoading ? (
                                <div className="flex items-center gap-2 py-4 justify-center text-slate-400">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span className="text-xs font-semibold uppercase tracking-wider">Loading journal details...</span>
                                </div>
                              ) : details.length === 0 ? (
                                <p className="text-xs text-slate-500 italic py-2 pl-4">No detailed journal ledger records found for this transaction.</p>
                              ) : (
                                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-inner bg-white">
                                  <table className="min-w-full divide-y divide-slate-100 text-xs">
                                    <thead className="bg-slate-50">
                                      <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        <th className="px-4 py-2.5 text-left">Date</th>
                                        <th className="px-4 py-2.5 text-left">Account Name</th>
                                        <th className="px-4 py-2.5 text-left">Particulars</th>
                                        <th className="px-4 py-2.5 text-right">Credit</th>
                                        <th className="px-4 py-2.5 text-right">Debit</th>
                                        <th className="px-4 py-2.5 text-left">Entered By</th>
                                        <th className="px-4 py-2.5 text-center">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                                      {details.map((detail: any, dIdx: number) => (
                                        <tr key={dIdx} className="hover:bg-slate-50/50 transition-colors">
                                          <td className="px-4 py-2 font-sans">{format(new Date(detail.date), 'dd/MM/yyyy')}</td>
                                          <td className="px-4 py-2 font-sans font-black text-indigo-900">{displayHeadName(detail.account_name)}</td>
                                          <td className="px-4 py-2 font-sans text-slate-500 font-bold">{detail.particulars}</td>
                                          <td className="px-4 py-2 text-right font-bold text-slate-900">{detail.credit > 0 ? formatCurrency(detail.credit) : '-'}</td>
                                          <td className="px-4 py-2 text-right font-bold text-slate-900">{detail.debit > 0 ? formatCurrency(detail.debit) : '-'}</td>
                                          <td className="px-4 py-2 font-sans font-semibold uppercase text-[10px] text-slate-650">{detail.entered_by}</td>
                                          <td className="px-4 py-2 text-center font-sans">
                                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                                              detail.status === 'APPROVED'
                                                ? 'bg-green-50 text-green-700 border border-green-200'
                                                : detail.status === 'REJECTED'
                                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                                            }`}>
                                              {detail.status}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Bulk Confirm Modal */}
      {showBulkConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-indigo-600 p-5 text-white flex items-center gap-3">
              <Check className="w-6 h-6" />
              <h3 className="font-bold text-lg">Confirm Bulk Approval</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-600 text-sm">
                You are about to approve <strong>{selectedReviewIds.size > 0 ? selectedReviewIds.size : reviews.filter(r => r.review_status === 'PENDING').length}</strong> transactions simultaneously.
              </p>
              
              {/* Detailed breakdown section */}
              {(() => {
                const targetIds = selectedReviewIds.size > 0 ? Array.from(selectedReviewIds) : reviews.filter(r => r.review_status === 'PENDING').map(r => r.id);
                const getBulkBreakdown = (ids: string[]) => {
                  const targets = reviews.filter(r => ids.includes(r.id));
                  const editCount = targets.filter(r => r.action_type === 'EDIT').length;
                  const deleteCount = targets.filter(r => r.action_type === 'DELETE').length;
                  const createCount = targets.filter(r => !r.action_type || r.action_type === 'CREATE').length;
                  const distinctOps = Array.from(new Set(targets.map(r => r.entered_by).filter(Boolean)));
                  const dates = targets.map(r => r.transaction_date).filter(Boolean).sort();
                  const dateRange = dates.length > 0 
                    ? (dates[0] === dates[dates.length - 1] ? format(new Date(dates[0]), 'dd MMM yyyy') : `${format(new Date(dates[0]), 'dd MMM yyyy')} to ${format(new Date(dates[dates.length - 1]), 'dd MMM yyyy')}`)
                    : 'N/A';
                  return { editCount, deleteCount, createCount, distinctOps, dateRange };
                };
                const breakdown = getBulkBreakdown(targetIds);
                return (
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2 text-slate-700">
                    <div className="flex justify-between">
                      <span className="font-bold">CREATE Actions:</span>
                      <span>{breakdown.createCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-bold">EDIT Actions:</span>
                      <span>{breakdown.editCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-bold">DELETE Actions:</span>
                      <span>{breakdown.deleteCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-bold">Operator(s):</span>
                      <span className="truncate max-w-[200px]" title={breakdown.distinctOps.join(', ')}>
                        {breakdown.distinctOps.join(', ') || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-bold">Date Range:</span>
                      <span>{breakdown.dateRange}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-amber-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Warning: Idempotent Ledger Rebuild
                </p>
                <p className="text-amber-700 text-xs mt-1">
                  This action will post all associated financial ledgers and execute chronological CD loan recalculations for affected accounts.
                </p>
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setShowBulkConfirmModal(false)}
                disabled={isBulkApproving}
                className="px-4 py-2 text-slate-500 hover:text-slate-700 font-bold text-sm uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                onClick={executeBulkApproval}
                disabled={isBulkApproving}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-bold text-sm uppercase tracking-wider flex items-center gap-2 transition-colors shadow-sm"
              >
                {isBulkApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {isBulkApproving ? 'Approving...' : 'Confirm Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Result Modal */}
      {bulkResult && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className={`p-5 text-white flex items-center justify-between ${bulkResult.failed > 0 ? 'bg-amber-600' : 'bg-emerald-600'}`}>
              <div className="flex items-center gap-3">
                {bulkResult.failed > 0 ? <AlertCircle className="w-6 h-6" /> : <Check className="w-6 h-6" />}
                <h3 className="font-bold text-lg">Bulk Approval Complete</h3>
              </div>
              <button onClick={() => setBulkResult(null)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                  <div className="text-2xl font-black text-slate-800">{bulkResult.requested}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Requested</div>
                </div>
                <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center">
                  <div className="text-2xl font-black text-emerald-700">{bulkResult.approved}</div>
                  <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mt-1">Approved</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                  <div className="text-2xl font-black text-slate-500">{bulkResult.skipped}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Skipped</div>
                </div>
                <div className="bg-rose-50 p-3 rounded-lg border border-rose-100 text-center">
                  <div className="text-2xl font-black text-rose-700">{bulkResult.failed}</div>
                  <div className="text-[10px] font-bold text-rose-600 uppercase tracking-wider mt-1">Failed</div>
                </div>
              </div>

              {bulkResult.failures.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Failure Details</h4>
                  <div className="max-h-40 overflow-y-auto bg-rose-50 border border-rose-100 rounded-lg p-2">
                    <ul className="text-xs text-rose-800 space-y-2">
                      {bulkResult.failures.map((f: any, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="font-bold shrink-0">{f.receiptNo}:</span>
                          <span>{f.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
            
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setBulkResult(null)}
                className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-2 rounded-lg font-bold text-sm uppercase tracking-wider transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TransactionApproval;
