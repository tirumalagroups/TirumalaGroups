import React, { useState, useEffect, useMemo, useRef } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import SearchableSelect from '../components/UI/SearchableSelect';
import { supabaseDB } from '../lib/supabaseDatabase';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import toast from 'react-hot-toast';
import ModeLabel from '../components/UI/ModeLabel';
import CustomCalendar from '../components/UI/CustomCalendar';
import { format } from 'date-fns';
import { getSharedPrintStyles, printPreviewFrame, toDisplayCase, PREVIEW_FIT_HEAD } from '../utils/print';
import { TrendingUp, TrendingDown, Search, BarChart3, Plus, Database, RefreshCw, Calendar, AlertTriangle } from 'lucide-react';
import { useBook } from '../contexts/BookContext';

interface DetailedLedgerFilters {
  fromDate: string;
  toDate: string;
  companyName: string;
  mainAccount: string;
  subAccount: string;
  staffwise: string;
  user: string;
  creditAmount: string; // keep as string for easy typing; parse on apply
  debitAmount: string;  // keep as string for easy typing; parse on apply
  betweenDates: boolean;
  paymentMode?: string;
}

interface LedgerEntry {
  id: string;
  sno: number;
  date: string;
  companyName: string;
  accountName: string;
  subAccount: string;
  particulars: string;
  credit: number;
  debit: number;
  saleQuantity: number;
  purchaseQuantity: number;
  staff: string;
  user: string;
  entryTime: string;
  approved: boolean;
  balance: number;
  runningBalance: number;
  payment_mode: string;
}

// Helper function to check if an entry matches the search term across all columns
const matchDetailedLedgerSearchTerm = (entry: LedgerEntry, searchTerm: string): boolean => {
  if (!searchTerm) return true;
  const searchLower = searchTerm.toLowerCase().trim();
  
  // Date formatting helpers
  let dateStr1 = '';
  let dateStr2 = '';
  if (entry.date) {
    try {
      const dateObj = new Date(entry.date);
      if (!isNaN(dateObj.getTime())) {
        dateStr1 = format(dateObj, 'dd/MM/yyyy');
        dateStr2 = format(dateObj, 'yyyy-MM-dd');
      }
    } catch (e) {
      // ignore
    }
  }
  
  // Amount check
  const creditStr = entry.credit != null ? String(entry.credit) : '';
  const debitStr = entry.debit != null ? String(entry.debit) : '';
  
  // Quantity check
  const saleQtyStr = entry.saleQuantity != null ? String(entry.saleQuantity) : '';
  const purchaseQtyStr = entry.purchaseQuantity != null ? String(entry.purchaseQuantity) : '';
  
  // Sno
  const snoStr = entry.sno != null ? String(entry.sno) : '';

  // Payment mode formatting for search
  const paymentModeStr = entry.payment_mode || '';
  let paymentModeDisplay = paymentModeStr;
  if (paymentModeStr === 'Online') {
    paymentModeDisplay = 'Double';
  } else if (paymentModeStr === 'Bank Transfer') {
    paymentModeDisplay = 'Bank';
  }

  return (
    (entry.companyName || '').toLowerCase().includes(searchLower) ||
    (entry.accountName || '').toLowerCase().includes(searchLower) ||
    (entry.subAccount || '').toLowerCase().includes(searchLower) ||
    (entry.particulars || '').toLowerCase().includes(searchLower) ||
    (entry.staff || '').toLowerCase().includes(searchLower) ||
    (entry.user || '').toLowerCase().includes(searchLower) ||
    paymentModeStr.toLowerCase().includes(searchLower) ||
    paymentModeDisplay.toLowerCase().includes(searchLower) ||
    creditStr.includes(searchLower) ||
    debitStr.includes(searchLower) ||
    saleQtyStr.includes(searchLower) ||
    purchaseQtyStr.includes(searchLower) ||
    snoStr.includes(searchLower) ||
    dateStr1.includes(searchLower) ||
    dateStr2.includes(searchLower)
  );
};

