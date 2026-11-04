import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import { financeCalculationService } from '../../services/financeCalculationService';
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { supabaseFinance, FinanceLoanPaymentFollowup } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import { 
  ArrowLeft, 
  Printer, 
  Search,
  MessageSquare
} from 'lucide-react';
import toast from 'react-hot-toast';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { useAuth } from '../../contexts/AuthContext';
import VoiceRecorder from '../../components/finance/VoiceRecorder';
import { convertTextToTelugu, hasEnglishLetters } from '../../utils/telugu';

interface ActiveDueLoan {
  id: string;
  loanId: string;
  customerName: string;
  loanCategory: string;
  loanType: 'CD' | 'HP' | 'STBD' | 'TBD';
  loanAmount: number;
  currentPrincipal: number;
  loanDate: string;
  currentDueDate: string;
  pendingInterest: number;
  penalty: number;
  presentDue: number;
  dueDays: number;
  phone: string;
  g1Name: string;
  g1Phone: string;
  g2Name: string;
  g2Phone: string;
  partnerName: string;
  status: string;
  customerId?: string;
  guarantor1Id?: string;
  guarantor2Id?: string;
  // Follow up state
  lastFollowUp?: FinanceLoanPaymentFollowup;
  nextFollowUpDate: string | null;
  activePendingAction?: any;
}

type FollowUpTab = 'ACTIVE_QUEUE' | 'TODAYS' | 'UPCOMING' | 'MISSED' | 'HISTORY';

// Simple Close Icon mapping
const XIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    fill="none" 
    viewBox="0 0 24 24" 
    strokeWidth={2} 
    stroke="currentColor" 
    className="w-5 h-5"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export const CALLBACK_RESULTS = [
  'CALL BACK',
  'NO ANSWER',
  'ANSWERED',
  'BUSY',
  'SWITCHED OFF',
  'REQUESTED LATER'
];

export const TERMINAL_OUTCOMES = [
  'PAID_CLOSED',
  'WRONG NUMBER',
  'NUMBER_DOESNT_EXIST',
  'LOAN_CLOSED',
  'CUSTOMER_DECEASED',
  'DUPLICATE_ENTRY'
];

