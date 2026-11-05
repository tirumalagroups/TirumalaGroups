import { sortNumerically } from '../../lib/financialCalculations';
import React, { useEffect, useState, useMemo } from 'react';
import { allocateCDPayment } from '../../services/cdLedgerEngine';

import Card from '../../components/UI/Card';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { supabaseFinance, FinanceLoan, FinanceCustomer, FinanceTransaction, FinanceDue, FinanceDocument, FinancePartner } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import { cdLedgerRebuildService } from '../../services/cdLedgerRebuildService';
import { useAuth } from '../../contexts/AuthContext';
import { clearFinanceCalendarCache } from '../../services/financeCalendarService';
import { financeCalculationService } from '../../services/financeCalculationService';
import {
  Printer,
  Download,
  RefreshCw,
  Search,
  Edit2,
  X,
  User,
  File as FileIcon,
  ShieldAlert,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  List,
  MoreVertical,
} from 'lucide-react';
import CustomerFullDetails from '../../components/finance/CustomerFullDetails';
import { normalizeCDLedgerEntries } from '../../utils/cdLedgerNormalize';
import toast from 'react-hot-toast';
import { exportToExcel, exportToCSV } from '../../utils/excel';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import CompoundInterestModal from '../../components/finance/CompoundInterestModal';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import { formatRelationship } from '../../utils/relationship';
import { receiptRowsFromStatement, formatReceiptAmount, amountInWords } from '../../utils/cdReceiptPrint';
import { cdCompoundInterestEngine, TOOLTIP_TEXT } from '../../services/cdCompoundInterestEngine';



const mapAccountName = (name: string): string => {
  const cleanName = (name || '').trim().toUpperCase();
  if (cleanName === 'CD A/C') return 'CD Principal Amount';
  if (cleanName === 'CD COMMISSION A/C') return 'CD Interest';
  if (cleanName === 'PENALTY A/C') return 'CD Penalty';
  if (cleanName === 'CD DOCUMENT CHARGES A/C') return 'CD Document Charges';
  if (cleanName === 'CD AMOUNT PAID') return 'CD Amount Paid';
  if (cleanName === 'CD LOAN RECEIVABLE A/C') return 'NPA Pending';
  if (cleanName === 'CD DISBURSEMENT') return 'CD Principal Amount';
  return name || 'CD Principal Amount';
};
// Same row clean-up is shared with Payment Follow-up (src/utils/cdLedgerNormalize.ts)