const DetailedLedger: React.FC = () => {
  const { user } = useAuth();
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();
  const [allLedgerEntries, setAllLedgerEntries] = useState<LedgerEntry[]>([]);

  const [filters, setFilters] = useState<DetailedLedgerFilters>({
    fromDate: '2016-10-31',
    toDate: format(new Date(), 'yyyy-MM-dd'),
    companyName: '',
    mainAccount: '',
    subAccount: '',
    staffwise: '',
    user: '',
    creditAmount: '',
    debitAmount: '',
    betweenDates: true,
  });

  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [printAllEntries, setPrintAllEntries] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFromCalendar, setShowFromCalendar] = useState(false);
  const [showToCalendar, setShowToCalendar] = useState(false);
  
  // Pagination states
  const [pageSize] = useState(1000); // Show 1000 entries per page
  const [totalEntries, setTotalEntries] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, message: '' });

  // Re-load on dashboard-wide refresh events (emitted after New Entry save)
  useEffect(() => {
    const handler = () => {
      // Longer delay to ensure database has saved the entry
      setTimeout(() => {
        console.log('🔄 DetailedLedger: Refreshing after dashboard-refresh event');
        loadLedgerData();
      }, 500); // Increased delay to 500ms to ensure database save is complete
    };
    window.addEventListener('dashboard-refresh', handler);
    return () => window.removeEventListener('dashboard-refresh', handler);
  }, []);

  // 1. Get entries within the date range (fromDate to toDate)
  const entriesInRange = useMemo(() => {
    if (!filters.betweenDates) return allLedgerEntries;
    const fromStr = filters.fromDate;
    const toStr = filters.toDate;
    return allLedgerEntries.filter(entry => {
      return entry.date >= fromStr && entry.date <= toStr;
    });
  }, [allLedgerEntries, filters.fromDate, filters.toDate, filters.betweenDates]);

  // 2. Companies in range
  const companyOptions = useMemo(() => {
    const distinctCompanies = [...new Set(entriesInRange.map(e => e.companyName).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Companies' },
      ...distinctCompanies.map(name => ({ value: name, label: name }))
    ];
  }, [entriesInRange]);

  // 3. Accounts in range (filtered by selected company if any)
  const accountOptions = useMemo(() => {
    if (!filters.companyName) {
      return [{ value: '', label: 'Select a company first' }];
    }
    const filtered = entriesInRange.filter(e => e.companyName === filters.companyName);
    const distinctAccounts = [...new Set(filtered.map(e => e.accountName).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Accounts' },
      ...distinctAccounts.map(name => ({ value: name, label: name }))
    ];
  }, [entriesInRange, filters.companyName]);

  // 4. Sub Accounts in range (filtered by selected company and main account)
  const subAccountOptions = useMemo(() => {
    if (!filters.companyName || !filters.mainAccount) {
      return [{ value: '', label: 'Select a main account first' }];
    }
    const filtered = entriesInRange.filter(
      e => e.companyName === filters.companyName && e.accountName === filters.mainAccount
    );
    const distinctSubAccounts = [...new Set(filtered.map(e => e.subAccount).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Sub Accounts' },
      ...distinctSubAccounts.map(name => ({ value: name, label: name }))
    ];
  }, [entriesInRange, filters.companyName, filters.mainAccount]);

  // 5. Staff in range
  const staffOptions = useMemo(() => {
    const distinctStaff = [...new Set(entriesInRange.map(e => e.staff).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Staff' },
      ...distinctStaff.map(name => ({ value: name, label: name }))
    ];
  }, [entriesInRange]);

  // 6. Users in range
  const userOptions = useMemo(() => {
    const distinctUsers = [...new Set(entriesInRange.map(e => e.user).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Users' },
      ...distinctUsers.map(name => ({ value: name, label: name }))
    ];
  }, [entriesInRange]);

  // Derived totals for top cards
  const totals = useMemo(() => {
    const totalCredit = filteredEntries.reduce((s, e) => s + (e.credit || 0), 0);
    const totalDebit = filteredEntries.reduce((s, e) => s + (e.debit || 0), 0);
    const totalSaleQty = filteredEntries.reduce((s, e) => s + (e.saleQuantity || 0), 0);
    const totalPurchaseQty = filteredEntries.reduce((s, e) => s + (e.purchaseQuantity || 0), 0);
    return { totalCredit, totalDebit, balance: totalCredit - totalDebit, totalSaleQty, totalPurchaseQty };
  }, [filteredEntries]);

  // Local visible inputs for dd/MM/yyyy editing to prevent mm/dd flip
  const [fromDateInput, setFromDateInput] = useState('');
  const [toDateInput, setToDateInput] = useState('');

  useEffect(() => {
    try {
      setFromDateInput(filters.fromDate ? format(new Date(filters.fromDate), 'dd/MM/yyyy') : '');
      setToDateInput(filters.toDate ? format(new Date(filters.toDate), 'dd/MM/yyyy') : '');
    } catch {
      // ignore format errors
    }
  }, [filters.fromDate, filters.toDate]);

  // Summary data (removed - using totals useMemo instead for better performance)

  useEffect(() => {
    loadLedgerData();
  }, [tableMode, currentBook?.id]);

  useEffect(() => {
    applyFilters();
  }, [ledgerEntries, filters, searchTerm]);

  // Reset child filters if their currently selected values are no longer available in the dynamically filtered lists
  useEffect(() => {
    setFilters(prev => {
      let updated = false;
      const newFilters = { ...prev };

      // 1. Company Name
      if (newFilters.companyName && !companyOptions.some(c => c.value === newFilters.companyName)) {
        newFilters.companyName = '';
        newFilters.mainAccount = '';
        newFilters.subAccount = '';
        updated = true;
      }

      // 2. Main Account
      if (newFilters.mainAccount && !accountOptions.some(a => a.value === newFilters.mainAccount)) {
        newFilters.mainAccount = '';
        newFilters.subAccount = '';
        updated = true;
      }

      // 3. Sub Account
      if (newFilters.subAccount && !subAccountOptions.some(s => s.value === newFilters.subAccount)) {
        newFilters.subAccount = '';
        updated = true;
      }

      // 4. Staffwise
      if (newFilters.staffwise && !staffOptions.some(s => s.value === newFilters.staffwise)) {
        newFilters.staffwise = '';
        updated = true;
      }

      // 5. User
      if (newFilters.user && !userOptions.some(u => u.value === newFilters.user)) {
        newFilters.user = '';
        updated = true;
      }

      return updated ? newFilters : prev;
    });
  }, [companyOptions, accountOptions, subAccountOptions, staffOptions, userOptions]);

  const loadLedgerData = async () => {
    setLoading(true);
    try {
      console.log('🔄 Loading all cashbook entries...');
      
      // Load all entries for both ITR and regular modes
      const entries = await supabaseDB.getAllCashBookEntries();
      console.log('✅ All entries fetched:', entries.length);
      
      // Get total count for pagination info
      const totalCount = await supabaseDB.getCashBookEntriesCount();
      setTotalEntries(totalCount);

      // Convert to ledger format with running balance
      let runningBalance = 0;
      const ledgerData: LedgerEntry[] = entries.map((entry, index) => {
        const balance = entry.credit - entry.debit;
        runningBalance += balance;

        // Use the normalized payment_mode from getCashBookEntries directly
        // getCashBookEntries already normalizes payment_mode from database
        // Ensure we properly extract and display the payment_mode value
        let paymentMode = '';
        if (entry.payment_mode) {
          const pmStr = String(entry.payment_mode).trim();
          if (pmStr && pmStr !== 'null' && pmStr !== 'undefined' && pmStr !== '') {
            paymentMode = pmStr;
          }
        }
        
        // Debug: Log payment_mode for first few entries to verify values are present
        if (index < 5) {
          console.log(`📋 DetailedLedger Mapping Entry ${index + 1}:`, {
            id: entry.id,
            sno: entry.sno,
            payment_mode_from_entry: entry.payment_mode,
            payment_mode_type: typeof entry.payment_mode,
            payment_mode_final: paymentMode,
            company: entry.company_name
          });
        }

        return {
          id: entry.id,
          sno: entry.sno,
          date: entry.c_date,
          companyName: entry.company_name,
          accountName: entry.acc_name,
          subAccount: entry.sub_acc_name || '',
          particulars: entry.particulars,
          credit: entry.credit,
          debit: entry.debit,
          saleQuantity: entry.sale_qty || 0,
          purchaseQuantity: entry.purchase_qty || 0,
          staff: entry.staff,
          user: entry.users || entry.staff, // Use users field (logged-in user), fallback to staff if missing
          entryTime: entry.entry_time,
          approved: entry.approved,
          balance: balance,
          runningBalance: runningBalance,
          payment_mode: paymentMode, // Payment mode from NewEntry form (Cash/Bank Transfer/Online)
        };
      });

      setLedgerEntries(ledgerData);
      setAllLedgerEntries(ledgerData);
      
      // Debug: Log summary of payment_mode values
      const entriesWithPaymentMode = ledgerData.filter(e => e.payment_mode && e.payment_mode.trim());
      console.log(`✅ DetailedLedger loaded: ${ledgerData.length} entries, ${entriesWithPaymentMode.length} have payment_mode values`);
      if (entriesWithPaymentMode.length > 0) {
        // Log payment mode summary with correct labels
        console.log('📊 Payment mode summary:', {
          Cash: entriesWithPaymentMode.filter(e => e.payment_mode === 'Cash').length,
          Bank: entriesWithPaymentMode.filter(e => e.payment_mode === 'Bank Transfer').length,
          Double: entriesWithPaymentMode.filter(e => e.payment_mode === 'Online').length
        });
      }
      
      if (entries.length === 0) {
        toast.success('No entries found in database');
      } else {
        toast.success(`Loaded all ${entries.length} cashbook entries`);
      }
    } catch (error) {
      console.error('Error loading ledger data:', error);
      toast.error('Failed to load ledger data');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreEntries = async () => {
    if (isLoadingMore || ledgerEntries.length >= totalEntries) return;
    
    try {
      setIsLoadingMore(true);
      const nextPage = Math.floor(ledgerEntries.length / pageSize) + 1;
      const offset = ledgerEntries.length;
      
      console.log(`🔄 Loading more entries - Page: ${nextPage}, Offset: ${offset}`);
      
      const moreEntries = await supabaseDB.getCashBookEntries(pageSize, offset);
      console.log(`✅ Loaded ${moreEntries.length} more entries`);
      
      // Convert to ledger format with running balance
      let runningBalance = ledgerEntries.length > 0 ? ledgerEntries[ledgerEntries.length - 1].runningBalance : 0;
      const moreLedgerData: LedgerEntry[] = moreEntries.map((entry) => {
        const balance = entry.credit - entry.debit;
        runningBalance += balance;

        return {
          id: entry.id,
          sno: entry.sno,
          date: entry.c_date,
          companyName: entry.company_name,
          accountName: entry.acc_name,
          subAccount: entry.sub_acc_name || '',
          particulars: entry.particulars,
          credit: entry.credit,
          debit: entry.debit,
          saleQuantity: entry.sale_qty || 0,
          purchaseQuantity: entry.purchase_qty || 0,
          staff: entry.staff,
          user: entry.users || entry.staff,
          entryTime: entry.entry_time,
          approved: entry.approved,
          balance: balance,
          runningBalance: runningBalance,
          payment_mode: entry.payment_mode && String(entry.payment_mode).trim()
            ? String(entry.payment_mode).trim()
            : '',
        };
      });
      
      setLedgerEntries(prev => [...prev, ...moreLedgerData]);
      setAllLedgerEntries(prev => [...prev, ...moreLedgerData]);
      
      if (moreEntries.length === 0) {
        toast.success('No more entries to load');
      }
    } catch (error) {
      console.error('Error loading more entries:', error);
      toast.error('Failed to load more entries');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const loadAllEntries = async () => {
    try {
      setIsLoadingAll(true);
      setLoadingProgress({ current: 0, total: 0, message: 'Starting to load all entries...' });
      console.log('🔄 Loading ALL entries from database...');
      
      // First get the total count
      const totalCount = await supabaseDB.getCashBookEntriesCount();
      setLoadingProgress({ current: 0, total: totalCount, message: `Found ${totalCount} total records, starting to load...` });
      
      if (totalCount === 0) {
        toast.error('No records found in database');
        return;
      }
      
      // Load all entries using the pagination helper
      const allEntries = await supabaseDB.getAllCashBookEntries();
      console.log(`✅ Loaded ALL ${allEntries.length} entries`);
      
      // Convert to ledger format with running balance
      let runningBalance = 0;
      const ledgerData: LedgerEntry[] = allEntries.map((entry) => {
        const balance = entry.credit - entry.debit;
        runningBalance += balance;

        return {
          id: entry.id,
          sno: entry.sno,
          date: entry.c_date,
          companyName: entry.company_name,
          accountName: entry.acc_name,
          subAccount: entry.sub_acc_name || '',
          particulars: entry.particulars,
          credit: entry.credit,
          debit: entry.debit,
          staff: entry.staff,
          user: entry.users || entry.staff, // Use users field (logged-in user), fallback to staff if missing
          entryTime: entry.entry_time,
          approved: entry.approved,
          balance: balance,
          runningBalance: runningBalance,
          payment_mode: entry.payment_mode && String(entry.payment_mode).trim()
            ? String(entry.payment_mode).trim()
            : '',
          saleQuantity: entry.sale_qty || 0,
          purchaseQuantity: entry.purchase_qty || 0,
        };
      });
      
      setLedgerEntries(ledgerData);
      setAllLedgerEntries(ledgerData);
      setTotalEntries(ledgerData.length);
      setLoadingProgress({ current: ledgerData.length, total: totalCount, message: 'Loading complete!' });
      
      toast.success(`Loaded ALL ${ledgerData.length} entries successfully`);
    } catch (error) {
      console.error('Error loading all entries:', error);
      toast.error('Failed to load all entries: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setLoadingProgress({ current: 0, total: 0, message: 'Loading failed' });
    } finally {
      setIsLoadingAll(false);
      // Clear progress after a delay
      setTimeout(() => {
        setLoadingProgress({ current: 0, total: 0, message: '' });
      }, 3000);
    }
  };

  const applyFilters = () => {
    let filtered = [...ledgerEntries];

    // Date range filter
    if (filters.betweenDates) {
      filtered = filtered.filter(entry => {
        const entryDate = new Date(entry.date);
        const fromDate = new Date(filters.fromDate);
        const toDate = new Date(filters.toDate);
        return entryDate >= fromDate && entryDate <= toDate;
      });
    }

    // Company filter
    if (filters.companyName) {
      filtered = filtered.filter(
        entry => entry.companyName === filters.companyName
      );
    }

    // Main Account filter
    if (filters.mainAccount) {
      filtered = filtered.filter(
        entry => entry.accountName === filters.mainAccount
      );
    }

    // Sub Account filter
    if (filters.subAccount) {
      filtered = filtered.filter(
        entry => entry.subAccount === filters.subAccount
      );
    }

    // Staff filter
    if (filters.staffwise && filters.staffwise.trim() !== '') {
      const filterStaff = filters.staffwise.trim();
      const beforeCount = filtered.length;
      filtered = filtered.filter(entry => {
        const entryStaff = String(entry.staff || '').trim();
        return entryStaff === filterStaff;
      });
      console.log(`🔍 Staff filter "${filterStaff}": ${beforeCount} -> ${filtered.length} entries`);
    }

    // User filter
    if (filters.user && filters.user.trim() !== '') {
      const filterUser = filters.user.trim();
      const beforeCount = filtered.length;
      filtered = filtered.filter(entry => {
        const entryUser = String(entry.user || '').trim();
        return entryUser === filterUser;
      });
      console.log(`🔍 User filter "${filterUser}": ${beforeCount} -> ${filtered.length} entries`);
    }

    // Credit amount filter (exact match)
    if (filters.creditAmount && filters.creditAmount.trim() !== '') {
      const n = Number(filters.creditAmount);
      if (!Number.isNaN(n)) {
        filtered = filtered.filter(entry => Number(entry.credit) === n);
      }
    }

    // Debit amount filter (exact match)
    if (filters.debitAmount && filters.debitAmount.trim() !== '') {
      const n = Number(filters.debitAmount);
      if (!Number.isNaN(n)) {
        filtered = filtered.filter(entry => Number(entry.debit) === n);
      }
    }

    // Payment mode filter
    if (filters.paymentMode) {
      filtered = filtered.filter(entry => {
        const entryPaymentMode = entry.payment_mode || '';
        return entryPaymentMode === filters.paymentMode;
      });
    }

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(entry => matchDetailedLedgerSearchTerm(entry, searchTerm));
    }

    // Calculate summary
    // Summary calculation (using totals useMemo instead)
    // const totalCredit = filtered.reduce((sum, entry) => sum + entry.credit, 0);
    // const totalDebit = filtered.reduce((sum, entry) => sum + entry.debit, 0);
    // const balance = totalCredit - totalDebit;
    // Summary is now calculated via totals useMemo (line 112-118)

    setFilteredEntries(filtered);
  };

  const handleFilterChange = (
    field: keyof DetailedLedgerFilters,
    value: any
  ) => {
    console.log('Filter change:', field, value);
    setFilters(prev => {
      const newFilters = { ...prev, [field]: value };

      // Reset dependent filters
      if (field === 'companyName') {
        newFilters.mainAccount = '';
        newFilters.subAccount = '';
        console.log('Reset main account and sub account');
      }
      if (field === 'mainAccount') {
        newFilters.subAccount = '';
        console.log('Reset sub account');
      }

      console.log('New filters:', newFilters);
      return newFilters;
    });
  };

  const getRecords = () => {
    applyFilters();
    toast.success(`Found ${filteredEntries.length} records`);
  };

  const loadFilteredData = async () => {
    try {
      setLoading(true);
      console.log('🔄 Loading filtered data from server...');
      
      // Use server-side filtering for better performance with large datasets
      const filteredEntries = await supabaseDB.getAllFilteredCashBookEntries({
        companyName: filters.companyName || undefined,
        accountName: filters.mainAccount || undefined,
        subAccountName: filters.subAccount || undefined,
      });
      
      console.log(`📊 Filtered entries loaded: ${filteredEntries.length}`);
      
      // Convert to ledger format with running balance
      let runningBalance = 0;
      const ledgerData: LedgerEntry[] = filteredEntries.map((entry) => {
        const balance = entry.credit - entry.debit;
        runningBalance += balance;

        // Extract payment_mode
        let paymentMode = '';
        if (entry.payment_mode) {
          const pmStr = String(entry.payment_mode).trim();
          if (pmStr && pmStr !== 'null' && pmStr !== 'undefined' && pmStr !== '') {
            paymentMode = pmStr;
          }
        }

        return {
          id: entry.id,
          sno: entry.sno,
          date: entry.c_date,
          companyName: entry.company_name,
          accountName: entry.acc_name,
          subAccount: entry.sub_acc_name || '',
          particulars: entry.particulars,
          credit: entry.credit,
          debit: entry.debit,
          saleQuantity: entry.sale_qty || 0,
          purchaseQuantity: entry.purchase_qty || 0,
          staff: entry.staff,
          user: entry.users || entry.staff,
          entryTime: entry.entry_time,
          approved: entry.approved,
          balance: balance,
          runningBalance: runningBalance,
          payment_mode: paymentMode,
        };
      });
      
      setLedgerEntries(ledgerData);
      setTotalEntries(ledgerData.length);
      
      if (ledgerData.length === 0) {
        toast.success(`No entries found for the selected filters`);
      } else {
        toast.success(`Found ${ledgerData.length} entries matching your filters`);
      }
    } catch (error) {
      console.error('Error loading filtered data:', error);
      toast.error('Failed to load filtered data: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const resetFilters = () => {
    setFilters({
      fromDate: '2016-10-31',
      toDate: format(new Date(), 'yyyy-MM-dd'),
      companyName: '',
      mainAccount: '',
      subAccount: '',
      staffwise: '',
      user: '',
      creditAmount: '',
      debitAmount: '',
      betweenDates: true,
      paymentMode: '',
    });
    setSearchTerm('');
    toast.success('Filters reset');
  };

  // One print document for both the preview and the printer, so they always match.
  const generatePrintContent = (entriesToPrint: LedgerEntry[], isAllEntries: boolean) => {
    const totalCredit = entriesToPrint.reduce((s, e) => s + (e.credit || 0), 0);
    const totalDebit = entriesToPrint.reduce((s, e) => s + (e.debit || 0), 0);
    const totalSaleQty = entriesToPrint.reduce((s, e) => s + (e.saleQuantity || 0), 0);
    const totalPurchaseQty = entriesToPrint.reduce((s, e) => s + (e.purchaseQuantity || 0), 0);
    const balance = totalCredit - totalDebit;
    const quantityBalance = totalPurchaseQty - totalSaleQty;

    const qty = (n: number) => (n > 0 ? n.toLocaleString() : '-');
    const amount = (n: number) => (n > 0 ? n.toLocaleString() : '-');

    const rowsHtml = entriesToPrint
      .map(
        (entry, index) => `
        <tr>
          <td class="col-sno">${index + 1}</td>
          <td class="col-date">${format(new Date(entry.date), 'dd/MM/yyyy')}</td>
          <td class="col-company">${toDisplayCase(entry.companyName)}</td>
          <td class="col-account">${toDisplayCase(entry.accountName)}</td>
          <td class="col-sub-account">${toDisplayCase(entry.subAccount) || '-'}</td>
          <td class="col-particulars">${toDisplayCase(entry.particulars)}</td>
          <td class="col-purchase-qty">${qty(entry.purchaseQuantity)}</td>
          <td class="col-sale-qty">${qty(entry.saleQuantity)}</td>
          <td class="col-credit">${amount(entry.credit)}</td>
          <td class="col-debit">${amount(entry.debit)}</td>
        </tr>`
      )
      .join('');

    const totalsRows = `
      <tr class="totals">
        <td colspan="6" class="text-right">Total</td>
        <td class="col-purchase-qty">${qty(totalPurchaseQty)}</td>
        <td class="col-sale-qty">${qty(totalSaleQty)}</td>
        <td class="col-credit">${totalCredit.toLocaleString()}</td>
        <td class="col-debit">${totalDebit.toLocaleString()}</td>
      </tr>
      <tr class="totals">
        <td colspan="6" class="text-right">Quantity Balance</td>
        <td class="col-purchase-qty ${quantityBalance >= 0 ? 'text-green' : 'text-red'}">${quantityBalance === 0 ? '-' : `${Math.abs(quantityBalance).toLocaleString()} ${quantityBalance > 0 ? 'CR' : 'DR'}`}</td>
        <td class="text-right">Balance</td>
        <td colspan="2" class="col-balance ${balance >= 0 ? 'text-green' : 'text-red'}">${Math.abs(balance).toLocaleString()} ${balance >= 0 ? 'CR' : 'DR'}</td>
      </tr>`;

    const filterParts = [
      !isAllEntries && filters.companyName ? `Company: <strong>${toDisplayCase(filters.companyName)}</strong>` : '',
      !isAllEntries && filters.mainAccount ? `Account: <strong>${toDisplayCase(filters.mainAccount)}</strong>` : '',
      !isAllEntries && filters.subAccount ? `Sub Account: <strong>${toDisplayCase(filters.subAccount)}</strong>` : '',
      !isAllEntries && filters.staffwise ? `Staff: <strong>${toDisplayCase(filters.staffwise)}</strong>` : '',
      !isAllEntries && filters.user ? `User: <strong>${filters.user}</strong>` : '',
      !isAllEntries && filters.paymentMode ? `Payment Mode: <strong>${filters.paymentMode}</strong>` : '',
    ].filter(Boolean);

    const period = isAllEntries
      ? 'All Records'
      : `Period: <strong>${format(new Date(filters.fromDate), 'dd/MM/yyyy')}</strong> to <strong>${format(new Date(filters.toDate), 'dd/MM/yyyy')}</strong>`;

    return `<!DOCTYPE html>
<html>
  <head>
    <title>Detailed Ledger Report</title>
    <meta charset="utf-8">
    <style>
      ${getSharedPrintStyles({ isLandscape: false, fontSizePt: 7.5 })}
      th, td { padding: 2px 3px; }
      /* No fixed column widths: each column grows or shrinks with its content */
      body { background: #f3f4f6; padding: 16px; }
      .page { background: #fff; max-width: 210mm; margin: 0 auto; padding: 8mm 6mm; border: 1px solid #d1d5db; box-sizing: border-box; }
      .header { text-align: center; border-bottom: 1.5px solid #111; padding-bottom: 5px; margin-bottom: 6px; }
      .header h1 { margin: 0; font-size: 13pt; }
      .header h2 { margin: 1px 0 0; font-size: 10.5pt; font-weight: 600; }
      .header .meta { margin-top: 2px; font-size: 8.5pt; }
      .header .filters span { margin: 0 8px; }
      .text-green { color: #047857; }
      .text-red { color: #b91c1c; }
      .footer { margin-top: 8px; text-align: center; font-size: 7.5pt; color: #555; border-top: 1px solid #d1d5db; padding-top: 4px; }
      @media print {
        body { background: #fff !important; padding: 0 !important; }
        .page { max-width: none; border: none; padding: 0; margin: 0; }
        thead { display: table-header-group; }
      }
    </style>
    ${PREVIEW_FIT_HEAD}
  </head>
  <body>
    <div class="page">
      <div class="header">
        <h1>Thirumala Group</h1>
        <h2>Detailed Ledger Report${isAllEntries ? ' (All Records)' : ''}</h2>
        <div class="meta">${period}</div>
        ${filterParts.length ? `<div class="meta filters">${filterParts.map(p => `<span>${p}</span>`).join('')}</div>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th class="col-sno">S.No</th>
            <th class="col-date">Date</th>
            <th class="col-company">Company</th>
            <th class="col-account">Account</th>
            <th class="col-sub-account">Sub Account</th>
            <th class="col-particulars">Particulars</th>
            <th class="col-purchase-qty">Purchase Qty</th>
            <th class="col-sale-qty">Sale Qty</th>
            <th class="col-credit">Credit</th>
            <th class="col-debit">Debit</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          ${totalsRows}
        </tbody>
      </table>

      <div class="footer">Generated on ${format(new Date(), 'dd/MM/yyyy HH:mm')}${user?.username ? ` by ${user.username}` : ''} &middot; Total Records: ${entriesToPrint.length}</div>
    </div>
  </body>
</html>`;
  };

  const printReport = () => {
    const entriesToPrint = filteredEntries;
    if (entriesToPrint.length === 0) {
      toast.error('No entries to print');
      return;
    }

    // Show print preview modal (background page stays visible)
    setShowPrintPreview(true);
    setPrintAllEntries(false);
  };

  const printAll = () => {
    const entriesToPrint = ledgerEntries;
    if (entriesToPrint.length === 0) {
      toast.error('No entries to print');
      return;
    }

    // Show print preview modal (background page stays visible)
    setShowPrintPreview(true);
    setPrintAllEntries(true);
  };

  const exportToExcel = () => {
    if (filteredEntries.length === 0) {
      toast.error('No entries to export');
      return;
    }
    
    // Helper function to get payment mode display label
    const getPaymentModeDisplayLabel = (mode: string): string => {
      if (mode === 'Online') return 'Double';
      if (mode === 'Bank Transfer') return 'Bank';
      return mode || '';
    };
    
    const exportData = filteredEntries.map((entry, index) => ({
      'S.No': index + 1,
      Date: entry.date,
      Company: entry.companyName,
      'Main Account': entry.accountName,
      'Sub Account': entry.subAccount || '',
      Particulars: entry.particulars,
      Credit: entry.credit,
      Debit: entry.debit,
      Balance: entry.balance,
      Staff: entry.staff,
      'Payment Mode': getPaymentModeDisplayLabel(entry.payment_mode),
      User: entry.user,
      'Entry Time': entry.entryTime,
      // Status removed per requirement
    }));

    // Create CSV content
    const headers = Object.keys(exportData[0] || {});
    const csvContent = [
      headers.join(','),
      ...exportData.map(row =>
        headers.map(header => `"${row[header as keyof typeof row]}"`).join(',')
      ),
    ].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detailed-ledger-${filters.fromDate}-to-${filters.toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Ledger exported successfully!');
  };

  return (
    <div className='space-y-6'>
      {/* Locked Book Banner */}
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm flex items-center gap-3 no-print">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 animate-pulse" />
          <div>
            <h3 className="text-sm font-bold text-red-800">This Book Is Locked (Read Only)</h3>
            <p className="text-xs text-red-700">Writing, editing, and deletion operations are disabled for this accounting period.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <div className='flex items-center gap-3 mb-1'>
            <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2.5'>
              Detailed Ledger
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                currentBook?.is_locked 
                  ? 'bg-red-100 text-red-700' 
                  : tableMode === 'itr' 
                    ? 'bg-emerald-100 text-emerald-700' 
                    : 'bg-blue-100 text-blue-700'
              }`}>
                {tableMode === 'itr' ? 'ITR Mode' : 'Regular Mode'} | {currentBook?.book_code || 'No Book'}
              </span>
            </h1>
            <ModeLabel />
          </div>
          <p className='text-gray-600'>
            Comprehensive ledger analysis with advanced filtering
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <Button
            variant='secondary'
            onClick={() => setShowFilters(!showFilters)}
          >
            {showFilters ? 'Hide' : 'Show'} Filters
          </Button>
          <Button variant='secondary' onClick={loadLedgerData}>
            Refresh
          </Button>
          <Button variant='secondary' onClick={exportToExcel}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <Card className='bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'>
          <div className='space-y-6'>
            {/* Date Range Section */}
            <div className='bg-white p-4 rounded-lg border border-gray-200'>
              <div className='flex items-center gap-2 mb-4'>
                <input
                  type='checkbox'
                  id='betweenDates'
                  checked={filters.betweenDates}
                  onChange={e =>
                    handleFilterChange('betweenDates', e.target.checked)
                  }
                  className='w-4 h-4 text-blue-600 rounded focus:ring-blue-500'
                />
                <label
                  htmlFor='betweenDates'
                  className='text-sm font-medium text-gray-700'
                >
                  Between Dates
                </label>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    From
                  </label>
                  <div className='relative'>
                    <input
                      type='text'
                      value={fromDateInput}
                      onChange={e => {
                        const v = e.target.value;
                        setFromDateInput(v);
                        const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                        if (m) {
                          const [, dd, mm, yyyy] = m;
                          handleFilterChange('fromDate', `${yyyy}-${mm}-${dd}`);
                        }
                      }}
                      disabled={!filters.betweenDates}
                      placeholder='dd/MM/yyyy'
                      className='w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500'
                    />
                    <button
                      type='button'
                      onClick={() => setShowFromCalendar(!showFromCalendar)}
                      className='absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded'
                    >
                      <Calendar className='w-4 h-4 text-gray-500' />
                    </button>
                    {showFromCalendar && (
                      <CustomCalendar
                        entries={ledgerEntries.map(e => ({ c_date: e.date }))}
                        onDateSelect={(date) => {
                          handleFilterChange('fromDate', date);
                          setFromDateInput(format(new Date(date), 'dd/MM/yyyy'));
                          setShowFromCalendar(false);
                        }}
                        selectedDate={filters.fromDate}
                        onClose={() => setShowFromCalendar(false)}
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    To
                  </label>
                  <div className='relative'>
                    <input
                      type='text'
                      value={toDateInput}
                      onChange={e => {
                        const v = e.target.value;
                        setToDateInput(v);
                        const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                        if (m) {
                          const [, dd, mm, yyyy] = m;
                          handleFilterChange('toDate', `${yyyy}-${mm}-${dd}`);
                        }
                      }}
                      disabled={!filters.betweenDates}
                      placeholder='dd/MM/yyyy'
                      className='w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500'
                    />
                    <button
                      type='button'
                      onClick={() => setShowToCalendar(!showToCalendar)}
                      className='absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded'
                    >
                      <Calendar className='w-4 h-4 text-gray-500' />
                    </button>
                    {showToCalendar && (
                      <CustomCalendar
                        entries={ledgerEntries.map(e => ({ c_date: e.date }))}
                        onDateSelect={(date) => {
                          handleFilterChange('toDate', date);
                          setToDateInput(format(new Date(date), 'dd/MM/yyyy'));
                          setShowToCalendar(false);
                        }}
                        selectedDate={filters.toDate}
                        onClose={() => setShowToCalendar(false)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Account Filters */}
            <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
              <SearchableSelect
                label='Company Name'
                value={filters.companyName}
                onChange={value => handleFilterChange('companyName', value)}
                options={companyOptions}
                placeholder='Search company...'
              />

              <SearchableSelect
                label='Main Account'
                value={filters.mainAccount}
                onChange={value => handleFilterChange('mainAccount', value)}
                options={accountOptions}
                disabled={!filters.companyName}
                placeholder={
                  !filters.companyName
                    ? 'Select a company first'
                    : 'Search main account...'
                }
              />

              <SearchableSelect
                label='Sub Account'
                value={filters.subAccount}
                onChange={value => handleFilterChange('subAccount', value)}
                options={subAccountOptions}
                disabled={!filters.mainAccount}
                placeholder={
                  !filters.mainAccount
                    ? 'Select a main account first'
                    : 'Search sub account...'
                }
              />

              <SearchableSelect
                label='Staffwise'
                value={filters.staffwise}
                onChange={value => handleFilterChange('staffwise', value)}
                options={staffOptions}
                placeholder='Search staff...'
              />

              <SearchableSelect
                label='User'
                value={filters.user}
                onChange={value => handleFilterChange('user', value)}
                options={userOptions}
                placeholder='Search user...'
              />
            </div>

            {/* Filtering guidance removed as requested */}

            {/* Amount Filters + Payment Mode */}
            <div className='grid grid-cols-1 md:grid-cols-3 gap-2'>
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-1'>
                  Credit Amount (Search)
                </label>
                <input
                  type='text'
                  inputMode='decimal'
                  value={filters.creditAmount || ''}
                  onChange={e => handleFilterChange('creditAmount', e.target.value)}
                  placeholder='Enter credit amount to search...'
                  className='w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-700 mb-1'>
                  Debit Amount (Search)
                </label>
                <input
                  type='text'
                  inputMode='decimal'
                  value={filters.debitAmount || ''}
                  onChange={e => handleFilterChange('debitAmount', e.target.value)}
                  placeholder='Enter debit amount to search...'
                  className='w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>

              <SearchableSelect
                label='Payment Mode'
                value={filters.paymentMode || ''}
                onChange={value => handleFilterChange('paymentMode', value)}
                options={[
                  { value: '', label: 'All' },
                  { value: 'Cash', label: 'Cash' },
                  { value: 'Bank Transfer', label: 'Bank' },
                  { value: 'Online', label: 'Double' },
                ]}
                placeholder='Search payment mode...'
              />
            </div>

            {/* Action Buttons */}
            <div className='flex flex-wrap gap-3'>
              <Button
                onClick={getRecords}
                className='bg-green-600 hover:bg-green-700'
              >
                Get Record (Client-side)
              </Button>

              <Button
                onClick={loadFilteredData}
                className='bg-blue-600 hover:bg-blue-700'
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load Filtered Data (Server-side)'}
              </Button>

              <Button variant='secondary' onClick={resetFilters}>
                Reset
              </Button>

              <Button variant='secondary' onClick={() => setShowFilters(false)}>
                Close
              </Button>

              <Button variant='secondary' onClick={printReport}>
                Print
              </Button>

              <Button variant='secondary' onClick={printAll}>
                Print All
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Search Bar */}
      <Card className='bg-gray-50'>
        <div className='flex items-center gap-4'>
          <div className='relative flex-1'>
            <Search className='w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400' />
            <input
              type='text'
              placeholder='Search in ledger entries...'
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className='pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
          </div>
          <div className='text-sm text-gray-600 bg-white px-3 py-2 rounded-lg border'>
            <strong>{filteredEntries.length}</strong> records found
            {totalEntries > 0 && (
              <span className='text-xs text-gray-500 ml-2'>
                (of {totalEntries} total)
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Summary Cards */}
      <div className='grid grid-cols-1 md:grid-cols-5 gap-4'>
        <Card className='bg-gradient-to-r from-green-500 to-green-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-green-100 text-sm font-medium'>Total Credit</p>
              <p className='text-2xl font-bold'>
{totals.totalCredit.toLocaleString()}
              </p>
            </div>
            <TrendingUp className='w-8 h-8 text-green-200' />
          </div>
        </Card>

        <Card className='bg-gradient-to-r from-red-500 to-red-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-red-100 text-sm font-medium'>Total Debit</p>
              <p className='text-2xl font-bold'>
{totals.totalDebit.toLocaleString()}
              </p>
            </div>
            <TrendingDown className='w-8 h-8 text-red-200' />
          </div>
        </Card>

        <Card
          className={`bg-gradient-to-r ${
            totals.balance >= 0
              ? 'from-blue-500 to-blue-600'
              : 'from-orange-500 to-orange-600'
          } text-white`}
        >
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-blue-100 text-sm font-medium'>Balance</p>
              <p className='text-2xl font-bold'>
{Math.abs(totals.balance).toLocaleString()}
                {totals.balance >= 0 ? ' CR' : ' DR'}
              </p>
            </div>
            <BarChart3 className='w-8 h-8 text-blue-200' />
          </div>
        </Card>

        <Card className='bg-gradient-to-r from-indigo-500 to-indigo-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-indigo-100 text-sm font-medium'>Total Sale Qty</p>
              <p className='text-2xl font-bold'>
                {totals.totalSaleQty.toLocaleString()}
              </p>
            </div>
            <BarChart3 className='w-8 h-8 text-indigo-200' />
          </div>
        </Card>
        <Card className='bg-gradient-to-r from-purple-500 to-purple-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-purple-100 text-sm font-medium'>Total Purchase Qty</p>
              <p className='text-2xl font-bold'>
                {totals.totalPurchaseQty.toLocaleString()}
              </p>
            </div>
            <BarChart3 className='w-8 h-8 text-purple-200' />
          </div>
        </Card>
      </div>

      {/* Ledger Table */}
      <Card
        title='Detailed Ledger Entries'
        subtitle={`Showing ${filteredEntries.length} entries${totalEntries > 0 ? ` (of ${totalEntries} total)` : ''}`}
      >
        {loading ? (
          <div className='text-center py-8'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto'></div>
            <p className='mt-2 text-gray-600'>Loading ledger data...</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className='text-center py-8 text-gray-500'>
            No entries found matching your criteria.
          </div>
        ) : (
          <>
            <div className='w-full'>
              <table className='fit-table border-collapse'>
              <thead className='sticky top-0 bg-gray-50 z-10'>
                <tr className='border-b border-gray-200'>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    S.No
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Date
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Company
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Account
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Sub Account
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Particulars
                  </th>
                  <th className='px-0.5 py-1 text-right font-medium text-gray-700'>
                    Credit
                  </th>
                  <th className='px-0.5 py-1 text-right font-medium text-gray-700'>
                    Debit
                  </th>
                  <th className='px-0.5 py-1 text-center font-medium text-gray-700'>
                    Purchase Qty
                  </th>
                  <th className='px-0.5 py-1 text-center font-medium text-gray-700'>
                    Sale Qty
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Staff
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Payment Mode
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    User
                  </th>
                  <th className='px-0.5 py-1 text-left font-medium text-gray-700'>
                    Entry Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    className={`border-b hover:bg-gray-50 transition-colors ${
                      index % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                    }`}
                  >
                    <td className='px-0.5 py-1 font-medium text-gray-500 fit-nowrap'>{index + 1}</td>
                    <td className='px-0.5 py-1 text-gray-900 font-medium fit-nowrap'>
                      {format(new Date(entry.date), 'dd/MM/yyyy')}
                    </td>
                    <td className='px-0.5 py-1 text-blue-600 font-semibold fit-name' title={entry.companyName}>
                      {entry.companyName}
                    </td>
                    <td className='px-0.5 py-1 text-gray-900 font-medium' title={entry.accountName}>
                      {entry.accountName}
                    </td>
                    <td className='px-0.5 py-1 text-gray-500' title={entry.subAccount}>
                      {entry.subAccount || '-'}
                    </td>
                    <td className='px-0.5 py-1 text-gray-900 fit-particulars' title={entry.particulars}>
                      {entry.particulars}
                    </td>
                    <td className='px-0.5 py-1 text-right font-semibold text-green-600 fit-nowrap'>
                      {entry.credit > 0
                        ? `${entry.credit.toLocaleString()}`
                        : '-'}
                    </td>
                    <td className='px-0.5 py-1 text-right font-semibold text-red-600 fit-nowrap'>
                      {entry.debit > 0
                        ? `${entry.debit.toLocaleString()}`
                        : '-'}
                    </td>
                    <td className='px-0.5 py-1 text-center text-gray-900 font-medium'>
                      {entry.purchaseQuantity > 0 ? entry.purchaseQuantity.toLocaleString() : '-'}
                    </td>
                    <td className='px-0.5 py-1 text-center text-gray-900 font-medium'>
                      {entry.saleQuantity > 0 ? entry.saleQuantity.toLocaleString() : '-'}
                    </td>
                    <td className='px-0.5 py-1 text-gray-900' title={entry.staff}>
                      {entry.staff}
                    </td>
                    <td className='px-0.5 py-1 text-gray-900' title={entry.payment_mode || 'No payment mode'}>
                      {entry.payment_mode && String(entry.payment_mode).trim() ? (entry.payment_mode === 'Online' ? 'Double' : entry.payment_mode === 'Bank Transfer' ? 'Bank' : String(entry.payment_mode).trim()) : '-'}
                    </td>
                    <td className='px-0.5 py-1 text-gray-900' title={entry.user}>
                      {entry.user}
                    </td>
                    <td className='px-0.5 py-1 text-gray-500 font-medium'>
                      <span className='fit-nowrap'>{format(new Date(entry.entryTime), 'dd/MM/yyyy')}</span>{' '}
                      <span className='fit-nowrap'>{format(new Date(entry.entryTime), 'hh:mm:ss aa')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Footer */}
          <div className='mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg border'>
            <div className='bg-green-100 p-3 rounded-lg'>
              <div className='text-sm font-medium text-green-800'>
                Total Credit:
              </div>
              <div className='text-lg font-bold text-green-900'>
                {totals.totalCredit.toLocaleString()}
              </div>
            </div>
            <div className='bg-red-100 p-3 rounded-lg'>
                <div className='text-sm font-medium text-red-800'>
                  Total Debit:
                </div>
                <div className='text-lg font-bold text-red-900'>
{totals.totalDebit.toLocaleString()}
                </div>
              </div>
              <div
                className={`p-3 rounded-lg ${
                  totals.balance >= 0 ? 'bg-blue-100' : 'bg-orange-100'
                }`}
              >
                <div
                  className={`text-sm font-medium ${
                    totals.balance >= 0 ? 'text-blue-800' : 'text-orange-800'
                  }`}
                >
                  Balance:
                </div>
                <div
                  className={`text-lg font-bold ${
                    totals.balance >= 0 ? 'text-blue-900' : 'text-orange-900'
                  }`}
                >
{Math.abs(totals.balance).toLocaleString()}
                  {totals.balance >= 0 ? ' CR' : ' DR'}
                </div>
              </div>
            </div>
          </>
        )}
        
        {/* Progress Indicator */}
        {isLoadingAll && loadingProgress.total > 0 && (
          <div className='text-center py-4'>
            <div className='bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto'>
              <div className='text-sm text-blue-800 mb-2'>{loadingProgress.message}</div>
              <div className='w-full bg-blue-200 rounded-full h-2 mb-2'>
                <div 
                  className='bg-blue-600 h-2 rounded-full transition-all duration-300'
                  style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
                ></div>
              </div>
              <div className='text-xs text-blue-600'>
                {loadingProgress.current.toLocaleString()} / {loadingProgress.total.toLocaleString()} records
              </div>
            </div>
          </div>
        )}

        {/* Load More and Load All Buttons */}
        <div className='text-center py-4 space-x-4'>
          {ledgerEntries.length < totalEntries && (
            <Button
              onClick={loadMoreEntries}
              disabled={isLoadingMore || isLoadingAll}
              variant='secondary'
              icon={isLoadingMore ? RefreshCw : Plus}
              className='min-w-[200px]'
            >
              {isLoadingMore ? 'Loading...' : `Load More (${totalEntries - ledgerEntries.length} remaining)`}
            </Button>
          )}
          
          {ledgerEntries.length < totalEntries && (
            <Button
              onClick={loadAllEntries}
              disabled={isLoadingMore || isLoadingAll}
              variant='primary'
              icon={isLoadingAll ? RefreshCw : Database}
              className='min-w-[200px]'
            >
              {isLoadingAll ? 'Loading All...' : `Load All ${totalEntries} Records`}
            </Button>
          )}
        </div>
        
        {/* Pagination Info */}
        {totalEntries > 0 && (
          <div className='text-center text-sm text-gray-600 py-2'>
            Showing {ledgerEntries.length} of {totalEntries} entries
          </div>
        )}
      </Card>

      {/* Print Preview Modal: shows the exact document that gets printed */}
      {showPrintPreview && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 z-50'>
          <div className='bg-white rounded-lg w-[98vw] h-[96vh] flex flex-col'>
            <div className='flex items-center justify-between px-6 py-4 border-b no-print'>
              <h3 className='text-lg font-semibold'>
                Print Preview - Detailed Ledger
              </h3>
              <div className='flex items-center gap-2'>
                <Button
                  size='sm'
                  onClick={() => {
                    if (!printPreviewFrame(previewFrameRef.current)) {
                      toast.error('Print failed. Please try again.');
                    }
                  }}
                >
                  Print
                </Button>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={() => setShowPrintPreview(false)}
                >
                  Close
                </Button>
              </div>
            </div>
            <iframe
              ref={previewFrameRef}
              title='Detailed Ledger print preview'
              srcDoc={generatePrintContent(printAllEntries ? ledgerEntries : filteredEntries, printAllEntries)}
              className='flex-1 w-full rounded-b-lg'
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DetailedLedger;