const PaymentFollowUp: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Loading and Data States
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<ActiveDueLoan[]>([]);
  const [followUps, setFollowUps] = useState<FinanceLoanPaymentFollowup[]>([]);
  const [duesError, setDuesError] = useState<string | null>(null);
  const [followUpsError, setFollowUpsError] = useState<string | null>(null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<FollowUpTab>('ACTIVE_QUEUE');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState<'ALL' | 'CD' | 'HP' | 'STBD' | 'TBD'>('ALL');
  const [staffFilter, setStaffFilter] = useState<string>('ALL STAFF');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Follow-up Form Modal State
  const [selectedLoan, setSelectedLoan] = useState<ActiveDueLoan | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [g1Details, setG1Details] = useState<any>(null);
  const [g2Details, setG2Details] = useState<any>(null);
  const [loadingContactDetails, setLoadingContactDetails] = useState(false);

  // Modal Dashboard State variables for fresh fetches
  const [cdLedgerEntries, setCdLedgerEntries] = useState<any[]>([]);
  const [cdInterestDetails, setCdInterestDetails] = useState<any[]>([]);
  const [loanDetails, setLoanDetails] = useState<any>(null);
  const [modalFollowUpHistory, setModalFollowUpHistory] = useState<any[]>([]);

  // Form Fields
  const [contactedPerson, setContactedPerson] = useState<'CUSTOMER' | 'GUARANTOR_1' | 'GUARANTOR_2' | 'OTHER'>('CUSTOMER');
  const [result, setResult] = useState<
    | 'ANSWERED'
    | 'NO ANSWER'
    | 'BUSY'
    | 'SWITCHED OFF'
    | 'REQUESTED LATER'
    | 'WRONG NUMBER'
    | 'CALL BACK'
    | 'PROMISED TO PAY'
    | 'PAID_CLOSED'
    | 'NUMBER_DOESNT_EXIST'
    | 'LOAN_CLOSED'
    | 'CUSTOMER_DECEASED'
    | 'DUPLICATE_ENTRY'
  >('ANSWERED');
  const [narration, setNarration] = useState('');
  const [convertingTelugu, setConvertingTelugu] = useState(false);

  // Typed remarks (English or Telugu in English letters) -> Telugu script
  const handleConvertRemarksToTelugu = async () => {
    if (!narration.trim() || convertingTelugu) return;
    if (!hasEnglishLetters(narration)) {
      toast('Remarks are already in Telugu');
      return;
    }
    setConvertingTelugu(true);
    try {
      const telugu = await convertTextToTelugu(narration);
      setNarration(telugu);
    } catch (err: any) {
      toast.error(`Telugu conversion failed: ${err?.message || 'try again'}`);
    } finally {
      setConvertingTelugu(false);
    }
  };
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [promisedAmount, setPromisedAmount] = useState('');

  // Print Preview state
  const [showPrintModal, setShowPrintModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setDuesError(null);
    setFollowUpsError(null);
    setTransactionsError(null);

    let fetchedFollowups: FinanceLoanPaymentFollowup[] = [];
    let summaryData: { dues: any[]; integrityErrors: any[] } = { dues: [], integrityErrors: [] };
    let transactions: any[] = [];

    // 1. Fetch Dues Summary
    try {
      summaryData = await supabaseFinance.getDuesLedgerSummary();
    } catch (err: any) {
      console.error('[PAYMENT_FOLLOWUP_FETCH_ERROR] Dues query failed:', {
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
        raw: err
      });
      setDuesError(err?.message || 'Failed to load dues summary');
      toast.error('Failed to load collection follow-ups data', { id: 'payment-followup-fetch-error' });
    }

    // 2. Fetch Followups
    try {
      fetchedFollowups = await supabaseFinance.getFollowUps();
      setFollowUps(fetchedFollowups);
    } catch (err: any) {
      console.error('[PAYMENT_FOLLOWUP_FETCH_ERROR] Follow-ups query failed:', {
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
        raw: err
      });
      setFollowUpsError(err?.message || 'Failed to load follow-up history');
      toast.error('Failed to load collection follow-ups data', { id: 'payment-followup-fetch-error' });
    }

    // 3. Fetch Transactions
    try {
      const { data, error } = await supabase
        .from('finance_transactions')
        .select(`
          id, date, amount, type, remarks, collected_by, receipt_no, loan_id,
          loan:finance_loans(
            id, loan_id, loan_category, amount, customer_id,
            customer:finance_customers!customer_id(id, name, phone)
          )
        `)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      transactions = data || [];
    } catch (err: any) {
      console.error('[PAYMENT_FOLLOWUP_FETCH_ERROR] Transactions query failed:', {
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
        raw: err
      });
      setTransactionsError(err?.message || 'Failed to load transactions');
      toast.error('Failed to load collection follow-ups data', { id: 'payment-followup-fetch-error' });
    }

    if (summaryData && summaryData.dues) {
      const dues = summaryData.dues;
      const calculatedLoans: ActiveDueLoan[] = dues.map((row: any) => {
        // Get this loan's follow-up history sorted oldest to newest
        const loanFollowups = fetchedFollowups
          .filter((f: any) => f.loan_id === row.id)
          .sort((a, b) => {
            if (a.follow_up_date !== b.follow_up_date) {
              return a.follow_up_date.localeCompare(b.follow_up_date);
            }
            if (a.created_at && b.created_at) {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            }
            return a.id.localeCompare(b.id);
          });

        const lastFollowUp = loanFollowups[loanFollowups.length - 1];
        let activePendingAction: any = null;

        // Process follow-ups in chronological order to find the active pending action (promise or callback)
        for (const f of loanFollowups) {
          if (CALLBACK_RESULTS.includes(f.result) && f.next_follow_up_date) {
            activePendingAction = f;
          } else if (f.result === 'PROMISED TO PAY' && f.next_follow_up_date) {
            // A newer logged call (promise) completes older pending callback schedules
            if (activePendingAction && CALLBACK_RESULTS.includes(activePendingAction.result)) {
              activePendingAction = null;
            }
            const promiseDateStr = f.follow_up_date;
            const promiseCreatedAt = f.created_at ? new Date(f.created_at).getTime() : null;

            // Find qualifying collections in event window
            const qualifying = transactions.filter((t: any) => {
              if (t.loan_id !== row.id) return false;
              if (t.type !== 'Collection') return false;

              if (t.date > promiseDateStr) {
                return true;
              } else if (t.date === promiseDateStr) {
                if (t.created_at && promiseCreatedAt) {
                  return new Date(t.created_at).getTime() > promiseCreatedAt;
                }
                return false; // Do not resolve if timestamp is missing on same date
              }
              return false;
            });

            const totalPaid = qualifying.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
            const amtNeeded = f.promised_amount ? Number(f.promised_amount) : 0;

            let resolved = false;
            if (amtNeeded > 0) {
              resolved = totalPaid >= amtNeeded;
            } else {
              resolved = qualifying.length > 0;
            }

            if (!resolved) {
              activePendingAction = f;
            } else {
              if (activePendingAction === f) {
                activePendingAction = null;
              }
            }
          } else {
            // Any other call completes older pending callback schedules
            if (activePendingAction && CALLBACK_RESULTS.includes(activePendingAction.result)) {
              activePendingAction = null;
            }
          }
        }

        const nextFollowUpDate = activePendingAction ? activePendingAction.next_follow_up_date : null;

        return {
          id: row.id,
          loanId: row.loan_id,
          customerName: row.customer_name,
          loanCategory: row.loan_category || 'General',
          loanType: row.loan_type,
          loanAmount: Number(row.loan_amount),
          currentPrincipal: Number(row.current_principal),
          loanDate: row.loan_date,
          currentDueDate: row.current_due_date,
          pendingInterest: Number(row.pending_interest || 0),
          penalty: Number(row.penalty || 0),
          presentDue: Number(row.present_due || 0),
          dueDays: Number(row.due_days || 0),
          phone: row.phone || '',
          g1Name: row.g1_name || '',
          g1Phone: row.g1_phone || '',
          g2Name: row.g2_name || '',
          g2Phone: row.g2_phone || '',
          partnerName: row.partner_name || 'Unassigned',
          status: 'Active',
          customerId: row.customer_id,
          guarantor1Id: row.guarantor_1_id,
          guarantor2Id: row.guarantor_2_id,
          lastFollowUp,
          nextFollowUpDate,
          activePendingAction
        };
      });

      setLoans(calculatedLoans);
    } else {
      setLoans([]);
    }
    setLoading(false);
  };

  // Staff list for filter
  const staffList = useMemo(() => {
    const staffSet = new Set<string>();
    followUps.forEach(f => {
      if (f.followed_up_by) staffSet.add(f.followed_up_by);
    });
    return Array.from(staffSet);
  }, [followUps]);

  const todayDateStr = useMemo(() => getLocalBusinessDateISO(), []);

  const categorizedLoans = useMemo(() => {
    // Only Active Loans whose due date has arrived or passed are eligible
    const activeDueLoans = loans.filter(l => l.status === 'Active' && l.dueDays >= 0);

    return {
      ACTIVE_QUEUE: activeDueLoans.filter(l => !l.nextFollowUpDate),
      TODAYS: activeDueLoans.filter(l => l.nextFollowUpDate === todayDateStr),
      UPCOMING: activeDueLoans.filter(l => l.nextFollowUpDate && l.nextFollowUpDate > todayDateStr),
      MISSED: activeDueLoans.filter(l => l.nextFollowUpDate && l.nextFollowUpDate < todayDateStr)
    };
  }, [loans, todayDateStr]);

  // Main UI Filter Logic
  const filteredList = useMemo(() => {
    if (activeTab === 'HISTORY') return [];

    let list = categorizedLoans[activeTab as keyof typeof categorizedLoans] || [];

    // Search query
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      list = list.filter(l => 
        l.loanId.toLowerCase().includes(query) || 
        l.customerName.toLowerCase().includes(query) ||
        l.phone.toLowerCase().includes(query)
      );
    }

    // Loan type
    if (loanTypeFilter !== 'ALL') {
      list = list.filter(l => l.loanType === loanTypeFilter);
    }

    return list;
  }, [categorizedLoans, activeTab, searchQuery, loanTypeFilter]);

  // Unified History Records for history tab/report
  const filteredHistory = useMemo(() => {
    if (activeTab !== 'HISTORY') return [];

    let list = [...followUps];

    // Staff filter
    if (staffFilter !== 'ALL STAFF') {
      list = list.filter(f => f.followed_up_by === staffFilter);
    }

    // Date filter
    if (dateFilter) {
      list = list.filter(f => f.follow_up_date === dateFilter);
    }

    // Search query
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      list = list.filter(f => {
        const loanNo = f.loan?.loan_id || '';
        const custName = f.loan?.customer?.name || '';
        const narration = f.narration || '';
        return (
          loanNo.toLowerCase().includes(query) ||
          custName.toLowerCase().includes(query) ||
          narration.toLowerCase().includes(query)
        );
      });
    }

    // Filter by loan type
    if (loanTypeFilter !== 'ALL') {
      list = list.filter(f => {
        const loanNo = f.loan?.loan_id || '';
        const type = loanNo.startsWith('CD') ? 'CD' : loanNo.startsWith('HP') ? 'HP' : loanNo.startsWith('STBD') ? 'STBD' : 'TBD';
        return type === loanTypeFilter;
      });
    }

    return list;
  }, [followUps, activeTab, staffFilter, dateFilter, searchQuery, loanTypeFilter]);

  // Open Log Modal
  const handleOpenFollowUpModal = async (loan: ActiveDueLoan) => {
    setSelectedLoan(loan);
    setContactedPerson('CUSTOMER');
    setResult('ANSWERED');
    setNarration('');
    setNextFollowUpDate('');
    setPromisedAmount('');
    setShowModal(true);

    setG1Details(null);
    setG2Details(null);
    setCdLedgerEntries([]);
    setCdInterestDetails([]);
    setLoanDetails(null);
    setModalFollowUpHistory([]);
    setLoadingContactDetails(true);

    try {
      const ids = [loan.customerId, loan.guarantor1Id, loan.guarantor2Id].filter(Boolean) as string[];
      
      const [customersRes, ledgerRes, interestRes, loanRes, followupsRes] = await Promise.all([
        ids.length > 0 ? supabase.from('finance_customers').select('*').in('id', ids) : Promise.resolve({ data: [], error: null }),
        supabase.from('finance_cd_ledger_entries').select('*').eq('loan_id', loan.id).order('created_at', { ascending: true }),
        supabase.from('finance_cd_interest_details').select('*').eq('loan_id', loan.id),
        supabase.from('finance_loans').select('*').eq('id', loan.id).single(),
        supabase.from('finance_loan_payment_followups').select('*').eq('loan_id', loan.id).order('followed_up_at', { ascending: false })
      ]);

      if (customersRes.data) {
        const data = customersRes.data;
        const g1 = data.find(c => c.id === loan.guarantor1Id);
        const g2 = data.find(c => c.id === loan.guarantor2Id);
        setG1Details(g1 || null);
        setG2Details(g2 || null);
      }

      if (ledgerRes.data) {
        setCdLedgerEntries(ledgerRes.data);
      }
      if (interestRes.data) {
        setCdInterestDetails(interestRes.data);
      }
      if (loanRes.data) {
        setLoanDetails(loanRes.data);
      }
      if (followupsRes.data) {
        setModalFollowUpHistory(followupsRes.data);
      }
    } catch (err) {
      console.error("Error fetching contact details for modal:", err);
    } finally {
      setLoadingContactDetails(false);
    }
  };

  const renewCalculations = useMemo(() => {
    if (!selectedLoan || selectedLoan.loanType !== 'CD' || !loanDetails || cdLedgerEntries.length === 0) {
      return null;
    }
    try {
      return financeCalculationService.getCDAccountPosition(
        loanDetails,
        cdLedgerEntries,
        cdInterestDetails,
        todayDateStr
      ) as any;
    } catch (err) {
      console.warn("CD position calculation failed inside follow-up dashboard modal:", err);
      return null;
    }
  }, [selectedLoan, loanDetails, cdLedgerEntries, cdInterestDetails, todayDateStr]);

  // Quick next date calculator helpers
  const handleSetQuickDate = (days: number) => {
    const d = new Date(todayDateStr);
    d.setDate(d.getDate() + days);
    setNextFollowUpDate(d.toISOString().split('T')[0]);
  };

  // Save followup record
  const handleSaveFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoan) return;

    if (!narration.trim()) {
      toast.error('Please enter a narration / call summary');
      return;
    }

    setSubmitting(true);
    const staffName = user?.username || 'Staff';

    // Remarks are kept in Telugu: convert anything still typed in English letters
    let finalNarration = narration.trim();
    if (hasEnglishLetters(finalNarration)) {
      try {
        finalNarration = (await convertTextToTelugu(finalNarration)).trim() || finalNarration;
        setNarration(finalNarration);
      } catch {
        toast('Could not convert remarks to Telugu; saved as typed');
      }
    }

    const payload = {
      loan_id: selectedLoan.id,
      follow_up_date: todayDateStr,
      followed_up_by: staffName,
      contacted_person: contactedPerson,
      result: result,
      narration: finalNarration,
      next_follow_up_date: !TERMINAL_OUTCOMES.includes(result) ? nextFollowUpDate || null : null,
      promised_amount: result === 'PROMISED TO PAY' && promisedAmount ? Number(promisedAmount) : null
    };

    try {
      const result = await supabaseFinance.createFollowUp(payload);
      if (result) {
        toast.success('Follow-up record logged successfully');
        setShowModal(false);
        fetchData();
      } else {
        toast.error('Failed to log follow-up record');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error logging follow-up');
    } finally {
      setSubmitting(false);
    }
  };



  return (
    <div className="flex flex-col gap-2 w-full max-w-[100%] mx-auto px-4 pt-3 pb-4 print:p-0 select-none">
      
      {/* ── ROW 1: Header ───────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center print:hidden">
        <div>
          <h1 className="text-[15px] font-black uppercase text-slate-900 tracking-wide leading-none">Collection Follow-up Dashboard</h1>
          <p className="text-[11px] text-slate-500 uppercase font-semibold mt-0.5">Active overdue callbacks, next scheduled actions &amp; staff accountability</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 text-[12px] font-bold uppercase shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <button
            onClick={() => setShowPrintModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0b1329] text-white rounded-lg hover:bg-slate-800 text-[12px] font-bold uppercase shadow-sm"
          >
            <Printer className="w-3.5 h-3.5" /> Print Landscape
          </button>
        </div>
      </div>

      {/* Warning banner for partial failures */}
      {(followUpsError || transactionsError) && !duesError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider print:hidden">
          Warning: Partial database loading issues. 
          {followUpsError && ` [Schedules/History: ${followUpsError}]`}
          {transactionsError && ` [Collections Resolution: ${transactionsError}]`}
        </div>
      )}

      {duesError ? (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-rose-50 border border-rose-200 rounded-lg p-6 my-4">
          <span className="text-red-700 font-black uppercase text-sm tracking-wider">Failed to Load Active Due Accounts</span>
          <p className="text-red-650 text-xs mt-2 uppercase font-semibold">{duesError}</p>
          <button 
            onClick={fetchData} 
            className="mt-4 px-4 py-2 bg-red-700 text-white rounded-lg text-xs font-black uppercase hover:bg-red-800 transition-colors shadow-sm"
          >
            Retry Fetch
          </button>
        </div>
      ) : null}

      {/* ── ROW 2: Filters + KPI Status Counts (single horizontal bar) ───────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2.5 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          
          {/* Follow-up View Select */}
          <div className="flex flex-col min-w-[170px]">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Follow-up View</label>
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as FollowUpTab)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-slate-800 uppercase bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer h-[34px]"
            >
              <option value="ACTIVE_QUEUE">Active Due Queue</option>
              <option value="TODAYS">Today's Schedules</option>
              <option value="MISSED">Missed Schedules</option>
              <option value="UPCOMING">Upcoming Schedules</option>
              <option value="HISTORY">Staff Callback Reports</option>
            </select>
          </div>

          {/* Search */}
          <div className="flex flex-col flex-1 min-w-[200px]">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Search Account / Customer</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="e.g. CD100, NARSIMULU"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-[13px] text-slate-800 font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 h-[34px]"
              />
            </div>
          </div>

          {/* Loan Type */}
          <div className="flex flex-col min-w-[135px]">
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

          {/* Conditional Date & Staff filters for History report */}
          {activeTab === 'HISTORY' && (
            <>
              {/* Staff Member */}
              <div className="flex flex-col min-w-[140px]">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Staff Member</label>
                <select
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-slate-800 uppercase bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer h-[34px]"
                >
                  <option value="ALL STAFF">ALL STAFF</option>
                  {staffList.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Follow-up Date */}
              <div className="min-w-[140px]">
                <FinanceSmartCalendar
                  label="Follow-up Date"
                  value={dateFilter}
                  onChange={setDateFilter}
                  module="PAYMENT_FOLLOWUP"
                  allowClear
                />
              </div>
            </>
          )}

          {/* ── KPI Metrics (right side) ───────────────────────────────────── */}
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            {/* Active */}
            <div 
              onClick={() => setActiveTab('ACTIVE_QUEUE')}
              className={`cursor-pointer px-3 py-1 flex flex-col justify-center text-center rounded-lg border transition-all min-w-[85px] h-[38px] ${
                activeTab === 'ACTIVE_QUEUE' 
                  ? 'bg-[#0b1329] text-white border-[#0b1329] shadow-sm' 
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <span className={`text-[9px] font-black uppercase tracking-wider leading-none ${activeTab === 'ACTIVE_QUEUE' ? 'text-slate-300' : 'text-slate-500'}`}>Active</span>
              <span className="text-[16px] font-black font-mono mt-0.5 leading-none">{categorizedLoans.ACTIVE_QUEUE.length}</span>
            </div>

            {/* Today */}
            <div 
              onClick={() => setActiveTab('TODAYS')}
              className={`cursor-pointer px-3 py-1 flex flex-col justify-center text-center rounded-lg border transition-all min-w-[85px] h-[38px] ${
                activeTab === 'TODAYS' 
                  ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm' 
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <span className={`text-[9px] font-black uppercase tracking-wider leading-none ${activeTab === 'TODAYS' ? 'text-emerald-200' : 'text-slate-500'}`}>Today</span>
              <span className="text-[16px] font-black font-mono mt-0.5 leading-none">{categorizedLoans.TODAYS.length}</span>
            </div>

            {/* Missed */}
            <div 
              onClick={() => setActiveTab('MISSED')}
              className={`cursor-pointer px-3 py-1 flex flex-col justify-center text-center rounded-lg border transition-all min-w-[85px] h-[38px] ${
                activeTab === 'MISSED' 
                  ? 'bg-rose-700 text-white border-rose-700 shadow-sm' 
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <span className={`text-[9px] font-black uppercase tracking-wider leading-none ${activeTab === 'MISSED' ? 'text-rose-200' : 'text-slate-500'}`}>Missed</span>
              <span className="text-[16px] font-black font-mono mt-0.5 leading-none">{categorizedLoans.MISSED.length}</span>
            </div>

            <div 
              onClick={() => setActiveTab('UPCOMING')}
              className={`cursor-pointer px-3 py-1 flex flex-col justify-center text-center rounded-lg border transition-all min-w-[85px] h-[38px] ${
                activeTab === 'UPCOMING' 
                  ? 'bg-blue-700 text-white border-blue-700 shadow-sm' 
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <span className={`text-[9px] font-black uppercase tracking-wider leading-none ${activeTab === 'UPCOMING' ? 'text-blue-200' : 'text-slate-500'}`}>Upcoming</span>
              <span className="text-[16px] font-black font-mono mt-0.5 leading-none">{categorizedLoans.UPCOMING.length}</span>
            </div>
          </div>{/* end KPI bar */}
        </div>{/* end filter flex row */}
      </div>{/* end filter card container */}

        {/* ── ROW 3: Follow-up Queue / History Table ──────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden print:hidden">
        {/* Compact section header */}
        <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <span className="text-[12px] font-black uppercase text-slate-700 tracking-wide">
            {activeTab === 'HISTORY' ? 'Staff Callbacks History Report' : `${activeTab.replace('_', ' ')} list`}
          </span>
          <span className="text-[12px] text-slate-500 font-extrabold uppercase">
            {activeTab === 'HISTORY' ? filteredHistory.length : filteredList.length} records
          </span>
        </div>

        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 210px)' }}>
          {activeTab === 'HISTORY' ? (
            // HISTORY / REPORT LIST
            !loading && filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center h-[200px]">
                <span className="text-[13px] font-black uppercase text-slate-400 tracking-wide">NO CALLBACK RECORDS FOUND</span>
                <p className="text-[11px] text-slate-450 uppercase mt-1">There are currently no staff callback reports to display.</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-150 finance-caption">
                 <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)]">
                  <tr className="bg-slate-50">
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-center bg-slate-50 finance-small-label">Sl</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Loan No</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Party Name</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Follow Date</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Staff</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Contacted</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-center bg-slate-50 finance-small-label">Result</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Narration</th>
                    <th className="px-2 py-2 text-slate-800 text-left bg-slate-50 finance-small-label">Next Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 font-mono text-sm">
                  {loading && Array.from({ length: 6 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-6 mx-auto"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-28"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-20 mx-auto"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-48"></div></td>
                      <td className="p-2"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                    </tr>
                  ))}
                  {!loading && filteredHistory.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/40">
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-500 font-sans text-center text-sm font-semibold">{idx + 1}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 font-bold text-blue-650 text-sm whitespace-nowrap">{item.loan?.loan_id || '—'}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-900 font-sans font-bold text-sm">{item.loan?.customer?.name || 'N/A'}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-660 font-sans whitespace-nowrap text-sm font-semibold">{item.follow_up_date.split('-').reverse().join('/')}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-700 font-sans font-bold text-sm">{item.followed_up_by}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-655 font-sans text-sm font-semibold whitespace-nowrap">{item.contacted_person}</td>
                      <td className={`px-2 py-1.5 border-r border-slate-100 font-sans font-extrabold text-sm text-center whitespace-nowrap ${item.result === 'PROMISED_PAYMENT' ? 'text-green-700' : item.result === 'NO_ANSWER' ? 'text-red-655' : 'text-slate-700'}`}>
                        {item.result.replace('_', ' ')}
                      </td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-700 font-sans leading-relaxed text-sm font-semibold" title={item.narration}>{item.narration}</td>
                      <td className="px-2 py-1.5 text-blue-650 font-sans font-bold whitespace-nowrap text-sm">
                        {item.next_follow_up_date ? item.next_follow_up_date.split('-').reverse().join('/') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            // ACTIVE & SCHEDULED QUEUES
            !loading && filteredList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center h-[200px]">
                <span className="text-[13px] font-black uppercase text-slate-400 tracking-wide">NO ACTIVE DUE ACCOUNTS</span>
                <p className="text-[11px] text-slate-450 uppercase mt-1">There are currently no accounts requiring follow-up.</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-150 text-base finance-caption">
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)]">
                  <tr className="bg-slate-50">
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-center bg-slate-50 finance-small-label">Sl</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Loan No</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Party Name</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-right bg-slate-50 finance-small-label">Present Due</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-center bg-slate-50 finance-small-label">Due Days</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Due Date</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Phones (B / G1 / G2)</th>
                    <th className="px-2 py-2 border-r border-slate-200 text-slate-800 text-left bg-slate-50 finance-small-label">Latest Callback Summary</th>
                    <th className="px-2 py-2 text-slate-800 text-center bg-slate-50 finance-small-label">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 font-mono text-sm">
                  {loading && Array.from({ length: 6 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-6 mx-auto"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-16 font-bold"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-28"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-10 mx-auto"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
                      <td className="p-2 border-r border-slate-100"><div className="h-4 bg-slate-200 rounded w-48"></div></td>
                      <td className="p-2"><div className="h-8 bg-slate-200 rounded w-full"></div></td>
                    </tr>
                  ))}
                  {!loading && filteredList.map((due, idx) => (
                    <tr key={due.id} className="hover:bg-slate-50/40">
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-500 font-sans text-center text-sm font-semibold">{idx + 1}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-blue-700 text-[16px] font-black whitespace-nowrap">{due.loanId}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-900 font-sans text-[16px] font-black uppercase">{due.customerName}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-right text-slate-950 font-sans text-sm font-black whitespace-nowrap">{Math.round(due.presentDue).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-center text-red-655 text-sm font-bold whitespace-nowrap">{due.dueDays}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-600 font-sans whitespace-nowrap text-sm font-semibold">{due.currentDueDate.split('-').reverse().join('/')}</td>
                      <td className="px-2 py-1.5 border-r border-slate-100 font-sans text-slate-700 space-y-1.5 whitespace-normal">
                        <div className="text-[13px] font-bold text-slate-900">B: <span className="font-extrabold">{due.phone || '—'}</span></div>
                        {due.g1Name && (
                          <div className="text-[13px] font-bold text-slate-800">G1: <span className="font-black">{due.g1Name}</span> - <span className="font-extrabold">{due.g1Phone || '—'}</span></div>
                        )}
                        {due.g2Name && (
                          <div className="text-[13px] font-bold text-slate-800">G2: <span className="font-black">{due.g2Name}</span> - <span className="font-extrabold">{due.g2Phone || '—'}</span></div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 border-r border-slate-100 text-slate-700 font-sans text-sm leading-relaxed whitespace-normal">
                        {due.activePendingAction || due.lastFollowUp ? (
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-wider mb-0.5 flex flex-wrap gap-1 items-center">
                              {activeTab === 'MISSED' && due.activePendingAction ? (
                                CALLBACK_RESULTS.includes(due.activePendingAction.result) ? (
                                  <span className="text-red-700 font-black">CALL OVERDUE • Scheduled {due.activePendingAction.next_follow_up_date.split('-').reverse().join('/')}</span>
                                ) : (
                                  <span className="text-red-700 font-black">PAYMENT PROMISE MISSED • Due {due.activePendingAction.next_follow_up_date.split('-').reverse().join('/')}</span>
                                )
                              ) : due.activePendingAction ? (
                                CALLBACK_RESULTS.includes(due.activePendingAction.result) ? (
                                  <span className="text-amber-700 font-black">{due.activePendingAction.result} • Next call {due.activePendingAction.next_follow_up_date.split('-').reverse().join('/')}</span>
                                ) : (
                                  <span className="text-blue-700 font-black">
                                    PROMISED TO PAY • {due.activePendingAction.promised_amount ? '' + Number(due.activePendingAction.promised_amount).toLocaleString('en-IN') + ' ' : ''}by {due.activePendingAction.next_follow_up_date.split('-').reverse().join('/')}
                                  </span>
                                )
                              ) : due.lastFollowUp ? (
                                <span className="text-slate-500 font-black">
                                  {due.lastFollowUp.result} • {due.lastFollowUp.follow_up_date.split('-').reverse().join('/')}
                                </span>
                              ) : null}
                              {due.lastFollowUp && (
                                <span className="text-slate-400 font-normal">by {due.lastFollowUp.followed_up_by}</span>
                              )}
                            </div>
                            {due.lastFollowUp && (
                              <div className="font-semibold text-slate-800 text-sm leading-snug" title={due.lastFollowUp.narration}>
                                {due.lastFollowUp.narration}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="italic text-gray-400 text-sm">No callbacks logged</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => handleOpenFollowUpModal(due)}
                          className="px-2.5 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900 rounded border border-indigo-200 transition-colors font-sans font-extrabold text-[13px] uppercase inline-flex items-center justify-center gap-1.5 min-h-[30px] w-full whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          LOG CALL
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>

            {/* RECORD FOLLOW-UP MODAL */}
      {showModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center backdrop-blur-sm">
          <div
            className="bg-[#f0f2f7] rounded-2xl border border-slate-300 shadow-2xl overflow-hidden flex flex-col"
            style={{ width: '94vw', maxWidth: '1820px', height: '92vh' }}
          >

            {/* ══════════════════════════════════════════════════════
                HEADER BAR  —  dark background, loan ID + close
            ══════════════════════════════════════════════════════ */}
            <div className="bg-[#0b1329] text-white px-5 py-2.5 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <span className="text-[13px] font-black uppercase tracking-widest text-slate-400">Follow-up Operator Dashboard</span>
                <span className="text-white font-black text-[20px] font-mono">{selectedLoan.loanId}</span>
                <span className={`px-3 py-0.5 rounded-full text-[13px] font-black uppercase ${
                  (loanDetails?.status || selectedLoan.status) === 'Active'
                    ? 'bg-green-500 text-white' : 'bg-slate-500 text-white'
                }`}>{loanDetails?.status || selectedLoan.status}</span>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* ══════════════════════════════════════════════════════
                CONTENT AREA
            ══════════════════════════════════════════════════════ */}
            <div className="flex-1 overflow-hidden flex flex-col p-2.5 gap-2">
              {loadingContactDetails ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-900 mb-3"></div>
                  <span className="text-[15px] font-bold uppercase">Loading Account Details &amp; History...</span>
                </div>
              ) : (
                <>
                  {/* ────────────────────────────────────────────────
                      ROW 1  :  BORROWER IDENTITY STRIP
                      Borrower | Loan details | Guarantors  — one row
                  ──────────────────────────────────────────────── */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-2 flex items-center gap-0 shrink-0">

                    {/* Avatar + Name block */}
                    <div className="flex items-center gap-3 pr-4 shrink-0">
                      <div className="w-11 h-11 rounded-full bg-[#0b1329] flex items-center justify-center shrink-0 shadow">
                        <span className="text-white text-[20px] font-black">{selectedLoan.customerName.charAt(0)}</span>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-black uppercase tracking-wider leading-none mb-0.5">Borrower</div>
                        <div className="text-[26px] font-black text-slate-900 uppercase leading-none">{selectedLoan.customerName}</div>
                      </div>
                    </div>

                    <div className="w-px self-stretch bg-slate-200 mx-3 shrink-0" />

                    {/* Loan facts — compact 2-col grid */}
                    <div className="grid grid-rows-2 grid-flow-col gap-x-6 gap-y-0.5 shrink-0">
                      <div>
                        <div className="text-[11px] text-slate-400 font-black uppercase tracking-wider leading-none">Phone</div>
                        <div className="text-[18px] font-black text-slate-800 font-mono leading-tight">{selectedLoan.phone || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-black uppercase tracking-wider leading-none">Loan Date</div>
                        <div className="text-[15px] font-bold text-slate-700 font-mono leading-tight">
                          {selectedLoan.loanDate ? selectedLoan.loanDate.split('-').reverse().join('/') : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-black uppercase tracking-wider leading-none">Due Date</div>
                        <div className="text-[15px] font-bold text-red-700 font-mono leading-tight">
                          {selectedLoan.currentDueDate ? selectedLoan.currentDueDate.split('-').reverse().join('/') : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-black uppercase tracking-wider leading-none">Last Paid</div>
                        <div className="text-[15px] font-bold text-slate-700 font-mono leading-tight">
                          {cdLedgerEntries.filter((e: any) => e.entry_date && e.credit > 0).slice(-1)[0]?.entry_date?.split('T')[0].split('-').reverse().join('/') || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-black uppercase tracking-wider leading-none">Operator</div>
                        <div className="text-[15px] font-bold text-slate-700 uppercase leading-tight">{loanDetails?.created_by || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-black uppercase tracking-wider leading-none">Interest Rate</div>
                        <div className="text-[15px] font-bold text-slate-700 leading-tight">{loanDetails?.interest_rate ? `${loanDetails.interest_rate}%` : '—'}</div>
                      </div>
                    </div>

                    <div className="w-px self-stretch bg-slate-200 mx-3 shrink-0" />

                    {/* Guarantors — same row */}
                    <div className="flex items-start gap-5 shrink-0">
                      {selectedLoan.g1Name ? (
                        <div>
                          <div className="text-[11px] text-[#0b1329] font-black uppercase tracking-wider mb-0.5">G1</div>
                          <div className="text-[16px] font-black text-slate-900 uppercase leading-none">{selectedLoan.g1Name}</div>
                          <div className="text-[15px] font-bold text-slate-600 font-mono">{selectedLoan.g1Phone || g1Details?.phone || '—'}</div>
                        </div>
                      ) : null}
                      {selectedLoan.g2Name ? (
                        <div>
                          <div className="text-[11px] text-[#0b1329] font-black uppercase tracking-wider mb-0.5">G2</div>
                          <div className="text-[16px] font-black text-slate-900 uppercase leading-none">{selectedLoan.g2Name}</div>
                          <div className="text-[15px] font-bold text-slate-600 font-mono">{selectedLoan.g2Phone || g2Details?.phone || '—'}</div>
                        </div>
                      ) : null}
                      {!selectedLoan.g1Name && !selectedLoan.g2Name && (
                        <div className="text-slate-400 italic text-[14px]">No guarantors</div>
                      )}
                    </div>

                    {/* Days Due badge — far right */}
                    <div className="ml-auto shrink-0 bg-red-600 text-white rounded-xl px-5 py-2 text-center shadow">
                      <div className="text-[32px] font-black font-mono leading-none">{renewCalculations?.daysPastDue ?? selectedLoan.dueDays}</div>
                      <div className="text-[11px] font-black uppercase tracking-widest mt-0.5">Days Due</div>
                    </div>
                  </div>

                  {/* ────────────────────────────────────────────────
                      ROW 2  :  FINANCIAL CARDS — 6 wide cards (amounts)
                  ──────────────────────────────────────────────── */}
                  <div className="grid grid-cols-6 gap-2 shrink-0">
                    {/* Principal */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Principal</div>
                      <div className="text-[28px] font-black text-slate-900 font-mono leading-tight mt-0.5">
                        {Math.round(renewCalculations?.principalBalance ?? selectedLoan.currentPrincipal).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* Interest Due */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Interest Due</div>
                      <div className="text-[28px] font-black text-red-600 font-mono leading-tight mt-0.5">
                        {Math.round(renewCalculations?.accruedInterest ?? selectedLoan.pendingInterest).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* Penalty Due */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Penalty Due</div>
                      <div className="text-[28px] font-black text-orange-600 font-mono leading-tight mt-0.5">
                        {Math.round(renewCalculations?.accruedPenalty ?? selectedLoan.penalty).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* Today's Due */}
                    <div className="bg-red-50 rounded-xl border border-red-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-red-600 uppercase tracking-wide leading-none">Today's Due</div>
                      <div className="text-[28px] font-black text-red-700 font-mono leading-tight mt-0.5">
                        {Math.round(renewCalculations?.todayDue ?? selectedLoan.presentDue).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* Outstanding */}
                    <div className="bg-[#0b1329] rounded-xl shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-400 uppercase tracking-wide leading-none">Outstanding</div>
                      <div className="text-[28px] font-black text-white font-mono leading-tight mt-0.5">
                        {Math.round(
                          (renewCalculations?.principalBalance ?? selectedLoan.currentPrincipal) +
                          (renewCalculations?.accruedInterest ?? selectedLoan.pendingInterest) +
                          (renewCalculations?.accruedPenalty ?? selectedLoan.penalty)
                        ).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* Total Paid */}
                    <div className="bg-emerald-50 rounded-xl border border-emerald-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-emerald-700 uppercase tracking-wide leading-none">Total Paid</div>
                      <div className="text-[28px] font-black text-emerald-700 font-mono leading-tight mt-0.5">
                        {Math.round(renewCalculations?.totalCollected ?? (cdLedgerEntries.filter((e: any) => e.credit > 0).reduce((s: number, e: any) => s + Number(e.credit), 0))).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>

                  {/* ────────────────────────────────────────────────
                      ROW 3  :  RECOVERY METRICS — 6 stat cards
                  ──────────────────────────────────────────────── */}
                  <div className="grid grid-cols-6 gap-2 shrink-0">
                    {/* Interest Paid */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Interest Paid</div>
                      <div className="text-[22px] font-black text-emerald-700 font-mono leading-tight mt-0.5">
                        {Math.round(renewCalculations?.interestPaid ?? 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* Penalty Paid */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Penalty Paid</div>
                      <div className="text-[22px] font-black text-emerald-700 font-mono leading-tight mt-0.5">
                        {Math.round(renewCalculations?.penaltyPaid ?? 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* Renewal Paid */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Renewal Paid</div>
                      <div className="text-[22px] font-black text-emerald-700 font-mono leading-tight mt-0.5">
                        {Math.round(cdInterestDetails.reduce((s: number, d: any) => s + Number(d.interest_amount || 0), 0)).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {/* No. of Renewals */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Renewals</div>
                      <div className="text-[28px] font-black text-slate-800 font-mono leading-tight mt-0.5">
                        {cdInterestDetails.filter((d: any) => Number(d.renewed_days) > 0).length}
                      </div>
                    </div>
                    {/* Days Due */}
                    <div className="bg-rose-50 rounded-xl border border-rose-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-rose-600 uppercase tracking-wide leading-none">Days Due</div>
                      <div className="text-[28px] font-black text-rose-700 font-mono leading-tight mt-0.5">
                        {renewCalculations?.daysPastDue ?? selectedLoan.dueDays}
                      </div>
                    </div>
                    {/* Cycle */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
                      <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide leading-none">Cycle</div>
                      <div className="text-[28px] font-black text-slate-800 font-mono leading-tight mt-0.5">
                        #{cdInterestDetails.length + 1}
                      </div>
                    </div>
                  </div>

                  {/* ────────────────────────────────────────────────
                      ROW 4  :  CALLBACK HISTORY (55%)  |  LOG FORM (45%)
                  ──────────────────────────────────────────────── */}
                  <div className="flex-1 flex gap-2 min-h-0">

                    {/* LEFT — Callback History Timeline  55% */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-2.5 flex flex-col min-h-0" style={{ flex: '55' }}>
                      <div className="text-[15px] font-black uppercase text-slate-700 tracking-wide pb-1.5 border-b border-slate-100 shrink-0 flex items-baseline gap-2">
                        Callback History
                        <span className="text-[13px] text-slate-400 font-bold normal-case">({modalFollowUpHistory.length} records)</span>
                      </div>
                      <div className="flex-1 overflow-auto min-h-0 mt-1.5 border border-slate-200 rounded-lg bg-white shadow-2xs">
                        {modalFollowUpHistory.length === 0 ? (
                          <div className="text-slate-400 italic text-center py-6 text-xs">No callback logs recorded for this account.</div>
                        ) : (
                          <table className="w-full text-left border-collapse text-[11px]">
                            <thead className="bg-slate-100 border-b border-slate-250 sticky top-0 font-black uppercase text-slate-600 select-none text-[10px]">
                              <tr>
                                <th className="px-2 py-1.5 border-r border-slate-200 w-20">Date</th>
                                <th className="px-2 py-1.5 border-r border-slate-200 text-center w-24">Status</th>
                                <th className="px-2 py-1.5 border-r border-slate-200 w-20">Contacted</th>
                                <th className="px-2.5 py-1.5 border-r border-slate-200">Remarks &amp; Notes</th>
                                <th className="px-2 py-1.5 border-r border-slate-200 w-20 text-center">Next Date</th>
                                <th className="px-2 py-1.5 w-16">Staff</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-150 font-sans">
                              {modalFollowUpHistory.map((h: any) => (
                                <tr key={h.id} className="hover:bg-slate-50/80 transition-colors h-[36px]">
                                  <td className="px-2 py-1 border-r border-slate-200 font-mono font-bold text-slate-800 whitespace-nowrap">
                                    {h.follow_up_date ? h.follow_up_date.split('-').reverse().join('/') : '—'}
                                  </td>
                                  <td className="px-2 py-1 border-r border-slate-200 text-center whitespace-nowrap">
                                    <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                                      h.result === 'PROMISED TO PAY' ? 'bg-blue-100 text-blue-800 border-blue-300' :
                                      h.result === 'ANSWERED' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                                      h.result === 'CALL BACK' ? 'bg-purple-100 text-purple-800 border-purple-300' :
                                      'bg-rose-100 text-rose-800 border-rose-300'
                                    }`}>
                                      {h.result}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1 border-r border-slate-200 font-bold text-slate-700 uppercase whitespace-nowrap text-[10px]">
                                    {h.contacted_person === 'CUSTOMER' ? 'Borrower' : h.contacted_person === 'GUARANTOR_1' ? 'G1' : h.contacted_person === 'GUARANTOR_2' ? 'G2' : 'Other'}
                                  </td>
                                  <td className="px-2.5 py-1 border-r border-slate-200 text-slate-800 font-medium" title={h.narration || ''}>
                                    <div className="line-clamp-2 leading-tight">
                                      {h.promised_amount ? (
                                        <span className="font-bold text-emerald-700 mr-1 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200 font-mono text-[10px]">
                                          {Number(h.promised_amount).toLocaleString('en-IN')}
                                        </span>
                                      ) : null}
                                      {h.narration || '—'}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 border-r border-slate-200 text-center font-mono font-bold text-amber-800 whitespace-nowrap">
                                    {h.next_follow_up_date ? h.next_follow_up_date.split('-').reverse().join('/') : '—'}
                                  </td>
                                  <td className="px-2 py-1 font-semibold text-slate-600 uppercase whitespace-nowrap text-[10px]">
                                    {h.followed_up_by || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    {/* RIGHT — Log Callback Form  45% */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-2.5 flex flex-col min-h-0" style={{ flex: '45' }}>
                      <div className="text-[15px] font-black uppercase text-slate-700 tracking-wide pb-1.5 border-b border-slate-100 shrink-0">Log Callback</div>
                      <form onSubmit={handleSaveFollowUp} className="flex flex-col gap-2 flex-1 min-h-0 mt-1.5">
                        {/* Contacted + Result */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[13px] font-black uppercase text-slate-500 block mb-1">Contacted</label>
                            <select
                              value={contactedPerson}
                              onChange={(e) => setContactedPerson(e.target.value as any)}
                              className="w-full text-slate-900 border border-slate-200 rounded-lg px-3 py-2 bg-white font-bold text-[15px] uppercase cursor-pointer focus:outline-none focus:border-slate-700"
                            >
                              <option value="CUSTOMER">C — Borrower</option>
                              {selectedLoan.g1Name && <option value="GUARANTOR_1">G1 — Guarantor 1</option>}
                              {selectedLoan.g2Name && <option value="GUARANTOR_2">G2 — Guarantor 2</option>}
                              <option value="OTHER">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[13px] font-black uppercase text-slate-500 block mb-1">Result</label>
                            <select
                              value={result}
                              onChange={(e) => setResult(e.target.value as any)}
                              className="w-full text-slate-900 border border-slate-200 rounded-lg px-3 py-2 bg-white font-bold text-[15px] uppercase cursor-pointer focus:outline-none focus:border-slate-700"
                            >
                              <optgroup label="Non-Terminal Outcomes">
                                <option value="ANSWERED">Answered</option>
                                <option value="CALL BACK">Call Back</option>
                                <option value="PROMISED TO PAY">Promised to Pay</option>
                                <option value="BUSY">Busy</option>
                                <option value="NO ANSWER">No Answer</option>
                                <option value="SWITCHED OFF">Switched Off</option>
                                <option value="REQUESTED LATER">Requested Later</option>
                              </optgroup>
                              <optgroup label="Terminal Outcomes">
                                <option value="PAID_CLOSED">Paid / Closed</option>
                                <option value="WRONG NUMBER">Wrong Number</option>
                                <option value="NUMBER_DOESNT_EXIST">Number Doesn't Exist</option>
                                <option value="LOAN_CLOSED">Loan Closed</option>
                                <option value="CUSTOMER_DECEASED">Customer Deceased</option>
                                <option value="DUPLICATE_ENTRY">Duplicate Entry</option>
                              </optgroup>
                            </select>
                          </div>
                        </div>

                        {/* Remarks — grows to fill available space */}
                        <div className="flex-1 flex flex-col min-h-0">
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[13px] font-black uppercase text-slate-500 block">Remarks</label>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={handleConvertRemarksToTelugu}
                                disabled={submitting || convertingTelugu || !narration.trim()}
                                title="Convert typed English / Telugu-English remarks to Telugu (Ctrl+Enter)"
                                className="h-[30px] px-2.5 rounded border border-indigo-300 bg-indigo-50 text-indigo-800 text-[13px] font-bold hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap"
                              >
                                {convertingTelugu ? 'Converting…' : 'అ → తెలుగు'}
                              </button>
                              <VoiceRecorder onTranscriptionCompleted={(text) => {
                                console.log('[DEBUG] 6. Final text written into Remarks:', text);
                                setNarration(prev => prev ? prev + ' ' + text : text);
                              }} disabled={submitting} />
                            </div>
                          </div>
                          <textarea
                            placeholder="TYPE REMARKS (ENGLISH OR TELUGU-ENGLISH), THEN PRESS అ → తెలుగు"
                            value={narration}
                            onChange={(e) => setNarration(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                handleConvertRemarksToTelugu();
                              }
                            }}
                            className="flex-1 min-h-[60px] w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] text-slate-900 focus:outline-none focus:border-slate-700 leading-relaxed font-semibold uppercase placeholder-slate-400 resize-none"
                            required
                          />
                        </div>

                        {/* Call Back extra fields */}
                        {CALLBACK_RESULTS.includes(result) && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 shrink-0">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <FinanceSmartCalendar
                                  label="Next Call Date"
                                  value={nextFollowUpDate}
                                  onChange={setNextFollowUpDate}
                                  module="PAYMENT_FOLLOWUP"
                                />
                              </div>
                              <div>
                                <label className="text-[12px] font-black uppercase text-amber-800 block mb-1">Quick Schedule</label>
                                <div className="flex gap-1.5">
                                  <button type="button" onClick={() => handleSetQuickDate(1)} className="flex-1 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 font-black text-[12px] uppercase rounded border border-amber-300">Tmrw</button>
                                  <button type="button" onClick={() => handleSetQuickDate(3)} className="flex-1 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 font-black text-[12px] uppercase rounded border border-amber-300">+3D</button>
                                  <button type="button" onClick={() => handleSetQuickDate(7)} className="flex-1 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 font-black text-[12px] uppercase rounded border border-amber-300">+7D</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Promised to Pay extra fields */}
                        {result === 'PROMISED TO PAY' && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 shrink-0">
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <FinanceSmartCalendar
                                  label="Promise Date"
                                  value={nextFollowUpDate}
                                  onChange={setNextFollowUpDate}
                                  module="PAYMENT_FOLLOWUP"
                                  required
                                />
                              </div>
                              <div>
                                <label className="text-[12px] font-black uppercase text-blue-800 block mb-1">Amount ()</label>
                                <input
                                  type="number"
                                  placeholder="e.g. 5000"
                                  value={promisedAmount}
                                  onChange={(e) => setPromisedAmount(e.target.value)}
                                  className="w-full border border-blue-300 rounded-lg px-2.5 py-1.5 text-[14px] font-bold bg-white text-slate-900"
                                />
                              </div>
                              <div>
                                <label className="text-[12px] font-black uppercase text-blue-800 block mb-1">Quick Date</label>
                                <div className="flex gap-1">
                                  <button type="button" onClick={() => handleSetQuickDate(1)} className="flex-1 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 font-black text-[11px] uppercase rounded border border-blue-300">Tmrw</button>
                                  <button type="button" onClick={() => handleSetQuickDate(3)} className="flex-1 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 font-black text-[11px] uppercase rounded border border-blue-300">+3D</button>
                                  <button type="button" onClick={() => handleSetQuickDate(7)} className="flex-1 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 font-black text-[11px] uppercase rounded border border-blue-300">+7D</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Action buttons — pinned at bottom */}
                        <div className="flex gap-3 justify-end shrink-0">
                          <button
                            type="button"
                            onClick={() => setShowModal(false)}
                            className="px-5 py-2.5 border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-[15px] font-bold uppercase rounded-lg"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={submitting}
                            className="px-8 py-2.5 bg-[#0b1329] hover:bg-slate-800 text-white text-[15px] font-black uppercase rounded-lg disabled:opacity-50 transition-colors"
                          >
                            {submitting ? 'Saving...' : 'Save Callback'}
                          </button>
                        </div>
                      </form>
                    </div>

                  </div>{/* end row 4 */}
                </>
              )}
            </div>{/* end content */}

          </div>
        </div>
      )}{/* PRINT PREVIEW LANDSCAPE */}
      <FinancePrintPreview
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        title="Collection Dues Callbacks Report"
        documentTitle={`FOLLOWUPS_LIST_${activeTab}_${loanTypeFilter}`}
        orientation="landscape"
      >
        {!loading && (
          <div className="space-y-6">
            <div className="flex justify-between items-end border-b border-slate-900 pb-2">
              <div>
                <h2 className="text-xl font-bold uppercase text-slate-900">Thirumala Group Finance</h2>
                <p className="text-[13px] uppercase text-slate-500">Collection Dues Follow-up Report ({activeTab.replace('_', ' ')} - {loanTypeFilter})</p>
              </div>
              <div className="text-right text-[13px] text-slate-600">
                <p>Report Date: {new Date().toLocaleDateString('en-IN')}</p>
                <p>Printed By: {user?.username || 'Staff'}</p>
              </div>
            </div>

            {activeTab === 'HISTORY' ? (
              <table className="w-full border-collapse" style={{ tableLayout: 'auto', fontSize: '10pt' }}>
                <colgroup>
                  {/* Sl  Loan  Name  FollowDate  Staff  Contacted  Result  Narration  NextDate */}
                  <col style={{ width: '3%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '36%' }} />
                  <col style={{ width: '8%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-slate-850 bg-slate-100">
                    <th className="p-1 border text-center font-bold print-nowrap">Sl No</th>
                    <th className="p-1 border font-bold print-nowrap">Loan No</th>
                    <th className="p-1 border font-bold print-wrap">Party Name</th>
                    <th className="p-1 border font-bold print-nowrap">Follow Date</th>
                    <th className="p-1 border font-bold print-wrap">Staff Member</th>
                    <th className="p-1 border font-bold print-nowrap">Contacted</th>
                    <th className="p-1 border font-bold print-nowrap">Call Result</th>
                    <th className="p-1 border font-bold print-wrap">Narration / Conversation</th>
                    <th className="p-1 border font-bold print-nowrap">Next Schedule</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((item, idx) => (
                    <tr key={item.id} className="border-b">
                      <td className="p-1 border text-center print-nowrap">{idx + 1}</td>
                      <td className="p-1 border font-bold text-blue-850 print-nowrap">{item.loan?.loan_id || '—'}</td>
                      <td className="p-1 border font-bold print-wrap">{item.loan?.customer?.name || 'N/A'}</td>
                      <td className="p-1 border print-nowrap">{item.follow_up_date.split('-').reverse().join('/')}</td>
                      <td className="p-1 border font-bold print-wrap">{item.followed_up_by}</td>
                      <td className="p-1 border print-nowrap">{item.contacted_person}</td>
                      <td className="p-1 border font-bold text-indigo-700 print-nowrap">{item.result.replace('_', ' ')}</td>
                      <td className="p-1 border print-wrap">{item.narration}</td>
                      <td className="p-1 border font-bold print-nowrap">{item.next_follow_up_date ? item.next_follow_up_date.split('-').reverse().join('/') : '—'}</td>
                    </tr>
                  ))}
                  {filteredHistory.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center p-4 italic text-slate-400">No callbacks recorded for current filters</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full border-collapse" style={{ tableLayout: 'auto', fontSize: '10pt' }}>
                <colgroup>
                  {/* Sl  Loan  Name  Due  Days  DueDate  Phone  G1G2  LastCall  NextCall */}
                  <col style={{ width: '3%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '4%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '29%' }} />
                  <col style={{ width: '8%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-slate-850 bg-slate-100">
                    <th className="p-1 border text-center font-bold print-nowrap">Sl No</th>
                    <th className="p-1 border font-bold print-nowrap">Loan No</th>
                    <th className="p-1 border font-bold print-wrap">Party Name</th>
                    <th className="p-1 border text-right font-bold print-nowrap">Present Due</th>
                    <th className="p-1 border text-center font-bold print-nowrap">Days</th>
                    <th className="p-1 border font-bold print-nowrap">Due Date</th>
                    <th className="p-1 border font-bold print-nowrap">Borrower Phone</th>
                    <th className="p-1 border font-bold print-wrap">Guarantor Phones (G1 / G2)</th>
                    <th className="p-1 border font-bold print-wrap">Last Callback Summary</th>
                    <th className="p-1 border font-bold print-nowrap">Next Call</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((due, idx) => (
                    <tr key={due.id} className="border-b">
                      <td className="p-1 border text-center print-nowrap">{idx + 1}</td>
                      <td className="p-1 border font-bold text-blue-855 print-nowrap">{due.loanId}</td>
                      <td className="p-1 border font-bold print-wrap">{due.customerName}</td>
                      <td className="p-1 border text-right text-red-700 font-bold print-amount">{Math.round(due.presentDue).toLocaleString('en-IN')}</td>
                      <td className="p-1 border text-center font-bold print-nowrap">{due.dueDays}</td>
                      <td className="p-1 border print-nowrap">{due.currentDueDate.split('-').reverse().join('/')}</td>
                      <td className="p-1 border font-bold print-nowrap">{due.phone || '—'}</td>
                      <td className="p-1 border leading-tight print-wrap">
                        {due.g1Name && <div>G1: {due.g1Name} ({due.g1Phone || '—'})</div>}
                        {due.g2Name && <div>G2: {due.g2Name} ({due.g2Phone || '—'})</div>}
                      </td>
                      <td className="p-1 border print-wrap">
                        {due.lastFollowUp ? `[${due.lastFollowUp.follow_up_date.split('-').reverse().join('/')} - ${due.lastFollowUp.followed_up_by}] ${due.lastFollowUp.result}: ${due.lastFollowUp.narration}` : 'No previous log'}
                      </td>
                      <td className="p-1 border font-bold text-indigo-700 print-nowrap">
                        {due.nextFollowUpDate ? due.nextFollowUpDate.split('-').reverse().join('/') : '—'}
                      </td>
                    </tr>
                  ))}
                  {filteredList.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center p-4 italic text-slate-400">No outstanding queue accounts to display</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </FinancePrintPreview>

    </div>
  );
};

export default PaymentFollowUp;