const formatCDCurrency = (val: number | undefined): string => {
  if (val === undefined || isNaN(val)) return '0.00';
  if (val < 0) {
    return `-${Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const CDLedger: React.FC = () => {
  const { user } = useAuth();


  // Permission Check
  const hasAccess = useMemo(() => {
    return user?.is_admin || user?.features.includes('cd_ledger');
  }, [user]);

  // UI / State
  const [loading, setLoading] = useState(true);
  // Full details dialog opened from the ⋮ menu on the borrower / guarantor cards
  const [fullDetailsCustomerId, setFullDetailsCustomerId] = useState<string | null>(null);
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);
  const [loansList, setLoansList] = useState<(FinanceLoan & { customer: FinanceCustomer; guarantor_1?: FinanceCustomer; guarantor_2?: FinanceCustomer })[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'CLOSED' | 'NPA CLOSED'>('ACTIVE');

  const filteredLoansList = useMemo(() => {
    return loansList.filter(loan => {
      if (statusFilter === 'ACTIVE') return loan.status === 'Active';
      if (statusFilter === 'CLOSED') return loan.status === 'Closed';
      if (statusFilter === 'NPA CLOSED') return loan.status === 'NPA_CLOSED';
      return true;
    });
  }, [loansList, statusFilter]);

  // Custom Autocomplete Search State
  const [universalSearchQuery, setUniversalSearchQuery] = useState('');
  const [showUniversalDropdown, setShowUniversalDropdown] = useState(false);

  const [selectedLoan, setSelectedLoan] = useState<(FinanceLoan & { customer: FinanceCustomer; transactions: FinanceTransaction[]; photos: any[]; dues: FinanceDue[]; documents: FinanceDocument[] }) | null>(null);

  const [paymentDate, setPaymentDate] = useState(() => getLocalBusinessDateISO());
  const [partnersData, setPartnersData] = useState<FinancePartner[]>([]);
  const [expandedPivotRowIds, setExpandedPivotRowIds] = useState<Set<string>>(new Set());

  const togglePivotRowExpand = (id: string) => {
    setExpandedPivotRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    let isMounted = true;
    const fetchPartners = async () => {
      try {
        const data = await supabaseFinance.getPartners();
        if (isMounted && data) setPartnersData(data);
      } catch (err) {
        console.error('Error fetching partners:', err);
      }
    };
    fetchPartners();
    return () => { isMounted = false; };
  }, []);

  const handleTodayPaymentDate = () => {
    setPaymentDate(getLocalBusinessDateISO());
  };

  // Partner Allocations calculation for selected loan
  const partnerAllocations = useMemo(() => {
    if (!selectedLoan) return [];
    const loanPrincipal = Number(selectedLoan.amount) || 0;

    const partnerList = (partnersData.length > 0) ? partnersData : [
      { id: 'p1', name: 'BUKKA RAMESH', share_percent: 48.30, is_md: true },
      { id: 'p2', name: 'SAI VINITH BUKKA', share_percent: 20.40, is_md: false },
      { id: 'p3', name: 'BUKKA SAI VIVEK', share_percent: 20.00, is_md: false },
      { id: 'p4', name: 'VIRAJA BUKKA', share_percent: 11.30, is_md: false },
    ];

    const PARTNER_COLORS: Record<string, string> = {
      'BUKKA RAMESH': '#2563eb',
      'RAMESH': '#2563eb',
      'SAI VINITH BUKKA': '#16a34a',
      'SAI VINITH': '#16a34a',
      'BUKKA SAI VIVEK': '#0284c7',
      'SAI VIVEK': '#0284c7',
      'SAI': '#0284c7',
      'VIRAJA BUKKA': '#9333ea',
      'VIRAJA': '#9333ea',
    };

    const assignedName = (selectedLoan.partner_name || selectedLoan.customer?.partner_name || '').trim().toUpperCase();

    if (assignedName) {
      const matchedPartner = partnerList.find(p => p.name.trim().toUpperCase() === assignedName || p.name.trim().toUpperCase().includes(assignedName));
      if (matchedPartner) {
        return [{
          id: matchedPartner.id,
          name: matchedPartner.name,
          is_md: matchedPartner.is_md || false,
          sharePercent: 100.00,
          principalShare: loanPrincipal,
          color: PARTNER_COLORS[matchedPartner.name.trim().toUpperCase()] || '#2563eb'
        }];
      }
    }

    let cumulativePrincipal = 0;
    const rows = partnerList.map((p, idx) => {
      const pct = Number(p.share_percent) || 0;
      let pShare = (idx === partnerList.length - 1)
        ? (loanPrincipal - cumulativePrincipal)
        : Math.round((pct / 100) * loanPrincipal);

      cumulativePrincipal += pShare;

      return {
        id: p.id,
        name: p.name,
        is_md: p.is_md || false,
        sharePercent: pct,
        principalShare: pShare,
        color: PARTNER_COLORS[p.name.trim().toUpperCase()] || '#2563eb'
      };
    });

    return rows;
  }, [selectedLoan, partnersData]);

  const totalPartnerPrincipal = useMemo(() => partnerAllocations.reduce((sum, p) => sum + p.principalShare, 0), [partnerAllocations]);
  const totalPartnerPercent = useMemo(() => partnerAllocations.reduce((sum, p) => sum + p.sharePercent, 0), [partnerAllocations]);

  useEffect(() => {
    if (!selectedLoan || partnerAllocations.length === 0) return;
    const loanPrincipal = Number(selectedLoan.amount) || 0;
    
    if (Math.abs(totalPartnerPrincipal - loanPrincipal) > 1) {
      console.warn(`[PARTNER RECONCILIATION WARNING] Total Partner Principal Share (${totalPartnerPrincipal}) does not match Loan Principal (${loanPrincipal}).`);
    }
    if (Math.abs(totalPartnerPercent - 100) > 0.1) {
      console.warn(`[PARTNER PERCENTAGE WARNING] Total Partner Share Percent (${totalPartnerPercent}%) does not equal 100%.`);
    }
  }, [selectedLoan, partnerAllocations, totalPartnerPrincipal, totalPartnerPercent]);




  // Print Preview Modal State
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  // Receipt print: chooser (pick a receipt) + A4 preview
  const [showReceiptChooser, setShowReceiptChooser] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showCompoundModal, setShowCompoundModal] = useState(false);

  // Return Document Modal State
  const [returnDate, setReturnDate] = useState(() => getLocalBusinessDateISO());
  const [returnedTo, setReturnedTo] = useState('');
  const [returnRemarks, setReturnRemarks] = useState('');
  const [isReturningDoc, setIsReturningDoc] = useState(false);
  const [returnSignature, setReturnSignature] = useState<File | null>(null);
  const [isRenewing, setIsRenewing] = useState(false);
  const [showReturnDocModal, setShowReturnDocModal] = useState(false);

  // New Tables State
  const [cdLedgerEntries, setCdLedgerEntries] = useState<any[]>([]);
  const [cdInterestDetails, setCdInterestDetails] = useState<any[]>([]);

  // Action Panel State
  const [totalAmountPaying, setTotalAmountPaying] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [activeLogTab, setActiveLogTab] = useState<'statement' | 'interest' | 'payment' | 'editHistory'>('statement');
  const [editLogs, setEditLogs] = useState<any[]>([]);
  const [pendingReviews, setPendingReviews] = useState<any[]>([]);
  const [loanTransactions, setLoanTransactions] = useState<any[]>([]);
  const [showEditTxModal, setShowEditTxModal] = useState(false);
  const [editingTx, setEditingTx] = useState<any | null>(null);
  const [editTxReceiptNo, setEditTxReceiptNo] = useState('');
  const [editTxDate, setEditTxDate] = useState('');
  const [editTxAmount, setEditTxAmount] = useState('');
  const [editTxReason, setEditTxReason] = useState('');
  const [isSavingTx, setIsSavingTx] = useState(false);
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());
  const toggleExpandTx = (txId: string) => {
    const newSet = new Set(expandedTxIds);
    if (newSet.has(txId)) {
      newSet.delete(txId);
    } else {
      newSet.add(txId);
    }
    setExpandedTxIds(newSet);
  };

  // NPA Modal State
  const [showNpaModal, setShowNpaModal] = useState(false);
  const [npaReason, setNpaReason] = useState('');
  const [isNpaClosing, setIsNpaClosing] = useState(false);

  // Guarantor Full Objects for Display
  const [guarantor1, setGuarantor1] = useState<any | null>(null);
  const [guarantor2, setGuarantor2] = useState<any | null>(null);
  const [documentReturned, setDocumentReturned] = useState<any | null>(null);
  // Real-time ticking Clock State removed (unused)

  useEffect(() => {
    if (hasAccess) {
      fetchLedgerData();
    }
  }, [hasAccess]);

  const fetchLedgerData = async () => {
    setLoading(true);
    try {
      const allLoans = await supabaseFinance.getCDLoansList();
      try {
        const pending = await supabaseFinance.getTransactionReviews({ status: 'PENDING' });
        setPendingReviews(pending || []);
      } catch (err) {
        console.error('Failed to fetch pending reviews:', err);
      }

      // Show ONLY CD loans in CD Ledger
      const cdLoans = allLoans.filter((l: any) => l.loan_category === 'CD');
      setLoansList(cdLoans);

      // Do NOT auto-load — show the index/list view on mount
    } catch (err) {
      console.error(err);
      toast.error('Failed to load ledger data');
    } finally {
      setLoading(false);
    }
  };

  const [loadingTab, setLoadingTab] = useState(false);

  const loadTabDetails = async (tab: 'statement' | 'interest' | 'payment' | 'editHistory', loanId: string) => {
    setLoadingTab(true);
    try {
      if (tab === 'statement' || tab === 'interest') {
        const [entries, interests] = await Promise.all([
          supabaseFinance.getCDLedgerEntries(loanId),
          supabaseFinance.getCDInterestDetails(loanId)
        ]);

        const normalizedEntries = normalizeCDLedgerEntries(entries || []);
        setCdLedgerEntries(normalizedEntries);
        setCdInterestDetails(interests || []);
      } else if (tab === 'payment') {
        const { data: txs } = await supabase
          .from('finance_transactions')
          .select('id, date, amount, type, remarks, collected_by, receipt_no')
          .eq('loan_id', loanId)
          .order('date', { ascending: true });
        
        const sortedTxs = [...(txs || [])].sort((a, b) => {
          const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
          if (dateDiff !== 0) return dateDiff;
          
          const aReceipt = a.receipt_no || '';
          const bReceipt = b.receipt_no || '';
          const receiptDiff = aReceipt.localeCompare(bReceipt, undefined, { numeric: true, sensitivity: 'base' });
          if (receiptDiff !== 0) return receiptDiff;
          
          return String(a.id).localeCompare(String(b.id));
        });
        setLoanTransactions(sortedTxs);
      } else if (tab === 'editHistory') {
        const { data: editLogsData } = await supabase
          .from('finance_cd_transaction_edit_logs')
          .select('*')
          .eq('loan_id', loanId)
          .order('edited_at', { ascending: false });
        setEditLogs(editLogsData || []);
      }
    } catch (err) {
      console.error('Error loading tab details:', err);
    } finally {
      setLoadingTab(false);
    }
  };

  useEffect(() => {
    if (selectedLoan?.id) {
      loadTabDetails(activeLogTab, selectedLoan.id);
    }
  }, [activeLogTab, selectedLoan?.id]);

  const loadLedgerDetails = async (loanId: string) => {
    setLoading(true);
    try {
      const fullDetails = await supabaseFinance.getLoanById(loanId);
      if (fullDetails) {
        setSelectedLoan(fullDetails);



        // Fetch remaining core details in parallel
        const [
          g1Res,
          g2Res,
          _docsRes,
          _colLogsRes,
          retDocsRes,
          nextReceipt,
          cdEntries,
          cdInterests
        ] = await Promise.all([
          fullDetails.guarantor_1_id
            ? supabase.from('finance_customers').select('id, name, phone, customer_photo_url, aadhaar, address').eq('id', fullDetails.guarantor_1_id).single()
            : Promise.resolve({ data: null }),
          fullDetails.guarantor_2_id
            ? supabase.from('finance_customers').select('id, name, phone, customer_photo_url, aadhaar, address').eq('id', fullDetails.guarantor_2_id).single()
            : Promise.resolve({ data: null }),
          supabase.from('finance_loan_documents').select('*').eq('loan_id', loanId),
          supabase.from('finance_edited_logs').select('*').eq('table_name', 'finance_loans_collateral').eq('record_id', loanId).order('edited_at', { ascending: false }).limit(1),
          supabase.from('finance_documents_returned').select('*').eq('loan_id', loanId).order('created_at', { ascending: false }).limit(1),
          supabaseFinance.getNextReceiptNumber(),
          supabaseFinance.getCDLedgerEntries(loanId),
          supabaseFinance.getCDInterestDetails(loanId)
        ]);

        setGuarantor1(g1Res.data || null);
        setGuarantor2(g2Res.data || null);

        setDocumentReturned(retDocsRes.data && retDocsRes.data.length > 0 ? retDocsRes.data[0] : null);
        setReceiptNo(nextReceipt);
        setTotalAmountPaying('');

        // Populate entries and interest details immediately on select/refresh
        const normalizedEntries = normalizeCDLedgerEntries(cdEntries || []);
        setCdLedgerEntries(normalizedEntries);
        setCdInterestDetails(cdInterests || []);
      } else {
        toast.error('Ledger details could not be resolved');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error fetching CD ledger details');
    } finally {
      setLoading(false);
    }
  };

  const refreshLoanData = async () => {
    if (!selectedLoan?.id) return;
    const loanId = selectedLoan.id;
    try {
      await fetchLedgerData();
      await loadLedgerDetails(loanId);
      await Promise.all([
        loadTabDetails('statement', loanId),
        loadTabDetails('interest', loanId),
        loadTabDetails('payment', loanId),
        loadTabDetails('editHistory', loanId)
      ]);
    } catch (err) {
      console.error('Failed to refresh loan data:', err);
    }
  };

  const handleRefresh = async () => {
    if (selectedLoan) {
      await refreshLoanData();
    } else {
      await fetchLedgerData();
    }
  };

  const handleOpenEditTxModal = (tx: any) => {
    setEditingTx(tx);
    setEditTxReceiptNo(tx.receipt_no || '');
    setEditTxDate(tx.date ? new Date(tx.date).toISOString().split('T')[0] : '');
    
    setEditTxAmount(String(tx.amount || ''));
    setEditTxReason('');
    setShowEditTxModal(true);
  };

  const handleSaveEditTx = async () => {
    if (!editingTx || !selectedLoan) return;
    if (!editTxReceiptNo.trim() || !editTxDate || !editTxAmount || !editTxReason.trim()) {
      toast.error('All required fields must be filled.');
      return;
    }
    const amt = parseFloat(editTxAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Amount must be greater than 0.');
      return;
    }

    setIsSavingTx(true);
    try {
      // 1. Check for duplicate receipt numbers for same loan (excluding current transaction)
      const { data: dupTx, error: dupError } = await supabase
        .from('finance_transactions')
        .select('id')
        .eq('loan_id', selectedLoan.id)
        .eq('receipt_no', editTxReceiptNo.trim())
        .neq('id', editingTx.id)
        .maybeSingle();

      if (dupError) throw dupError;
      if (dupTx) {
        toast.error(`Receipt number ${editTxReceiptNo.trim()} is already used for another transaction on this loan.`);
        setIsSavingTx(false);
        return;
      }

      // Prepare old and new data for audit log
      const oldData = {
        receipt_no: editingTx.receipt_no,
        date: editingTx.date,
        amount: editingTx.amount,
        remarks: editingTx.remarks,
        type: editingTx.type
      };

      const newData = {
        receipt_no: editTxReceiptNo.trim(),
        date: editTxDate,
        amount: amt,
        remarks: editingTx.remarks || '',
        type: 'Collection'
      };

      // 2. Update transaction record
      const { error: txUpdateError } = await supabase
        .from('finance_transactions')
        .update({
          receipt_no: newData.receipt_no,
          date: new Date(newData.date).toISOString(),
          amount: newData.amount,
          remarks: newData.remarks,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingTx.id);

      if (txUpdateError) throw txUpdateError;

      // 3. Log the edit audit
      try {
        const username = user?.username || 'Staff';
        await supabase
          .from('finance_cd_transaction_edit_logs')
          .insert({
            loan_id: selectedLoan.id,
            transaction_id: editingTx.id,
            old_data: oldData,
            new_data: newData,
            edited_by: username,
            reason: editTxReason.trim()
          });

        await supabaseFinance.logTransactionForReview({
          loanId: selectedLoan.id,
          sourceType: 'Loan Payment',
          sourceId: editingTx.id,
          receiptNo: newData.receipt_no,
          transactionType: 'CD Collection Edition',
          transactionDate: newData.date,
          amount: newData.amount,
          enteredBy: username,
          actionType: 'EDIT'
        });
      } catch (logErr) {
        console.error('Failed to write audit log:', logErr);
      }

      // 4. Run rebuild
      const rebuildResult = await cdLedgerRebuildService.rebuildCDLoanLifecycle(selectedLoan.id, 'FULL_RECALCULATE');
      if (!rebuildResult.success) {
        throw new Error(rebuildResult.error || 'Rebuild failed');
      }

      toast.success('Transaction updated and loan rebuilt successfully');
      setShowEditTxModal(false);
      setEditingTx(null);
      
      // Refresh details
      await refreshLoanData();
    } catch (err: any) {
      console.error('Error saving transaction edit:', err);
      toast.error(err.message || 'Failed to edit transaction');
    } finally {
      setIsSavingTx(false);
    }
  };

  const handleDeleteTx = async (tx: any) => {
    if (!selectedLoan) return;
    if (!user?.is_admin) {
      toast.error('Only administrators can delete transactions.');
      return;
    }

    const confirmDelete = window.confirm(`Are you sure you want to delete transaction ${tx.receipt_no || ''} of ${Number(tx.amount).toLocaleString('en-IN')}? This will completely rebuild the loan lifecycle.`);
    if (!confirmDelete) return;

    const reason = window.prompt('Please enter the reason for deleting this transaction (Mandatory):');
    if (reason === null) return; // User cancelled prompt
    if (!reason.trim()) {
      toast.error('Delete reason is mandatory.');
      return;
    }

    try {
      // 1. Prepare log snapshot
      const oldData = {
        receipt_no: tx.receipt_no,
        date: tx.date,
        amount: tx.amount,
        remarks: tx.remarks,
        type: tx.type
      };

      // 2. Log audit log first (before deleting)
      try {
        const username = user?.username || 'Admin';
        await supabase
          .from('finance_cd_transaction_edit_logs')
          .insert({
            loan_id: selectedLoan.id,
            transaction_id: tx.id,
            old_data: oldData,
            new_data: { status: 'Deleted' },
            edited_by: username,
            reason: reason.trim()
          });

        await supabaseFinance.logTransactionForReview({
          loanId: selectedLoan.id,
          sourceType: 'Loan Payment',
          sourceId: tx.id,
          receiptNo: tx.receipt_no,
          transactionType: 'CD Collection Deletion',
          transactionDate: tx.date,
          amount: Number(tx.amount),
          enteredBy: username,
          actionType: 'DELETE'
        });
      } catch (logErr) {
        console.error('Failed to log delete audit:', logErr);
      }

      // 3. Delete transaction record
      const { error: deleteError } = await supabase
        .from('finance_transactions')
        .delete()
        .eq('id', tx.id);

      if (deleteError) throw deleteError;

      // 4. Run rebuild
      const rebuildResult = await cdLedgerRebuildService.rebuildCDLoanLifecycle(selectedLoan.id, 'FULL_RECALCULATE');
      if (!rebuildResult.success) {
        throw new Error(rebuildResult.error || 'Rebuild failed');
      }

      toast.success('Transaction deleted and loan rebuilt successfully');
      
      // Refresh details
      await refreshLoanData();
    } catch (err: any) {
      console.error('Error deleting transaction:', err);
      toast.error(err.message || 'Failed to delete transaction');
    }
  };



  // Autocomplete Suggestions logic
  const universalSuggestions = useMemo(() => {
    const q = universalSearchQuery.toLowerCase().trim();
    if (!q) return [];
    return filteredLoansList.filter(loan => {
      const cust = loan.customer;
      const g1 = loan.guarantor_1;
      const g2 = loan.guarantor_2;
      return (
        loan.loan_id.toLowerCase().includes(q) ||
        (cust?.name && cust.name.toLowerCase().includes(q)) ||
        (cust?.phone && cust.phone.includes(q)) ||
        (cust?.phone2 && cust.phone2.includes(q)) ||
        (cust?.phone_1 && cust.phone_1.includes(q)) ||
        (cust?.phone_2 && cust.phone_2.includes(q)) ||
        (cust?.aadhaar && cust.aadhaar.includes(q)) ||
        (cust?.partner_name && cust.partner_name.toLowerCase().includes(q)) ||
        (g1?.name && g1.name.toLowerCase().includes(q)) ||
        (g1?.phone && g1.phone.includes(q)) ||
        (g1?.aadhaar && g1.aadhaar.includes(q)) ||
        (g2?.name && g2.name.toLowerCase().includes(q)) ||
        (g2?.phone && g2.phone.includes(q)) ||
        (g2?.aadhaar && g2.aadhaar.includes(q)) ||
        (cust?.village && cust.village.toLowerCase().includes(q)) ||
        (cust?.mandal && cust.mandal.toLowerCase().includes(q)) ||
        (cust?.district && cust.district.toLowerCase().includes(q)) ||
        (cust?.aadhaar_village && cust.aadhaar_village.toLowerCase().includes(q)) ||
        (cust?.aadhaar_mandal && cust.aadhaar_mandal.toLowerCase().includes(q)) ||
        (cust?.aadhaar_district && cust.aadhaar_district.toLowerCase().includes(q)) ||
        (cust?.present_village && cust.present_village.toLowerCase().includes(q)) ||
        (cust?.present_mandal && cust.present_mandal.toLowerCase().includes(q)) ||
        (cust?.present_district && cust.present_district.toLowerCase().includes(q))
      );
    }).slice(0, 50); // limit to 50 results to prevent massive dropdown
  }, [filteredLoansList, universalSearchQuery]);

  // Record Index Navigator Memo
  const currentIndex = useMemo(() => {
    if (!selectedLoan || filteredLoansList.length === 0) return -1;
    return filteredLoansList.findIndex(l => l.id === selectedLoan.id);
  }, [selectedLoan, filteredLoansList]);

  const handlePrevRecord = () => {
    if (currentIndex > 0) {
      loadLedgerDetails(filteredLoansList[currentIndex - 1].id);
    }
  };

  const handleNextRecord = () => {
    if (currentIndex < filteredLoansList.length - 1) {
      loadLedgerDetails(filteredLoansList[currentIndex + 1].id);
    }
  };



  // Dynamic calculations based on payment date and selected loan
  const renewCalculations = useMemo(() => {
    try {
      return financeCalculationService.getCDAccountPosition(
        selectedLoan,
        cdLedgerEntries,
        cdInterestDetails,
        paymentDate
      ) as any;
    } catch (err: any) {
      if (err.message && err.message.includes('CD_DATA_INTEGRITY_ERROR')) {
        return { error: err.message } as any;
      }
      throw err;
    }
  }, [selectedLoan, paymentDate, cdLedgerEntries, cdInterestDetails]) as any;

  // Date Formatter helper (returns format e.g. 07-Mar-26)
  const formatDateOld = (dateStr: string | Date | number | null | undefined) => {
    if (!dateStr) return '';
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parts = dateStr.split('-');
      const year = parseInt(parts[0], 10);
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parts[2];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const yy = String(year).slice(-2);
      return `${day}-${months[monthIndex]}-${yy}`;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const yy = String(d.getFullYear()).slice(-2);
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}-${months[d.getMonth()]}-${yy}`;
  };

  // Statement ledger builder containing native logs + fallbacks (interest, document charges etc.)
  const displayedStatementEntries = useMemo(() => {
    if (!selectedLoan || !renewCalculations) return [];

    const list: any[] = [];
    const sortedDbEntries = [...cdLedgerEntries].sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());

    const principalPaidTotalDb = sortedDbEntries
      .filter(e => {
        const isPrincipalPaid = (e.particulars || '').toLowerCase().includes('principal paid') ||
          (e.particulars || '').toLowerCase().includes('principal adjusted') ||
          e.entry_type === 'principal_payment';
        return e.account_name === 'CD A/C' && isPrincipalPaid;
      })
      .reduce((sum, e) => sum + Number(e.credit || 0), 0);

    const originalAmount = Number(selectedLoan.amount) + principalPaidTotalDb;

    // Let's first add the Disbursement row
    const hasDisbursement = sortedDbEntries.some(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
    if (!hasDisbursement) {
      list.push({
        id: `fallback-disb-${selectedLoan.id}`,
        loan_id: selectedLoan.id,
        customer_id: selectedLoan.customer_id,
        account_name: 'CD A/C',
        entry_date: selectedLoan.date,
        credit: 0,
        debit: originalAmount,
        receipt_no: '-',
        particulars: 'Original Loan Disbursement',
        user_name: 'System',
        entry_type: 'original_loan'
      });
    }

    // Check if we have CD Commission opening row in the DB.
    const hasCommission = sortedDbEntries.some(e =>
      e.entry_type === 'opening_commission' || e.entry_type === 'Commission'
    );
    if (!hasCommission) {
      // Fallback: derive from disbursement debit (the true original principal, never changes)
      const disbEntry = sortedDbEntries.find(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
      const P = disbEntry ? Number(disbEntry.debit) : originalAmount;
      const R = Number(selectedLoan.interest_rate) || 3;
      const pDays = (selectedLoan.period_days && Number(selectedLoan.period_days) > 0) ? Number(selectedLoan.period_days) : 30;
      const commAmount = Number(((P * (R / 100) * pDays) / 30).toFixed(2));

      list.push({
        id: `fallback-comm-${selectedLoan.id}`,
        loan_id: selectedLoan.id,
        customer_id: selectedLoan.customer_id,
        account_name: 'CD COMMISSION A/C',
        entry_date: disbEntry ? disbEntry.entry_date : selectedLoan.date,
        credit: commAmount,
        debit: 0,
        receipt_no: '-',
        particulars: 'Opening CD Commission Charged',
        user_name: 'System',
        entry_type: 'opening_commission'
      });
    }

    // Check if we have CD Document Charges row
    const docChargesVal = Number(selectedLoan.document_charges) || 0;
    const hasDocCharges = sortedDbEntries.some(e =>
      (e.account_name || '').toLowerCase() === 'cd document charges a/c' ||
      e.entry_type === 'document_charge'
    );
    if (!hasDocCharges && docChargesVal > 0) {
      const disb = sortedDbEntries.find(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
      list.push({
        id: `fallback-doc-${selectedLoan.id}`,
        loan_id: selectedLoan.id,
        customer_id: selectedLoan.customer_id,
        account_name: 'CD DOCUMENT CHARGES A/C',
        credit: docChargesVal,
        debit: 0,
        receipt_no: '-',
        particulars: 'Document Charges Collected',
        user_name: 'System',
        entry_type: 'document_charge',
        entry_date: disb ? disb.entry_date : selectedLoan.date
      });
    }

    // Push all database entries directly (both payment and non-payment)
    // The canonical engine handles all mathematics, UI simply displays stored facts.
    sortedDbEntries.forEach(entry => {
      list.push({ ...entry, account_name: entry.account_name || 'CD A/C' });
    });

    return list.sort((a, b) => {
      const dateA = new Date(a.entry_date).getTime();
      const dateB = new Date(b.entry_date).getTime();
      if (dateA !== dateB) return dateA - dateB;

      const isAmtA = a.entry_type === 'amount_paid';
      const isAmtB = b.entry_type === 'amount_paid';
      if (isAmtA && !isAmtB) return -1;
      if (!isAmtA && isAmtB) return 1;

      return 0;
    });
  }, [selectedLoan, cdLedgerEntries, paymentDate]);

  // Original Loan Amount calculations
  const originalLoanAmount = useMemo(() => {
    if (!selectedLoan) return 0;
    return displayedStatementEntries
      .filter(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement')
      .reduce((sum, e) => sum + Number(e.debit), 0) || Number(selectedLoan.amount);
  }, [selectedLoan, displayedStatementEntries]);

  const originalLoanDate = useMemo(() => {
    if (!selectedLoan) return null;
    const disb = displayedStatementEntries.find(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
    return disb ? disb.entry_date : selectedLoan.date;
  }, [displayedStatementEntries, selectedLoan]);

  // Principal Paid calculations
  const principalPaidTotal = useMemo(() => {
    return displayedStatementEntries
      .filter(e =>
        e.entry_type === 'principal_payment' ||
        (e.particulars || '').toLowerCase().includes('principal paid') ||
        (e.particulars || '').toLowerCase().includes('principal adjusted')
      )
      .reduce((sum, e) => sum + Number(e.credit), 0);
  }, [displayedStatementEntries]);

  // Compound Interest Calculation Engine (Timeline Display Engine - Informational Only)
  const compoundInterestData = useMemo(() => {
    if (!selectedLoan || !originalLoanDate) return { summary: null, reportRows: [] };

    return cdCompoundInterestEngine.calculateCITimeline(
      {
        id: selectedLoan.id,
        loan_id: selectedLoan.loan_id,
        amount: Number(selectedLoan.amount) || 0,
        date: originalLoanDate,
        interest_rate: Number(selectedLoan.interest_rate) || 3,
        status: selectedLoan.status,
        closed_at: (selectedLoan as any).closed_at || null
      },
      displayedStatementEntries,
      paymentDate || undefined
    );
  }, [selectedLoan, originalLoanDate, displayedStatementEntries, paymentDate]);

  // Statement-Oriented Pivot Ledger Engine (One Business Event = One Row)
  const groupedPivotStatementEntries = useMemo(() => {
    if (!selectedLoan || !renewCalculations) return [];

    const rawList = [...displayedStatementEntries];
    if (rawList.length === 0) return [];

    // 1. Separate Opening / Loan Issue entries (Disbursement, Opening Commission, Doc Charges)
    const openingEntries = rawList.filter(e =>
      e.entry_type === 'original_loan' ||
      e.entry_type === 'Disbursement' ||
      e.entry_type === 'opening_commission' ||
      e.entry_type === 'Commission' ||
      e.entry_type === 'document_charge' ||
      (e.account_name || '').toLowerCase() === 'cd document charges a/c'
    );

    const nonOpeningEntries = rawList.filter(e => !openingEntries.includes(e));

    // Initialize Loan Issue Row
    const disbEntry = openingEntries.find(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
    const commEntry = openingEntries.find(e => e.entry_type === 'opening_commission' || e.entry_type === 'Commission');
    const docEntry = openingEntries.find(e => e.entry_type === 'document_charge' || (e.account_name || '').toLowerCase() === 'cd document charges a/c');

    const issueDate = disbEntry ? disbEntry.entry_date : selectedLoan.date;
    const issuePrincipal = disbEntry ? Number(disbEntry.debit || 0) : Number(selectedLoan.amount || 0);
    const issueInterest = commEntry ? Number(commEntry.credit || 0) : 0;
    const issueDoc = docEntry ? Number(docEntry.credit || docEntry.debit || 0) : Number(selectedLoan.document_charges || 0);

    const loanIssueRow = {
      id: `loan-issue-${selectedLoan.id}`,
      date: issueDate,
      receiptNo: '—',
      eventType: 'Loan Issue',
      principalPaid: issuePrincipal,
      interestPaid: issueInterest,
      penaltyPaid: 0,
      docCharges: issueDoc,
      renewalAmount: 0,
      // Interest (and document charges) collected when the loan is issued count as paid
      totalPaid: issueInterest + issueDoc,
      outstandingPrincipal: issuePrincipal,
      presentDue: issuePrincipal + issueInterest + issueDoc,
      operator: disbEntry?.user_name || 'System',
      remarks: 'Original Loan Disbursement',
      rawEntries: openingEntries
    };

    // 2. Group Non-Opening Entries by Receipt No or (Date + Entry Type)
    const nonOpeningGroups = new Map<string, any[]>();
    nonOpeningEntries.forEach(entry => {
      const key = (entry.receipt_no && entry.receipt_no !== '-') 
        ? `RC-${entry.receipt_no}` 
        : `EVT-${entry.entry_date}-${entry.entry_type || entry.account_name}`;
      if (!nonOpeningGroups.has(key)) {
        nonOpeningGroups.set(key, []);
      }
      nonOpeningGroups.get(key)!.push(entry);
    });

    const eventRows: any[] = [loanIssueRow];
    let runningPrincipal = issuePrincipal;

    nonOpeningGroups.forEach((entries, groupKey) => {
      const first = entries[0];
      const receiptNo = (first.receipt_no && first.receipt_no !== '-') ? first.receipt_no : '—';
      const date = first.entry_date;
      const operator = first.user_name || 'Staff';

      let principalPaid = 0;
      let interestPaid = 0;
      let penaltyPaid = 0;
      let docCharges = 0;
      let totalPaid = 0;

      entries.forEach(e => {
        const acct = (e.account_name || '').toUpperCase();
        const type = (e.entry_type || '').toLowerCase();
        const cred = Number(e.credit || 0);

        if (type === 'amount_paid' || acct === 'CD AMOUNT PAID') {
          if (cred > 0) totalPaid = Math.max(totalPaid, cred);
        } else if (type === 'principal_payment' || acct === 'CD A/C' || (e.particulars || '').toLowerCase().includes('principal')) {
          principalPaid += cred;
        } else if (type === 'interest_payment' || acct === 'CD COMMISSION A/C') {
          interestPaid += cred;
        } else if (type === 'penalty_payment' || acct === 'PENALTY A/C') {
          penaltyPaid += cred;
        } else if (type === 'document_charge' || acct === 'CD DOCUMENT CHARGES A/C') {
          docCharges += cred;
        }
      });

      if (totalPaid === 0) {
        totalPaid = principalPaid + interestPaid + penaltyPaid + docCharges;
      }

      // Determine Event Type & Remarks
      let eventType = 'Payment';
      let remarks = first.particulars || 'Transaction';

      const isRenewal = entries.some(e => 
        e.entry_type === 'Renewal' || e.entry_type === 'Renew' || 
        (e.particulars || '').toLowerCase().includes('renewal') ||
        (e.particulars || '').toLowerCase().includes('renew')
      );
      const isClose = entries.some(e => e.entry_type === 'Close' || e.entry_type === 'Settlement' || (e.particulars || '').toLowerCase().includes('close'));

      const matchingInt = cdInterestDetails.find(d => d.receipt_no === receiptNo && (Number(d.renewed_days) > 0 || d.renewed_till_date));

      const npaLossRow = entries.find(e => e.entry_type === 'NPA_WRITEOFF' && Number(e.debit) > 0);
      if (npaLossRow) {
        // NPA close: nothing received, the remaining amount is written off as loss
        eventType = 'NPA';
        remarks = `NPA Close - Loss ₹${Number(npaLossRow.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      } else if (isClose) {
        eventType = 'Closure';
        remarks = 'Account Closed & Settled';
      } else if (isRenewal || matchingInt) {
        eventType = 'Renewal';
        const days = matchingInt ? Number(matchingInt.renewed_days) : 0;
        remarks = days > 0 ? `${days} Days Renewed` : 'Renewal Payment';
      } else if (principalPaid > 0) {
        eventType = 'Partial';
        remarks = 'Partial Principal Paid';
      } else if (interestPaid > 0) {
        eventType = 'Payment';
        remarks = 'Interest Payment';
      }

      runningPrincipal = Math.max(0, runningPrincipal - principalPaid);
      const presentDue = runningPrincipal;

      eventRows.push({
        id: groupKey,
        date,
        receiptNo,
        eventType,
        principalPaid,
        interestPaid,
        penaltyPaid,
        docCharges,
        renewalAmount: (isRenewal || matchingInt) ? (interestPaid + penaltyPaid) : 0,
        totalPaid,
        outstandingPrincipal: runningPrincipal,
        presentDue,
        operator,
        remarks,
        rawEntries: entries
      });
    });

    return eventRows;
  }, [displayedStatementEntries, cdInterestDetails, selectedLoan, renewCalculations]);

  const pivotTotals = useMemo(() => {
    const totals = {
      principalPaid: 0,
      interestPaid: 0,
      penaltyPaid: 0,
      docCharges: 0,
      totalPaid: 0,
      latestOutstanding: 0,
      latestPresentDue: 0
    };

    groupedPivotStatementEntries.forEach(row => {
      if (row.eventType !== 'Loan Issue') {
        totals.principalPaid += row.principalPaid;
      }
      totals.interestPaid += row.interestPaid;
      totals.penaltyPaid += row.penaltyPaid;
      totals.docCharges += row.docCharges;
      totals.totalPaid += row.totalPaid;
    });

    if (groupedPivotStatementEntries.length > 0) {
      const lastRow = groupedPivotStatementEntries[groupedPivotStatementEntries.length - 1];
      totals.latestOutstanding = lastRow.outstandingPrincipal;
      totals.latestPresentDue = lastRow.presentDue;
    }

    return totals;
  }, [groupedPivotStatementEntries]);

  // Receipts of the selected loan, newest first (rows without a receipt number are skipped)
  const receiptRows = useMemo(() => {
    const list = receiptRowsFromStatement(groupedPivotStatementEntries);
    return list
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const d = new Date(b.r.date).getTime() - new Date(a.r.date).getTime();
        return Number.isFinite(d) && d !== 0 ? d : b.idx - a.idx;
      })
      .map(x => x.r);
  }, [groupedPivotStatementEntries]);

  const selectedReceipt = useMemo(
    () => receiptRows.find(r => r.id === selectedReceiptId) || null,
    [receiptRows, selectedReceiptId]
  );

  const openReceiptChooser = () => {
    if (receiptRows.length === 0) {
      toast.error('No receipts found for this loan yet');
      return;
    }
    setSelectedReceiptId(receiptRows[0].id); // latest receipt by default
    setShowReceiptChooser(true);
  };

  // Grouped payment entries for receipt-centric statement reports (Change 6, 8, 9, 10, 11, 12, 13)
  const groupedPayments = useMemo(() => {
    if (!selectedLoan) return [];

    const nonOpening = displayedStatementEntries.filter(e => 
      e.entry_type !== 'original_loan' && 
      e.entry_type !== 'opening_commission' && 
      e.entry_type !== 'document_charge' &&
      (e.account_name || '').toLowerCase() !== 'cd document charges a/c' &&
      e.entry_type !== 'Disbursement' &&
      e.entry_type !== 'Commission' &&
      e.entry_type !== 'Document Charges'
    );

    const groups: { [key: string]: any[] } = {};
    const noReceiptEntries: any[] = [];

    nonOpening.forEach(entry => {
      if (entry.receipt_no && entry.receipt_no !== '-') {
        if (!groups[entry.receipt_no]) {
          groups[entry.receipt_no] = [];
        }
        groups[entry.receipt_no].push(entry);
      } else {
        noReceiptEntries.push(entry);
      }
    });

    const rows: any[] = [];

    Object.keys(groups).forEach(receiptNo => {
      const groupEntries = groups[receiptNo];
      const firstEntry = groupEntries[0];

      const amountPaidEntry = groupEntries.find(e => e.entry_type === 'amount_paid');
      const totalAmountPaid = amountPaidEntry ? Number(amountPaidEntry.credit) : 
        groupEntries.reduce((sum, e) => {
          const isAllocation = ['PENALTY A/C', 'CD COMMISSION A/C', 'CD A/C'].includes((e.account_name || '').toUpperCase()) || 
            ['penalty_payment', 'interest_payment', 'principal_payment'].includes(e.entry_type);
          return sum + (isAllocation ? Number(e.credit || 0) : 0);
        }, 0);

      const interestPaid = groupEntries
        .filter(e => (e.account_name || '').toUpperCase() === 'CD COMMISSION A/C' || e.entry_type === 'interest_payment')
        .reduce((sum, e) => sum + Number(e.credit || 0), 0);

      const penaltyPaid = groupEntries
        .filter(e => (e.account_name || '').toUpperCase() === 'PENALTY A/C' || e.entry_type === 'penalty_payment')
        .reduce((sum, e) => sum + Number(e.credit || 0), 0);

      const principalPaid = groupEntries
        .filter(e => (e.account_name || '').toUpperCase() === 'CD A/C' || e.entry_type === 'principal_payment')
        .reduce((sum, e) => sum + Number(e.credit || 0), 0);

      const matchingInt = cdInterestDetails.find(d => d.receipt_no === receiptNo && (Number(d.renewed_days) > 0 || d.renewed_till_date));
      const renewedDays = matchingInt ? Number(matchingInt.renewed_days) : 0;
      const renewedTill = matchingInt ? matchingInt.renewed_till_date : null;

      const date = firstEntry.entry_date;
      const user = firstEntry.user_name || 'Staff';

      let particulars = 'Payment';
      const isRenewal = groupEntries.some(e => 
        e.entry_type === 'Renewal' || e.entry_type === 'Renew' || 
        (e.particulars || '').toLowerCase().includes('renewal') ||
        (e.particulars || '').toLowerCase().includes('renew')
      );
      const isClose = groupEntries.some(e => e.entry_type === 'Close' || e.entry_type === 'Settlement' || (e.particulars || '').toLowerCase().includes('close'));
      if (isClose) {
        particulars = 'Close Account';
      } else if (isRenewal) {
        particulars = 'Renewal Payment';
      } else if (principalPaid > 0) {
        particulars = 'Principal Payment';
      } else {
        particulars = 'Interest Payment';
      }

      rows.push({
        receipt_no: receiptNo,
        date,
        amountPaid: totalAmountPaid,
        interest: interestPaid,
        penalty: penaltyPaid,
        principal: principalPaid,
        particulars,
        daysRenewed: renewedDays,
        renewedTill: renewedTill,
        user
      });
    });

    noReceiptEntries.forEach(entry => {
      const isDebit = Number(entry.debit) > 0;
      const amount = isDebit ? Number(entry.debit) : Number(entry.credit);
      rows.push({
        receipt_no: '-',
        date: entry.entry_date,
        amountPaid: isDebit ? 0 : amount,
        interest: 0,
        penalty: 0,
        principal: isDebit ? amount : 0,
        particulars: entry.particulars || (isDebit ? 'Debit Entry' : 'Credit Entry'),
        daysRenewed: 0,
        renewedTill: null,
        user: entry.user_name || 'Staff'
      });
    });

    return rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [displayedStatementEntries, cdInterestDetails, selectedLoan]);

  const statementTotals = useMemo(() => {
    const t = {
      amountPaid: 0,
      interest: 0,
      penalty: 0,
      principal: 0,
      documentCharges: Number(selectedLoan?.document_charges) || 0
    };
    groupedPayments.forEach(row => {
      t.amountPaid += row.amountPaid || 0;
      t.interest += row.interest || 0;
      t.penalty += row.penalty || 0;
      t.principal += row.principal || 0;
    });
    return t;
  }, [groupedPayments, selectedLoan]);

  const displayedInterestDetails = useMemo(() => {
    const list: any[] = [];
    if (!selectedLoan) return list;

    displayedStatementEntries.forEach(entry => {
      const isInterestOrPenalty = ['penalty a/c', 'cd commission a/c'].includes((entry.account_name || '').toLowerCase());
      if (isInterestOrPenalty && entry.credit > 0 && entry.entry_type !== 'opening_commission' && entry.entry_type !== 'Commission' && !entry.id.toString().startsWith('fallback-comm-')) {

        // Find matching interest detail row from Supabase table
        const matchingDetail = cdInterestDetails.find(d =>
          d.entry_id === entry.id ||
          d.ledger_entry_id === entry.id ||
          (d.receipt_no === entry.receipt_no && d.row_type === (entry.account_name === 'PENALTY A/C' ? 'penalty_payment' : 'interest_payment'))
        );

        let renewed_days = 0;
        let renewed_till_date = null;

        if (matchingDetail) {
          renewed_days = Number(matchingDetail.renewed_days) || 0;
          renewed_till_date = matchingDetail.renewed_till_date;
        }

        list.push({
          id: `int-detail-${entry.id}`,
          loan_id: entry.loan_id,
          entry_id: entry.id,
          entry_date: entry.entry_date,
          credit: entry.credit,
          receipt_no: entry.receipt_no,
          particulars: entry.particulars,
          renewed_days,
          renewed_till_date,
          row_type: entry.account_name === 'PENALTY A/C' ? 'Penalty Paid' : 'Interest Paid',
          created_at: entry.created_at || entry.entry_date
        });
      }
    });

    cdInterestDetails.forEach(detail => {
      if ((detail.particulars || '').toLowerCase().includes('note:')) {
        const renewed_days = Number(detail.renewed_days) || 0;
        const renewed_till_date = detail.renewed_till_date;

        list.push({
          ...detail,
          renewed_days,
          renewed_till_date
        });
      }
    });

    return list.sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());
  }, [displayedStatementEntries, cdInterestDetails, selectedLoan]);

  // Clean Grouped Interest History Entries (Groups repetitive entries by Receipt / Event)
  const groupedInterestHistoryEntries = useMemo(() => {
    if (!selectedLoan) return [];

    const rawInterestRows = displayedInterestDetails.filter(
      d => !(d.particulars || '').toLowerCase().includes('note:')
    );

    const groups = new Map<string, {
      id: string;
      date: string;
      receiptNo: string;
      type: string;
      interestPaid: number;
      penaltyPaid: number;
      daysRenewed: number;
      renewedTill: string | null;
      remarks: string;
    }>();

    rawInterestRows.forEach(item => {
      const key = (item.receipt_no && item.receipt_no !== '-') 
        ? `RC-${item.receipt_no}` 
        : `INT-${item.entry_date}-${item.id}`;

      const isPenalty = item.row_type === 'Penalty Paid' || (item.particulars || '').toLowerCase().includes('penalty');

      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          date: item.entry_date,
          receiptNo: item.receipt_no && item.receipt_no !== '-' ? item.receipt_no : '—',
          type: item.renewed_days > 0 ? 'Renewal' : 'Interest Paid',
          interestPaid: isPenalty ? 0 : Number(item.credit || 0),
          penaltyPaid: isPenalty ? Number(item.credit || 0) : 0,
          daysRenewed: Number(item.renewed_days || 0),
          renewedTill: item.renewed_till_date || null,
          remarks: item.particulars || 'Interest Collection'
        });
      } else {
        const existing = groups.get(key)!;
        if (isPenalty) {
          existing.penaltyPaid += Number(item.credit || 0);
        } else {
          existing.interestPaid += Number(item.credit || 0);
        }
        if (item.renewed_days > 0) {
          existing.daysRenewed = Math.max(existing.daysRenewed, Number(item.renewed_days));
          existing.type = 'Renewal';
        }
        if (item.renewed_till_date) {
          existing.renewedTill = item.renewed_till_date;
        }
      }
    });

    return Array.from(groups.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [displayedInterestDetails, selectedLoan]);

  const interestTotals = useMemo(() => {
    const totals = { interestPaid: 0, penaltyPaid: 0 };
    groupedInterestHistoryEntries.forEach(row => {
      totals.interestPaid += row.interestPaid;
      totals.penaltyPaid += row.penaltyPaid;
    });
    return totals;
  }, [groupedInterestHistoryEntries]);

  const paymentTotals = useMemo(() => {
    return loanTransactions
      .filter((tx: any) => tx.type === 'Collection')
      .reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
  }, [loanTransactions]);

  // Shared single source of truth calculations
  const ledgerMetrics = useMemo(() => {
    if (!selectedLoan || !renewCalculations || renewCalculations.error) {
      return {
        originalPrincipal: 0,
        principalPaid: 0,
        principalBalance: 0,
        grossInterestDue: 0,
        grossPenaltyDue: 0,
        paidInterest: 0,
        paidPenalty: 0,
        pendingInterest: 0,
        pendingPenalty: 0,
        todayDue: 0,
        renewalDue: 0,
        currentTotalDues: 0,
        currentPaidDues: 0,
        currentPendingDues: 0,
        totalToRegularize: 0,
        totalClose: 0,
        totalCredit: 0,
        totalDebit: 0
      };
    }

    const originalPrincipal = originalLoanAmount;
    const principalPaid = principalPaidTotal;
    
    // Direct consumption from production calculator (renewCalculations)
    const principalBalance = renewCalculations.principalBalance;
    const pendingInterest = renewCalculations.accruedInterest;
    const pendingPenalty = renewCalculations.accruedPenalty;
    const todayDue = renewCalculations.todayDue;
    const renewalDue = renewCalculations.totalRenewal; // matches renewalAmount
    const totalToRegularize = renewCalculations.totalToRegularize;
    const totalClose = renewCalculations.totalForClose;

    const grossInterestDue = renewCalculations.effectiveGrossInterest || 0;
    const grossPenaltyDue = renewCalculations.effectiveGrossPenalty || 0;

    const paidInterest = renewCalculations.interestPaid || 0;
    const paidPenalty = renewCalculations.penaltyPaid || 0;

    // Footer metrics synchronized with calculations and card values
    const currentTotalDues = (renewCalculations.daysPastDue || 0) <= 0
      ? 0
      : Number((grossInterestDue + grossPenaltyDue).toFixed(2));
    const currentPaidDues = (renewCalculations.daysPastDue || 0) <= 0
      ? 0
      : Number((paidInterest + paidPenalty).toFixed(2));
    const currentPendingDues = Math.max(0, Number((currentTotalDues - currentPaidDues).toFixed(2)));

    // totalCredit = only real cash collected (interest, penalty, principal payments)
    // Must NOT include opening_commission or document_charge rows (not real collections)
    const NON_COLLECTION_TYPES = new Set(['original_loan', 'Disbursement', 'opening_commission', 'Commission', 'Document Charges', 'document_charge', 'amount_paid', 'NPA_WRITEOFF']);
    const totalCredit = displayedStatementEntries
      .filter(e => !NON_COLLECTION_TYPES.has(e.entry_type) && Number(e.credit) > 0)
      .reduce((sum, e) => sum + Number(e.credit || 0), 0);

    const totalDebit = displayedStatementEntries
      .filter(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement')
      .reduce((sum, e) => sum + Number(e.debit || 0), 0);

    return {
      originalPrincipal,
      principalPaid,
      principalBalance,
      grossInterestDue,
      grossPenaltyDue,
      paidInterest,
      paidPenalty,
      pendingInterest,
      pendingPenalty,
      todayDue,
      renewalDue,
      currentTotalDues,
      currentPaidDues,
      currentPendingDues,
      totalToRegularize,
      totalClose,
      totalCredit,
      totalDebit
    };
  }, [selectedLoan, renewCalculations, originalLoanAmount, principalPaidTotal, displayedInterestDetails, displayedStatementEntries]);

  // Calculation bottom totals
  const bottomTotals = useMemo(() => {
    const totalCredit = displayedStatementEntries
      .filter(e => e.entry_type !== 'amount_paid' && e.entry_type !== 'NPA_WRITEOFF')
      .reduce((sum, e) => sum + Number(e.credit || 0), 0);
    const totalDebit = displayedStatementEntries
      .filter(e => e.entry_type !== 'amount_paid' && e.entry_type !== 'NPA_WRITEOFF')
      .reduce((sum, e) => sum + Number(e.debit || 0), 0);
    return {
      totalCredit,
      totalDebit,
      presentBalance: Number((ledgerMetrics.principalBalance + ledgerMetrics.pendingInterest + ledgerMetrics.pendingPenalty).toFixed(2)),
      totalDues: ledgerMetrics.currentTotalDues,
      paidDues: ledgerMetrics.currentPaidDues,
      pendingDues: ledgerMetrics.currentPendingDues
    };
  }, [displayedStatementEntries, ledgerMetrics]);

  // Payment preview calculation — priority allocation: Penalty → Interest → Principal
  const paymentPreview = useMemo(() => {
    const paymentAmount = Number(totalAmountPaying) || 0;
    if (paymentAmount <= 0 || !renewCalculations) return null;

    const principalBefore = ledgerMetrics.principalBalance;

    const periodDays = (selectedLoan?.period_days && Number(selectedLoan.period_days) > 0) ? Number(selectedLoan.period_days) : 30;
    const interestRate = Number(selectedLoan?.interest_rate) || 3;
    const monthlyInterest = Number(((principalBefore * (interestRate / 100) * periodDays) / 30).toFixed(2));
    const dailyInterestValue = Number((monthlyInterest / periodDays).toFixed(5));

    const isClosingPayment = paymentAmount >= Math.max(0, ledgerMetrics.totalClose);

    if (isClosingPayment) {
      const closeSplit = allocateCDPayment(
        renewCalculations as any,
        paymentAmount,
        'Close',
        periodDays
      );
      const details = {
        penaltyPaid: closeSplit.penaltyPaid,
        overdueInterestPaid: closeSplit.overdueInterestPaid,
        renewalInterestPaid: closeSplit.renewalInterestPaid,
        interestPaid: closeSplit.interestPaid,
        principalPaid: closeSplit.principalPaid,
        principalAfter: Number(Math.max(0, principalBefore - closeSplit.principalPaid).toFixed(2)),
        renewedDays: closeSplit.renewedDays,
        nextDueDate: null,
        dailyInterestValue
      };

      return {
        paymentAmount,
        isClosingPayment,
        renew: details,
        partial: details
      };
    }

    // Renew Option (Option 1)
    const renewSplit = allocateCDPayment(
      renewCalculations as any,
      paymentAmount,
      'Renew',
      periodDays
    );
    // VBA: NextDueDate = DueDate + RDAYS — always extends from old DueDate, not payment date
    const renewBaseDateStr = renewCalculations?.dueDateStr || paymentDate;
    const renewNextDueDateStr = renewSplit.renewedDays > 0
      ? financeCalculationService.addCalendarDays(renewBaseDateStr, renewSplit.renewedDays)
      : null;
    const renewNextDueDate = renewNextDueDateStr ? new Date(renewNextDueDateStr) : null;

    const renewDetails = {
      penaltyPaid: renewSplit.penaltyPaid,
      overdueInterestPaid: renewSplit.overdueInterestPaid,
      renewalInterestPaid: renewSplit.renewalInterestPaid,
      interestPaid: renewSplit.interestPaid,
      principalPaid: renewSplit.principalPaid,
      principalAfter: Number(Math.max(0, principalBefore - renewSplit.principalPaid).toFixed(2)),
      renewedDays: renewSplit.renewedDays,
      nextDueDate: renewNextDueDate,
      dailyInterestValue
    };

    // Partial Option (Option 2)
    const partialSplit = allocateCDPayment(
      renewCalculations as any,
      paymentAmount,
      'Partial',
      periodDays
    );
    const partialBaseDateStr = renewCalculations?.dueDateStr || paymentDate;
    const partialNextDueDateStr = partialSplit.renewedDays > 0
      ? financeCalculationService.addCalendarDays(partialBaseDateStr, partialSplit.renewedDays)
      : null;
    const partialNextDueDate = partialNextDueDateStr ? new Date(partialNextDueDateStr) : null;

    const partialDetails = {
      penaltyPaid: partialSplit.penaltyPaid,
      overdueInterestPaid: partialSplit.overdueInterestPaid,
      renewalInterestPaid: partialSplit.renewalInterestPaid,
      interestPaid: partialSplit.interestPaid,
      principalPaid: partialSplit.principalPaid,
      principalAfter: Number(Math.max(0, principalBefore - partialSplit.principalPaid).toFixed(2)),
      renewedDays: partialSplit.renewedDays,
      nextDueDate: partialNextDueDate,
      dailyInterestValue
    };

    return {
      paymentAmount,
      isClosingPayment,
      renew: renewDetails,
      partial: partialDetails
    };
  }, [totalAmountPaying, ledgerMetrics, renewCalculations, selectedLoan, paymentDate]);

  // Handle payments renewals and closures (Access VBA logic)
  const handleActionSubmit = async (actionType: 'Renew' | 'Partial' | 'Close') => {
    if (isRenewing) return;
    if (!selectedLoan || !renewCalculations) return;
    if (renewCalculations.error) {
      toast.error('Cannot submit payment due to account data chronology error.');
      return;
    }

    // Block if payment date is before loan date
    if (renewCalculations.isDateInvalid) {
      toast.error('Payment date cannot be before loan date.');
      return;
    }

    const amount = Number(totalAmountPaying) || 0;
    if (actionType !== 'Close' && (amount <= 0 || isNaN(amount))) {
      toast.error('Enter a valid payment amount.');
      return;
    }

    // Validation for Partial Payment bounds
    if (actionType === 'Partial') {
      const totalToRegularize = ledgerMetrics.totalToRegularize || 0;
      if (amount < totalToRegularize) {
        toast.error(`Partial Payment amount (${amount.toFixed(2)}) must be greater than or equal to the total to regularize amount (${totalToRegularize.toFixed(2)}).`);
        return;
      }
      const totalClose = ledgerMetrics.totalClose || 0;
      if (amount >= totalClose) {
        toast.error(`Partial Payment amount (${amount.toFixed(2)}) must be strictly less than the total close amount (${totalClose.toFixed(2)}). To close the loan, please use Close Account.`);
        return;
      }
    }

    const dueDays = renewCalculations.daysPastDue || 0;
    // Operator Warning/Confirmation when outstanding dues exist during Partial Payment
    if (actionType === 'Partial') {
      const totalOutstanding = (renewCalculations.outstandingPenalty || 0) + (renewCalculations.outstandingInterest || 0);
      const periodDays = (selectedLoan.period_days && Number(selectedLoan.period_days) > 0) ? Number(selectedLoan.period_days) : 30;

      const split = allocateCDPayment(renewCalculations, amount, 'Partial', periodDays);

      let confirmMsg = '';
      if (amount >= totalOutstanding) {
        confirmMsg = `You are making a Partial Payment of ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. This will pay off the outstanding dues of ${totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (Interest: ${(renewCalculations.outstandingInterest || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}, Penalty: ${(renewCalculations.outstandingPenalty || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}) and reduce the Principal Balance by ${split.principalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.\n\nThe loan's due date will be extended to the payment date (${formatDateOld(paymentDate)}).\n\nDo you want to proceed?`;
      } else {
        confirmMsg = `WARNING: The payment amount ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} is less than the total outstanding dues of ${totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (Interest: ${(renewCalculations.outstandingInterest || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}, Penalty: ${(renewCalculations.outstandingPenalty || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}).\n\nNo principal reduction will occur. Instead, this payment will renew the loan by ${split.renewedDays} days.\n\nDo you want to proceed?`;
      }
      if (!window.confirm(confirmMsg)) {
        return;
      }
    }

    setIsRenewing(true);
    try {
      // Snapshot variables before saving
      const principalBefore = ledgerMetrics.principalBalance;
      const paymentAmount = Number(amount.toFixed(2));
      const disbEntry = cdLedgerEntries.find(e => e.entry_type === 'original_loan');

      // ===== PRIORITY ALLOCATION: Penalty → Interest → Principal =====
      let penaltyPaid = 0;
      let interestPaid = 0;
      let principalPaid = 0;
      let renewedDays = 0;
      let overdueInterestPaid = 0;
      let renewalInterestPaid = 0;

      const periodDays = (selectedLoan.period_days && Number(selectedLoan.period_days) > 0) ? Number(selectedLoan.period_days) : 30;

      const isClosingPayment = actionType === 'Close' || paymentAmount >= Math.max(0, ledgerMetrics.totalClose);

      const split = allocateCDPayment(
        renewCalculations as any,
        paymentAmount,
        isClosingPayment ? 'Close' : actionType,
        periodDays
      );
      penaltyPaid = split.penaltyPaid;
      overdueInterestPaid = split.overdueInterestPaid;
      renewalInterestPaid = split.renewalInterestPaid;
      interestPaid = split.interestPaid;
      principalPaid = split.principalPaid;
      renewedDays = split.renewedDays;

      let renewedTillDate: string | null = null;
      if (renewedDays > 0) {
        const originalLoanDateStr = (disbEntry ? disbEntry.entry_date : selectedLoan.date).split('T')[0];
        const baseDueDateStr = financeCalculationService.addCalendarDays(originalLoanDateStr, periodDays - 1);

        // Sum total renewed days up to now (excluding current payment)
        const prevTotalRenewedDays = cdInterestDetails
          .filter(d => Number(d.credit) === 0)
          .reduce((sum, d) => sum + (Number(d.renewed_days) || 0), 0);

        // Add new renewed days to find the new exact total renewed days
        const newTotalRenewedDays = financeCalculationService.advanceExactRenewalPosition(prevTotalRenewedDays, renewedDays);

        // Convert exact total renewed days to display days
        const nextDisplayDays = financeCalculationService.calculateDisplayDays(newTotalRenewedDays);

        // Calculate display-rounded renewed till date
        renewedTillDate = financeCalculationService.addCalendarDays(baseDueDateStr, nextDisplayDays);
      }

      // Console logs for debugging
      console.log('=== Priority Payment Split ===');
      console.log('receiptNo:', receiptNo);
      console.log('paymentAmount:', paymentAmount);
      console.log('dueDays:', dueDays);
      console.log('renewedDays:', renewedDays);
      console.log('renewedTillDate:', renewedTillDate);
      console.log('penaltyPaid:', penaltyPaid);
      console.log('interestPaid:', interestPaid);
      console.log('overdueInterestPaid:', overdueInterestPaid);
      console.log('renewalInterestPaid:', renewalInterestPaid);
      console.log('principalPaid:', principalPaid);
      console.log('principalBefore:', principalBefore);
      console.log('principalAfter:', Number((principalBefore - principalPaid).toFixed(2)));

      const res = await supabaseFinance.postCdLedgerPayment({
        loanId: selectedLoan.id,
        customerId: selectedLoan.customer_id,
        accountName: selectedLoan.customer?.name || null,
        userName: user?.username || 'Staff',
        actionType,
        principalPaid,
        interestPaid,
        penaltyPaid,
        renewedDays,
        paymentDate,
        receiptNo,
        renewedTillDate
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to post ledger entries');
      }

      const totalForClose = ledgerMetrics.totalClose;

      if (actionType === 'Close' || paymentAmount >= totalForClose) {
        const { error: closeError } = await supabase.from('finance_loans').update({
          status: 'Closed',
          amount: Math.max(0, Number((principalBefore - principalPaid).toFixed(2)))
        }).eq('id', selectedLoan.id);
        if (closeError) throw closeError;
      } else {
        const updates: any = {};

        // For renewal/partial: set loan date based on next_due_date = base_date + renewed_days
        // Loan start date = next_due_date - periodDays
        // VBA: NextDueDate = DueDate + RDAYS — always extends from old DueDate
        if (renewedDays > 0) {
          const baseDateStr = renewCalculations?.dueDateStr || paymentDate;
          const originalLoanDateStr = (disbEntry ? disbEntry.entry_date : selectedLoan.date).split('T')[0];
          const baseDueDateStr = financeCalculationService.addCalendarDays(originalLoanDateStr, periodDays - 1);
          const prevTotalRenewedDays = cdInterestDetails
            .filter(d => Number(d.credit) === 0)
            .reduce((sum, d) => sum + (Number(d.renewed_days) || 0), 0);
          const newTotalRenewedDays = financeCalculationService.advanceExactRenewalPosition(prevTotalRenewedDays, renewedDays);
          const nextDisplayDays = financeCalculationService.calculateDisplayDays(newTotalRenewedDays);
          const nextDueDateStr = financeCalculationService.addCalendarDays(baseDueDateStr, nextDisplayDays);

          console.log('=== RENEWAL DUE DATE ADVANCEMENT DEBUG ===');
          console.log('old_current_due_date:', baseDateStr);
          console.log('payment_date:', paymentDate);
          console.log('base_date:', baseDateStr);
          console.log('interest_paid:', interestPaid);
          console.log('renewed_days:', renewedDays);
          console.log('next_due_date:', nextDueDateStr);

          // Removed updates.date assignment to keep finance_loans.date permanently immutable.
          console.log('next_due_date calculated for local flow:', nextDueDateStr);
        }

        if (principalPaid > 0) {
          updates.amount = Math.max(0, Number((principalBefore - principalPaid).toFixed(2)));
        }

        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase.from('finance_loans').update(updates).eq('id', selectedLoan.id);
          if (updateError) throw updateError;
        }
      }

      // Rebuild CD loan sequential history
      const rebuildResult = await cdLedgerRebuildService.rebuildCDLoanLifecycle(selectedLoan.id, 'FULL_RECALCULATE');
      if (!rebuildResult.success) {
        throw new Error(`Rebuild of CD loan sequential history failed: ${rebuildResult.error || 'Unknown error'}`);
      }

      setTotalAmountPaying('');
      await refreshLoanData();

      if (actionType === 'Close' || paymentAmount >= totalForClose) {
        toast.success('Account closed successfully');
      } else {
        toast.success(`Payment applied — ${renewedDays} days renewed`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error applying payment');
    } finally {
      setIsRenewing(false);
    }
  };

  const handleNPACloseSubmit = async () => {
    if (!selectedLoan) return;
    const cleanNpaReason = npaReason.trim().toUpperCase();
    if (!cleanNpaReason) {
      toast.error('Please enter the reason for NPA close');
      return;
    }
    setIsNpaClosing(true);
    try {
      // NPA close = no money received. The whole "Total for Close" goes to loss.
      const npaClosedDate = new Date(paymentDate).toISOString();
      const entryDate = paymentDate.split('T')[0];
      const closedBy = (user?.username || 'Staff').toUpperCase();
      const npaReceiptNo = await supabaseFinance.getNextReceiptNumber();

      const r2 = (v: number) => Number((Number(v) || 0).toFixed(2));
      const interest_due = Math.max(0, r2(ledgerMetrics.pendingInterest));
      const penalty_due = Math.max(0, r2(ledgerMetrics.pendingPenalty));
      // Loss = the TOTAL FOR CLOSE figure shown on this screen (principal + pending interest + penalty)
      const total_for_close = Math.max(0, r2(ledgerMetrics.totalClose || (ledgerMetrics.principalBalance + interest_due + penalty_due)));
      const principal_part = Math.max(0, r2(total_for_close - interest_due - penalty_due));

      const customerName = (selectedLoan.customer?.name || '').toUpperCase();
      const loanIdStr = selectedLoan.loan_id || 'CD';

      // 1. Ledger rows first (loss debit + principal / interest / penalty credits). If this fails nothing else is changed.
      const res = await supabaseFinance.postCdNpaWriteOff({
        loanId: selectedLoan.id,
        customerId: selectedLoan.customer_id,
        customerName,
        loanIdStr,
        userName: closedBy,
        principalPart: principal_part,
        interestPart: interest_due,
        penaltyPart: penalty_due,
        paymentDate: entryDate,
        receiptNo: npaReceiptNo,
        reason: cleanNpaReason
      });
      if (!res.success) {
        throw new Error(res.error || 'Failed to record NPA Close entry');
      }

      // 2. NPA registry record (nothing received; everything written off)
      const npaRec = await supabaseFinance.addNPARecord({
        loan_id: selectedLoan.id,
        customer_id: selectedLoan.customer_id,
        customer_name: customerName,
        aadhaar: selectedLoan.customer?.aadhaar || '',
        phone: selectedLoan.customer?.phone || '',
        loan_type: selectedLoan.loan_category || 'CD',
        loan_amount: r2(ledgerMetrics.principalBalance),
        paid_amount: 0,
        balance_amount: 0,
        interest_due,
        penalty_due,
        settlement_amount: 0,
        total_liability: total_for_close,
        waived_amount: total_for_close,
        reason: `${cleanNpaReason} [${npaReceiptNo}]`,
        closed_by: closedBy,
        closed_at: npaClosedDate
      });
      if (!npaRec) {
        throw new Error('NPA entry was saved in the ledger but the NPA register could not be updated. Please refresh and check.');
      }

      // 3. Mark the loan NPA closed
      const updatedRemarks = `${selectedLoan.remarks || ''}\n[NPA CLOSED AT ${npaClosedDate} BY ${closedBy} - LOSS: ${total_for_close} - ${npaReceiptNo}]`.trim().toUpperCase();
      const { error: loanError } = await supabase.from('finance_loans')
        .update({
          status: 'NPA_CLOSED',
          npa_closed: true,
          amount: 0,
          remarks: updatedRemarks
        })
        .eq('id', selectedLoan.id);
      if (loanError) throw loanError;

      clearFinanceCalendarCache();
      await refreshLoanData();
      toast.success(`NPA Account closed. Loss of ₹${total_for_close.toLocaleString('en-IN', { minimumFractionDigits: 2 })} recorded (Receipt: ${npaReceiptNo}).`);
      setShowNpaModal(false);
      setNpaReason('');
    } catch (e: any) {
      console.error('Error closing NPA account:', e);
      toast.error(e?.message || 'Error closing NPA account');
    } finally {
      setIsNpaClosing(false);
    }
  };

  const handleReturnDocSubmit = async () => {
    if (!selectedLoan) return;
    setIsReturningDoc(true);
    try {
      let signatureUrl = null;
      if (returnSignature) {
        const fileExt = returnSignature.name.split('.').pop();
        const fileName = `signature-${selectedLoan.loan_id}-${Date.now()}.${fileExt}`;
        const { data, error } = await supabase.storage.from('finance-photos').upload(`documents/${fileName}`, returnSignature);
        if (!error && data) {
          signatureUrl = supabase.storage.from('finance-photos').getPublicUrl(data.path).data.publicUrl;
        }
      }

      const docReceiptNo = await supabaseFinance.getNextReceiptNumber();

      const { error: docError } = await supabase.from('finance_documents_returned').insert({
        loan_id: selectedLoan.id,
        returned_date: returnDate,
        returned_to: returnedTo,
        received_by_signature: signatureUrl,
        remarks: returnRemarks,
        created_by: user?.username || 'Staff',
        receipt_no: docReceiptNo
      });
      if (docError) throw docError;

      await supabaseFinance.addCDLedgerEntry({
        loan_id: selectedLoan.id,
        customer_id: selectedLoan.customer_id,
        account_name: 'CD A/C',
        entry_date: returnDate,
        credit: 0,
        debit: 0,
        receipt_no: docReceiptNo,
        particulars: `Documents Returned to ${returnedTo} - ${returnRemarks}`,
        user_name: user?.username || 'Staff',
        entry_type: 'Settlement'
      });

      await refreshLoanData();
      toast.success('Documents returned successfully.');
      setShowReturnDocModal(false);
    } catch (e) {
      console.error(e);
      toast.error('Error recording document return');
    } finally {
      setIsReturningDoc(false);
    }
  };

  const handleExport = (format: 'xlsx' | 'csv') => {
    if (!selectedLoan) {
      toast.error('No ledger data is currently loaded to export');
      return;
    }

    const exportData = groupedPivotStatementEntries.map((row: any) => ({
      'Date': formatDateOld(row.date),
      'Receipt No': row.receiptNo,
      'Type': row.eventType,
      'Principal Paid': row.principalPaid > 0 ? row.principalPaid : 0,
      'Interest Paid': row.interestPaid > 0 ? row.interestPaid : 0,
      'Penalty Paid': row.penaltyPaid > 0 ? row.penaltyPaid : 0,
      'Doc Charges': row.docCharges > 0 ? row.docCharges : 0,
      'Total Paid': row.totalPaid > 0 ? row.totalPaid : 0,
      'Outstanding Principal': row.outstandingPrincipal,
      'Present Due': row.presentDue,
      'Operator': row.operator,
      'Remarks': row.remarks
    }));

    const filename = `${selectedLoan.loan_id}_CD_Ledger_${getLocalBusinessDateISO()}`;

    if (format === 'xlsx') {
      const res = exportToExcel(exportData, filename, 'Transactions');
      if (res.success) toast.success('Excel ledger exported successfully');
    } else {
      const res = exportToCSV(exportData, filename);
      if (res.success) toast.success('CSV ledger exported successfully');
    }
  };

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center space-y-4">
        <div className="p-4 bg-red-50 rounded-full border border-red-200">
          <ShieldAlert className="w-16 h-16 text-red-600 animate-pulse" />
        </div>
        <h1 className="finance-h1">Access Restricted</h1>
        <p className="text-gray-500 max-w-md">
          Only authorized personnel are allowed to view the CD Ledger. Please consult your administrator to request access.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={`space-y-3.5 p-3.5 pt-2 max-w-7xl mx-auto ${showPrintPreview ? 'print:hidden' : 'print:p-0'}`}>

        {/* Top row: unified single-row toolbar */}
        <div className="flex flex-wrap lg:flex-nowrap items-end gap-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm print:hidden w-full">
          
          {/* Left Group: Date & Status (Stay together on wrap) */}
          <div className="flex items-end gap-3 shrink-0">
            {/* Payment Date Group */}
            <div className="flex items-end gap-1.5 shrink-0">
              <div className="w-[210px]">
                <FinanceSmartCalendar
                  value={paymentDate}
                  onChange={setPaymentDate}
                  module="CD_LEDGER"
                  label="PAYMENT DATE"
                  disabled={selectedLoan?.status === 'Closed' || selectedLoan?.status === 'NPA_CLOSED'}
                  compact={true}
                />
              </div>
              <button
                type="button"
                onClick={handleTodayPaymentDate}
                className="px-2.5 h-[42px] bg-blue-50 text-blue-700 hover:bg-blue-100 text-[11px] font-black uppercase rounded-[12px] border border-blue-200 transition-colors cursor-pointer shadow-2xs"
              >
                TODAY
              </button>
            </div>

            {/* Status Filter */}
            <div className="w-[120px] shrink-0">
              <label className="text-[12px] font-black text-slate-500 uppercase tracking-wider block mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as any);
                  setSelectedLoan(null);
                }}
                className="w-full bg-white border border-slate-200 rounded-[14px] px-2 text-slate-800 focus:ring-2 focus:ring-slate-900 focus:outline-none h-[42px] font-bold text-[12px] uppercase cursor-pointer shadow-2xs"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="ALL">ALL</option>
                <option value="CLOSED">CLOSED</option>
                <option value="NPA CLOSED">NPA CLOSED</option>
              </select>
            </div>

            {/* Universal Search */}
            <div className="relative flex-1 min-w-[300px]">
              <label className="text-[12px] font-black text-slate-500 uppercase tracking-wider block mb-1">Search</label>
              <div className="relative">
                <input
                  type="text"
                  value={universalSearchQuery !== '' ? universalSearchQuery : (selectedLoan ? `${selectedLoan.loan_id} - ${selectedLoan.customer?.name}` : '')}
                  onChange={(e) => {
                    setUniversalSearchQuery(e.target.value);
                    setShowUniversalDropdown(true);
                  }}
                  onFocus={() => setShowUniversalDropdown(true)}
                  onBlur={() => setTimeout(() => setShowUniversalDropdown(false), 250)}
                  placeholder="Search borrower, CD no., phone, guarantor..."
                  className="w-full bg-white border border-slate-200 rounded-[14px] py-2 pl-9 pr-4 text-[14px] font-semibold text-slate-800 focus:ring-2 focus:ring-slate-900 focus:outline-none h-[42px] shadow-2xs"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              </div>

              {showUniversalDropdown && universalSuggestions.length > 0 && (
                <div className="absolute z-50 w-full bg-white border border-slate-200 rounded-[14px] shadow-lg mt-1 max-h-80 overflow-y-auto">
                  {universalSuggestions.sort((a,b) => sortNumerically(a.loan_id, b.loan_id)).map(loan => (
                    <button
                      key={loan.id}
                      onMouseDown={() => {
                        loadLedgerDetails(loan.id);
                        setUniversalSearchQuery('');
                        setShowUniversalDropdown(false);
                      }}
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
            <p className="text-gray-500 finance-section-heading">Compiling CD ledger registry...</p>
          </div>
        ) : !selectedLoan ? (
          /* ========== LOAN INDEX / LIST VIEW ========== */
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Index Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <List className="w-5 h-5 text-green-600" />
                  All CD Loans
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">{filteredLoansList.length} loan(s) in the system</p>
              </div>
            </div>

            {/* Loan Table */}
            {(() => {
              const q = universalSearchQuery.toLowerCase().trim();
              const filtered = q
                ? filteredLoansList.filter(loan =>
                  loan.loan_id.toLowerCase().includes(q) ||
                  (loan.customer?.name || '').toLowerCase().includes(q) ||
                  (loan.customer?.phone || '').includes(q) ||
                  (loan.customer?.aadhaar || '').includes(q)
                )
                : filteredLoansList;

              if (filtered.length === 0) {
                return (
                  <div className="text-center py-16">
                    <p className="text-gray-400 text-sm">
                      {filteredLoansList.length === 0
                        ? 'No CD loans found in the system.'
                        : `No loans match "${universalSearchQuery}"`}
                    </p>
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">CD Number</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Borrower Name</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Phone</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Loan Amount</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filtered.sort((a,b) => sortNumerically(a.loan_id, b.loan_id)).map((loan, idx) => (
                        <tr
                          key={loan.id}
                          className="hover:bg-green-50/50 cursor-pointer transition-colors group"
                          onClick={() => {
                            loadLedgerDetails(loan.id);
                            setUniversalSearchQuery('');
                          }}
                        >
                          <td className="px-4 py-3.5 text-slate-500 font-mono text-sm">{idx + 1}</td>
                          <td className="px-4 py-3.5 font-black text-base text-green-700 font-mono tracking-wide">{loan.loan_id}</td>
                          <td className="px-4 py-3.5 font-black text-base text-gray-900">{loan.customer?.name || 'N/A'}</td>
                          <td className="px-4 py-3.5 text-gray-600 font-mono">{loan.customer?.phone || '-'}</td>
                          <td className="px-4 py-3.5 font-semibold text-gray-800">{Number(loan.amount || 0).toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${loan.status === 'Active' ? 'bg-green-100 text-green-700'
                              : loan.status === 'Closed' ? 'bg-gray-100 text-gray-500'
                                : loan.status === 'NPA_CLOSED' ? 'bg-orange-100 text-orange-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}>
                              {(loan.status || 'Active').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-green-600 text-xs font-semibold group-hover:underline">Open →</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        ) : (
          <>
            {/* Workspace Header Hub */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm print:hidden">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => { setSelectedLoan(null); setUniversalSearchQuery(''); }}
                  className="inline-flex items-center gap-2 text-xs font-bold text-gray-655 hover:text-slate-900 bg-gray-50 hover:bg-gray-100 border border-gray-200/60 px-3 py-2 rounded-xl transition-all shadow-sm font-sans"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to All
                </button>
                <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
                <div>
                  <h2 className="text-xl font-black text-slate-955 flex items-center gap-2">
                    {selectedLoan.customer?.name}
                    <span className="text-[17px] font-mono text-slate-900 font-bold bg-slate-100 px-3 py-1 rounded-lg">A/C: {selectedLoan.loan_id}</span>
                  </h2>
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[13px] font-bold ${selectedLoan.status === 'Active' ? 'bg-green-100 text-green-700'
                  : selectedLoan.status === 'Closed' ? 'bg-gray-100 text-gray-500'
                    : selectedLoan.status === 'NPA_CLOSED' ? 'bg-orange-100 text-orange-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                  {(selectedLoan.status || 'Active').toUpperCase()}
                </span>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-auto font-sans">
                <span className="text-[14px] text-slate-800 uppercase tracking-wider font-bold">
                  Record: <span className="text-slate-955 font-black">{currentIndex + 1}</span> of <span className="text-slate-955 font-black">{filteredLoansList.length}</span>
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={handlePrevRecord}
                    disabled={currentIndex <= 0}
                    className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Previous Record"
                  >
                    <ChevronLeft className="w-4 h-4 text-gray-650" />
                  </button>
                  <button
                    onClick={handleNextRecord}
                    disabled={currentIndex >= filteredLoansList.length - 1}
                    className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Next Record"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-650" />
                  </button>
                </div>
              </div>
            </div>

            {/* Workspace Profile Cards Layout (Compacted Profiles with Photos Side-by-Side) */}
            {(() => {
              const borrowerPhotoUrl = selectedLoan.customer?.customer_photo_url || selectedLoan.customer_photo_url;
              const guarantor1PhotoUrl = guarantor1?.photo_url || guarantor1?.customer_photo_url || selectedLoan.surety_photo_url;
              const guarantor2PhotoUrl = guarantor2?.photo_url || guarantor2?.customer_photo_url;

              // Determine which columns to show
              const showG1 = !!selectedLoan.guarantor_1_id;
              const showG2 = !!selectedLoan.guarantor_2_id;
              const gridCols = showG1 && showG2 ? 'grid-cols-3' : showG1 || showG2 ? 'grid-cols-2' : 'grid-cols-1';
              const cardMenu = (key: string, customerId?: string | null) => customerId ? (
                <div className="relative">
                  <button type="button" title="More options" onClick={() => setCardMenuOpen(cardMenuOpen === key ? null : key)}
                    className="p-1 rounded hover:bg-slate-100 text-slate-500">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {cardMenuOpen === key && (
                    <div className="absolute right-0 top-7 z-30 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[170px]">
                      <button type="button" onClick={() => { setCardMenuOpen(null); setFullDetailsCustomerId(customerId); }}
                        className="w-full text-left px-3 py-2 text-[14px] font-semibold text-slate-800 hover:bg-slate-50">View full details</button>
                    </div>
                  )}
                </div>
              ) : null;

              return (
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm print:hidden">
                  {fullDetailsCustomerId && (
                    <CustomerFullDetails customerId={fullDetailsCustomerId} onClose={() => setFullDetailsCustomerId(null)} />
                  )}
                  <div className={`grid ${gridCols} divide-x divide-gray-100`}>

                    {/* BORROWER column */}
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] font-bold uppercase text-slate-500 tracking-wider">Borrower</span>
                        {cardMenu('borrower', selectedLoan.customer_id)}
                      </div>

                      <div className="flex gap-2.5 items-start">
                        <div className="w-[72px] h-[92px] shrink-0 rounded-lg bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shadow-sm">
                          {borrowerPhotoUrl ? (
                            <img src={borrowerPhotoUrl} alt="Borrower" className="w-full h-full object-contain" />
                          ) : (
                            <User className="w-5 h-5 text-gray-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-black text-[18px] text-slate-900 leading-tight break-words">{selectedLoan.customer?.name}</div>
                          <div className="text-[13px] text-slate-500 leading-tight truncate">{formatRelationship(selectedLoan.customer?.father_husband_name) || '—'}</div>
                          <div className="text-[15px] font-bold text-slate-800 mt-0.5">☎ {selectedLoan.customer?.phone || 'N/A'}{selectedLoan.customer?.phone2 ? ` / ${selectedLoan.customer.phone2}` : ''}</div>
                          {selectedLoan.customer?.aadhaar && <div className="text-[14px] font-bold text-slate-700 mt-0.5">AADHAR NO : <span className="font-mono">{selectedLoan.customer.aadhaar}</span></div>}
                          {selectedLoan.customer?.address && <div className="text-[13px] text-slate-500 break-words" title={selectedLoan.customer.address}>{selectedLoan.customer.address}</div>}
                        </div>
                      </div>
                    </div>

                    {/* GUARANTOR 1 column — only if exists */}
                    {showG1 && (
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[13px] font-bold uppercase text-slate-500 tracking-wider">Guarantor 1</span>
                          {cardMenu('g1', selectedLoan.guarantor_1_id)}
                        </div>
                        {guarantor1 ? (
                          <div className="flex gap-2.5 items-start">
                            <div className="w-[72px] h-[92px] shrink-0 rounded-lg bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shadow-sm">
                              {guarantor1PhotoUrl ? (
                                <img src={guarantor1PhotoUrl} alt="Guarantor 1" className="w-full h-full object-contain" />
                              ) : (
                                <User className="w-5 h-5 text-gray-300" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-black text-[18px] text-slate-900 leading-tight break-words">{guarantor1.name}</div>
                              <div className="text-[15px] font-bold text-slate-800 mt-0.5">☎ {guarantor1.phone || 'N/A'}</div>
                              {guarantor1.aadhaar && <div className="text-[14px] font-bold text-slate-700 mt-0.5">AADHAR NO : <span className="font-mono">{guarantor1.aadhaar}</span></div>}
                              {guarantor1.address && <div className="text-[13px] text-slate-500 break-words" title={guarantor1.address}>{guarantor1.address}</div>}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-14 text-[13px] text-slate-400 italic">Loading…</div>
                        )}
                      </div>
                    )}

                    {/* GUARANTOR 2 column — only if exists */}
                    {showG2 && (
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[13px] font-bold uppercase text-slate-500 tracking-wider">Guarantor 2</span>
                          {cardMenu('g2', selectedLoan.guarantor_2_id)}
                        </div>
                        {guarantor2 ? (
                          <div className="flex gap-2.5 items-start">
                            <div className="w-[72px] h-[92px] shrink-0 rounded-lg bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shadow-sm">
                              {guarantor2PhotoUrl ? (
                                <img src={guarantor2PhotoUrl} alt="Guarantor 2" className="w-full h-full object-contain" />
                              ) : (
                                <User className="w-5 h-5 text-gray-300" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-black text-[18px] text-slate-900 leading-tight break-words">{guarantor2.name}</div>
                              <div className="text-[15px] font-bold text-slate-800 mt-0.5">☎ {guarantor2.phone || 'N/A'}</div>
                              {guarantor2.aadhaar && <div className="text-[14px] font-bold text-slate-700 mt-0.5">AADHAR NO : <span className="font-mono">{guarantor2.aadhaar}</span></div>}
                              {guarantor2.address && <div className="text-[13px] text-slate-500 break-words" title={guarantor2.address}>{guarantor2.address}</div>}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-14 text-[13px] text-slate-400 italic">Loading…</div>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              );
            })()}

            {/* ========== COMPACT OPERATOR WORKSPACE — FIRST VIEWPORT ========== */}
            <div className="grid grid-cols-12 gap-3 print:hidden">

              {/* LEFT BLOCK (8 cols): Inputs + Loan Details + Action Buttons */}
              <div className="col-span-8">
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden h-full flex flex-col">

                  {/* Card micro-header */}
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
                    <span className="text-[14px] font-bold uppercase text-slate-800 tracking-wider">Operator Action &amp; Calculations</span>
                    {renewCalculations?.error ? (
                      <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1 text-red-700 font-semibold text-[12px]">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-red-600" />
                        <span>Timeline Chronology Error</span>
                      </div>
                    ) : renewCalculations?.isDateInvalid && (
                      <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1 text-red-700 font-semibold text-[12px]">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-red-600" />
                        <span>Payment date before loan date ({renewCalculations.loanDate})</span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 flex flex-col gap-3.5 flex-1">

                    {/* Receipt + Amount row */}
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
                          disabled={selectedLoan.status === 'Closed' || selectedLoan.status === 'NPA_CLOSED'}
                        />
                      </div>
                    </div>

                    {/* Payment Allocation Visualizer (shows only when amount entered) */}
                    {paymentPreview && (
                      <div className="bg-slate-50/50 border border-slate-100 rounded-xl px-3 py-2 space-y-2.5 shadow-sm">
                        <h4 className="text-[12px] text-slate-800 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                          Real-Time Payment Allocation
                        </h4>

                        {paymentPreview.isClosingPayment ? (
                          <div className="space-y-1.5">
                            <span className="text-[12px] font-bold text-slate-700 uppercase block">Closing Allocation Preview</span>
                            {(() => {
                              const total = paymentPreview.paymentAmount;
                              const pPaid = paymentPreview.renew.penaltyPaid;
                              const oPaid = paymentPreview.renew.overdueInterestPaid;
                              const prPaid = paymentPreview.renew.principalPaid;
                              const pctP = total > 0 ? (pPaid / total) * 100 : 0;
                              const pctO = total > 0 ? (oPaid / total) * 100 : 0;
                              const pctPr = total > 0 ? (prPaid / total) * 100 : 0;
                              return (
                                <div className="space-y-1.5">
                                  <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner border border-slate-200/20">
                                    {pctP > 0 && <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${pctP}%` }} title={`Penalty: ${pPaid}`} />}
                                    {pctO > 0 && <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${pctO}%` }} title={`Overdue Interest: ${oPaid}`} />}
                                    {pctPr > 0 && <div className="bg-indigo-650 h-full transition-all duration-300" style={{ width: `${pctPr}%` }} title={`Principal: ${prPaid}`} />}
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-bold text-slate-800">
                                    {pPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />Penalty: {pPaid.toLocaleString('en-IN')}</span>}
                                    {oPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Overdue Int: {oPaid.toLocaleString('en-IN')}</span>}
                                    {prPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-650" />Principal: {prPaid.toLocaleString('en-IN')}</span>}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {/* Option 1 Bar */}
                            <div className="space-y-1">
                              <span className="text-[12px] font-bold text-emerald-800 uppercase block">Option 1: Renewal Allocation</span>
                              {(() => {
                                const total = paymentPreview.paymentAmount;
                                const pPaid = paymentPreview.renew.penaltyPaid;
                                const oPaid = paymentPreview.renew.overdueInterestPaid;
                                const rPaid = paymentPreview.renew.renewalInterestPaid;
                                const prPaid = paymentPreview.renew.principalPaid;
                                const pctP = total > 0 ? (pPaid / total) * 100 : 0;
                                const pctO = total > 0 ? (oPaid / total) * 100 : 0;
                                const pctR = total > 0 ? (rPaid / total) * 100 : 0;
                                const pctPr = total > 0 ? (prPaid / total) * 100 : 0;
                                return (
                                  <div className="space-y-1">
                                    <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner border border-slate-200/40">
                                      {pctP > 0 && <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${pctP}%` }} title={`Penalty: ${pPaid}`} />}
                                      {pctO > 0 && <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${pctO}%` }} title={`Overdue Interest: ${oPaid}`} />}
                                      {pctR > 0 && <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${pctR}%` }} title={`Renewal Interest: ${rPaid}`} />}
                                      {pctPr > 0 && <div className="bg-indigo-650 h-full transition-all duration-300" style={{ width: `${pctPr}%` }} title={`Principal: ${prPaid}`} />}
                                    </div>
                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] font-bold text-slate-800">
                                      {pPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />Penalty: {pPaid.toLocaleString('en-IN')}</span>}
                                      {oPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Overdue Int: {oPaid.toLocaleString('en-IN')}</span>}
                                      {rPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Renewal Int: {rPaid.toLocaleString('en-IN')}</span>}
                                      {prPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-650" />Principal: {prPaid.toLocaleString('en-IN')}</span>}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                            {/* Option 2 Bar */}
                            {paymentPreview.partial.principalPaid > 0 && (
                              <div className="space-y-1 border-t border-slate-200/50 pt-2">
                                <span className="text-[12px] font-bold text-indigo-800 uppercase block">Option 2: Partial Payment Allocation</span>
                                {(() => {
                                  const total = paymentPreview.paymentAmount;
                                  const pPaid = paymentPreview.partial.penaltyPaid;
                                  const oPaid = paymentPreview.partial.overdueInterestPaid;
                                  const rPaid = paymentPreview.partial.renewalInterestPaid;
                                  const prPaid = paymentPreview.partial.principalPaid;
                                  const pctP = total > 0 ? (pPaid / total) * 100 : 0;
                                  const pctO = total > 0 ? (oPaid / total) * 100 : 0;
                                  const pctR = total > 0 ? (rPaid / total) * 100 : 0;
                                  const pctPr = total > 0 ? (prPaid / total) * 100 : 0;
                                  return (
                                    <div className="space-y-1">
                                      <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner border border-slate-200/40">
                                        {pctP > 0 && <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${pctP}%` }} title={`Penalty: ${pPaid}`} />}
                                        {pctO > 0 && <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${pctO}%` }} title={`Overdue Interest: ${oPaid}`} />}
                                        {pctR > 0 && <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${pctR}%` }} title={`Renewal Interest: ${rPaid}`} />}
                                        {pctPr > 0 && <div className="bg-indigo-650 h-full transition-all duration-300" style={{ width: `${pctPr}%` }} title={`Principal: ${prPaid}`} />}
                                      </div>
                                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] font-bold text-slate-800">
                                        {pPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />Penalty: {pPaid.toLocaleString('en-IN')}</span>}
                                        {oPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Overdue Int: {oPaid.toLocaleString('en-IN')}</span>}
                                        {rPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Renewal Int: {rPaid.toLocaleString('en-IN')}</span>}
                                        {prPaid > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-650" />Principal: {prPaid.toLocaleString('en-IN')}</span>}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Compact 9-cell Loan Details grid (2 cols per row, except Days & Due Days side-by-side) */}
                    <div className="grid grid-cols-4 gap-2 font-sans">
                      <div className="col-span-2 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Loan Amount</span>
                        <span className="text-[16px] font-bold text-slate-900">{originalLoanAmount.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="col-span-2 grid grid-cols-2 border border-slate-200 rounded-lg bg-slate-50/80 shadow-sm overflow-hidden">
                        <div className="px-2.5 py-1.5 border-r border-slate-200">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Rate / Penalty</span>
                          <span className="text-[16px] font-bold text-slate-900">{Number(selectedLoan.interest_rate).toFixed(2)}% / {Number(selectedLoan.penalty_percent || 0.75).toFixed(2)}%</span>
                        </div>
                        <div 
                          onClick={() => setShowCompoundModal(true)}
                          title={TOOLTIP_TEXT}
                          className="px-2.5 py-1.5 hover:bg-slate-100 group cursor-pointer transition-colors"
                        >
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">CI</span>
                          <span className="text-[16px] font-bold text-slate-900 group-hover:underline underline-offset-2">{Math.round(compoundInterestData.summary?.compoundInterestEarned || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      <div className="col-span-2 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Loan Date</span>
                        <span className="text-[16px] font-bold text-slate-900">{formatDateOld(originalLoanDate)}</span>
                      </div>
                      <div className="col-span-2 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Last Payment</span>
                        <span className="text-[16px] font-bold text-slate-900">{renewCalculations?.error ? '—' : (formatDateOld(renewCalculations?.lastPaymentDate) || '—')}</span>
                      </div>
                      <div className="col-span-2 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Current Due Date</span>
                        <span className="text-[16px] font-bold text-slate-900">{renewCalculations?.error ? '—' : formatDateOld(renewCalculations?.currentDueDate)}</span>
                      </div>
                      <div className="col-span-2 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Next Due Date</span>
                        <span className="text-[16px] font-bold text-slate-900">{renewCalculations?.error ? '—' : (totalAmountPaying && Number(totalAmountPaying) > 0 && paymentPreview?.renew?.nextDueDate ? formatDateOld(paymentPreview.renew.nextDueDate) : '—')}</span>
                      </div>
                      <div className="col-span-1 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Days</span>
                        <span className="text-[16px] font-bold text-slate-900">{renewCalculations?.error ? '—' : (renewCalculations?.displayDays !== undefined ? Number(renewCalculations.displayDays).toFixed(2) : '0.00')}</span>
                      </div>
                      <div className="col-span-1 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Due Days</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[16px] font-bold text-slate-900">{renewCalculations?.error ? '—' : (renewCalculations?.displayDueDays !== undefined ? renewCalculations.displayDueDays : 0)}</span>
                          {!renewCalculations?.error && renewCalculations && renewCalculations.displayDueDays !== undefined && renewCalculations.displayDueDays < 0 && (
                            <span className="inline-flex px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-black text-[10px] uppercase tracking-wider">{Math.abs(renewCalculations.displayDueDays)} Left</span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2 border border-slate-200 rounded-lg bg-slate-50/80 px-2.5 py-1.5 shadow-sm">
                        <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Doc Status</span>
                        <span className="text-[16px] font-bold text-slate-900">{documentReturned ? 'Returned' : 'Submitted'}</span>
                      </div>
                    </div>

                    {/* Action buttons — last row of the left block */}
                    <div className="grid grid-cols-3 gap-2 mt-auto">
                      <Button
                        onClick={() => handleActionSubmit('Renew')}
                        disabled={
                          isRenewing ||
                          selectedLoan.status === 'Closed' ||
                          selectedLoan.status === 'NPA_CLOSED' ||
                          !!renewCalculations?.isDateInvalid ||
                          !!renewCalculations?.error ||
                          !totalAmountPaying ||
                          Number(totalAmountPaying) <= 0
                        }
                        className="bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1 border-0 animate-none"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Renewal
                      </Button>

                      <Button
                        onClick={() => handleActionSubmit('Partial')}
                        disabled={
                          isRenewing ||
                          !totalAmountPaying ||
                          Number(totalAmountPaying) <= 0 ||
                          Number(totalAmountPaying) < ledgerMetrics.totalToRegularize ||
                          Number(totalAmountPaying) >= ledgerMetrics.totalClose ||
                          selectedLoan.status === 'Closed' ||
                          selectedLoan.status === 'NPA_CLOSED' ||
                          !!renewCalculations?.isDateInvalid ||
                          !!renewCalculations?.error
                        }
                        className="bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1 border-0 animate-none"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        Partial Payment
                      </Button>

                      <Button
                        onClick={() => handleActionSubmit('Close')}
                        disabled={
                          isRenewing ||
                          selectedLoan.status === 'Closed' ||
                          selectedLoan.status === 'NPA_CLOSED' ||
                          !totalAmountPaying ||
                          Number(totalAmountPaying) < ledgerMetrics.totalClose ||
                          !!renewCalculations?.isDateInvalid ||
                          !!renewCalculations?.error
                        }
                        className="bg-rose-600 hover:bg-rose-700 text-white py-2.5 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1 border-0 animate-none"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Close Account
                      </Button>
                    </div>

                  </div>
                </div>
              </div>

              {/* RIGHT BLOCK (4 cols): Account Position Metrics */}
              <div className="col-span-4">
                {renewCalculations?.error ? (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 shadow-sm h-full flex flex-col justify-center items-center text-center">
                    <ShieldAlert className="w-12 h-12 text-red-600 mb-3 animate-pulse" />
                    <h3 className="text-red-900 text-lg font-black uppercase tracking-wider mb-2">Account Data Error</h3>
                    <p className="text-red-700 text-sm font-semibold mb-4 leading-relaxed">
                      {selectedLoan.loan_id} contains an invalid loan timeline.
                      <br />
                      Loan date: {formatDateOld(originalLoanDate)}
                      <br />
                      Earliest payment: {formatDateOld(cdLedgerEntries.filter(e => e.entry_type === 'amount_paid' || Number(e.credit) > 0).sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime())[0]?.entry_date)}
                    </p>
                    <span className="text-xs text-red-500 font-bold uppercase tracking-wider">Account position cannot be calculated safely.</span>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden h-full flex flex-col">

                    {/* Card micro-header */}
                    <div className="px-3 py-2.5 border-b border-gray-100">
                      <span className="text-[14px] font-bold uppercase text-slate-800 tracking-wider">Account Position</span>
                    </div>

                    <div className="p-3 flex flex-col gap-2.5 flex-1">

                      {/* 2×2 Compact Metrics Grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-sm">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Principal Bal.</span>
                          <span className="text-[20px] font-bold text-slate-955 block leading-snug">{ledgerMetrics.principalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-sm">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Today Due</span>
                          <span className={`text-[20px] font-bold block leading-snug ${ledgerMetrics.todayDue < 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {formatCDCurrency(ledgerMetrics.todayDue)}
                          </span>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-sm">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Accrued Interest</span>
                          <span className={`text-[20px] font-bold block leading-snug ${ledgerMetrics.pendingInterest < 0 ? 'text-emerald-700' : 'text-slate-955'}`}>
                            {formatCDCurrency(ledgerMetrics.pendingInterest)}
                          </span>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-sm">
                          <span className="text-[13px] text-slate-500 font-bold uppercase block tracking-wider leading-none mb-0.5">Accrued Penalty</span>
                          <span className="text-[20px] font-bold text-rose-700 block leading-snug">{ledgerMetrics.pendingPenalty.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>

                      {/* Total for Renewal */}
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex justify-between items-center shadow-sm">
                        <div>
                          <span className="text-emerald-900 text-[13px] uppercase font-bold tracking-wider block leading-none">Total for Renewal</span>
                          <span className="text-[12px] text-emerald-700 font-semibold block mt-0.5">To extend standard cycle</span>
                        </div>
                        <span className="text-[22px] font-extrabold text-emerald-800">
                          {ledgerMetrics.renewalDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      {/* Total to Regularize */}
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex justify-between items-center shadow-sm">
                        <div>
                          <span className="text-amber-900 text-[13px] uppercase font-bold tracking-wider block leading-none">Total to Regularize</span>
                          <span className="text-[12px] text-amber-700 font-semibold block mt-0.5">Overdue int + penalty + renewal</span>
                        </div>
                        <span className="text-[22px] font-extrabold text-amber-800">
                          {ledgerMetrics.totalToRegularize.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      {/* Total for Close */}
                      <div className="bg-slate-950 border border-slate-900 rounded-xl px-3 py-2 flex justify-between items-center shadow-md">
                        <div>
                          <span className="text-white text-[13px] uppercase font-bold tracking-wider block leading-none">Total for Close</span>
                          <span className="text-[12px] text-slate-400 font-semibold block mt-0.5">Full payoff principal &amp; dues</span>
                        </div>
                        <span className="text-[22px] font-extrabold text-emerald-400">
                          {formatCDCurrency(ledgerMetrics.totalClose)}
                        </span>
                      </div>

                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* ========== BELOW FOLD: Files & Statements ========== */}

            {/* Statements & Logs unified tabbed card */}
            <Card
              title={
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
                  <div>
                    <span className="text-base font-extrabold text-slate-950 block">Statements &amp; Logs</span>
                    <span className="text-xs text-slate-600 font-bold block mt-0.5">Track transaction history and interest accruals</span>
                  </div>
                  <div className="flex gap-1.5 bg-gray-100 border border-gray-200 p-1 rounded-xl self-start sm:self-auto font-sans">
                    <button
                      onClick={() => setActiveLogTab('statement')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all uppercase tracking-wider ${activeLogTab === 'statement' ? 'bg-white text-green-800 shadow-sm border border-gray-150' : 'text-slate-900 hover:text-black'}`}
                    >
                      Ledger Statement
                    </button>
                    <button
                      onClick={() => setActiveLogTab('interest')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all uppercase tracking-wider ${activeLogTab === 'interest' ? 'bg-white text-green-800 shadow-sm border border-gray-150' : 'text-slate-900 hover:text-black'}`}
                    >
                      Interest History
                    </button>
                    <button
                      onClick={() => setActiveLogTab('payment')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all uppercase tracking-wider ${activeLogTab === 'payment' ? 'bg-white text-green-800 shadow-sm border border-gray-150' : 'text-slate-900 hover:text-black'}`}
                    >
                      Payment History
                    </button>
                    <button
                      onClick={() => setActiveLogTab('editHistory')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all uppercase tracking-wider ${activeLogTab === 'editHistory' ? 'bg-white text-green-800 shadow-sm border border-gray-150' : 'text-slate-900 hover:text-black'}`}
                    >
                      Edit History
                    </button>
                  </div>
                </div>
              }
              className="shadow-sm border-gray-100 rounded-3xl w-full font-sans print:hidden animate-none relative"
            >
              {loadingTab && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-3xl">
                  <div className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-green-600" />
                    Updating Tab Data...
                  </div>
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
                      {groupedPivotStatementEntries.map((row) => {
                        const isExpanded = expandedPivotRowIds.has(row.id);
                        const isLoanIssue = row.eventType === 'Loan Issue';
                        return (
                          <React.Fragment key={row.id}>
                            <tr 
                              className={`hover:bg-blue-50/40 transition-colors ${isLoanIssue ? 'bg-slate-50/80 font-semibold' : ''}`}
                            >
                              <td className="px-2.5 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => togglePivotRowExpand(row.id)}
                                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition-colors cursor-pointer"
                                  title={isExpanded ? "Collapse Audit Details" : "Expand Audit Details"}
                                >
                                  {isExpanded ? <ChevronDown className="w-4 h-4 text-blue-600" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                </button>
                              </td>
                              <td className="px-3.5 py-3 font-bold text-slate-900 whitespace-nowrap">{formatDateOld(row.date)}</td>
                              <td className="px-3.5 py-3 font-mono font-black text-slate-900 whitespace-nowrap">{row.receiptNo}</td>
                              <td className="px-3.5 py-3 font-bold uppercase text-[11px] whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                  row.eventType === 'Loan Issue' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                  row.eventType === 'Renewal' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                  row.eventType === 'Partial' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                                  row.eventType === 'Closure' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                                  row.eventType === 'NPA' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                  'bg-slate-100 text-slate-800 border border-slate-200'
                                }`}>
                                  {row.eventType}
                                </span>
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">
                                {row.principalPaid > 0 ? row.principalPaid.toLocaleString('en-IN') : '—'}
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                                {row.interestPaid > 0 ? row.interestPaid.toLocaleString('en-IN') : '—'}
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-amber-700 whitespace-nowrap">
                                {row.penaltyPaid > 0 ? row.penaltyPaid.toLocaleString('en-IN') : '—'}
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-bold text-purple-700 whitespace-nowrap">
                                {row.docCharges > 0 ? row.docCharges.toLocaleString('en-IN') : '—'}
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-black text-indigo-900 whitespace-nowrap">
                                {row.totalPaid > 0 ? row.totalPaid.toLocaleString('en-IN') : '—'}
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-black text-rose-700 whitespace-nowrap">
                                {row.outstandingPrincipal.toLocaleString('en-IN')}
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-black text-rose-900 whitespace-nowrap">
                                {row.presentDue.toLocaleString('en-IN')}
                              </td>
                              <td className="px-3.5 py-3 text-slate-700 font-medium whitespace-nowrap">{row.operator}</td>
                              <td className="px-3.5 py-3 text-slate-800 font-medium text-[11px] truncate max-w-[200px]" title={row.remarks}>{row.remarks}</td>
                            </tr>

                            {/* Expandable Sub-table for Raw Audit Entries */}
                            {isExpanded && (
                              <tr className="bg-slate-50/90">
                                <td colSpan={13} className="px-6 py-3 border-y border-slate-250">
                                  <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 shadow-sm">
                                    <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-700 border-b pb-1.5">
                                      <span className="flex items-center gap-1.5 text-blue-900">
                                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                                        AUDIT DRILL-DOWN ({row.rawEntries.length} Raw Postings)
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
                                      <tbody className="divide-y divide-slate-150 font-mono">
                                        {row.rawEntries.map((raw: any) => (
                                          <tr key={raw.id} className="hover:bg-slate-50">
                                            <td className="p-1.5 font-bold text-slate-900">{mapAccountName(raw.account_name)}</td>
                                            <td className="p-1.5 text-slate-600">{raw.entry_type}</td>
                                            <td className="p-1.5 text-right text-emerald-700 font-bold">{raw.credit > 0 ? raw.credit.toLocaleString('en-IN') : '—'}</td>
                                            <td className="p-1.5 text-right text-rose-700 font-bold">{raw.debit > 0 ? raw.debit.toLocaleString('en-IN') : '—'}</td>
                                            <td className="p-1.5 font-sans text-slate-700">{raw.particulars || '—'}</td>
                                            <td className="p-1.5 font-sans text-slate-600">{raw.user_name || 'Staff'}</td>
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
                      {groupedPivotStatementEntries.length === 0 && (
                        <tr>
                          <td colSpan={13} className="text-center py-8 text-slate-400 italic">No entries recorded in statement</td>
                        </tr>
                      )}
                    </tbody>
                    {groupedPivotStatementEntries.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-100/90 text-slate-900 font-mono font-black text-xs border-t-2 border-slate-300">
                          <td colSpan={4} className="px-3.5 py-3.5 uppercase text-right font-sans font-bold text-slate-700">GRAND TOTALS:</td>
                          <td className="px-3.5 py-3.5 text-right text-blue-800 font-black">{pivotTotals.principalPaid.toLocaleString('en-IN')}</td>
                          <td className="px-3.5 py-3.5 text-right text-emerald-800 font-black">{pivotTotals.interestPaid.toLocaleString('en-IN')}</td>
                          <td className="px-3.5 py-3.5 text-right text-amber-800 font-black">{pivotTotals.penaltyPaid.toLocaleString('en-IN')}</td>
                          <td className="px-3.5 py-3.5 text-right text-purple-800 font-black">{pivotTotals.docCharges.toLocaleString('en-IN')}</td>
                          <td className="px-3.5 py-3.5 text-right text-indigo-950 font-black">{pivotTotals.totalPaid.toLocaleString('en-IN')}</td>
                          <td className="px-3.5 py-3.5 text-right text-rose-800 font-black">{pivotTotals.latestOutstanding.toLocaleString('en-IN')}</td>
                          <td className="px-3.5 py-3.5 text-right text-rose-950 font-black">{pivotTotals.latestPresentDue.toLocaleString('en-IN')}</td>
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
                    <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-250">
                      <tr>
                        <th className="px-4 py-3.5 whitespace-nowrap">Date</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Receipt No</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Type</th>
                        <th className="px-4 py-3.5 text-right text-emerald-800 whitespace-nowrap">Interest Paid</th>
                        <th className="px-4 py-3.5 text-right text-amber-800 whitespace-nowrap">Penalty Paid</th>
                        <th className="px-4 py-3.5 text-center whitespace-nowrap">Days Renewed</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Renewed Till</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-sans">
                      {groupedInterestHistoryEntries.map((row, idx) => (
                        <tr key={row.id || idx} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{formatDateOld(row.date)}</td>
                          <td className="px-4 py-3 font-mono font-black text-slate-900 whitespace-nowrap">{row.receiptNo}</td>
                          <td className="px-4 py-3 font-bold uppercase text-[11px] whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                              row.type === 'Renewal' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                              'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}>
                              {row.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                            {row.interestPaid > 0 ? row.interestPaid.toLocaleString('en-IN') : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-amber-700 whitespace-nowrap">
                            {row.penaltyPaid > 0 ? row.penaltyPaid.toLocaleString('en-IN') : '—'}
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-black text-slate-800 whitespace-nowrap">
                            {row.daysRenewed > 0 ? `${row.daysRenewed} Days` : '—'}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">
                            {row.renewedTill ? formatDateOld(row.renewedTill) : '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-800 font-medium text-[11px] truncate max-w-[220px]" title={row.remarks}>
                            {row.remarks}
                          </td>
                        </tr>
                      ))}
                      {groupedInterestHistoryEntries.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-slate-400 italic">No interest transactions logged</td>
                        </tr>
                      )}
                    </tbody>
                    {groupedInterestHistoryEntries.length > 0 && (
                      <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-900 font-mono font-black text-xs border-t-2 border-slate-300">
                        <tr>
                          <td colSpan={3} className="px-4 py-3 uppercase text-right font-sans font-bold text-slate-700">TOTAL INTEREST COLLECTED:</td>
                          <td className="px-4 py-3 text-right text-emerald-800 font-black">{interestTotals.interestPaid.toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3 text-right text-amber-800 font-black">{interestTotals.penaltyPaid.toLocaleString('en-IN')}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {activeLogTab === 'payment' && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin rounded-2xl border border-slate-200">
                  <table className="w-full text-xs text-left min-w-[950px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-250">
                      <tr>
                        <th className="w-8 px-3.5 py-3.5 text-center"></th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Date</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Receipt No</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Transaction Type</th>
                        <th className="px-4 py-3.5 text-right text-indigo-950 whitespace-nowrap">Amount Paid</th>
                        <th className="px-4 py-3.5 whitespace-nowrap">Collected By</th>
                        <th className="px-4 py-3.5 text-center whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-sans">
                      {loanTransactions
                        .filter((tx: any) => tx.type === 'Collection')
                        .map((tx: any) => {
                          const isTxEditable = user?.is_admin || (() => {
                            const txCreatedAt = new Date(tx.created_at || tx.date).getTime();
                            const now = Date.now();
                            const diffHours = (now - txCreatedAt) / (1000 * 60 * 60);
                            return diffHours <= 24;
                          })();
                          
                          const isExpanded = expandedTxIds.has(tx.id);
                          
                          const txAllocations = cdLedgerEntries.filter(
                            (entry) => entry.receipt_no === tx.receipt_no
                          );
                          const principalAllocation = txAllocations
                            .filter((e) => (e.account_name || '').toUpperCase() === 'CD A/C' || e.entry_type === 'principal_payment')
                            .reduce((sum, e) => sum + Number(e.credit || 0), 0);
                          const interestAllocation = txAllocations
                            .filter((e) => (e.account_name || '').toUpperCase() === 'CD COMMISSION A/C' || e.entry_type === 'interest_payment')
                            .reduce((sum, e) => sum + Number(e.credit || 0), 0);
                          const penaltyAllocation = txAllocations
                            .filter((e) => (e.account_name || '').toUpperCase() === 'PENALTY A/C' || e.entry_type === 'penalty_payment')
                            .reduce((sum, e) => sum + Number(e.credit || 0), 0);

                          const isPending = tx.receipt_no && tx.receipt_no !== '-' && pendingReviews?.some(r => r?.receipt_number === tx.receipt_no && r?.loan_id === selectedLoan?.id);
                          
                          return (
                            <React.Fragment key={tx.id}>
                              <tr className={`odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors ${isPending ? 'bg-[#fff7ed]' : ''}`}>
                                <td className="px-2.5 py-3 text-center">
                                  <button 
                                    onClick={() => toggleExpandTx(tx.id)}
                                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition-colors focus:outline-none cursor-pointer"
                                    title={isExpanded ? "Collapse Allocation" : "Expand Allocation"}
                                  >
                                    {isExpanded ? <ChevronDown className="w-4 h-4 text-blue-600" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                  </button>
                                </td>
                                <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{formatDateOld(tx.date)}</td>
                                <td className="px-4 py-3 font-mono font-black text-slate-900 whitespace-nowrap">
                                  {tx.receipt_no || '—'}
                                  {isPending && (
                                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold bg-orange-50 text-orange-700 border border-orange-200 uppercase tracking-wide">
                                      Pending Approval
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 font-bold uppercase text-[11px] whitespace-nowrap">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">
                                    CD Amount Paid
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-black text-indigo-900 text-sm whitespace-nowrap">
                                  {Number(tx.amount).toLocaleString('en-IN')}
                                </td>
                                <td className="px-4 py-3 text-slate-700 font-medium whitespace-nowrap">{tx.collected_by || 'Staff'}</td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="flex items-center justify-center gap-2">
                                    {isTxEditable ? (
                                      <button
                                        onClick={() => handleOpenEditTxModal(tx)}
                                        className="p-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900 rounded-lg transition-colors border border-indigo-200"
                                        title="Edit Transaction"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <span className="text-slate-400 text-xs italic bg-slate-50 px-2 py-0.5 rounded border border-slate-200" title={isPending ? "Pending approval review" : "Editable only within 24 hours"}>
                                        {isPending ? 'Pending' : 'ReadOnly'}
                                      </span>
                                    )}
                                    {user?.is_admin && (
                                      <button
                                        onClick={() => handleDeleteTx(tx)}
                                        className="p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-900 rounded-lg transition-colors border border-rose-200"
                                        title="Delete Transaction"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-slate-50/90">
                                  <td colSpan={7} className="px-6 py-3 border-y border-slate-250">
                                    <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 shadow-sm">
                                      <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-700 border-b pb-1.5">
                                        <span className="flex items-center gap-1.5 text-blue-900">
                                          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                                          PAYMENT ALLOCATION BREAKDOWN
                                        </span>
                                        <span className="text-slate-500 font-normal">Receipt: <span className="font-bold text-slate-800">{tx.receipt_no || '—'}</span></span>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
                                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                                          <span className="text-slate-500 uppercase font-sans font-bold tracking-wider text-[10px] block mb-0.5">CD Principal</span>
                                          <span className="text-sm font-black text-blue-700">
                                            {principalAllocation > 0 ? principalAllocation.toLocaleString('en-IN') : '—'}
                                          </span>
                                        </div>
                                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                                          <span className="text-slate-500 uppercase font-sans font-bold tracking-wider text-[10px] block mb-0.5">CD Interest</span>
                                          <span className="text-sm font-black text-emerald-700">
                                            {interestAllocation > 0 ? interestAllocation.toLocaleString('en-IN') : '—'}
                                          </span>
                                        </div>
                                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                                          <span className="text-slate-500 uppercase font-sans font-bold tracking-wider text-[10px] block mb-0.5">CD Penalty</span>
                                          <span className="text-sm font-black text-amber-700">
                                            {penaltyAllocation > 0 ? penaltyAllocation.toLocaleString('en-IN') : '—'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      {loanTransactions.filter((tx: any) => tx.type === 'Collection').length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-slate-400 italic">No collection transactions recorded</td>
                        </tr>
                      ) : null}
                    </tbody>
                    {loanTransactions.filter((tx: any) => tx.type === 'Collection').length > 0 && (
                      <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-900 font-mono font-black text-xs border-t-2 border-slate-300">
                        <tr>
                          <td colSpan={4} className="px-4 py-3 uppercase text-right font-sans font-bold text-slate-700">TOTAL CASH COLLECTED:</td>
                          <td className="px-4 py-3 text-right text-indigo-950 font-black">{paymentTotals.toLocaleString('en-IN')}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {activeLogTab === 'editHistory' && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin rounded-2xl border border-slate-200">
                  <table className="w-full text-xs text-left min-w-[950px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-[2px] text-slate-700 uppercase tracking-wider text-[11px] font-sans font-bold border-b border-slate-250">
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
                        const oldD = log.old_data || {};
                        const newD = log.new_data || {};
                        return (
                          <tr key={log.id || idx} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors">
                            <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                              {new Date(log.edited_at).toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-3 text-slate-800 font-bold whitespace-nowrap">{log.edited_by || 'Operator'}</td>
                            <td className="px-4 py-3 font-mono font-black text-slate-900 whitespace-nowrap">
                              {newD.receipt_no || oldD.receipt_no || '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-500 whitespace-nowrap">
                              {oldD.date ? oldD.date.split('T')[0].split('-').reverse().join('/') : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                              {newD.date ? newD.date.split('T')[0].split('-').reverse().join('/') : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-slate-600 whitespace-nowrap">
                              {oldD.amount !== undefined ? Number(oldD.amount).toLocaleString('en-IN') : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-black text-emerald-700 whitespace-nowrap">
                              {newD.amount !== undefined ? Number(newD.amount).toLocaleString('en-IN') : '—'}
                            </td>
                            <td className="px-4 py-3 text-slate-800 font-medium text-[11px] truncate max-w-[220px]" title={log.reason}>
                              {log.reason || '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {editLogs.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-slate-400 italic">No transaction edit history logged</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {/* Totals Summary Footer Card & Buttons */}
            <div className="bg-white px-5 py-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col gap-3">

              {/* Stats row — flex-wrap so values never clip */}
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3">

                {/* Total Credit */}
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Total Credit</span>
                  <span className={`text-sm font-black font-mono tabular-nums transition-colors duration-300 ${bottomTotals.totalCredit > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                    {bottomTotals.totalCredit.toLocaleString('en-IN')}
                  </span>
                </div>

                {/* Divider */}
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />

                {/* Total Debit */}
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Total Debit</span>
                  <span className={`text-sm font-black font-mono tabular-nums transition-colors duration-300 ${bottomTotals.totalDebit > 0 ? 'text-red-600' : 'text-slate-300'}`}>
                    {bottomTotals.totalDebit.toLocaleString('en-IN')}
                  </span>
                </div>

                {/* Divider */}
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />

                {/* Present Balance */}
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Present Bal.</span>
                  <span className={`text-sm font-black font-mono tabular-nums transition-colors duration-300 ${bottomTotals.presentBalance <= 0 ? 'text-slate-300'
                    : bottomTotals.presentBalance < bottomTotals.totalDebit * 0.25 ? 'text-emerald-600'
                      : 'text-amber-700'
                    }`}>
                    {bottomTotals.presentBalance.toLocaleString('en-IN')}
                  </span>
                </div>

                {/* Divider */}
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />

                {/* Total Dues + mini progress bar */}
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Total Dues</span>
                  <span className={`text-sm font-black font-mono tabular-nums transition-colors duration-300 ${bottomTotals.totalDues > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
                    {bottomTotals.totalDues.toLocaleString('en-IN')}
                  </span>
                  {bottomTotals.totalDues > 0 && (
                    <div className="w-full h-[3px] bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.round((bottomTotals.paidDues / bottomTotals.totalDues) * 100))}%`,
                          background: bottomTotals.pendingDues <= 0 ? '#16a34a' : bottomTotals.paidDues > 0 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Paid Dues / Pending Dues removed (not needed here) */}
                {/* Divider */}
                <div className="self-stretch w-px bg-slate-100 hidden sm:block" />

                {/* Partner */}
                <div className="flex flex-col min-w-[90px]">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-1">Partner</span>
                  <span 
                    className="text-sm font-black font-sans text-slate-800 truncate max-w-[150px]" 
                    title={selectedLoan?.partner_name || selectedLoan?.customer?.partner_name || '—'}
                  >
                    {selectedLoan?.partner_name || selectedLoan?.customer?.partner_name || '—'}
                  </span>
                </div>

              </div>

              {/* Buttons row — always below the stats */}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-50">
                <Button
                  onClick={() => setShowPrintPreview(true)}
                  variant="primary"
                  size="sm"
                  icon={Printer}
                  className="bg-green-600 hover:bg-green-700 border-0 text-white rounded-xl shadow-sm text-xs py-2 px-4"
                >
                  Open Report
                </Button>

                <Button
                  onClick={openReceiptChooser}
                  variant="primary"
                  size="sm"
                  icon={Printer}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0 text-white rounded-xl shadow-sm text-xs py-2 px-4"
                >
                  Receipt Print
                </Button>


                <Button
                  onClick={() => setShowNpaModal(true)}
                  disabled={false}
                  variant="danger"
                  size="sm"
                  icon={ShieldAlert}
                  className="bg-orange-600 hover:bg-orange-700 text-white border-0 rounded-xl shadow-sm text-xs py-2 px-4"
                >
                  NPA Close
                </Button>

                <Button
                  onClick={handleRefresh}
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  className="rounded-xl border-gray-200 text-xs py-2 px-4"
                >
                  Refresh
                </Button>

                <Button
                  onClick={() => handleExport('xlsx')}
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  className="rounded-xl border-gray-200 text-emerald-700 hover:bg-emerald-50 text-xs py-2 px-4"
                >
                  Excel
                </Button>
              </div>

            </div>
          </>
        )}

      </div>

      {/* Print Preview Modal */}
      <FinancePrintPreview
        isOpen={showPrintPreview && !!selectedLoan && !!renewCalculations}
        onClose={() => setShowPrintPreview(false)}
        title="Print Preview (A4 Friendly Layout)"
        documentTitle="CD Daily Loan Ledger Report Card"
      >
        {selectedLoan && renewCalculations && (() => {
          const borrowerPhotoUrl = selectedLoan.customer?.customer_photo_url || selectedLoan.customer_photo_url;
          const guarantor1PhotoUrl = guarantor1?.photo_url || guarantor1?.customer_photo_url || selectedLoan.surety_photo_url;
          const guarantor2PhotoUrl = guarantor2?.photo_url || guarantor2?.customer_photo_url;

          return (
            <div className="space-y-6 text-gray-850 font-sans text-xs p-1">
              {/* Header: A/C Number & Customer Name prominent once */}
              <div className="flex justify-between items-start border-b-2 border-double border-gray-300 pb-4">
                <div>
                  <h1 className="text-xl font-black text-gray-900 tracking-wide uppercase">Thirumala Finance Groups</h1>
                  <span className="text-xs text-gray-500 uppercase tracking-widest block font-medium">CD Daily Loan Ledger statement</span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-green-700 bg-green-50 px-3 py-1.5 rounded-xl border border-green-200 inline-block font-mono">
                    A/C: {selectedLoan.loan_id}
                  </div>
                  <div className="text-xs text-gray-500 font-extrabold uppercase mt-1">
                    CUSTOMER: {selectedLoan.customer?.name}
                  </div>
                  <div className="text-[9px] text-gray-400 mt-0.5">
                    OPERATOR: {user?.username || 'RAMESH'} | PRINTED: {new Date().toLocaleString('en-IN').replace(/\s/g, '')}
                  </div>
                </div>
              </div>

              {/* People Profiles: Borrower, Surety 1, Surety 2 with photos next to details */}
              <div className="grid grid-cols-3 gap-4 border-b pb-4">
                {/* Borrower details */}
                <div className="p-3 bg-gray-50/50 rounded-2xl border border-gray-100 flex gap-3">
                  <div className="flex-1 space-y-1 text-[10px] font-sans">
                    <span className="text-[10px] font-black uppercase text-green-800 tracking-wider block border-b pb-0.5 mb-1.5">Borrower Details</span>
                    <div className="flex justify-between"><span className="text-gray-400">Name:</span> <span className="font-extrabold text-gray-900">{selectedLoan.customer?.name}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">S/o W/o:</span> <span className="font-bold text-gray-800">{formatRelationship(selectedLoan.customer?.father_husband_name) || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Phone:</span> <span className="font-bold text-gray-800">{selectedLoan.customer?.phone || 'N/A'}</span></div>
                    {selectedLoan.customer?.phone2 && (
                      <div className="flex justify-between"><span className="text-gray-400">Phone 2:</span> <span className="font-bold text-gray-800">{selectedLoan.customer?.phone2}</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-gray-400">Aadhaar:</span> <span className="font-bold text-gray-800 font-mono">{selectedLoan.customer?.aadhaar || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Address:</span> <span className="font-bold text-gray-800 truncate max-w-[80px]" title={selectedLoan.customer?.address || undefined}>{selectedLoan.customer?.address || 'N/A'}</span></div>
                  </div>
                  <div className="w-14 h-18 shrink-0 rounded-lg bg-white border border-gray-250 overflow-hidden flex items-center justify-center relative shadow-sm">
                    {borrowerPhotoUrl ? (
                      <img src={borrowerPhotoUrl} alt="Borrower" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 text-gray-300" />
                    )}
                  </div>
                </div>

                {/* Guarantor 1 details */}
                <div className="p-3 bg-gray-50/50 rounded-2xl border border-gray-100 flex gap-3">
                  <div className="flex-1 space-y-1 text-[10px] font-sans">
                    <span className="text-[10px] font-black uppercase text-green-800 tracking-wider block border-b pb-0.5 mb-1.5">Guarantor 1 Details</span>
                    {guarantor1 ? (
                      <>
                        <div className="flex justify-between"><span className="text-gray-400">Name:</span> <span className="font-extrabold text-gray-900">{guarantor1.name}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Phone:</span> <span className="font-bold text-gray-800">{guarantor1.phone}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Aadhaar:</span> <span className="font-bold text-gray-800 font-mono">{guarantor1.aadhaar}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Address:</span> <span className="font-bold text-gray-800 truncate max-w-[80px]" title={guarantor1.address}>{guarantor1.address || 'N/A'}</span></div>
                      </>
                    ) : (
                      <span className="text-gray-450 italic block py-2">No guarantor 1</span>
                    )}
                  </div>
                  {guarantor1 && (
                    <div className="w-14 h-18 shrink-0 rounded-lg bg-white border border-gray-250 overflow-hidden flex items-center justify-center relative shadow-sm">
                      {guarantor1PhotoUrl ? (
                        <img src={guarantor1PhotoUrl} alt="Guarantor 1" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                  )}
                </div>

                {/* Guarantor 2 details */}
                <div className="p-3 bg-gray-50/50 rounded-2xl border border-gray-100 flex gap-3">
                  <div className="flex-1 space-y-1 text-[10px] font-sans">
                    <span className="text-[10px] font-black uppercase text-green-800 tracking-wider block border-b pb-0.5 mb-1.5">Guarantor 2 Details</span>
                    {guarantor2 ? (
                      <>
                        <div className="flex justify-between"><span className="text-gray-400">Name:</span> <span className="font-extrabold text-gray-900">{guarantor2.name}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Phone:</span> <span className="font-bold text-gray-800">{guarantor2.phone}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Aadhaar:</span> <span className="font-bold text-gray-800 font-mono">{guarantor2.aadhaar}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Address:</span> <span className="font-bold text-gray-800 truncate max-w-[80px]" title={guarantor2.address}>{guarantor2.address || 'N/A'}</span></div>
                      </>
                    ) : (
                      <span className="text-gray-450 italic block py-2">No guarantor 2</span>
                    )}
                  </div>
                  {guarantor2 && (
                    <div className="w-14 h-18 shrink-0 rounded-lg bg-white border border-gray-250 overflow-hidden flex items-center justify-center relative shadow-sm">
                      {guarantor2PhotoUrl ? (
                        <img src={guarantor2PhotoUrl} alt="Guarantor 2" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Opening & Current Status separate details */}
              <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
                <div className="space-y-1.5 text-[11px] font-sans">
                  <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Opening Details</span>
                  <div className="flex justify-between"><span className="text-slate-500">Loan Date (Inclusive):</span> <span className="font-extrabold text-slate-900">{formatDateOld(originalLoanDate || selectedLoan.date)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Opening Loan Principal:</span> <span className="font-extrabold text-slate-900">{originalLoanAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Opening Interest/Commission:</span> <span className="font-extrabold text-slate-900">{(displayedStatementEntries.filter(e => e.entry_type === 'opening_commission' || e.entry_type === 'Commission').reduce((s, e) => s + Number(e.credit || 0), 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Document Charges Paid:</span> <span className="font-extrabold text-slate-900">{statementTotals.documentCharges.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                </div>
                <div className="space-y-1.5 text-[11px] font-sans">
                  <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Current Balance State</span>
                  <div className="flex justify-between"><span className="text-slate-500">Current Principal Balance:</span> <span className="font-extrabold text-green-700">{ledgerMetrics.principalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Pending Accrued Interest:</span> <span className="font-extrabold text-orange-600">{formatCDCurrency(ledgerMetrics.pendingInterest)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Pending Accrued Penalty:</span> <span className="font-extrabold text-red-650">{ledgerMetrics.pendingPenalty.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Current Next Due Date:</span> <span className="font-extrabold text-slate-900">{formatDateOld(renewCalculations?.dueDateStr)}</span></div>
                </div>
              </div>

              {/* Account Position — same figures as the ledger screen, plus Total Outstanding */}
              {(() => {
                const money = (v: number) => formatCDCurrency(Number(v) || 0);
                const docChargesDue = Number((ledgerMetrics as any).docChargesBalance || (selectedLoan as any).document_charges_due || 0);
                const totalOutstanding = Number((
                  (ledgerMetrics.principalBalance || 0) +
                  (ledgerMetrics.pendingInterest || 0) +
                  (ledgerMetrics.pendingPenalty || 0) +
                  docChargesDue
                ).toFixed(2));
                const details: Array<[string, string]> = [
                  ['Loan Amount', money(originalLoanAmount)],
                  ['Rate / Penalty', `${Number(selectedLoan.interest_rate).toFixed(2)}% / ${Number(selectedLoan.penalty_percent || 0.75).toFixed(2)}%`],
                  ['Compound Interest (CI)', Math.round(compoundInterestData.summary?.compoundInterestEarned || 0).toLocaleString('en-IN')],
                  ['Loan Date', formatDateOld(originalLoanDate || selectedLoan.date) || '—'],
                  ['Last Payment', renewCalculations?.error ? '—' : (formatDateOld(renewCalculations?.lastPaymentDate) || '—')],
                  ['Current Due Date', renewCalculations?.error ? '—' : (formatDateOld(renewCalculations?.currentDueDate) || '—')],
                  ['Days / Due Days', renewCalculations?.error ? '—' : `${Number(renewCalculations?.displayDays || 0).toFixed(2)} / ${renewCalculations?.displayDueDays ?? 0}`],
                  ['Document Status', documentReturned ? 'Returned' : 'Submitted'],
                ];
                const position: Array<[string, string, string]> = [
                  ['Principal Balance', money(ledgerMetrics.principalBalance), ''],
                  ['Today Due', money(ledgerMetrics.todayDue), ''],
                  ['Accrued Interest', money(ledgerMetrics.pendingInterest), ''],
                  ['Accrued Penalty', money(ledgerMetrics.pendingPenalty), ''],
                  ['Document Charges Due', money(docChargesDue), ''],
                  ['Total for Renewal', money(ledgerMetrics.renewalDue), 'To extend the standard cycle'],
                  ['Total to Regularize', money(ledgerMetrics.totalToRegularize), 'Overdue interest + penalty + renewal'],
                  ['Total for Close', money(ledgerMetrics.totalClose), 'Full payoff of principal and dues'],
                ];
                return (
                  <div className="grid grid-cols-2 gap-6 p-4 rounded-2xl border border-slate-300" style={{ breakInside: 'avoid' }}>
                    <div className="space-y-1.5 text-[11px] font-sans">
                      <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Loan Details</span>
                      {details.map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3"><span className="text-slate-500">{label}:</span> <span className="font-extrabold text-slate-900 whitespace-nowrap">{value}</span></div>
                      ))}
                    </div>
                    <div className="space-y-1.5 text-[11px] font-sans">
                      <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider block border-b pb-1 mb-1.5">Account Position</span>
                      {position.map(([label, value, hint]) => (
                        <div key={label} className="flex justify-between gap-3">
                          <span className="text-slate-500">{label}:{hint && <span className="block text-[9px] text-slate-400">{hint}</span>}</span>
                          <span className="font-extrabold text-slate-900 whitespace-nowrap">{value}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 border-t-2 border-slate-800 pt-1.5 mt-1.5 text-[13px]">
                        <span className="font-black text-slate-900 uppercase">Total Outstanding:<span className="block text-[9px] font-semibold normal-case text-slate-500">Principal + interest + penalty + document charges</span></span>
                        <span className="font-black text-rose-700 whitespace-nowrap">{money(totalOutstanding)}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Grouped horizontal statement table */}
              <div className="space-y-2">
                <h4 className="text-green-800 border-b pb-1 text-[10px] font-bold uppercase tracking-wider">Statement Ledger (Pivot Event History)</h4>
                <table className="w-full border border-gray-300 text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-300 text-gray-700 uppercase text-[9px] font-bold">
                      <th className="p-1.5 border-r text-center">Sl No</th>
                      <th className="p-1.5 border-r">Date</th>
                      <th className="p-1.5 border-r">Receipt No</th>
                      <th className="p-1.5 border-r">Type</th>
                      <th className="p-1.5 border-r text-right">Principal</th>
                      <th className="p-1.5 border-r text-right">Interest</th>
                      <th className="p-1.5 border-r text-right">Penalty</th>
                      <th className="p-1.5 border-r text-right">Doc Charges</th>
                      <th className="p-1.5 border-r text-right">Total Paid</th>
                      <th className="p-1.5 border-r text-right">Outstanding</th>
                      <th className="p-1.5 border-r text-right">Present Due</th>
                      <th className="p-1.5">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-250 font-mono text-gray-700">
                    {groupedPivotStatementEntries.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="p-1.5 border-r text-center font-sans text-slate-500">{idx + 1}</td>
                        <td className="p-1.5 border-r font-sans whitespace-nowrap">{formatDateOld(row.date)}</td>
                        <td className="p-1.5 border-r font-black text-slate-900">{row.receiptNo}</td>
                        <td className="p-1.5 border-r font-bold uppercase text-[9px]">{row.eventType}</td>
                        <td className="p-1.5 border-r text-right text-blue-800 font-bold">
                          {row.principalPaid > 0 ? row.principalPaid.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="p-1.5 border-r text-right text-green-800 font-bold">
                          {row.interestPaid > 0 ? row.interestPaid.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="p-1.5 border-r text-right text-amber-700 font-bold">
                          {row.penaltyPaid > 0 ? row.penaltyPaid.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="p-1.5 border-r text-right text-purple-700 font-bold">
                          {row.docCharges > 0 ? row.docCharges.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="p-1.5 border-r text-right text-indigo-900 font-black">
                          {row.totalPaid > 0 ? row.totalPaid.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="p-1.5 border-r text-right text-rose-700 font-black">
                          {row.outstandingPrincipal.toLocaleString('en-IN')}
                        </td>
                        <td className="p-1.5 border-r text-right text-rose-900 font-black">
                          {row.presentDue.toLocaleString('en-IN')}
                        </td>
                        <td className="p-1.5 font-sans text-gray-700 truncate max-w-[120px]">{row.remarks}</td>
                      </tr>
                    ))}
                    {groupedPivotStatementEntries.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="text-center py-6 font-sans text-gray-400 italic">No entries recorded</td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-black border-t-2 border-slate-350 text-slate-900 text-[10px]">
                      <td colSpan={4} className="p-1.5 border-r text-right font-sans">GRAND TOTALS:</td>
                      <td className="p-1.5 border-r text-right text-blue-800">{pivotTotals.principalPaid.toLocaleString('en-IN')}</td>
                      <td className="p-1.5 border-r text-right text-green-800">{pivotTotals.interestPaid.toLocaleString('en-IN')}</td>
                      <td className="p-1.5 border-r text-right text-amber-700">{pivotTotals.penaltyPaid.toLocaleString('en-IN')}</td>
                      <td className="p-1.5 border-r text-right text-purple-700">{pivotTotals.docCharges.toLocaleString('en-IN')}</td>
                      <td className="p-1.5 border-r text-right text-indigo-900">{pivotTotals.totalPaid.toLocaleString('en-IN')}</td>
                      <td className="p-1.5 border-r text-right text-rose-700">{pivotTotals.latestOutstanding.toLocaleString('en-IN')}</td>
                      <td className="p-1.5 border-r text-right text-rose-900">{pivotTotals.latestPresentDue.toLocaleString('en-IN')}</td>
                      <td className="p-1.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Print Signatures */}
              <div className="pt-16 grid grid-cols-2 gap-20 text-center text-gray-500 text-[10px] font-semibold">
                <div>
                  <div className="border-t border-gray-300 pt-1.5 w-32 mx-auto">Borrower Signature</div>
                </div>
                <div>
                  <div className="border-t border-gray-300 pt-1.5 w-32 mx-auto">Auditor Signature</div>
                </div>
              </div>
            </div>
          );
        })()}
      </FinancePrintPreview>

      {/* Receipt chooser: pick which receipt to print */}
      {showReceiptChooser && selectedLoan && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowReceiptChooser(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-[16px] font-black uppercase text-slate-900">Select Receipt to Print</h3>
                <p className="text-[12px] font-bold uppercase text-slate-500">{selectedLoan.loan_id} · {selectedLoan.customer?.name}</p>
              </div>
              <button onClick={() => setShowReceiptChooser(false)} className="p-1.5 rounded hover:bg-slate-200 text-slate-600" title="Close">
                <X className="w-4 h-4" />
              </button>
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
                    <tr
                      key={r.id}
                      onClick={() => setSelectedReceiptId(r.id)}
                      className={`cursor-pointer border-b border-slate-100 ${selectedReceiptId === r.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input type="radio" readOnly checked={selectedReceiptId === r.id} className="accent-indigo-600" />
                      </td>
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
              <button onClick={() => setShowReceiptChooser(false)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-[13px] font-bold uppercase text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              <button
                disabled={!selectedReceipt}
                onClick={() => { setShowReceiptChooser(false); setShowReceiptPreview(true); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-bold uppercase hover:bg-indigo-700 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" /> Preview Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Print Preview (A4 portrait) */}
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
            { label: 'Interest Paid', value: r.interestPaid },
            { label: 'Penalty Paid', value: r.penaltyPaid },
            { label: 'Document Charges', value: r.docCharges },
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
                  <tr><td className="rc-label">CD No</td><td className="font-mono font-bold">{selectedLoan.loan_id}</td></tr>
                  <tr><td className="rc-label">Customer Name</td><td className="font-bold">{cust.name || '—'}</td></tr>
                  <tr><td className="rc-label">Guardian</td><td>{guardian || '—'}</td></tr>
                  <tr><td className="rc-label">Phone</td><td className="font-mono">{phone || '—'}</td></tr>
                  <tr><td className="rc-label">Payment Type</td><td>{r.eventType}</td></tr>
                </tbody>
              </table>

              <table>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.label}>
                      <td className="rc-label">{l.label}</td>
                      <td className="rc-amt">{formatReceiptAmount(l.value)}</td>
                    </tr>
                  ))}
                  <tr className="rc-total">
                    <td className="rc-label">Total Paid</td>
                    <td className="rc-amt">₹ {formatReceiptAmount(r.totalPaid)}</td>
                  </tr>
                  <tr>
                    <td className="rc-label">Balance Principal Outstanding</td>
                    <td className="rc-amt">{formatReceiptAmount(r.outstandingPrincipal)}</td>
                  </tr>
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

      {/* NPA Close Account Modal */}
      {showNpaModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl relative">
            <button onClick={() => setShowNpaModal(false)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-orange-600" />
              NPA Close
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 text-orange-850 border border-orange-200 rounded-2xl text-sm leading-relaxed">
                <p className="font-semibold mb-1">Confirm NPA Close</p>
                <p>No amount is collected. The full Total for Close is written off as <strong>loss</strong>, and the loan is marked NPA closed.</p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono tabular-nums text-[14px]">
                  <span className="font-sans">Principal</span><span className="text-right">{Math.max(0, Number(((ledgerMetrics.totalClose || 0) - Math.max(0, ledgerMetrics.pendingInterest) - Math.max(0, ledgerMetrics.pendingPenalty)).toFixed(2))).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  <span className="font-sans">Interest</span><span className="text-right">{Math.max(0, ledgerMetrics.pendingInterest).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  <span className="font-sans">Penalty</span><span className="text-right">{Math.max(0, ledgerMetrics.pendingPenalty).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  <span className="font-sans font-bold border-t border-orange-200 pt-1">Loss (Total for Close)</span><span className="text-right font-bold border-t border-orange-200 pt-1">{Math.max(0, ledgerMetrics.totalClose || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div>
                <Input
                  label="Reason / Remarks"
                  value={npaReason}
                  onChange={v => setNpaReason(v.toUpperCase())}
                  placeholder="Enter reason/remarks for NPA closure"
                  required
                />
              </div>
              <div className="pt-4 flex gap-3">
                <Button onClick={() => setShowNpaModal(false)} variant="secondary" className="flex-1 rounded-xl">
                  Cancel
                </Button>
                <Button onClick={handleNPACloseSubmit} variant="danger" className="flex-1 bg-orange-600 hover:bg-orange-700 text-white rounded-xl" disabled={isNpaClosing || !npaReason.trim()}>
                  {isNpaClosing ? 'Processing...' : 'Close NPA Account'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Return Documents Modal */}
      {showReturnDocModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl relative">
            <button onClick={() => setShowReturnDocModal(false)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <FileIcon className="w-6 h-6 text-blue-600" />
              Return Documents
            </h2>
            <div className="space-y-4">
              <div>
                <FinanceSmartCalendar
                  value={returnDate}
                  onChange={setReturnDate}
                  module="CD_LEDGER"
                  label="Return Date"
                />
              </div>
              <div>
                <Input
                  label="Returned To (Name)"
                  value={returnedTo}
                  onChange={setReturnedTo}
                  placeholder="Person receiving documents"
                />
              </div>
              <div>
                <label className="finance-caption uppercase mb-2 block">Receiver Signature / Photo</label>
                <input
                  type="file"
                  onChange={(e) => setReturnSignature(e.target.files?.[0] || null)}
                  className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm text-gray-800"
                />
              </div>
              <div>
                <Input label="Remarks" value={returnRemarks} onChange={setReturnRemarks} />
              </div>
              <div className="pt-4 flex gap-3">
                <Button onClick={() => setShowReturnDocModal(false)} variant="secondary" className="flex-1 rounded-xl">
                  Cancel
                </Button>
                <Button onClick={handleReturnDocSubmit} variant="primary" className="flex-1 bg-blue-600 hover:bg-blue-700 border-0 text-white rounded-xl" disabled={isReturningDoc || !returnedTo.trim()}>
                  {isReturningDoc ? 'Saving...' : 'Confirm Return'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {showEditTxModal && editingTx && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl relative">
            <button onClick={() => setShowEditTxModal(false)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <CreditCard className="w-6 h-6 text-indigo-600" />
              Edit Payment Transaction
            </h2>
            <div className="space-y-4">
              {/* Original Snapshot Panel */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs space-y-2">
                <div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Original Transaction Snapshot</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-slate-400">Receipt No</div>
                    <div className="font-bold font-mono text-slate-800">{editingTx.receipt_no || '-'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Payment Date</div>
                    <div className="font-bold text-slate-800">
                      {editingTx.date ? new Date(editingTx.date).toLocaleDateString('en-IN') : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Amount Paid</div>
                    <div className="font-bold text-slate-800">
                      {Number(editingTx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Input 
                  label="New Receipt Number" 
                  value={editTxReceiptNo} 
                  onChange={setEditTxReceiptNo} 
                  placeholder="Receipt number (e.g. RC150)"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FinanceSmartCalendar
                    value={editTxDate}
                    onChange={setEditTxDate}
                    module="CD_LEDGER"
                    label="New Payment Date"
                    required
                  />
                </div>
                <div>
                  <Input 
                    label="New Payment Amount ()" 
                    value={editTxAmount} 
                    onChange={setEditTxAmount} 
                    placeholder="Amount paid"
                    type="number"
                    required
                  />
                </div>
              </div>

              <div>
                <Input 
                  label="Reason for Edit (Mandatory)" 
                  value={editTxReason} 
                  onChange={setEditTxReason} 
                  placeholder="e.g. Wrong amount entered, Cash correction"
                  required
                />
              </div>
              
              <div className="pt-4 flex gap-3">
                <Button onClick={() => setShowEditTxModal(false)} variant="secondary" className="flex-1 rounded-xl">
                  Cancel
                </Button>
                <Button 
                  onClick={handleSaveEditTx} 
                  variant="primary" 
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 border-0 text-white rounded-xl" 
                  disabled={isSavingTx || !editTxReceiptNo.trim() || !editTxDate || !editTxAmount || !editTxReason.trim()}
                >
                  {isSavingTx ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedLoan && (
        <CompoundInterestModal
          isOpen={showCompoundModal}
          onClose={() => setShowCompoundModal(false)}
          cdNumber={selectedLoan.loan_id || ''}
          customerName={selectedLoan.customer?.name || ''}
          interestRate={Number(selectedLoan.interest_rate) || 3}
          penaltyPercent={Number(selectedLoan.penalty_percent) || 0.75}
          loanDate={originalLoanDate || selectedLoan.date}
          reportRows={compoundInterestData.reportRows}
          summary={compoundInterestData.summary}
        />
      )}
    </>
  );
};

export default CDLedger;
