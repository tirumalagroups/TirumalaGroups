import React, { useEffect, useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import { sortNumerically } from '../../lib/financialCalculations';
import { useAuth } from '../../contexts/AuthContext';
import {
  Printer, X, ShieldAlert, Search, ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, User, CreditCard,
  RefreshCw, Download, List, MoreVertical, Layers
} from 'lucide-react';
import toast from 'react-hot-toast';
import CustomerFullDetails from '../../components/finance/CustomerFullDetails';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { exportToExcelMultiSheet } from '../../utils/excel';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import { formatRelationship } from '../../utils/relationship';
import { formatReceiptAmount, amountInWords } from '../../utils/cdReceiptPrint';
import {
  computeHPPosition, previewHPPayment, hpPaymentsFromTransactions, hpOpening, isHPOpeningRow, hpRound,
  HPPosition, HP_CLOSE_PREFIX, HP_NPA_PREFIX
} from '../../services/hpLedgerEngine';

/**
 * HP Ledger: the same screen as the CD Ledger (layout, look, buttons, prints), with HP amounts.
 * Every amount comes from the HP engine (hpLedgerEngine.ts); rules: "HP Ledger Knowledge Base".
 */

const money = (v: number | undefined) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: number | undefined) => (Number(v) || 0).toLocaleString('en-IN');

const formatDateOld = (dateStr: string | Date | number | null | undefined) => {
  if (!dateStr) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [y, m, d] = dateStr.slice(0, 10).split('-');
    return `${d}-${months[parseInt(m, 10) - 1]}-${y.slice(-2)}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
};

type Tab = 'installments' | 'statement' | 'interest' | 'payment' | 'editHistory';
type EventType = 'Loan Issue' | 'Installment' | 'Partial' | 'Closure' | 'NPA';

interface RawPosting { id: string; account: string; entryType: string; credit: number; debit: number; particulars: string; user: string }
interface StatementRow {
  id: string;
  txId: string | null;
  date: string;
  receiptNo: string;
  eventType: EventType;
  principalPaid: number;
  interestPaid: number; // installment interest
  lateInterestPaid: number;
  penaltyPaid: number;
  docCharges: number;
  totalPaid: number;
  outstandingPrincipal: number;
  presentDue: number;
  operator: string;
  remarks: string;
  installments: number[];
  raw: RawPosting[];
}

const eventChip = (t: string) =>
  t === 'Loan Issue' ? 'bg-blue-100 text-blue-800 border border-blue-200'
    : t === 'Installment' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
      : t === 'Partial' ? 'bg-purple-100 text-purple-800 border border-purple-200'
        : t === 'Closure' ? 'bg-rose-100 text-rose-800 border border-rose-200'
          : t === 'NPA' ? 'bg-amber-100 text-amber-800 border border-amber-200'
            : 'bg-slate-100 text-slate-800 border border-slate-200';

const statusChip = (status: string) =>
  status === 'Active' ? 'bg-green-100 text-green-700'
    : status === 'Closed' ? 'bg-gray-100 text-gray-500'
      : status === 'NPA_CLOSED' ? 'bg-orange-100 text-orange-700'
        : 'bg-yellow-100 text-yellow-700';

const instChip: Record<string, string> = {
  'Paid': 'bg-green-100 text-green-700 border border-green-200',
  'Part paid': 'bg-amber-100 text-amber-800 border border-amber-200',
  'Overdue': 'bg-rose-100 text-rose-700 border border-rose-200',
  'Due today': 'bg-blue-100 text-blue-700 border border-blue-200',
  'Upcoming': 'bg-slate-100 text-slate-600 border border-slate-200',
};

const HPLedger: React.FC = () => {
  const { user } = useAuth();
  const today = getLocalBusinessDateISO();

  const [loading, setLoading] = useState(true);
  const [loansList, setLoansList] = useState<any[]>([]);
  const [pendingReviews, setPendingReviews] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'ALL' | 'CLOSED' | 'NPA CLOSED'>('ACTIVE');
  const [universalSearchQuery, setUniversalSearchQuery] = useState('');
  const [showUniversalDropdown, setShowUniversalDropdown] = useState(false);
  const [paymentDate, setPaymentDate] = useState<string>(today);

  const [selectedLoan, setSelectedLoan] = useState<any | null>(null);
  const [guarantor1, setGuarantor1] = useState<any | null>(null);
  const [guarantor2, setGuarantor2] = useState<any | null>(null);
  const [documentReturned, setDocumentReturned] = useState<any | null>(null);
  const [receiptNo, setReceiptNo] = useState('');
  const [totalAmountPaying, setTotalAmountPaying] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [activeLogTab, setActiveLogTab] = useState<Tab>('installments');
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());
  const [editLogs, setEditLogs] = useState<any[]>([]);
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);
  const [fullDetailsCustomerId, setFullDetailsCustomerId] = useState<string | null>(null);

  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showReceiptChooser, setShowReceiptChooser] = useState(false);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);

  const [showNpaModal, setShowNpaModal] = useState(false);
  const [npaReason, setNpaReason] = useState('');
  const [npaSettlementAmount, setNpaSettlementAmount] = useState('');
  const [isNpaClosing, setIsNpaClosing] = useState(false);

  // ---------------------------------------------------------------- data
  const fetchLedgerData = async () => {
    setLoading(true);
    try {
      const allLoans = await supabaseFinance.getCDLoansList();
      try {
        setPendingReviews((await supabaseFinance.getTransactionReviews({ status: 'PENDING' })) || []);
      } catch (err) {
        console.error('Failed to fetch pending reviews:', err);
      }
      setLoansList((allLoans || []).filter((l: any) =>
        String(l.loan_category || '').toUpperCase() === 'HP' || (!l.loan_category && String(l.loan_id || '').toUpperCase().startsWith('HP'))
      ));
    } catch (err) {
      console.error(err);
      toast.error('Failed to load ledger data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedgerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLedgerDetails = async (loanId: string) => {
    setLoading(true);
    try {
      const full = await supabaseFinance.getLoanById(loanId);
      if (!full) {
        toast.error('Ledger details could not be resolved');
        return;
      }
      const [g1Res, g2Res, retDocsRes, nextReceipt] = await Promise.all([
        full.guarantor_1_id
          ? supabase.from('finance_customers').select('id, name, phone, customer_photo_url, aadhaar, address').eq('id', full.guarantor_1_id).single()
          : Promise.resolve({ data: null }),
        full.guarantor_2_id
          ? supabase.from('finance_customers').select('id, name, phone, customer_photo_url, aadhaar, address').eq('id', full.guarantor_2_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('finance_documents_returned').select('*').eq('loan_id', loanId).order('created_at', { ascending: false }).limit(1),
        supabaseFinance.getNextReceiptNumber().catch(() => '')
      ]);
      setSelectedLoan(full);
      setGuarantor1((g1Res as any).data || null);
      setGuarantor2((g2Res as any).data || null);
      setDocumentReturned((retDocsRes as any).data && (retDocsRes as any).data.length > 0 ? (retDocsRes as any).data[0] : null);
      setReceiptNo(nextReceipt as string);
      setTotalAmountPaying('');
      setExpandedRowIds(new Set());
      setExpandedTxIds(new Set());
    } catch (err) {
      console.error(err);
      toast.error('Error fetching HP ledger details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedLoan?.id || activeLogTab !== 'editHistory') return;
    supabase
      .from('finance_edited_logs')
      .select('*')
      .eq('record_id', selectedLoan.id)
      .order('edited_at', { ascending: false })
      .then(({ data }: any) => setEditLogs(data || []));
  }, [selectedLoan?.id, activeLogTab]);

  const handleRefresh = async () => {
    const id = selectedLoan?.id;
    await fetchLedgerData();
    if (id) await loadLedgerDetails(id);
  };

  // ---------------------------------------------------------------- list
  const filteredLoansList = useMemo(() => loansList.filter(loan => {
    if (statusFilter === 'ACTIVE') return loan.status === 'Active';
    if (statusFilter === 'CLOSED') return loan.status === 'Closed';
    if (statusFilter === 'NPA CLOSED') return loan.status === 'NPA_CLOSED';
    return true;
  }), [loansList, statusFilter]);

  const universalSuggestions = useMemo(() => {
    const q = universalSearchQuery.toLowerCase().trim();
    if (!q) return [];
    return filteredLoansList.filter(loan => {
      const c = loan.customer || {};
      const g1 = loan.guarantor_1 || {};
      const g2 = loan.guarantor_2 || {};
      return [loan.loan_id, c.name, c.phone, c.partner_name, g1.name, g1.phone, g2.name, g2.phone]
        .some(v => v && String(v).toLowerCase().includes(q));
    }).slice(0, 50);
  }, [filteredLoansList, universalSearchQuery]);

  const currentIndex = useMemo(() => (
    !selectedLoan ? -1 : filteredLoansList.findIndex(l => l.id === selectedLoan.id)
  ), [selectedLoan, filteredLoansList]);

  // ---------------------------------------------------------------- HP figures
  const isActive = selectedLoan?.status === 'Active';
  const transactions: any[] = useMemo(() => (selectedLoan?.transactions || []).slice().sort((a: any, b: any) =>
    String(a.date).localeCompare(String(b.date)) || String(a.receipt_no || '').localeCompare(String(b.receipt_no || ''), undefined, { numeric: true })
  ), [selectedLoan]);
  const payments = useMemo(() => hpPaymentsFromTransactions(transactions), [transactions]);

  const position: HPPosition | null = useMemo(() => {
    if (!selectedLoan) return null;
    try {
      return computeHPPosition(selectedLoan, payments, paymentDate || today);
    } catch (e) {
      console.error('HP position error', e);
      return null;
    }
  }, [selectedLoan, payments, paymentDate, today]);

  // Every receipt's split, regardless of the payment date picked above
  const fullPosition: HPPosition | null = useMemo(() => {
    if (!selectedLoan) return null;
    const last = payments.map(p => p.date).sort().pop();
    const asOf = last && last > today ? last : today;
    try {
      return computeHPPosition(selectedLoan, payments, asOf);
    } catch {
      return null;
    }
  }, [selectedLoan, payments, today]);

  const amountNum = hpRound(Number(totalAmountPaying) || 0);
  const preview = useMemo(() => {
    if (!selectedLoan || !isActive || !(amountNum > 0) || !position) return null;
    return previewHPPayment(selectedLoan, payments, { date: paymentDate, amount: amountNum, kind: 'payment' });
  }, [selectedLoan, isActive, amountNum, position, payments, paymentDate]);
  const previewKind = preview && preview.ok ? preview.after.splits[preview.after.splits.length - 1].kind : null;

  // What the account needs today: overdue installments + late charges, or the next installment
  const installmentTarget = position
    ? (position.totalDue > 0 ? position.totalDue : (position.nextDue ? position.nextDue.balance : 0))
    : 0;
  const totalToRegularize = position ? position.totalDue : 0;

  const opening = selectedLoan && position ? hpOpening(position.contract) : null;
  // Next installment that is not due yet (overdue ones show as Current Due Date / Total to Regularize)
  const nextUpcoming = position ? position.installments.find(i => i.status !== 'Paid' && i.dueDate > position.asOf) || null : null;
  const lastPaymentDate = payments.length ? payments[payments.length - 1].date : null;

  const statementRows: StatementRow[] = useMemo(() => {
    if (!selectedLoan || !fullPosition || !opening) return [];
    const rows: StatementRow[] = [];
    const amount = Number(selectedLoan.amount) || 0;
    const disb = transactions.find(t => t.type === 'Disbursement');
    const openTx = transactions.find(t => isHPOpeningRow(t));
    rows.push({
      id: 'loan-issue', txId: openTx?.id || null, date: String(selectedLoan.date).slice(0, 10), receiptNo: '—', eventType: 'Loan Issue',
      principalPaid: opening.installment1Principal, interestPaid: 0, lateInterestPaid: 0, penaltyPaid: 0, docCharges: opening.docCharges,
      totalPaid: hpRound(opening.installment1Principal + opening.docCharges),
      outstandingPrincipal: hpRound(amount - opening.installment1Principal), presentDue: 0,
      operator: openTx?.collected_by || disb?.collected_by || 'Staff', remarks: 'Loan given; installment 1 principal and document charges kept',
      installments: [1],
      raw: [
        { id: 'r-disb', account: 'HP Disbursement', entryType: 'Disbursement', credit: 0, debit: amount, particulars: 'Loan given', user: disb?.collected_by || 'Staff' },
        { id: 'r-p1', account: 'HP Principal Amount', entryType: 'installment 1', credit: opening.installment1Principal, debit: 0, particulars: 'Installment 1 kept at disbursement', user: openTx?.collected_by || 'Staff' },
        ...(opening.docCharges > 0 ? [{ id: 'r-doc', account: 'HP Document Charges', entryType: 'document_charge', credit: opening.docCharges, debit: 0, particulars: 'Document charges collected', user: openTx?.collected_by || 'Staff' }] : []),
      ],
    });

    let paidSoFar: typeof payments = [];
    for (const s of fullPosition.splits) {
      const tx = transactions.find(t => t.id === s.id);
      paidSoFar = [...paidSoFar, payments.find(p => p.id === s.id)!].filter(Boolean);
      let after: HPPosition | null = null;
      try { after = computeHPPosition(selectedLoan, paidSoFar, s.date); } catch { after = null; }
      const eventType: EventType = s.kind === 'close' ? 'Closure' : (after && after.totalDue > 0 ? 'Partial' : 'Installment');
      const u = tx?.collected_by || 'Staff';
      rows.push({
        id: s.id || `${s.date}-${s.receiptNo}`, txId: s.id || null, date: s.date, receiptNo: s.receiptNo || '—', eventType,
        principalPaid: s.principal, interestPaid: s.interest, lateInterestPaid: s.lateInterest, penaltyPaid: s.penalty, docCharges: 0,
        totalPaid: s.total, outstandingPrincipal: after ? after.principalBalance : 0, presentDue: after ? after.totalDue : 0,
        operator: u, remarks: s.installments.length ? `Installments ${s.installments.map(n => `#${n}`).join(', ')}` : '',
        installments: s.installments,
        raw: [
          ...(s.principal > 0 ? [{ id: 'p', account: 'HP Principal Amount', entryType: 'principal_payment', credit: s.principal, debit: 0, particulars: `Installments ${s.installments.map(n => `#${n}`).join(', ')}`, user: u }] : []),
          ...(s.interest > 0 ? [{ id: 'i', account: 'HP Interest', entryType: 'interest_payment', credit: s.interest, debit: 0, particulars: 'Installment interest', user: u }] : []),
          ...(s.lateInterest > 0 ? [{ id: 'l', account: 'HP Interest', entryType: 'late_interest', credit: s.lateInterest, debit: 0, particulars: 'Late interest', user: u }] : []),
          ...(s.penalty > 0 ? [{ id: 'n', account: 'HP Penalty', entryType: 'penalty_payment', credit: s.penalty, debit: 0, particulars: 'Penalty', user: u }] : []),
        ],
      });
    }

    transactions.filter(t => String(t.remarks || '').trim().startsWith(HP_NPA_PREFIX)).forEach(t => {
      rows.push({
        id: t.id, txId: t.id, date: String(t.date).slice(0, 10), receiptNo: t.receipt_no || '—', eventType: 'NPA',
        principalPaid: Number(t.amount) || 0, interestPaid: 0, lateInterestPaid: 0, penaltyPaid: 0, docCharges: 0, totalPaid: Number(t.amount) || 0,
        outstandingPrincipal: 0, presentDue: 0, operator: t.collected_by || 'Staff', remarks: 'NPA settlement', installments: [],
        raw: [{ id: 'npa', account: 'HP Principal Amount', entryType: 'npa_settlement', credit: Number(t.amount) || 0, debit: 0, particulars: 'NPA settlement', user: t.collected_by || 'Staff' }],
      });
    });
    return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.eventType === 'Loan Issue' ? -1 : b.eventType === 'Loan Issue' ? 1 : 0));
  }, [selectedLoan, fullPosition, opening, transactions, payments]);

  const pivotTotals = useMemo(() => {
    const t = { principalPaid: 0, interestPaid: 0, penaltyPaid: 0, docCharges: 0, totalPaid: 0, latestOutstanding: 0, latestPresentDue: 0 };
    statementRows.forEach(r => {
      t.principalPaid += r.principalPaid;
      t.interestPaid += r.interestPaid + r.lateInterestPaid;
      t.penaltyPaid += r.penaltyPaid;
      t.docCharges += r.docCharges;
      t.totalPaid += r.totalPaid;
    });
    const last = statementRows[statementRows.length - 1];
    t.latestOutstanding = last ? last.outstandingPrincipal : 0;
    t.latestPresentDue = position ? position.totalDue : 0;
    (Object.keys(t) as (keyof typeof t)[]).forEach(k => { t[k] = hpRound(t[k]); });
    return t;
  }, [statementRows, position]);

  const receiptRows = statementRows.filter(r => r.eventType !== 'Loan Issue' && r.receiptNo && r.receiptNo !== '—');
  const selectedReceipt = receiptRows.find(r => r.id === selectedReceiptId) || null;

  const collectionTxs = transactions.filter(t => t.type === 'Collection' && !isHPOpeningRow(t));
  const paymentTotals = hpRound(collectionTxs.reduce((s, t) => s + (Number(t.amount) || 0), 0));

  const bottomTotals = useMemo(() => {
    const totalCredit = hpRound(transactions.filter(t => t.type === 'Collection').reduce((s, t) => s + (Number(t.amount) || 0), 0));
    const totalDebit = hpRound(transactions.filter(t => t.type === 'Disbursement').reduce((s, t) => s + (Number(t.amount) || 0), 0));
    const insts = position ? position.installments : [];
    const totalDues = hpRound(insts.reduce((s, i) => s + i.amount, 0));
    const paidDues = hpRound(insts.reduce((s, i) => s + i.paid, 0));
    return { totalCredit, totalDebit, presentBalance: position ? position.principalBalance : 0, totalDues, paidDues, pendingDues: hpRound(totalDues - paidDues) };
  }, [transactions, position]);

  // ---------------------------------------------------------------- actions
  const handleActionSubmit = async (action: 'Partial' | 'Installment' | 'Close') => {
    if (!selectedLoan || !position) return;
    if (!preview || !preview.ok) {
      toast.error(preview && !preview.ok ? preview.error : 'Enter the amount paying');
      return;
    }
    if (!receiptNo) {
      toast.error('Receipt number is missing');
      return;
    }
    const kind = action === 'Close' ? 'close' : 'payment';
    if (kind === 'close' && !window.confirm(`Close ${selectedLoan.loan_id} with ${money(amountNum)} (Total for Close)? Future interest is waived.`)) return;
    setIsPosting(true);
    try {
      const res = await supabaseFinance.postHPReceipt({
        loanId: selectedLoan.id, kind, date: paymentDate, amount: amountNum, receiptNo, userName: user?.username || 'Staff'
      });
      if (!res.success) {
        toast.error(res.error || 'Failed to save the receipt');
        return;
      }
      toast.success(res.closed ? `${selectedLoan.loan_id} closed. Receipt ${receiptNo}` : `Receipt ${receiptNo} saved`);
      await handleRefresh();
    } finally {
      setIsPosting(false);
    }
  };

  const handleNPACloseSubmit = async () => {
    if (!selectedLoan || !position) return;
    setIsNpaClosing(true);
    try {
      const closedBy = user?.username || 'Staff';
      const closedAt = new Date(paymentDate).toISOString();
      const settlement = hpRound(Number(npaSettlementAmount) || 0);
      const reason = npaReason.trim().toUpperCase();
      const npaReceiptNo = await supabaseFinance.getNextReceiptNumber();
      const interestDue = hpRound(position.interestDue + position.currentPeriodInterest + position.lateInterestDue);
      const totalLiability = position.totalForClose;

      const { error: loanError } = await supabase.from('finance_loans')
        .update({
          status: 'NPA_CLOSED',
          npa_closed: true,
          remarks: `${selectedLoan.remarks || ''}\n[NPA CLOSED AT ${closedAt} BY ${closedBy} WITH SETTLEMENT AMOUNT: ${settlement}]`.trim().toUpperCase()
        })
        .eq('id', selectedLoan.id);
      if (loanError) throw loanError;

      await supabaseFinance.addNPARecord({
        loan_id: selectedLoan.id,
        customer_id: selectedLoan.customer_id,
        customer_name: String(selectedLoan.customer?.name || '').toUpperCase(),
        phone: selectedLoan.customer?.phone || '',
        loan_type: 'HP',
        loan_amount: Number(selectedLoan.amount) || 0,
        paid_amount: hpRound(position.principalPaid + position.interestPaid + position.lateInterestPaid + position.penaltyPaid),
        balance_amount: position.principalBalance,
        interest_due: interestDue,
        penalty_due: position.penaltyDue,
        settlement_amount: settlement,
        total_liability: totalLiability,
        waived_amount: hpRound(Math.max(0, totalLiability - settlement)),
        reason,
        closed_by: closedBy,
        closed_at: closedAt
      } as any);

      if (settlement > 0) {
        await supabaseFinance.addTransaction({
          loan_id: selectedLoan.id,
          type: 'Collection',
          amount: settlement,
          date: paymentDate,
          remarks: `${HP_NPA_PREFIX} Settlement Collection - ${npaReceiptNo} (Prin: ${settlement.toFixed(2)})`,
          collected_by: closedBy,
          receipt_no: npaReceiptNo
        } as any);
      }
      const waived = hpRound(Math.max(0, totalLiability - settlement));
      if (waived > 0) {
        await supabaseFinance.addWaiverAudit({
          loan_id: selectedLoan.id,
          waived_date: paymentDate,
          waived_by: closedBy,
          waiver_reason: `NPA CLOSE WRITE-OFF: ${reason}`,
          waived_interest: interestDue,
          waived_penalty: position.penaltyDue,
          waived_commission: 0,
          receipt_no: npaReceiptNo
        } as any);
      }
      toast.success('HP account closed under NPA');
      setShowNpaModal(false);
      await handleRefresh();
    } catch (e) {
      console.error(e);
      toast.error('Error closing the HP account under NPA');
    } finally {
      setIsNpaClosing(false);
    }
  };

  const handleExport = () => {
    if (!selectedLoan || !position) {
      toast.error('No ledger data is currently loaded to export');
      return;
    }
    const statement = statementRows.map(r => ({
      'Date': formatDateOld(r.date),
      'Receipt No': r.receiptNo,
      'Type': r.eventType,
      'Principal Paid': r.principalPaid,
      'Interest Paid': hpRound(r.interestPaid + r.lateInterestPaid),
      'Penalty Paid': r.penaltyPaid,
      'Doc Charges': r.docCharges,
      'Total Paid': r.totalPaid,
      'Outstanding Principal': r.outstandingPrincipal,
      'Present Due': r.presentDue,
      'Operator': r.operator,
      'Remarks': r.remarks
    }));
    const installments = position.installments.map(i => ({
      'No': i.no,
      'Due Date': formatDateOld(i.dueDate),
      'Principal': i.principal,
      'Interest': i.interest,
      'Amount': i.amount,
      'Paid': i.paid,
      'Balance': i.balance,
      'Days Late': i.daysLate,
      'Late Interest': i.lateInterest,
      'Penalty': i.penalty,
      'Total (To be paid)': i.toBePaid,
      'Status': i.no === 1 ? 'Kept at disbursement' : i.status
    }));
    const res = exportToExcelMultiSheet(
      [{ name: 'Transactions', data: statement }, { name: 'Installments', data: installments }],
      `${selectedLoan.loan_id}_HP_Ledger_${getLocalBusinessDateISO()}`
    );
    if (res.success) toast.success('Excel ledger exported successfully');
  };

  const openReceiptChooser = () => {
    if (receiptRows.length === 0) {
      toast.error('No receipts on this loan yet');
      return;
    }
    setSelectedReceiptId(receiptRows[receiptRows.length - 1].id);
    setShowReceiptChooser(true);
  };

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const isPendingTx = (tx: any) =>
    !!tx.receipt_no && tx.receipt_no !== '-' && pendingReviews.some(r => r?.receipt_number === tx.receipt_no && r?.loan_id === selectedLoan?.id);

  const txAllocation = (tx: any) => fullPosition?.splits.find(s => s.id === tx.id) || null;

  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
      onClick={() => setActiveLogTab(t)}
      className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all uppercase tracking-wider ${activeLogTab === t ? 'bg-white text-green-800 shadow-sm border border-gray-150' : 'text-slate-900 hover:text-black'}`}
    >
      {label}
    </button>
  );

  const detailCell = (label: string, value: React.ReactNode, span = 'col-span-2') => (
    <div className={`${span} border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm`}>
      <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">{label}</span>
      <span className="text-[16px] font-bold text-slate-900">{value}</span>
    </div>
  );

  const splitBar = (s: { penalty: number; lateInterest: number; interest: number; principal: number; total: number }) => {
    const total = s.total || 1;
    const parts = [
      { v: s.penalty, c: 'bg-rose-500', l: 'Penalty' },
      { v: s.lateInterest, c: 'bg-amber-500', l: 'Late Int' },
      { v: s.interest, c: 'bg-emerald-500', l: 'Interest' },
      { v: s.principal, c: 'bg-indigo-600', l: 'Principal' },
    ];
    return (
      <div className="space-y-1">
        <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner border border-slate-200/40">
          {parts.map(p => p.v > 0 && <div key={p.l} className={`${p.c} h-full transition-all duration-300`} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.l}: ${p.v}`} />)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] font-bold text-slate-800">
          {parts.map(p => p.v > 0 && (
            <span key={p.l} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${p.c}`} />{p.l}: {p.v.toLocaleString('en-IN')}</span>
          ))}
        </div>
      </div>
    );
  };

  const personCard = (title: string, key: string, person: any, photo: string | null | undefined, customerId?: string | null, relation?: string) => (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold uppercase text-slate-500 tracking-wider">{title}</span>
        {customerId && (
          <div className="relative">
            <button type="button" title="More options" onClick={() => setCardMenuOpen(cardMenuOpen === key ? null : key)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
              <MoreVertical className="w-4 h-4" />
            </button>
            {cardMenuOpen === key && (
              <div className="absolute right-0 top-7 z-30 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[170px]">
                <button type="button" onClick={() => { setCardMenuOpen(null); setFullDetailsCustomerId(customerId); }} className="w-full text-left px-3 py-2 text-[14px] font-semibold text-slate-800 hover:bg-slate-50">View full details</button>
              </div>
            )}
          </div>
        )}
      </div>
      {person ? (
        <div className="flex gap-2.5 items-start">
          <div className="w-[72px] h-[92px] shrink-0 rounded-lg bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shadow-sm">
            {photo ? <img src={photo} alt={title} className="w-full h-full object-contain" /> : <User className="w-5 h-5 text-gray-300" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-black text-[18px] text-slate-900 leading-tight break-words">{person.name}</div>
            {relation !== undefined && <div className="text-[13px] text-slate-500 leading-tight truncate">{relation || '—'}</div>}
            <div className="text-[15px] font-bold text-slate-800 mt-0.5">☎ {person.phone || 'N/A'}{person.phone2 ? ` / ${person.phone2}` : ''}</div>
            {person.aadhaar && <div className="text-[14px] font-bold text-slate-700 mt-0.5">AADHAR NO : <span className="font-mono">{person.aadhaar}</span></div>}
            {person.address && <div className="text-[13px] text-slate-500 break-words" title={person.address}>{person.address}</div>}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-14 text-[13px] text-slate-400 italic">Loading…</div>
      )}
    </div>
  );

  const amountInvalid = !preview || !preview.ok;
  const canPartial = isActive && !isPosting && !amountInvalid && previewKind === 'payment' && amountNum < installmentTarget - 0.009;
  const canInstallment = isActive && !isPosting && !amountInvalid && previewKind === 'payment' && amountNum >= installmentTarget - 0.009;
  const canClose = isActive && !isPosting && !amountInvalid && previewKind === 'close';

  // ---------------------------------------------------------------- render
  return (
    <>
      <div className={`space-y-3.5 p-3.5 pt-2 max-w-7xl mx-auto ${showPrintPreview ? 'print:hidden' : 'print:p-0'}`}>

        {/* Top row: unified single-row toolbar */}
        <div className="flex flex-wrap lg:flex-nowrap items-end gap-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm print:hidden w-full">
          <div className="flex flex-wrap items-end gap-3 w-full">
            <div className="flex items-end gap-1.5 shrink-0">
              <div className="w-[210px]">
                <FinanceSmartCalendar
                  value={paymentDate}
                  onChange={setPaymentDate}
                  module="HP_LEDGER"
                  label="PAYMENT DATE"
                  disabled={!!selectedLoan && !isActive}
                  compact={true}
                />
              </div>
              <button
                type="button"
                onClick={() => setPaymentDate(getLocalBusinessDateISO())}
                className="px-2.5 h-[42px] bg-blue-50 text-blue-700 hover:bg-blue-100 text-[11px] font-black uppercase rounded-[12px] border border-blue-200 transition-colors cursor-pointer shadow-2xs"
              >
                TODAY
              </button>
            </div>

            <div className="w-[120px] shrink-0">
              <label className="text-[12px] font-black text-slate-500 uppercase tracking-wider block mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as any); setSelectedLoan(null); }}
                className="w-full bg-white border border-slate-200 rounded-[14px] px-2 text-slate-800 focus:ring-2 focus:ring-slate-900 focus:outline-none h-[42px] font-bold text-[12px] uppercase cursor-pointer shadow-2xs"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="ALL">ALL</option>
                <option value="CLOSED">CLOSED</option>
                <option value="NPA CLOSED">NPA CLOSED</option>
              </select>
            </div>

            <div className="relative flex-1 min-w-[260px]">
              <label className="text-[12px] font-black text-slate-500 uppercase tracking-wider block mb-1">Search</label>
              <div className="relative">
                <input
                  type="text"
                  value={universalSearchQuery !== '' ? universalSearchQuery : (selectedLoan ? `${selectedLoan.loan_id} - ${selectedLoan.customer?.name}` : '')}
                  onChange={(e) => { setUniversalSearchQuery(e.target.value); setShowUniversalDropdown(true); }}
                  onFocus={() => setShowUniversalDropdown(true)}
                  onBlur={() => setTimeout(() => setShowUniversalDropdown(false), 250)}
                  placeholder="Search borrower, HP no., phone, guarantor..."
                  className="w-full bg-white border border-slate-200 rounded-[14px] py-2 pl-9 pr-4 text-[14px] font-semibold text-slate-800 focus:ring-2 focus:ring-slate-900 focus:outline-none h-[42px] shadow-2xs"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              </div>
              {showUniversalDropdown && universalSuggestions.length > 0 && (
                <div className="absolute z-50 w-full bg-white border border-slate-200 rounded-[14px] shadow-lg mt-1 max-h-80 overflow-y-auto">
                  {universalSuggestions.sort((a, b) => sortNumerically(a.loan_id, b.loan_id)).map(loan => (
                    <button
                      key={loan.id}
                      onMouseDown={() => { loadLedgerDetails(loan.id); setUniversalSearchQuery(''); setShowUniversalDropdown(false); }}
                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-[14px] text-slate-700 font-medium border-b border-slate-100 last:border-0"
                    >
                      <div className="font-semibold text-slate-900 flex justify-between">
                        <span>{loan.customer?.name}</span>
                        <span className="text-green-700">{loan.loan_id}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex gap-4 mt-1">
                        <span>Phone: {loan.customer?.phone || '-'}</span>
                        {loan.guarantor_1?.name && <span>G1: {loan.guarantor_1.name}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-600"></div>
            <p className="text-gray-500 finance-section-heading">Compiling HP ledger registry...</p>
          </div>
        ) : !selectedLoan ? (
          /* ========== LOAN INDEX / LIST VIEW ========== */
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <List className="w-5 h-5 text-green-600" />
                  All HP Loans
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">{filteredLoansList.length} loan(s) in the system</p>
              </div>
            </div>
            {(() => {
              const q = universalSearchQuery.toLowerCase().trim();
              const filtered = q
                ? filteredLoansList.filter(loan =>
                  loan.loan_id.toLowerCase().includes(q) ||
                  (loan.customer?.name || '').toLowerCase().includes(q) ||
                  (loan.customer?.phone || '').includes(q))
                : filteredLoansList;
              if (filtered.length === 0) {
                return (
                  <div className="text-center py-16">
                    <p className="text-gray-400 text-sm">
                      {filteredLoansList.length === 0 ? 'No HP loans found in the system.' : `No loans match "${universalSearchQuery}"`}
                    </p>
                  </div>
                );
              }
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        {['#', 'HP Number', 'Borrower Name', 'Phone', 'Loan Amount', 'Status', 'Action'].map(h => (
                          <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filtered.slice().sort((a, b) => sortNumerically(a.loan_id, b.loan_id)).map((loan, idx) => (
                        <tr key={loan.id} className="hover:bg-green-50/50 cursor-pointer transition-colors group" onClick={() => { loadLedgerDetails(loan.id); setUniversalSearchQuery(''); }}>
                          <td className="px-4 py-3.5 text-slate-500 font-mono text-sm">{idx + 1}</td>
                          <td className="px-4 py-3.5 font-black text-base text-green-700 font-mono tracking-wide">{loan.loan_id}</td>
                          <td className="px-4 py-3.5 font-black text-base text-gray-900">{loan.customer?.name || 'N/A'}</td>
                          <td className="px-4 py-3.5 text-gray-600 font-mono">{loan.customer?.phone || '-'}</td>
                          <td className="px-4 py-3.5 font-semibold text-gray-800">{num(Number(loan.amount))}</td>
                          <td className="px-4 py-3.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusChip(loan.status)}`}>{(loan.status || 'Active').toUpperCase()}</span>
                          </td>
                          <td className="px-4 py-3.5"><span className="text-green-600 text-xs font-semibold group-hover:underline">Open →</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        ) : !position ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-800 font-bold">
            {selectedLoan.loan_id}: the HP figures could not be worked out for this account.
          </div>
        ) : (
          <>
            {/* Workspace Header Hub */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm print:hidden">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => { setSelectedLoan(null); setUniversalSearchQuery(''); }}
                  className="inline-flex items-center gap-2 text-xs font-bold text-gray-700 hover:text-slate-900 bg-gray-50 hover:bg-gray-100 border border-gray-200/60 px-3 py-2 rounded-xl transition-all shadow-sm font-sans"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to All
                </button>
                <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
                <h2 className="text-xl font-black text-slate-950 flex flex-wrap items-center gap-2">
                  {selectedLoan.customer?.name}
                  <span className="text-[17px] font-mono text-slate-900 font-bold bg-slate-100 px-3 py-1 rounded-lg">A/C: {selectedLoan.loan_id}</span>
                </h2>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[13px] font-bold ${statusChip(selectedLoan.status)}`}>{(selectedLoan.status || 'Active').toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-auto font-sans">
                <span className="text-[14px] text-slate-800 uppercase tracking-wider font-bold">
                  Record: <span className="text-slate-950 font-black">{currentIndex + 1}</span> of <span className="text-slate-950 font-black">{filteredLoansList.length}</span>
                </span>
                <div className="flex gap-1">
                  <button onClick={() => currentIndex > 0 && loadLedgerDetails(filteredLoansList[currentIndex - 1].id)} disabled={currentIndex <= 0} className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-30" title="Previous Record">
                    <ChevronLeft className="w-4 h-4 text-gray-600" />
                  </button>
                  <button onClick={() => currentIndex < filteredLoansList.length - 1 && loadLedgerDetails(filteredLoansList[currentIndex + 1].id)} disabled={currentIndex < 0 || currentIndex >= filteredLoansList.length - 1} className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-30" title="Next Record">
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
              </div>
            </div>

            {/* Borrower and guarantors */}
            {(() => {
              const showG1 = !!selectedLoan.guarantor_1_id;
              const showG2 = !!selectedLoan.guarantor_2_id;
              const gridCols = showG1 && showG2 ? 'grid-cols-1 md:grid-cols-3' : showG1 || showG2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1';
              return (
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm print:hidden">
                  {fullDetailsCustomerId && <CustomerFullDetails customerId={fullDetailsCustomerId} onClose={() => setFullDetailsCustomerId(null)} />}
                  <div className={`grid ${gridCols} md:divide-x divide-gray-100`}>
                    {personCard('Borrower', 'borrower', selectedLoan.customer, selectedLoan.customer?.customer_photo_url, selectedLoan.customer_id, formatRelationship(selectedLoan.customer?.father_husband_name))}
                    {showG1 && personCard('Guarantor 1', 'g1', guarantor1, guarantor1?.customer_photo_url, selectedLoan.guarantor_1_id)}
                    {showG2 && personCard('Guarantor 2', 'g2', guarantor2, guarantor2?.customer_photo_url, selectedLoan.guarantor_2_id)}
                  </div>
                </div>
              );
            })()}

            {/* ========== OPERATOR WORKSPACE ========== */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 print:hidden">

              {/* LEFT BLOCK: inputs, loan details, action buttons */}
              <div className="lg:col-span-8">
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden h-full flex flex-col">
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-gray-100">
                    <span className="text-[14px] font-bold uppercase text-slate-800 tracking-wider">Operator Action &amp; Calculations</span>
                    {preview && !preview.ok && (
                      <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1 text-red-700 font-semibold text-[12px]">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-red-600" />
                        <span>{preview.error}</span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 flex flex-col gap-3.5 flex-1">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[13px] font-bold text-slate-700 uppercase block mb-1">Receipt No</label>
                        <Input value={receiptNo} readOnly className="bg-gray-50 text-slate-900 font-mono text-[17px] font-bold h-11" />
                      </div>
                      <div>
                        <label className="text-[13px] font-bold text-slate-700 uppercase block mb-1">Total Amount Paying</label>
                        <Input
                          value={totalAmountPaying}
                          onChange={setTotalAmountPaying}
                          className="font-bold text-green-700 text-[18px] h-11"
                          placeholder="Enter "
                          type="text"
                          inputMode="decimal"
                          disabled={!isActive}
                        />
                      </div>
                    </div>

                    {preview && preview.ok && (
                      <div className="bg-slate-50/50 border border-slate-100 rounded-xl px-3 py-2 space-y-2.5 shadow-sm">
                        <h4 className="text-[12px] text-slate-800 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                          Real-Time Payment Allocation
                        </h4>
                        <span className={`text-[12px] font-bold uppercase block ${previewKind === 'close' ? 'text-slate-700' : 'text-emerald-800'}`}>
                          {previewKind === 'close' ? 'Closing Allocation Preview (future interest waived)' : `Installment Allocation: ${preview.split.installments.map(n => `#${n}`).join(', ')}`}
                        </span>
                        {splitBar(preview.split)}
                      </div>
                    )}

                    {/* Loan details grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-sans">
                      {detailCell('Loan Amount', num(Number(selectedLoan.amount)))}
                      <div className="col-span-2 grid grid-cols-2 border border-slate-200 rounded-lg bg-slate-50/80 shadow-sm overflow-hidden">
                        <div className="px-2.5 py-1.5 border-r border-slate-200">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Rate / Penalty</span>
                          <span className="text-[16px] font-bold text-slate-900">{position.contract.interestRate.toFixed(2)}% / {position.contract.penaltyRate.toFixed(2)}%</span>
                          <span className="text-[11px] text-slate-500 font-semibold block leading-none">per period</span>
                        </div>
                        <div className="px-2.5 py-1.5">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Installments</span>
                          <span className="text-[16px] font-bold text-slate-900">{position.installmentsPaid} of {position.installmentsTotal}</span>
                          <span className="text-[11px] text-slate-500 font-semibold block leading-none">every {position.contract.periodDays} days</span>
                        </div>
                      </div>
                      {detailCell('Loan Date', formatDateOld(selectedLoan.date))}
                      {detailCell('Last Payment', formatDateOld(lastPaymentDate) || '—')}
                      {detailCell('Current Due Date', formatDateOld(position.oldestUnpaidDueDate || position.nextDue?.dueDate) || '—')}
                      {detailCell('Next Due Date', formatDateOld(nextUpcoming?.dueDate) || '—')}
                      {detailCell('Installment Amt', num(position.installments[1]?.amount ?? 0), 'col-span-1')}
                      <div className="col-span-1 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Due Days</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[16px] font-bold text-slate-900">{position.dueDays}</span>
                          {position.isNPA && <span className="inline-flex px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-black text-[10px] uppercase tracking-wider">NPA</span>}
                        </div>
                      </div>
                      {detailCell('Doc Status', documentReturned ? 'Returned' : 'Submitted')}
                    </div>

                    {/* Action buttons */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-auto">
                      <Button
                        onClick={() => handleActionSubmit('Partial')}
                        disabled={!canPartial}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1 border-0 animate-none"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        Partial Payment
                      </Button>
                      <Button
                        onClick={() => handleActionSubmit('Installment')}
                        disabled={!canInstallment}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1 border-0 animate-none"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        Installment Payment
                      </Button>
                      <Button
                        onClick={() => handleActionSubmit('Close')}
                        disabled={!canClose}
                        className="bg-rose-600 hover:bg-rose-700 text-white py-2.5 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1 border-0 animate-none"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Close Account
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT BLOCK: Account Position */}
              <div className="lg:col-span-4">
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden h-full flex flex-col">
                  <div className="px-3 py-2.5 border-b border-gray-100">
                    <span className="text-[14px] font-bold uppercase text-slate-800 tracking-wider">Account Position</span>
                  </div>
                  <div className="p-3 flex flex-col gap-2.5 flex-1">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ['Principal Bal.', money(position.principalBalance), 'text-slate-950'],
                        ['Today Due', money(position.totalDue), 'text-amber-700'],
                        ['Late Interest', money(position.lateInterestDue), 'text-slate-950'],
                        ['Penalty', money(position.penaltyDue), 'text-rose-700'],
                      ].map(([label, value, cls]) => (
                        <div key={label} className="bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-sm">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">{label}</span>
                          <span className={`text-[20px] font-bold block leading-snug ${cls}`}>{value}</span>
                        </div>
                      ))}
                    </div>

                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex justify-between items-center shadow-sm">
                      <div>
                        <span className="text-emerald-900 text-[13px] uppercase font-bold tracking-wider block leading-none">Next Installment</span>
                        <span className="text-[12px] text-emerald-700 font-semibold block mt-0.5">
                          {nextUpcoming ? `#${nextUpcoming.no} due ${formatDateOld(nextUpcoming.dueDate)}` : 'No installment left'}
                        </span>
                      </div>
                      <span className="text-[22px] font-extrabold text-emerald-800">{money(nextUpcoming?.balance ?? 0)}</span>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex justify-between items-center shadow-sm">
                      <div>
                        <span className="text-amber-900 text-[13px] uppercase font-bold tracking-wider block leading-none">Total to Regularize</span>
                        <span className="text-[12px] text-amber-700 font-semibold block mt-0.5">Overdue installments + late charges</span>
                      </div>
                      <span className="text-[22px] font-extrabold text-amber-800">{money(totalToRegularize)}</span>
                    </div>

                    <div className="bg-slate-950 border border-slate-900 rounded-xl px-3 py-2 flex justify-between items-center shadow-md">
                      <div>
                        <span className="text-white text-[13px] uppercase font-bold tracking-wider block leading-none">Total for Close</span>
                        <span className="text-[12px] text-slate-400 font-semibold block mt-0.5">Principal + due interest + late charges</span>
                      </div>
                      <span className="text-[22px] font-extrabold text-emerald-400">{isActive ? money(position.totalForClose) : '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Statements & Logs */}
            <Card
              title={
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
                  <div>
                    <span className="text-base font-extrabold text-slate-950 block">Statements &amp; Logs</span>
                    <span className="text-xs text-slate-600 font-bold block mt-0.5">Track installments, transaction history and interest</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 bg-gray-100 border border-gray-200 p-1 rounded-xl self-start sm:self-auto font-sans">
                    {tabBtn('installments', 'Installments')}
                    {tabBtn('statement', 'Ledger Statement')}
                    {tabBtn('interest', 'Interest History')}
                    {tabBtn('payment', 'Payment History')}
                    {tabBtn('editHistory', 'Edit History')}
                  </div>
                </div>
              }
              className="shadow-sm border-gray-100 rounded-3xl w-full font-sans print:hidden animate-none relative"
            >
              {activeLogTab === 'installments' && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin rounded-2xl border border-slate-200">
                  <table className="w-full text-xs text-left min-w-[950px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100/95 text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">No</th>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">Due Date</th>
                        <th className="px-3.5 py-3.5 text-right text-blue-800 whitespace-nowrap">Principal</th>
                        <th className="px-3.5 py-3.5 text-right text-emerald-800 whitespace-nowrap">Interest</th>
                        <th className="px-3.5 py-3.5 text-right text-indigo-950 whitespace-nowrap">Amount</th>
                        <th className="px-3.5 py-3.5 text-right text-green-800 whitespace-nowrap">Paid</th>
                        <th className="px-3.5 py-3.5 text-right text-rose-800 whitespace-nowrap">Balance</th>
                        <th className="px-3.5 py-3.5 text-center whitespace-nowrap">Days Late</th>
                        <th className="px-3.5 py-3.5 text-right text-amber-800 whitespace-nowrap">Late Interest</th>
                        <th className="px-3.5 py-3.5 text-right text-rose-800 whitespace-nowrap">Penalty</th>
                        <th className="px-3.5 py-3.5 text-right text-rose-950 whitespace-nowrap">Total (To be paid)</th>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {position.installments.map(i => (
                        <tr key={i.no} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors">
                          <td className="px-3.5 py-3 font-mono font-black text-slate-900">#{i.no}</td>
                          <td className="px-3.5 py-3 font-bold text-slate-900 whitespace-nowrap">{formatDateOld(i.dueDate)}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-bold text-blue-700">{num(i.principal)}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-bold text-emerald-700">{i.interest > 0 ? num(i.interest) : '—'}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-black text-indigo-900">{num(i.amount)}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-bold text-green-700">{i.paid > 0 ? num(i.paid) : '—'}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-black text-rose-700">{i.balance > 0 ? num(i.balance) : '—'}</td>
                          <td className="px-3.5 py-3 text-center font-mono font-bold text-slate-800">{i.daysLate > 0 ? i.daysLate : '—'}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-bold text-amber-700">{i.lateInterest > 0 ? num(i.lateInterest) : '—'}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-bold text-rose-700">{i.penalty > 0 ? num(i.penalty) : '—'}</td>
                          <td className="px-3.5 py-3 text-right font-mono font-black text-rose-950">{i.toBePaid > 0 ? num(i.toBePaid) : '—'}</td>
                          <td className="px-3.5 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${i.no === 1 ? 'bg-blue-100 text-blue-800 border border-blue-200' : instChip[i.status]}`}>
                              {i.no === 1 ? 'Kept at disbursement' : i.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 text-slate-900 font-mono font-black text-xs border-t-2 border-slate-300">
                      <tr>
                        <td colSpan={2} className="px-3.5 py-3 uppercase text-right font-sans font-bold text-slate-700">TOTALS:</td>
                        <td className="px-3.5 py-3 text-right text-blue-800">{num(hpRound(position.installments.reduce((s, i) => s + i.principal, 0)))}</td>
                        <td className="px-3.5 py-3 text-right text-emerald-800">{num(hpRound(position.installments.reduce((s, i) => s + i.interest, 0)))}</td>
                        <td className="px-3.5 py-3 text-right text-indigo-950">{num(bottomTotals.totalDues)}</td>
                        <td className="px-3.5 py-3 text-right text-green-800">{num(bottomTotals.paidDues)}</td>
                        <td className="px-3.5 py-3 text-right text-rose-800">{num(bottomTotals.pendingDues)}</td>
                        <td></td>
                        <td className="px-3.5 py-3 text-right text-amber-800">{num(hpRound(position.installments.reduce((s, i) => s + i.lateInterest, 0)))}</td>
                        <td className="px-3.5 py-3 text-right text-rose-800">{num(hpRound(position.installments.reduce((s, i) => s + i.penalty, 0)))}</td>
                        <td className="px-3.5 py-3 text-right text-rose-950">{num(hpRound(position.installments.reduce((s, i) => s + i.toBePaid, 0)))}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {activeLogTab === 'statement' && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1 scrollbar-thin">
                  <table className="w-full text-xs text-left min-w-[1100px] border-collapse">
                    <thead>
                      <tr className="bg-slate-100/90 text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-200">
                        <th className="w-8 px-3.5 py-3.5 text-center"></th>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">Date</th>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">Receipt No</th>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">Type</th>
                        <th className="px-3.5 py-3.5 text-right text-blue-800 whitespace-nowrap">Principal Paid</th>
                        <th className="px-3.5 py-3.5 text-right text-emerald-800 whitespace-nowrap">Interest Paid</th>
                        <th className="px-3.5 py-3.5 text-right text-amber-800 whitespace-nowrap">Penalty Paid</th>
                        <th className="px-3.5 py-3.5 text-right text-purple-800 whitespace-nowrap">Doc Charges</th>
                        <th className="px-3.5 py-3.5 text-right text-indigo-950 whitespace-nowrap">Total Paid</th>
                        <th className="px-3.5 py-3.5 text-right text-rose-800 whitespace-nowrap">Outstanding</th>
                        <th className="px-3.5 py-3.5 text-right text-rose-950 whitespace-nowrap">Present Due</th>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">Operator</th>
                        <th className="px-3.5 py-3.5 whitespace-nowrap">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {statementRows.map(row => {
                        const isExpanded = expandedRowIds.has(row.id);
                        const interest = hpRound(row.interestPaid + row.lateInterestPaid);
                        return (
                          <React.Fragment key={row.id}>
                            <tr className={`hover:bg-blue-50/40 transition-colors ${row.eventType === 'Loan Issue' ? 'bg-slate-50/80 font-semibold' : ''}`}>
                              <td className="px-2.5 py-3 text-center">
                                <button type="button" onClick={() => toggle(expandedRowIds, row.id, setExpandedRowIds)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition-colors cursor-pointer" title={isExpanded ? 'Collapse Audit Details' : 'Expand Audit Details'}>
                                  {isExpanded ? <ChevronDown className="w-4 h-4 text-blue-600" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                </button>
                              </td>
                              <td className="px-3.5 py-3 font-bold text-slate-900 whitespace-nowrap">{formatDateOld(row.date)}</td>
                              <td className="px-3.5 py-3 font-mono font-black text-slate-900 whitespace-nowrap">{row.receiptNo}</td>
                              <td className="px-3.5 py-3 font-bold uppercase text-[11px] whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${eventChip(row.eventType)}`}>{row.eventType}</span>
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">{row.principalPaid > 0 ? num(row.principalPaid) : '—'}</td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">{interest > 0 ? num(interest) : '—'}</td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-amber-700 whitespace-nowrap">{row.penaltyPaid > 0 ? num(row.penaltyPaid) : '—'}</td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-purple-700 whitespace-nowrap">{row.docCharges > 0 ? num(row.docCharges) : '—'}</td>
                              <td className="px-3.5 py-3 text-right font-mono font-black text-indigo-900 whitespace-nowrap">{row.totalPaid > 0 ? num(row.totalPaid) : '—'}</td>
                              <td className="px-3.5 py-3 text-right font-mono font-black text-rose-700 whitespace-nowrap">{num(row.outstandingPrincipal)}</td>
                              <td className="px-3.5 py-3 text-right font-mono font-black text-rose-900 whitespace-nowrap">{num(row.presentDue)}</td>
                              <td className="px-3.5 py-3 text-slate-700 font-medium whitespace-nowrap">{row.operator}</td>
                              <td className="px-3.5 py-3 text-slate-800 font-medium text-[11px] truncate max-w-[200px]" title={row.remarks}>{row.remarks}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-slate-50/90">
                                <td colSpan={13} className="px-6 py-3 border-y border-slate-200">
                                  <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 shadow-sm">
                                    <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-700 border-b pb-1.5">
                                      <span className="flex items-center gap-1.5 text-blue-900">
                                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                                        AUDIT DRILL-DOWN ({row.raw.length} Postings)
                                      </span>
                                      <span className="text-slate-500 font-normal">Receipt: <span className="font-bold text-slate-800">{row.receiptNo}</span></span>
                                    </div>
                                    <table className="w-full text-[11px] text-left border-collapse">
                                      <thead>
                                        <tr className="bg-slate-100/90 text-slate-700 font-bold uppercase border-b border-slate-200">
                                          <th className="p-1.5">Account Name</th>
                                          <th className="p-1.5">Entry Type</th>
                                          <th className="p-1.5 text-right text-emerald-800">Credit</th>
                                          <th className="p-1.5 text-right text-rose-800">Debit</th>
                                          <th className="p-1.5">Particulars</th>
                                          <th className="p-1.5">User</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 font-mono">
                                        {row.raw.map(raw => (
                                          <tr key={raw.id} className="hover:bg-slate-50">
                                            <td className="p-1.5 font-bold text-slate-900">{raw.account}</td>
                                            <td className="p-1.5 text-slate-600">{raw.entryType}</td>
                                            <td className="p-1.5 text-right text-emerald-700 font-bold">{raw.credit > 0 ? num(raw.credit) : '—'}</td>
                                            <td className="p-1.5 text-right text-rose-700 font-bold">{raw.debit > 0 ? num(raw.debit) : '—'}</td>
                                            <td className="p-1.5 font-sans text-slate-700">{raw.particulars || '—'}</td>
                                            <td className="p-1.5 font-sans text-slate-600">{raw.user}</td>
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
                    </tbody>
                    {statementRows.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-100/90 text-slate-900 font-mono font-black text-xs border-t-2 border-slate-300">
                          <td colSpan={4} className="px-3.5 py-3.5 uppercase text-right font-sans font-bold text-slate-700">GRAND TOTALS:</td>
                          <td className="px-3.5 py-3.5 text-right text-blue-800">{num(pivotTotals.principalPaid)}</td>
                          <td className="px-3.5 py-3.5 text-right text-emerald-800">{num(pivotTotals.interestPaid)}</td>
                          <td className="px-3.5 py-3.5 text-right text-amber-800">{num(pivotTotals.penaltyPaid)}</td>
                          <td className="px-3.5 py-3.5 text-right text-purple-800">{num(pivotTotals.docCharges)}</td>
                          <td className="px-3.5 py-3.5 text-right text-indigo-950">{num(pivotTotals.totalPaid)}</td>
                          <td className="px-3.5 py-3.5 text-right text-rose-800">{num(pivotTotals.latestOutstanding)}</td>
                          <td className="px-3.5 py-3.5 text-right text-rose-950">{num(pivotTotals.latestPresentDue)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {activeLogTab === 'interest' && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin rounded-2xl border border-slate-200">
                  <table className="w-full text-xs text-left min-w-[950px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100/95 text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3.5 whitespace-nowrap">Date</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Receipt No</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Type</th>
                        <th className="px-4 py-3.5 text-right text-emerald-800 whitespace-nowrap">Interest Paid</th>
                        <th className="px-4 py-3.5 text-right text-amber-800 whitespace-nowrap">Late Interest</th>
                        <th className="px-4 py-3.5 text-right text-rose-800 whitespace-nowrap">Penalty Paid</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Installments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-sans">
                      {statementRows.filter(r => r.eventType !== 'Loan Issue' && r.eventType !== 'NPA').map(row => (
                        <tr key={row.id} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{formatDateOld(row.date)}</td>
                          <td className="px-4 py-3 font-mono font-black text-slate-900 whitespace-nowrap">{row.receiptNo}</td>
                          <td className="px-4 py-3 font-bold uppercase text-[11px] whitespace-nowrap"><span className={`px-2 py-0.5 rounded text-[10px] font-black ${eventChip(row.eventType)}`}>{row.eventType}</span></td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">{row.interestPaid > 0 ? num(row.interestPaid) : '—'}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-amber-700 whitespace-nowrap">{row.lateInterestPaid > 0 ? num(row.lateInterestPaid) : '—'}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-rose-700 whitespace-nowrap">{row.penaltyPaid > 0 ? num(row.penaltyPaid) : '—'}</td>
                          <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{row.installments.map(n => `#${n}`).join(', ') || '—'}</td>
                        </tr>
                      ))}
                      {statementRows.filter(r => r.eventType !== 'Loan Issue' && r.eventType !== 'NPA').length === 0 && (
                        <tr><td colSpan={7} className="text-center py-8 text-slate-400 italic">No interest transactions logged</td></tr>
                      )}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 text-slate-900 font-mono font-black text-xs border-t-2 border-slate-300">
                      <tr>
                        <td colSpan={3} className="px-4 py-3 uppercase text-right font-sans font-bold text-slate-700">TOTAL INTEREST COLLECTED:</td>
                        <td className="px-4 py-3 text-right text-emerald-800">{num(fullPosition?.interestPaid ?? 0)}</td>
                        <td className="px-4 py-3 text-right text-amber-800">{num(fullPosition?.lateInterestPaid ?? 0)}</td>
                        <td className="px-4 py-3 text-right text-rose-800">{num(fullPosition?.penaltyPaid ?? 0)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {activeLogTab === 'payment' && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin rounded-2xl border border-slate-200">
                  <table className="w-full text-xs text-left min-w-[950px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100/95 text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-200">
                      <tr>
                        <th className="w-8 px-3.5 py-3.5 text-center"></th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Date</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Receipt No</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Transaction Type</th>
                        <th className="px-4 py-3.5 text-right text-indigo-950 whitespace-nowrap">Amount Paid</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Collected By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-sans">
                      {collectionTxs.map(tx => {
                        const isExpanded = expandedTxIds.has(tx.id);
                        const alloc = txAllocation(tx);
                        const pending = isPendingTx(tx);
                        const rem = String(tx.remarks || '').trim();
                        const label = rem.startsWith(HP_CLOSE_PREFIX) ? 'HP Close' : rem.startsWith(HP_NPA_PREFIX) ? 'HP NPA Settlement' : 'HP Amount Paid';
                        return (
                          <React.Fragment key={tx.id}>
                            <tr className={`odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors ${pending ? 'bg-[#fff7ed]' : ''}`}>
                              <td className="px-2.5 py-3 text-center">
                                <button onClick={() => toggle(expandedTxIds, tx.id, setExpandedTxIds)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition-colors cursor-pointer" title={isExpanded ? 'Collapse Allocation' : 'Expand Allocation'}>
                                  {isExpanded ? <ChevronDown className="w-4 h-4 text-blue-600" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                </button>
                              </td>
                              <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{formatDateOld(tx.date)}</td>
                              <td className="px-4 py-3 font-mono font-black text-slate-900 whitespace-nowrap">
                                {tx.receipt_no || '—'}
                                {pending && <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold bg-orange-50 text-orange-700 border border-orange-200 uppercase tracking-wide">Pending Approval</span>}
                              </td>
                              <td className="px-4 py-3 font-bold uppercase text-[11px] whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">{label}</span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-black text-indigo-900 text-sm whitespace-nowrap">{num(Number(tx.amount))}</td>
                              <td className="px-4 py-3 text-slate-700 font-medium whitespace-nowrap">{tx.collected_by || 'Staff'}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-slate-50/90">
                                <td colSpan={6} className="px-6 py-3 border-y border-slate-200">
                                  <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 shadow-sm">
                                    <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-700 border-b pb-1.5">
                                      <span className="flex items-center gap-1.5 text-blue-900">
                                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                                        PAYMENT ALLOCATION BREAKDOWN
                                      </span>
                                      <span className="text-slate-500 font-normal">Receipt: <span className="font-bold text-slate-800">{tx.receipt_no || '—'}</span></span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
                                      {[
                                        ['HP Principal', alloc ? alloc.principal : (rem.startsWith(HP_NPA_PREFIX) ? Number(tx.amount) : 0), 'text-blue-700'],
                                        ['HP Interest', alloc ? hpRound(alloc.interest + alloc.lateInterest) : 0, 'text-emerald-700'],
                                        ['HP Penalty', alloc ? alloc.penalty : 0, 'text-amber-700'],
                                      ].map(([l, v, c]) => (
                                        <div key={l as string} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                                          <span className="text-slate-500 uppercase font-sans font-bold tracking-wider text-[10px] block mb-0.5">{l}</span>
                                          <span className={`text-sm font-black ${c}`}>{(v as number) > 0 ? num(v as number) : '—'}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {collectionTxs.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-8 text-slate-400 italic">No collection transactions recorded</td></tr>
                      )}
                    </tbody>
                    {collectionTxs.length > 0 && (
                      <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 text-slate-900 font-mono font-black text-xs border-t-2 border-slate-300">
                        <tr>
                          <td colSpan={4} className="px-4 py-3 uppercase text-right font-sans font-bold text-slate-700">TOTAL CASH COLLECTED:</td>
                          <td className="px-4 py-3 text-right text-indigo-950">{num(paymentTotals)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {activeLogTab === 'editHistory' && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin rounded-2xl border border-slate-200">
                  <table className="w-full text-xs text-left min-w-[950px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100/95 text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3.5 whitespace-nowrap">Edited At</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Operator</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Receipt No</th>
                        <th className="px-4 py-3.5 text-right whitespace-nowrap">Original Date</th>
                        <th className="px-4 py-3.5 text-right whitespace-nowrap">New Date</th>
                        <th className="px-4 py-3.5 text-right whitespace-nowrap">Original Amt</th>
                        <th className="px-4 py-3.5 text-right text-emerald-800 whitespace-nowrap">New Amt</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Reason / Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-sans">
                      {editLogs.map((log: any, idx: number) => {
                        const oldD = log.old_values || {};
                        const newD = log.new_values || {};
                        const changed = Object.keys(newD).filter(k => k !== 'updated_at' && JSON.stringify(oldD[k]) !== JSON.stringify(newD[k]));
                        const d = (v: any) => (v ? formatDateOld(String(v).slice(0, 10)) : '—');
                        return (
                          <tr key={log.id || idx} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors">
                            <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{log.edited_at ? new Date(log.edited_at).toLocaleString('en-IN') : '—'}</td>
                            <td className="px-4 py-3 text-slate-800 font-bold whitespace-nowrap">{log.edited_by || 'Operator'}</td>
                            <td className="px-4 py-3 font-mono font-black text-slate-900 whitespace-nowrap">{newD.receipt_no || oldD.receipt_no || '—'}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-500 whitespace-nowrap">{d(oldD.date)}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900 whitespace-nowrap">{d(newD.date)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-slate-600 whitespace-nowrap">{oldD.amount !== undefined ? num(Number(oldD.amount)) : '—'}</td>
                            <td className="px-4 py-3 text-right font-mono font-black text-emerald-700 whitespace-nowrap">{newD.amount !== undefined ? num(Number(newD.amount)) : '—'}</td>
                            <td className="px-4 py-3 text-slate-800 font-medium text-[11px] max-w-[260px]" title={changed.join(', ')}>
                              {log.reason || (changed.length ? `Changed: ${changed.slice(0, 6).join(', ')}` : (log.table_name || '—'))}
                            </td>
                          </tr>
                        );
                      })}
                      {editLogs.length === 0 && (
                        <tr><td colSpan={8} className="text-center py-8 text-slate-400 italic">No transaction edit history logged</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Totals Summary Footer Card & Buttons */}
            <div className="bg-white px-5 py-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col gap-3 print:hidden">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Total Credit</span>
                  <span className={`text-sm font-black font-mono tabular-nums ${bottomTotals.totalCredit > 0 ? 'text-green-700' : 'text-slate-300'}`}>{num(bottomTotals.totalCredit)}</span>
                </div>
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Total Debit</span>
                  <span className={`text-sm font-black font-mono tabular-nums ${bottomTotals.totalDebit > 0 ? 'text-red-600' : 'text-slate-300'}`}>{num(bottomTotals.totalDebit)}</span>
                </div>
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Present Bal.</span>
                  <span className={`text-sm font-black font-mono tabular-nums ${bottomTotals.presentBalance <= 0 ? 'text-slate-300' : bottomTotals.presentBalance < bottomTotals.totalDebit * 0.25 ? 'text-emerald-600' : 'text-amber-700'}`}>{num(bottomTotals.presentBalance)}</span>
                </div>
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Total Dues</span>
                  <span className={`text-sm font-black font-mono tabular-nums ${bottomTotals.totalDues > 0 ? 'text-slate-800' : 'text-slate-300'}`}>{num(bottomTotals.totalDues)}</span>
                  {bottomTotals.totalDues > 0 && (
                    <div className="w-full h-[3px] bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{
                        width: `${Math.min(100, Math.round((bottomTotals.paidDues / bottomTotals.totalDues) * 100))}%`,
                        background: bottomTotals.pendingDues <= 0 ? '#16a34a' : bottomTotals.paidDues > 0 ? '#f59e0b' : '#ef4444',
                      }} />
                    </div>
                  )}
                </div>
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Partner</span>
                  <span className="text-sm font-black font-sans text-slate-800 truncate max-w-[150px]" title={selectedLoan.partner_name || selectedLoan.customer?.partner_name || '—'}>
                    {selectedLoan.partner_name || selectedLoan.customer?.partner_name || '—'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-50">
                <Button onClick={() => setShowPrintPreview(true)} variant="primary" size="sm" icon={Printer} className="bg-green-600 hover:bg-green-700 border-0 text-white rounded-xl shadow-sm text-xs py-2 px-4">Open Report</Button>
                <Button onClick={openReceiptChooser} variant="primary" size="sm" icon={Printer} className="bg-indigo-600 hover:bg-indigo-700 border-0 text-white rounded-xl shadow-sm text-xs py-2 px-4">Receipt Print</Button>
                <Button onClick={() => { setNpaReason(''); setNpaSettlementAmount(''); setShowNpaModal(true); }} disabled={!isActive} variant="danger" size="sm" icon={ShieldAlert} className="bg-orange-600 hover:bg-orange-700 text-white border-0 rounded-xl shadow-sm text-xs py-2 px-4">NPA Close</Button>
                <Button onClick={handleRefresh} variant="secondary" size="sm" icon={RefreshCw} className="rounded-xl border-gray-200 text-xs py-2 px-4">Refresh</Button>
                <Button onClick={handleExport} variant="secondary" size="sm" icon={Download} className="rounded-xl border-gray-200 text-emerald-700 hover:bg-emerald-50 text-xs py-2 px-4">Excel</Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Report print (A4) */}
      <FinancePrintPreview
        isOpen={showPrintPreview && !!selectedLoan && !!position}
        onClose={() => setShowPrintPreview(false)}
        title="Print Preview (A4 Friendly Layout)"
        documentTitle="HP Loan Ledger Report Card"
      >
        {selectedLoan && position && opening && (
          <div className="space-y-6 text-gray-800 font-sans text-xs p-1">
            <div className="flex justify-between items-start border-b-2 border-double border-gray-300 pb-4">
              <div>
                <h1 className="text-xl font-black text-gray-900 tracking-wide uppercase">Thirumala Finance Groups</h1>
                <span className="text-xs text-gray-500 uppercase tracking-widest block font-medium">HP Loan Ledger statement</span>
              </div>
              <div className="text-right">
                <div className="text-lg font-black text-green-700 bg-green-50 px-3 py-1.5 rounded-xl border border-green-200 inline-block font-mono">A/C: {selectedLoan.loan_id}</div>
                <div className="text-xs text-gray-500 font-extrabold uppercase mt-1">CUSTOMER: {selectedLoan.customer?.name}</div>
                <div className="text-[9px] text-gray-400 mt-0.5">OPERATOR: {user?.username || 'Staff'} | PRINTED: {new Date().toLocaleString('en-IN').replace(/\s/g, '')}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border-b pb-4">
              {[
                { t: 'Borrower Details', p: selectedLoan.customer, photo: selectedLoan.customer?.customer_photo_url, rel: formatRelationship(selectedLoan.customer?.father_husband_name) },
                { t: 'Guarantor 1 Details', p: guarantor1, photo: guarantor1?.customer_photo_url },
                { t: 'Guarantor 2 Details', p: guarantor2, photo: guarantor2?.customer_photo_url },
              ].map(({ t, p, photo, rel }) => (
                <div key={t} className="p-3 bg-gray-50/50 rounded-2xl border border-gray-100 flex gap-3">
                  <div className="flex-1 space-y-1 text-[10px] font-sans">
                    <span className="text-[10px] font-black uppercase text-green-800 tracking-wider block border-b pb-0.5 mb-1.5">{t}</span>
                    {p ? (
                      <>
                        <div className="flex justify-between"><span className="text-gray-400">Name:</span> <span className="font-extrabold text-gray-900">{p.name}</span></div>
                        {rel !== undefined && <div className="flex justify-between"><span className="text-gray-400">S/o W/o:</span> <span className="font-bold text-gray-800">{rel || 'N/A'}</span></div>}
                        <div className="flex justify-between"><span className="text-gray-400">Phone:</span> <span className="font-bold text-gray-800">{p.phone || 'N/A'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Aadhaar:</span> <span className="font-bold text-gray-800 font-mono">{p.aadhaar || 'N/A'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Address:</span> <span className="font-bold text-gray-800 truncate max-w-[80px]" title={p.address || undefined}>{p.address || 'N/A'}</span></div>
                      </>
                    ) : <span className="text-gray-400 italic block py-2">None</span>}
                  </div>
                  {p && (
                    <div className="w-14 h-18 shrink-0 rounded-lg bg-white border border-gray-200 overflow-hidden flex items-center justify-center shadow-sm">
                      {photo ? <img src={photo} alt={t} className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-gray-300" />}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
              <div className="space-y-1.5 text-[11px] font-sans">
                <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Opening Details</span>
                <div className="flex justify-between"><span className="text-slate-500">Loan Date:</span> <span className="font-extrabold text-slate-900">{formatDateOld(selectedLoan.date)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Opening Loan Principal:</span> <span className="font-extrabold text-slate-900">{money(Number(selectedLoan.amount))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Installment 1 kept at disbursement:</span> <span className="font-extrabold text-slate-900">{money(opening.installment1Principal)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Document Charges Paid:</span> <span className="font-extrabold text-slate-900">{money(opening.docCharges)}</span></div>
              </div>
              <div className="space-y-1.5 text-[11px] font-sans">
                <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Current Balance State</span>
                <div className="flex justify-between"><span className="text-slate-500">Current Principal Balance:</span> <span className="font-extrabold text-green-700">{money(position.principalBalance)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Pending Late Interest:</span> <span className="font-extrabold text-orange-600">{money(position.lateInterestDue)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Pending Penalty:</span> <span className="font-extrabold text-red-600">{money(position.penaltyDue)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Next Due Date:</span> <span className="font-extrabold text-slate-900">{formatDateOld(nextUpcoming?.dueDate) || '—'}</span></div>
              </div>
            </div>

            {(() => {
              const details: Array<[string, string]> = [
                ['Loan Amount', money(Number(selectedLoan.amount))],
                ['Rate / Penalty (per period)', `${position.contract.interestRate.toFixed(2)}% / ${position.contract.penaltyRate.toFixed(2)}%`],
                ['Installments', `${position.installmentsPaid} of ${position.installmentsTotal} (every ${position.contract.periodDays} days)`],
                ['Installment Amount', money(position.installments[1]?.amount ?? 0)],
                ['Loan Date', formatDateOld(selectedLoan.date) || '—'],
                ['Last Payment', formatDateOld(lastPaymentDate) || '—'],
                ['Current Due Date', formatDateOld(position.oldestUnpaidDueDate || position.nextDue?.dueDate) || '—'],
                ['Due Days', String(position.dueDays)],
                ['Document Status', documentReturned ? 'Returned' : 'Submitted'],
              ];
              const pos: Array<[string, string, string]> = [
                ['Principal Balance', money(position.principalBalance), ''],
                ['Today Due', money(position.totalDue), ''],
                ['Late Interest', money(position.lateInterestDue), ''],
                ['Penalty', money(position.penaltyDue), ''],
                ['Next Installment', money(nextUpcoming?.balance ?? 0), nextUpcoming ? `#${nextUpcoming.no} due ${formatDateOld(nextUpcoming.dueDate)}` : ''],
                ['Total to Regularize', money(totalToRegularize), 'Overdue installments + late charges'],
                ['Total for Close', isActive ? money(position.totalForClose) : '—', 'Principal + due interest + late charges'],
              ];
              return (
                <div className="grid grid-cols-2 gap-6 p-4 rounded-2xl border border-slate-300" style={{ breakInside: 'avoid' }}>
                  <div className="space-y-1.5 text-[11px] font-sans">
                    <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Loan Details</span>
                    {details.map(([l, v]) => <div key={l} className="flex justify-between gap-3"><span className="text-slate-500">{l}:</span> <span className="font-extrabold text-slate-900 whitespace-nowrap">{v}</span></div>)}
                  </div>
                  <div className="space-y-1.5 text-[11px] font-sans">
                    <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Account Position</span>
                    {pos.map(([l, v, h]) => (
                      <div key={l} className="flex justify-between gap-3">
                        <span className="text-slate-500">{l}:{h && <span className="block text-[9px] text-slate-400">{h}</span>}</span>
                        <span className="font-extrabold text-slate-900 whitespace-nowrap">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2">
              <h4 className="text-green-800 border-b pb-1 text-[10px] font-bold uppercase tracking-wider">Installment Schedule</h4>
              <table className="w-full border border-gray-300 text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b border-gray-300 text-gray-700 uppercase text-[9px] font-bold">
                    {['No', 'Due Date', 'Amount', 'Paid', 'Balance', 'Days Late', 'Late Int.', 'Penalty', 'Total (To be paid)', 'Status'].map(h => <th key={h} className={`p-1.5 border-r ${['No', 'Due Date', 'Status'].includes(h) ? '' : 'text-right'}`}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 font-mono text-gray-700">
                  {position.installments.map(i => (
                    <tr key={i.no}>
                      <td className="p-1.5 border-r font-sans">#{i.no}</td>
                      <td className="p-1.5 border-r font-sans whitespace-nowrap">{formatDateOld(i.dueDate)}</td>
                      <td className="p-1.5 border-r text-right">{num(i.amount)}</td>
                      <td className="p-1.5 border-r text-right">{i.paid > 0 ? num(i.paid) : '—'}</td>
                      <td className="p-1.5 border-r text-right">{i.balance > 0 ? num(i.balance) : '—'}</td>
                      <td className="p-1.5 border-r text-right">{i.daysLate > 0 ? i.daysLate : '—'}</td>
                      <td className="p-1.5 border-r text-right">{i.lateInterest > 0 ? num(i.lateInterest) : '—'}</td>
                      <td className="p-1.5 border-r text-right">{i.penalty > 0 ? num(i.penalty) : '—'}</td>
                      <td className="p-1.5 border-r text-right font-bold">{i.toBePaid > 0 ? num(i.toBePaid) : '—'}</td>
                      <td className="p-1.5 font-sans uppercase text-[9px] font-bold">{i.no === 1 ? 'Kept at disbursement' : i.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <h4 className="text-green-800 border-b pb-1 text-[10px] font-bold uppercase tracking-wider">Statement Ledger (Pivot Event History)</h4>
              <table className="w-full border border-gray-300 text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b border-gray-300 text-gray-700 uppercase text-[9px] font-bold">
                    {['Sl No', 'Date', 'Receipt No', 'Type', 'Principal', 'Interest', 'Penalty', 'Doc Charges', 'Total Paid', 'Outstanding', 'Present Due', 'Remarks'].map(h => (
                      <th key={h} className={`p-1.5 border-r ${['Sl No', 'Date', 'Receipt No', 'Type', 'Remarks'].includes(h) ? '' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 font-mono text-gray-700">
                  {statementRows.map((row, idx) => (
                    <tr key={row.id}>
                      <td className="p-1.5 border-r text-center font-sans text-slate-500">{idx + 1}</td>
                      <td className="p-1.5 border-r font-sans whitespace-nowrap">{formatDateOld(row.date)}</td>
                      <td className="p-1.5 border-r font-black text-slate-900">{row.receiptNo}</td>
                      <td className="p-1.5 border-r font-bold uppercase text-[9px]">{row.eventType}</td>
                      <td className="p-1.5 border-r text-right text-blue-800 font-bold">{row.principalPaid > 0 ? num(row.principalPaid) : '—'}</td>
                      <td className="p-1.5 border-r text-right text-green-800 font-bold">{row.interestPaid + row.lateInterestPaid > 0 ? num(hpRound(row.interestPaid + row.lateInterestPaid)) : '—'}</td>
                      <td className="p-1.5 border-r text-right text-amber-700 font-bold">{row.penaltyPaid > 0 ? num(row.penaltyPaid) : '—'}</td>
                      <td className="p-1.5 border-r text-right text-purple-700 font-bold">{row.docCharges > 0 ? num(row.docCharges) : '—'}</td>
                      <td className="p-1.5 border-r text-right text-indigo-900 font-black">{row.totalPaid > 0 ? num(row.totalPaid) : '—'}</td>
                      <td className="p-1.5 border-r text-right text-rose-700 font-black">{num(row.outstandingPrincipal)}</td>
                      <td className="p-1.5 border-r text-right text-rose-900 font-black">{num(row.presentDue)}</td>
                      <td className="p-1.5 font-sans text-gray-700 truncate max-w-[120px]">{row.remarks}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-black border-t-2 border-slate-300 text-slate-900 text-[10px]">
                    <td colSpan={4} className="p-1.5 border-r text-right font-sans">GRAND TOTALS:</td>
                    <td className="p-1.5 border-r text-right text-blue-800">{num(pivotTotals.principalPaid)}</td>
                    <td className="p-1.5 border-r text-right text-green-800">{num(pivotTotals.interestPaid)}</td>
                    <td className="p-1.5 border-r text-right text-amber-700">{num(pivotTotals.penaltyPaid)}</td>
                    <td className="p-1.5 border-r text-right text-purple-700">{num(pivotTotals.docCharges)}</td>
                    <td className="p-1.5 border-r text-right text-indigo-900">{num(pivotTotals.totalPaid)}</td>
                    <td className="p-1.5 border-r text-right text-rose-700">{num(pivotTotals.latestOutstanding)}</td>
                    <td className="p-1.5 border-r text-right text-rose-900">{num(pivotTotals.latestPresentDue)}</td>
                    <td className="p-1.5"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="pt-16 grid grid-cols-2 gap-20 text-center text-gray-500 text-[10px] font-semibold">
              <div><div className="border-t border-gray-300 pt-1.5 w-32 mx-auto">Borrower Signature</div></div>
              <div><div className="border-t border-gray-300 pt-1.5 w-32 mx-auto">Auditor Signature</div></div>
            </div>
          </div>
        )}
      </FinancePrintPreview>

      {/* Receipt chooser */}
      {showReceiptChooser && selectedLoan && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowReceiptChooser(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-[16px] font-black uppercase text-slate-900">Select Receipt to Print</h3>
                <p className="text-[12px] font-bold uppercase text-slate-500">{selectedLoan.loan_id} · {selectedLoan.customer?.name}</p>
              </div>
              <button onClick={() => setShowReceiptChooser(false)} className="p-1.5 rounded hover:bg-slate-200 text-slate-600" title="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-100 sticky top-0">
                  <tr className="text-[11px] uppercase text-slate-600">
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 text-left">Receipt No</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Total Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptRows.map(r => (
                    <tr key={r.id} onClick={() => setSelectedReceiptId(r.id)} className={`cursor-pointer border-b border-slate-100 ${selectedReceiptId === r.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-3 py-2 text-center"><input type="radio" readOnly checked={selectedReceiptId === r.id} className="accent-indigo-600" /></td>
                      <td className="px-3 py-2 font-mono font-bold text-slate-900 whitespace-nowrap">{r.receiptNo}</td>
                      <td className="px-3 py-2 font-bold whitespace-nowrap">{formatDateOld(r.date)}</td>
                      <td className="px-3 py-2 font-bold uppercase text-[12px]">{r.eventType}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold whitespace-nowrap">{formatReceiptAmount(r.totalPaid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button onClick={() => setShowReceiptChooser(false)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-[13px] font-bold uppercase text-slate-700 hover:bg-slate-100">Cancel</button>
              <button disabled={!selectedReceipt} onClick={() => { setShowReceiptChooser(false); setShowReceiptPreview(true); }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-bold uppercase hover:bg-indigo-700 disabled:opacity-50">
                <Printer className="w-4 h-4" /> Preview Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt print (A4) */}
      <FinancePrintPreview
        isOpen={showReceiptPreview && !!selectedLoan && !!selectedReceipt}
        onClose={() => setShowReceiptPreview(false)}
        title="Receipt Print Preview (A4)"
        subtitle={selectedReceipt ? `Receipt ${selectedReceipt.receiptNo}` : undefined}
        documentTitle="GAJWEL, DIST: SIDDIPET, TELANGANA"
      >
        {selectedLoan && selectedReceipt && (() => {
          const r = selectedReceipt;
          const cust: any = selectedLoan.customer || {};
          const phone = [cust.phone_1 || cust.phone, cust.phone_2 || cust.phone2].filter(Boolean).join(' / ');
          const guardian = formatRelationship(cust.father_name || cust.father_husband_name);
          const lines = [
            { label: 'Principal Paid', value: r.principalPaid },
            { label: 'Interest Paid', value: hpRound(r.interestPaid + r.lateInterestPaid) },
            { label: 'Penalty Paid', value: r.penaltyPaid },
          ];
          return (
            <div className="cd-receipt uppercase text-black">
              <style>{`
                .cd-receipt .rc-title { font-size: 18px; font-weight: 800; letter-spacing: 2px; text-align: center; margin: 0 0 14px; }
                .cd-receipt .rc-meta { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
                .cd-receipt table { width: 100%; border-collapse: collapse; }
                .cd-receipt td { border: 1px solid #555; padding: 7px 10px; font-size: 14px; vertical-align: top; }
                .cd-receipt td.rc-label { width: 40%; font-weight: 700; background: #f3f4f6; }
                .cd-receipt td.rc-amt { text-align: right; white-space: nowrap; font-weight: 700; font-variant-numeric: tabular-nums; }
                .cd-receipt tr.rc-total td { font-size: 16px; font-weight: 800; background: #e5e7eb; }
                .cd-receipt .rc-words { margin-top: 10px; font-size: 13px; font-weight: 700; }
                .cd-receipt .font-mono { font-size: 15px; font-weight: 700; }
                .cd-receipt .rc-sign { display: flex; justify-content: space-between; margin-top: 70px; font-size: 13px; font-weight: 700; }
                .cd-receipt .rc-sign div { border-top: 1px solid #000; padding-top: 6px; width: 38%; text-align: center; }
                @media print {
                  .print-document .cd-receipt td { font-size: 11pt !important; padding: 6px 9px !important; border: 1px solid #000 !important; vertical-align: top !important; }
                  .print-document .cd-receipt .font-mono { font-size: 11.5pt !important; }
                  .print-document .cd-receipt td.rc-label { background: #f0f2f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                  .print-document .cd-receipt tr.rc-total td { font-size: 12.5pt !important; background: #e5e7eb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
              `}</style>
              <div className="rc-title">Payment Receipt</div>
              <div className="rc-meta">
                <span>Receipt No: <span className="font-mono">{r.receiptNo}</span></span>
                <span>Date: {formatDateOld(r.date)}</span>
              </div>
              <table className="mb-4">
                <tbody>
                  <tr><td className="rc-label">HP No</td><td className="font-mono font-bold">{selectedLoan.loan_id}</td></tr>
                  <tr><td className="rc-label">Customer Name</td><td className="font-bold">{cust.name || '—'}</td></tr>
                  <tr><td className="rc-label">Guardian</td><td>{guardian || '—'}</td></tr>
                  <tr><td className="rc-label">Phone</td><td className="font-mono">{phone || '—'}</td></tr>
                  <tr><td className="rc-label">Payment Type</td><td>{r.eventType}{r.installments.length ? ` (Installments ${r.installments.map(n => `#${n}`).join(', ')})` : ''}</td></tr>
                </tbody>
              </table>
              <table>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.label}><td className="rc-label">{l.label}</td><td className="rc-amt">{formatReceiptAmount(l.value)}</td></tr>
                  ))}
                  <tr className="rc-total"><td className="rc-label">Total Paid</td><td className="rc-amt">{formatReceiptAmount(r.totalPaid)}</td></tr>
                  <tr><td className="rc-label">Balance Principal Outstanding</td><td className="rc-amt">{formatReceiptAmount(r.outstandingPrincipal)}</td></tr>
                </tbody>
              </table>
              <div className="rc-words">Amount in words: {amountInWords(r.totalPaid)}</div>
              <div className="rc-words">Received by (Operator): {r.operator || '—'}</div>
              <div className="rc-sign">
                <div>Customer Signature</div>
                <div>Cashier Signature</div>
              </div>
            </div>
          );
        })()}
      </FinancePrintPreview>

      {/* NPA Close (HP: settlement amount collected, the rest written off) */}
      {showNpaModal && selectedLoan && position && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl relative">
            <button onClick={() => setShowNpaModal(false)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-orange-600" />
              NPA Close
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 text-orange-900 border border-orange-200 rounded-2xl text-sm leading-relaxed">
                <p className="font-semibold mb-1">Confirm NPA Close</p>
                <p>Enter the settlement amount collected (0 if nothing). Whatever is not collected from the Total for Close is written off, and the loan is marked NPA closed.</p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono tabular-nums text-[14px]">
                  <span className="font-sans">Principal</span><span className="text-right">{money(position.principalBalance)}</span>
                  <span className="font-sans">Interest</span><span className="text-right">{money(hpRound(position.interestDue + position.currentPeriodInterest + position.lateInterestDue))}</span>
                  <span className="font-sans">Penalty</span><span className="text-right">{money(position.penaltyDue)}</span>
                  <span className="font-sans font-bold border-t border-orange-200 pt-1">Total for Close</span><span className="text-right font-bold border-t border-orange-200 pt-1">{money(position.totalForClose)}</span>
                  <span className="font-sans font-bold">Written off</span><span className="text-right font-bold">{money(Math.max(0, hpRound(position.totalForClose - (Number(npaSettlementAmount) || 0))))}</span>
                </div>
              </div>
              <Input label="Settlement Amount Collected" type="number" value={npaSettlementAmount} onChange={setNpaSettlementAmount} placeholder="0.00" />
              <Input label="Reason / Remarks" value={npaReason} onChange={v => setNpaReason(v.toUpperCase())} placeholder="Enter reason/remarks for NPA closure" required />
              <div className="pt-4 flex gap-3">
                <Button onClick={() => setShowNpaModal(false)} variant="secondary" className="flex-1 rounded-xl">Cancel</Button>
                <Button onClick={handleNPACloseSubmit} variant="danger" className="flex-1 bg-orange-600 hover:bg-orange-700 text-white rounded-xl" disabled={isNpaClosing || !npaReason.trim()}>
                  {isNpaClosing ? 'Processing...' : 'Close NPA Account'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HPLedger;
