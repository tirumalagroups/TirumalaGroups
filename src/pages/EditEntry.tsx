import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import SearchableSelect from '../components/UI/SearchableSelect';
import { supabaseDB } from '../lib/supabaseDatabase';
import { supabase } from '../lib/supabase';
import { getTableName } from '../lib/tableNames';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import { useFormArrowNavigation } from '../hooks/useFormArrowNavigation';
import { useBook } from '../contexts/BookContext';
import toast from 'react-hot-toast';
import ModeLabel from '../components/UI/ModeLabel';
import CustomCalendar from '../components/UI/CustomCalendar';
import { format } from 'date-fns';
import { useOffline } from '../contexts/OfflineContext';
import { fetchAndCacheMasterData, getCachedMasterData } from '../lib/offlineMasterData';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import {
  Calendar,
  Edit,
  History,
  RefreshCw,
  Plus,
  Eye,
  Trash2,
  AlertCircle,
  Download,
} from 'lucide-react';

interface EditHistory {
  id: string;
  entryId: string;
  action: string;
  userId: string;
  timestamp: string;
  sno?: number;
  editedBy?: string;
  editedAt?: string;
  changes?: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
  oldValues?: any;
  newValues?: any;
}

// Helper function to normalize date to YYYY-MM-DD format for comparison
const normalizeDate = (date: string | Date | null | undefined): string | null => {
  if (!date) return null;
  
  try {
    // If it's already a string in YYYY-MM-DD format, return it
    if (typeof date === 'string') {
      // Handle dates with time components (e.g., "2025-11-21 00:00:00" or "2025-11-21T00:00:00")
      const dateOnly = date.split('T')[0].split(' ')[0];
      // Validate it's in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        return dateOnly;
      }
      // Try parsing as date
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return format(parsed, 'yyyy-MM-dd');
      }
    }
    
    // If it's a Date object
    if (date instanceof Date) {
      return format(date, 'yyyy-MM-dd');
    }
    
    return null;
  } catch (error) {
    console.warn('Error normalizing date:', date, error);
    return null;
  }
};

// Helper function to check if an entry matches the search term across all columns
const matchSearchTerm = (entry: any, searchTerm: string): boolean => {
  if (!searchTerm) return true;
  const searchLower = searchTerm.toLowerCase().trim();
  
  // Date formatting helpers
  let dateStr1 = '';
  let dateStr2 = '';
  if (entry.c_date) {
    try {
      const dateObj = new Date(entry.c_date);
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
  const saleQtyStr = entry.sale_qty != null ? String(entry.sale_qty) : '';
  const purchaseQtyStr = entry.purchase_qty != null ? String(entry.purchase_qty) : '';
  
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
    entry.company_name?.toLowerCase().includes(searchLower) ||
    entry.acc_name?.toLowerCase().includes(searchLower) ||
    entry.sub_acc_name?.toLowerCase().includes(searchLower) ||
    entry.particulars?.toLowerCase().includes(searchLower) ||
    entry.staff?.toLowerCase().includes(searchLower) ||
    entry.users?.toLowerCase().includes(searchLower) ||
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

const EditEntry: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const canDelete = isAdmin || !!(user?.features?.includes('delete_entry'));
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();
  const { isOnline, askInternet } = useOffline();
  const [isCacheSyncing, setIsCacheSyncing] = useState(false);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const handleManualCacheRefresh = async () => {
    setIsCacheSyncing(true);
    try {
      await fetchAndCacheMasterData(tableMode === 'itr' ? 'itr' : 'regular');
      toast.success('Offline cache updated successfully!');
      queryClient.invalidateQueries({ queryKey: queryKeys.dropdowns.companies() });
      await loadDropdownData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to refresh offline cache');
    } finally {
      setIsCacheSyncing(false);
    }
  };
  
  const [entries, setEntries] = useState<any[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [editMode, setEditMode] = useState(false);
  const [editDateInput, setEditDateInput] = useState('');

  useEffect(() => {
    if (selectedEntry?.c_date) {
      try {
        setEditDateInput(format(new Date(selectedEntry.c_date), 'dd/MM/yyyy'));
      } catch (e) {
        console.error('Error formatting selected entry date:', e);
        setEditDateInput('');
      }
    } else {
      setEditDateInput('');
    }
  }, [selectedEntry?.id, editMode]);
  
  // Enable arrow key navigation only in non-finance modes (Regular/ITR) when in edit mode
  useFormArrowNavigation(formRef, tableMode !== 'finance' && editMode);
  
  // Calendar state
  const [showCalendar, setShowCalendar] = useState(false);
  const [entriesForSelectedDate, setEntriesForSelectedDate] = useState<any[]>([]);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // Default to empty to show all entries
  const [loading, setLoading] = useState(false);
  
  // Performance optimization states
  const [pageSize] = useState(1000); // Show 1000 entries per page for better data visibility
  const [totalEntries, setTotalEntries] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingAll] = useState(false);
  const [loadingProgress] = useState({ current: 0, total: 0, message: '' });
  
  // Add filter state variables (moved before memoized filtering)
  const [filterCompanyName, setFilterCompanyName] = useState('');
  const [filterAccountName, setFilterAccountName] = useState('');
  const [filterSubAccountName, setFilterSubAccountName] = useState('');
  const [filterParticulars, setFilterParticulars] = useState('');
  const [filterSaleQ, setFilterSaleQ] = useState('');
  const [filterPurchaseQ, setFilterPurchaseQ] = useState('');
  const [filterCredit, setFilterCredit] = useState('');
  const [filterDebit, setFilterDebit] = useState('');
  const [filterStaff, setFilterStaff] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterPaymentMode, setFilterPaymentMode] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterDateInput, setFilterDateInput] = useState('');
  
  // States for modal options (filters are memoized dynamically from entries)
  const [editAccountOptions, setEditAccountOptions] = useState<{ value: string; label: string }[]>([]);
  const [editSubAccountOptions, setEditSubAccountOptions] = useState<{ value: string; label: string }[]>([]);
  
  // Memoized filtered entries for better performance
  const filteredEntries = useMemo(() => {
    let filtered = entries;
    
    // Apply company filter
    if (filterCompanyName) {
      filtered = filtered.filter(entry => 
        entry.company_name?.toLowerCase().includes(filterCompanyName.toLowerCase())
      );
    }
    
    // Apply account filter
    if (filterAccountName) {
      filtered = filtered.filter(entry => 
        entry.acc_name?.toLowerCase().includes(filterAccountName.toLowerCase())
      );
    }
    
    // Apply sub-account filter
    if (filterSubAccountName) {
      filtered = filtered.filter(entry => 
        entry.sub_acc_name?.toLowerCase().includes(filterSubAccountName.toLowerCase())
      );
    }
    
    // Apply particulars filter
    if (filterParticulars) {
      filtered = filtered.filter(entry => 
        entry.particulars?.toLowerCase().includes(filterParticulars.toLowerCase())
      );
    }
    
    // Apply credit filter
    if (filterCredit) {
      const creditValue = parseFloat(filterCredit);
      if (!isNaN(creditValue)) {
        filtered = filtered.filter(entry => entry.credit === creditValue);
      }
    }
    
    // Apply debit filter
    if (filterDebit) {
      const debitValue = parseFloat(filterDebit);
      if (!isNaN(debitValue)) {
        filtered = filtered.filter(entry => entry.debit === debitValue);
      }
    }
    
    // Apply staff filter
    if (filterStaff) {
      filtered = filtered.filter(entry => 
        entry.staff?.toLowerCase().includes(filterStaff.toLowerCase())
      );
    }
    
    // Apply user filter - search by username (Edited By)
    if (filterUser) {
      filtered = filtered.filter(entry => {
        const entryUser = entry.users ? String(entry.users).trim() : '';
        const filterUserValue = String(filterUser).trim();
        // Exact match for dropdown selection, or partial match for search
        return entryUser === filterUserValue || entryUser.toLowerCase().includes(filterUserValue.toLowerCase());
      });
    }
    
    // Apply payment mode filter
    if (filterPaymentMode) {
      filtered = filtered.filter(entry => {
        const entryPaymentMode = entry.payment_mode ? String(entry.payment_mode).trim().toLowerCase() : '';
        return entryPaymentMode === filterPaymentMode.toLowerCase();
      });
    }
    
    // Apply date filter from calendar selection (priority over other date filters)
    if (selectedDateFilter) {
      const normalizedFilterDate = normalizeDate(selectedDateFilter);
      if (normalizedFilterDate) {
        filtered = filtered.filter(entry => {
          const normalizedEntryDate = normalizeDate(entry.c_date);
          return normalizedEntryDate === normalizedFilterDate;
        });
      }
    }
    
    if (searchTerm) {
      filtered = filtered.filter(entry => matchSearchTerm(entry, searchTerm));
    }
    
    if (filterDate && !selectedDateFilter) {
      const normalizedFilterDate = normalizeDate(filterDate);
      if (normalizedFilterDate) {
        filtered = filtered.filter(entry => {
          const normalizedEntryDate = normalizeDate(entry.c_date);
          return normalizedEntryDate === normalizedFilterDate;
        });
      }
    }
    
    if (statusFilter) {
      if (statusFilter === 'approved') {
        filtered = filtered.filter(entry => entry.approved);
      } else if (statusFilter === 'pending') {
        filtered = filtered.filter(entry => !entry.approved);
      }
    }
    
    // Apply sale quantity filter
    if (filterSaleQ) {
      filtered = filtered.filter(entry => String(entry.sale_qty || '') === filterSaleQ);
    }
    
    // Apply purchase quantity filter
    if (filterPurchaseQ) {
      filtered = filtered.filter(entry => String(entry.purchase_qty || '') === filterPurchaseQ);
    }
    
    return filtered;
  }, [entries, filterCompanyName, filterAccountName, filterSubAccountName, filterParticulars, filterCredit, filterDebit, filterStaff, filterUser, filterPaymentMode, selectedDateFilter, searchTerm, filterDate, statusFilter, filterSaleQ, filterPurchaseQ]);
  
  const [showHistory, setShowHistory] = useState(false);
  const [entryHistory] = useState<EditHistory[]>([]);

  // Form data for editing
  const [companies, setCompanies] = useState<{ value: string; label: string }[]>([]);
  const [editStaffOptions, setEditStaffOptions] = useState<{ value: string; label: string }[]>([]);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [paymentModeOptions, setPaymentModeOptions] = useState<{ value: string; label: string }[]>([]);
  
  // Separate state for edit form preloading - always show ALL values
  const [allAccountNames, setAllAccountNames] = useState<{ value: string; label: string }[]>([]);
  const [allSubAccounts, setAllSubAccounts] = useState<{ value: string; label: string }[]>([]);

  // Base entries for filtering dropdowns (respects date, search, and status filters)
  const baseFilterEntries = useMemo(() => {
    let filtered = entries;
    
    // Apply date filter from calendar selection (priority) or input date filter
    const activeDate = selectedDateFilter || filterDate;
    if (activeDate) {
      const normalizedFilterDate = normalizeDate(activeDate);
      if (normalizedFilterDate) {
        filtered = filtered.filter(entry => {
          const normalizedEntryDate = normalizeDate(entry.c_date);
          return normalizedEntryDate === normalizedFilterDate;
        });
      }
    }
    
    // Apply search term
    if (searchTerm) {
      filtered = filtered.filter(entry => matchSearchTerm(entry, searchTerm));
    }
    
    // Apply status filter
    if (statusFilter) {
      if (statusFilter === 'approved') {
        filtered = filtered.filter(entry => entry.approved);
      } else if (statusFilter === 'pending') {
        filtered = filtered.filter(entry => !entry.approved);
      }
    }
    
    return filtered;
  }, [entries, selectedDateFilter, filterDate, searchTerm, statusFilter]);

  // Derived filter options
  const filterCompanies = useMemo(() => {
    const uniqueCompanies = [...new Set(baseFilterEntries.map(entry => entry.company_name?.trim()).filter(Boolean))].sort();
    return uniqueCompanies.map(name => ({ value: name, label: name }));
  }, [baseFilterEntries]);

  const filterAccountOptions = useMemo(() => {
    let filtered = baseFilterEntries;
    if (filterCompanyName) {
      filtered = filtered.filter(entry =>
        entry.company_name?.toLowerCase().trim() === filterCompanyName.toLowerCase().trim()
      );
    }
    const uniqueAccounts = [...new Set(filtered.map(entry => entry.acc_name?.trim()).filter(Boolean))].sort();
    return uniqueAccounts.map(name => ({ value: name, label: name }));
  }, [baseFilterEntries, filterCompanyName]);

  const filterSubAccountOptions = useMemo(() => {
    let filtered = baseFilterEntries;
    if (filterCompanyName) {
      filtered = filtered.filter(entry =>
        entry.company_name?.toLowerCase().trim() === filterCompanyName.toLowerCase().trim()
      );
    }
    if (filterAccountName) {
      filtered = filtered.filter(entry =>
        entry.acc_name?.toLowerCase().trim() === filterAccountName.toLowerCase().trim()
      );
    }
    const uniqueSubAccounts = [...new Set(filtered.map(entry => entry.sub_acc_name?.trim()).filter(Boolean))].sort();
    return uniqueSubAccounts.map(name => ({ value: name, label: name }));
  }, [baseFilterEntries, filterCompanyName, filterAccountName]);

  const filterStaffOptions = useMemo(() => {
    let filtered = baseFilterEntries;
    if (filterCompanyName) {
      filtered = filtered.filter(entry =>
        entry.company_name?.toLowerCase().trim() === filterCompanyName.toLowerCase().trim()
      );
    }
    if (filterAccountName) {
      filtered = filtered.filter(entry =>
        entry.acc_name?.toLowerCase().trim() === filterAccountName.toLowerCase().trim()
      );
    }
    if (filterSubAccountName) {
      filtered = filtered.filter(entry =>
        entry.sub_acc_name?.toLowerCase().trim() === filterSubAccountName.toLowerCase().trim()
      );
    }
    const uniqueStaff = [...new Set(filtered.map(entry => entry.staff?.trim()).filter(Boolean))].sort();
    return uniqueStaff.map(name => ({ value: name, label: name }));
  }, [baseFilterEntries, filterCompanyName, filterAccountName, filterSubAccountName]);

  const particularsOptions = useMemo(() => {
    const uniqueParticulars = [...new Set(baseFilterEntries.map(entry => entry.particulars?.trim()).filter(Boolean))].sort();
    return uniqueParticulars.map(particular => ({ value: particular, label: particular }));
  }, [baseFilterEntries]);

  const creditOptions = useMemo(() => {
    const uniqueCredits = [...new Set(baseFilterEntries.map(entry => entry.credit).filter(val => val !== null && val !== undefined))].sort((a, b) => a - b);
    return uniqueCredits.map(amount => ({ value: amount.toString(), label: amount.toString() }));
  }, [baseFilterEntries]);

  const debitOptions = useMemo(() => {
    const uniqueDebits = [...new Set(baseFilterEntries.map(entry => entry.debit).filter(val => val !== null && val !== undefined))].sort((a, b) => a - b);
    return uniqueDebits.map(amount => ({ value: amount.toString(), label: amount.toString() }));
  }, [baseFilterEntries]);


  useEffect(() => {
    const initializeData = async () => {
      console.log('🔄 Initializing EditEntry data...');
      // Load companies first to ensure they're available immediately
      const allCompaniesList = await supabaseDB.getCompanies();
      const allCompaniesData = allCompaniesList.map(company => ({
        value: company.company_name?.trim() || '',
        label: company.company_name?.trim() || '',
      })).filter(item => item.value && item.label);
      console.log('✅ Initial companies loaded:', allCompaniesData.length);
      setCompanies(allCompaniesData);
      
      await loadEntries();
      await loadDropdownData();
    };

    initializeData();
  }, []); // Remove dependencies to prevent re-initialization on filter changes

  // Going offline or coming back changes which entries can be shown
  useEffect(() => {
    loadEntries();
  }, [isOnline]);

  // Refresh entries when table mode or book changes
  useEffect(() => {
    console.log('🔄 Table mode or book changed in EditEntry, reloading entries... Mode:', tableMode);
    loadEntries();
    loadDropdownData();
  }, [tableMode, currentBook?.id]);

  // Single useEffect for all filter changes - now using client-side filtering only
  useEffect(() => {
    console.log('🔄 Filters changed, reloading entries...');
    loadEntries();
  }, [searchTerm, filterDate, statusFilter, filterCompanyName, filterAccountName, filterSubAccountName, filterParticulars, filterCredit, filterDebit, filterStaff, filterUser, filterPaymentMode]);

  // Listen for global dashboard refresh events (emitted after new entry creation)
  useEffect(() => {
    const onRefresh = () => {
      // small delay to ensure DB commit
      setTimeout(() => {
        loadEntries();
      }, 300);
    };
    window.addEventListener('dashboard-refresh', onRefresh);
    return () => window.removeEventListener('dashboard-refresh', onRefresh);
  }, []);

  // Sync visible date input with ISO filterDate
  useEffect(() => {
    if (filterDate) {
      try {
        setFilterDateInput(format(new Date(filterDate), 'dd/MM/yyyy'));
      } catch {
        setFilterDateInput('');
      }
    } else {
      setFilterDateInput('');
    }
  }, [filterDate]);

  // Reset other filters when date changes to avoid empty results
  useEffect(() => {
    const activeDate = selectedDateFilter || filterDate;
    if (activeDate) {
      setFilterCompanyName('');
      setFilterAccountName('');
      setFilterSubAccountName('');
      setFilterParticulars('');
      setFilterCredit('');
      setFilterDebit('');
      setFilterPaymentMode('');
    }
  }, [filterDate, selectedDateFilter]);

  // Auto-reset dependent filters on Company Name change
  useEffect(() => {
    setFilterAccountName('');
    setFilterSubAccountName('');
    setFilterStaff('');
  }, [filterCompanyName]);

  // Auto-reset dependent filters on Account Name change
  useEffect(() => {
    setFilterSubAccountName('');
  }, [filterAccountName]);

  // Prepopulate edit modal dropdowns when selectedEntry changes (so options are available in edit/view modal)
  useEffect(() => {
    const populateEditOptions = async () => {
      if (!selectedEntry) return;
      
      const company = selectedEntry.company_name;
      const account = selectedEntry.acc_name;
      
      if (company) {
        const accNames = await supabaseDB.getDistinctAccountNamesByCompany(company);
        setEditAccountOptions(accNames.map(name => ({ value: name, label: name })));
        
        if (account) {
          const subAccs = await supabaseDB.getSubAccountsByAccountAndCompany(account, company);
          setEditSubAccountOptions(subAccs.map(name => ({ value: name, label: name })));
        } else {
          setEditSubAccountOptions([]);
        }
      } else {
        const allAccs = await supabaseDB.getDistinctAccountNames();
        setEditAccountOptions(allAccs.map(name => ({ value: name, label: name })));
        
        if (account) {
          const subAccs = await supabaseDB.getSubAccountsByAccountName(account);
          setEditSubAccountOptions(subAccs.map(name => ({ value: name, label: name })));
        } else {
          setEditSubAccountOptions([]);
        }
      }
    };
    
    populateEditOptions();
  }, [selectedEntry?.id, tableMode]);

  const loadDropdownData = async () => {
    try {
      console.log('🔄 Loading dropdown data...');
      
      // Load ALL companies from companies table (primary source)
      console.log('🏢 Loading ALL companies from companies table...');
      const companies = await supabaseDB.getCompanies();
      const companiesData = companies.map(company => ({
        value: company.company_name?.trim() || '',
        label: company.company_name?.trim() || '',
      })).filter(item => item.value && item.label);
      setCompanies(companiesData);

      // Load staff names from existing cash_book entries (staff column) for edit form
      try {
        const staffOptions = await supabaseDB.getDistinctStaffNames();
        setEditStaffOptions(staffOptions);
      } catch (error) {
        console.error('❌ Error loading staff, falling back to users table:', error);
        const usersFromTable = await supabaseDB.getUsers();
        const staffData = usersFromTable
          .filter(u => u.is_active)
          .map(user => ({
            value: user.username,
            label: user.username,
          }));
        setEditStaffOptions(staffData);
      }

      // Load user names from existing cash_book entries
      try {
        const userOptions = await supabaseDB.getDistinctUserNames();
        setUsers(userOptions);
      } catch (error) {
        console.error('❌ Error loading users, falling back to users table:', error);
        const usersFromTable = await supabaseDB.getUsers();
        const usersData = usersFromTable
          .filter(u => u.is_active)
          .map(user => ({
            value: user.username,
            label: user.username,
          }));
        setUsers(usersData);
      }
      
      // Load ALL account names for edit modal dropdown preloading
      const allAccountNamesList = await supabaseDB.getDistinctAccountNames();
      const allAccountNamesData = allAccountNamesList.map(name => ({
        value: name?.trim() || '',
        label: name?.trim() || '',
      })).filter(item => item.value && item.label);
      setAllAccountNames(allAccountNamesData);
      
      // Load ALL sub account names for edit modal dropdown preloading
      const allSubAccountNamesList = await supabaseDB.getDistinctSubAccountNames();
      const allSubAccountsData = allSubAccountNamesList.map(name => ({
        value: name?.trim() || '',
        label: name?.trim() || '',
      })).filter(item => item.value && item.label);
      setAllSubAccounts(allSubAccountsData);

      // Load payment modes
      if (!navigator.onLine) {
        console.log('📦 [offlineMasterData] Loading payment modes from IndexedDB cache...');
        const cachedModes = await getCachedMasterData(tableMode === 'itr' ? 'payment_modes_itr' : 'payment_modes', tableMode === 'itr' ? 'itr' : 'regular');
        if (cachedModes && cachedModes.length > 0) {
          setPaymentModeOptions(cachedModes);
        } else {
          setPaymentModeOptions([
            { value: 'Cash', label: 'Cash' },
            { value: 'Bank Transfer', label: 'Bank' },
            { value: 'Online', label: 'Double' }
          ]);
        }
      } else {
        const { data: amountsData, error: amountsError } = await supabase
          .from(getTableName('cash_book'))
          .select('payment_mode')
          .not('payment_mode', 'is', null);

        if (!amountsError && amountsData) {
          const uniquePaymentModes = [...new Set(
            amountsData
              .map(entry => entry.payment_mode)
              .filter(mode => mode && String(mode).trim() !== '')
              .map(mode => String(mode).trim())
          )];
          
          const standardPaymentModes = ['Cash', 'Bank Transfer', 'Online'];
          const allPaymentModes = [...new Set([...standardPaymentModes, ...uniquePaymentModes])];
          
          const getPaymentModeLabel = (mode: string): string => {
            if (mode === 'Online') return 'Double';
            if (mode === 'Bank Transfer') return 'Bank';
            return mode;
          };
          
          setPaymentModeOptions(allPaymentModes.map(mode => ({ value: mode, label: getPaymentModeLabel(mode) })));
        }
      }
      
      console.log('✅ All dropdown data loaded successfully');
    } catch (error) {
      console.error('❌ Error loading dropdown data:', error);
      toast.error('Failed to load dropdown data');
    }
  };

  // Filter options are derived client-side via useMemo, so no database helper functions are needed here.

  const loadEntries = async () => {
    // Offline, only entries that have not reached the server can be seen or fixed
    if (!supabaseDB.isOnline) {
      const waiting = await supabaseDB.getCashBookEntries(pageSize, 0);
      setEntries(waiting);
      setTotalEntries(waiting.length);
      setEntriesForSelectedDate([]);
      return waiting;
    }
    try {
      console.log('🔍 Loading entries from database...');
      console.log('🔍 Supabase URL:', import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '');
      console.log('🔍 Page size:', pageSize);

      // First, try direct Supabase query to check if RLS is blocking access
      const { data: directData, error: directError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .order('c_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, pageSize - 1);

      if (directError || !directData) {
        console.error('❌ Direct Supabase query failed:', directError);
        
        // Detect specific error types and provide helpful messages
        let errorMessage = 'Database access failed: ';
        if (directError?.message) {
          const errorMsg = directError.message.toLowerCase();
          
          // Network connectivity errors
          if (errorMsg.includes('failed to fetch') || errorMsg.includes('networkerror')) {
            errorMessage = 'Network Error: Cannot connect to database. ';
            errorMessage += 'Please check:\n';
            errorMessage += '1. Your internet connection\n';
            errorMessage += '2. Firewall/proxy settings\n';
            errorMessage += '3. Try refreshing the page (Ctrl+Shift+R)';
            toast.error(errorMessage, { duration: 6000 });
            
            // Also log helpful debugging info
            console.error('🌐 Network Error Details:', {
              error: directError.message,
              supabaseUrl: import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '',
              suggestion: 'Try: 1) Check internet 2) Clear browser cache 3) Check firewall',
            });
          }
          // RLS/permission errors
          else if (errorMsg.includes('permission') || errorMsg.includes('policy')) {
            errorMessage = 'Permission Error: RLS policies are blocking access. ';
            errorMessage += 'Please disable RLS in Supabase dashboard.';
            toast.error(errorMessage);
          }
          // Other errors
          else {
            errorMessage += directError.message;
            toast.error(errorMessage);
          }
        } else {
          toast.error(errorMessage + 'unknown error');
        }

        // Fallback: use database service to fetch all entries
        const fallback = await supabaseDB.getAllCashBookEntries();
        setEntries(fallback);
        setEntriesForSelectedDate([]);
        return fallback || [];
      }

      console.log(
        '✅ Direct Supabase query successful, found',
        directData?.length || 0,
        'entries'
      );

      // Load all entries for both ITR and regular modes
      const allEntries = await supabaseDB.mergeOfflineOperations('cash_book', await supabaseDB.getAllCashBookEntries());
      console.log('✅ All entries fetched:', allEntries.length);
      
      // Get total count for pagination info
      const { count } = await supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact', head: true });
      console.log('📊 Total entries in database:', count);
      
      // Store the total count
      const totalCount = count || 0;
      setTotalEntries(totalCount);

      // Store ALL entries without filtering - let filteredEntries memo handle filtering
      console.log(`📊 Storing all ${allEntries.length} entries (filtering will be applied by filteredEntries memo)`);
      setEntries(allEntries);
      
      // Keep selected date filter active and update its entries list
      if (selectedDateFilter) {
        const normalizedFilterDate = normalizeDate(selectedDateFilter);
        const entriesForDate = allEntries.filter(entry => {
          if (normalizedFilterDate) {
            return normalizeDate(entry.c_date) === normalizedFilterDate;
          }
          return false;
        });
        setEntriesForSelectedDate(entriesForDate);
      } else {
        setEntriesForSelectedDate([]);
      }
      return allEntries;
    } catch (error) {
      console.error('❌ Error loading entries:', error);
      
      // Provide more specific error messages
      if (error instanceof Error) {
        if (error.message.includes('fetch')) {
          toast.error('Network error: Unable to connect to database. Please check your internet connection.');
        } else if (error.message.includes('permission') || error.message.includes('policy')) {
          toast.error('Permission error: RLS policies are blocking access. Please contact administrator.');
        } else if (error.message.includes('timeout')) {
          toast.error('Timeout error: Database request timed out. Please try again.');
        } else {
          toast.error(`Failed to load entries: ${error.message}`);
        }
      } else {
        toast.error('Failed to load entries: Unknown error occurred');
      }
      
      setEntries([]);
      return [];
    }
  };

  const loadMoreEntries = useCallback(async (retryCount = 0) => {
    if (isLoadingMore || entries.length >= totalEntries) return;
    
    // Prevent infinite recursion - max 10 retries
    if (retryCount > 10) {
      console.log('🔄 Max retries reached, stopping...');
      toast.error('No more entries match your current filters');
      return;
    }
    
    try {
      setIsLoadingMore(true);
      
      // Calculate the actual offset based on unfiltered entries
      const currentPage = Math.floor(entries.length / pageSize);
      const offset = currentPage * pageSize;
      
      console.log(`🔄 Loading more entries - Page: ${currentPage + 1}, Offset: ${offset}, Retry: ${retryCount}`);
      
      const moreEntries = await supabaseDB.getCashBookEntries(pageSize, offset);
      console.log(`✅ Loaded ${moreEntries.length} more entries from database`);
      
      if (moreEntries.length === 0) {
        toast.success('No more entries to load');
        return;
      }
      
      // Apply filters EXCEPT date filter for load more to get diverse data
      let filteredEntries = moreEntries;
      
      // Apply search filter
      if (searchTerm) {
        filteredEntries = filteredEntries.filter(entry => matchSearchTerm(entry, searchTerm));
      }

      // SKIP date filter for load more to get data from different dates
      // if (filterDate) {
      //   filteredEntries = filteredEntries.filter(entry => entry.c_date === filterDate);
      // }

      // Apply status filter
      if (statusFilter) {
        switch (statusFilter) {
          case 'approved':
            filteredEntries = filteredEntries.filter(entry => entry.approved);
            break;
          case 'pending':
            filteredEntries = filteredEntries.filter(entry => !entry.approved);
            break;
          case 'locked':
            filteredEntries = filteredEntries.filter(() => false);
            break;
        }
      }

      // Apply new filters
      if (filterCompanyName) {
        filteredEntries = filteredEntries.filter(
          entry =>
            entry.company_name &&
            entry.company_name
              .toLowerCase()
              .includes(filterCompanyName.toLowerCase())
        );
      }
      if (filterAccountName) {
        filteredEntries = filteredEntries.filter(
          entry =>
            entry.acc_name &&
            entry.acc_name
              .toLowerCase()
              .includes(filterAccountName.toLowerCase())
        );
      }
      if (filterSubAccountName) {
        filteredEntries = filteredEntries.filter(
          entry =>
            entry.sub_acc_name &&
            entry.sub_acc_name
              .toLowerCase()
              .includes(filterSubAccountName.toLowerCase())
        );
      }
      if (filterParticulars) {
        filteredEntries = filteredEntries.filter(
          entry =>
            entry.particulars &&
            entry.particulars
              .toLowerCase()
              .includes(filterParticulars.toLowerCase())
        );
      }
      if (filterSaleQ) {
        filteredEntries = filteredEntries.filter(
          entry => String(entry.sale_qty || '') === filterSaleQ
        );
      }
      if (filterPurchaseQ) {
        filteredEntries = filteredEntries.filter(
          entry => String(entry.purchase_qty || '') === filterPurchaseQ
        );
      }
      
      console.log(`📊 After filtering (excluding date): ${filteredEntries.length} entries (from ${moreEntries.length} loaded)`);
      
      setEntries(prev => [...prev, ...filteredEntries]);
      
      // If all entries were filtered out, try loading the next page automatically
      if (filteredEntries.length === 0 && moreEntries.length > 0 && entries.length < totalEntries) {
        console.log('🔄 All entries filtered out, trying next page...');
        // Recursively try the next page with retry count
        setTimeout(() => {
          loadMoreEntries(retryCount + 1);
        }, 100);
      } else if (filteredEntries.length > 0) {
        // Show more detailed success message
        const hasActiveFilters = searchTerm || statusFilter || filterCompanyName || 
                               filterAccountName || filterSubAccountName || filterParticulars || 
                               filterSaleQ || filterPurchaseQ;
        
        if (hasActiveFilters) {
          toast.success(`Loaded ${filteredEntries.length} more entries matching your filters (from ${moreEntries.length} total loaded) - Date filter ignored for diversity`);
        } else {
          toast.success(`Loaded ${filteredEntries.length} more entries from different dates`);
        }
      } else if (moreEntries.length === 0) {
        toast.success('No more entries to load');
      }
      
    } catch (error) {
      console.error('Error loading more entries:', error);
      toast.error('Failed to load more entries');
    } finally {
      setIsLoadingMore(false);
    }
  }, [entries.length, totalEntries, pageSize, isLoadingMore, searchTerm, statusFilter, filterCompanyName, filterAccountName, filterSubAccountName, filterParticulars, filterSaleQ, filterPurchaseQ]);

  const loadMoreUnfiltered = useCallback(async () => {
    if (isLoadingMore || entries.length >= totalEntries) return;
    
    try {
      setIsLoadingMore(true);
      
      // Calculate the actual offset based on unfiltered entries
      const currentPage = Math.floor(entries.length / pageSize);
      const offset = currentPage * pageSize;
      
      console.log(`🔄 Loading more unfiltered entries - Page: ${currentPage + 1}, Offset: ${offset}`);
      
      const moreEntries = await supabaseDB.getCashBookEntries(pageSize, offset);
      console.log(`✅ Loaded ${moreEntries.length} more entries from database`);
      
      if (moreEntries.length === 0) {
        toast.success('No more entries to load');
        return;
      }
      
      // Add entries without any filtering
      setEntries(prev => [...prev, ...moreEntries]);
      toast.success(`Loaded ${moreEntries.length} more entries (unfiltered)`);
      
    } catch (error) {
      console.error('Error loading more entries:', error);
      toast.error('Failed to load more entries');
    } finally {
      setIsLoadingMore(false);
    }
  }, [entries.length, totalEntries, pageSize, isLoadingMore]);






  // Debug function to test RLS and data access

  const handleEdit = async (entry: any) => {
    if (!isOnline && !entry.pending_sync) {
      askInternet('Editing a saved entry');
      return;
    }
    // TODO: Implement locked check when Supabase schema supports it
    setSelectedEntry({ ...entry });
    setEditMode(true);
    setEntriesForSelectedDate([]); // Clear multiple entries selection
    
    // Set filter values to match the selected entry to prevent useEffect from clearing data
    setFilterCompanyName(entry.company_name || '');
    setFilterAccountName(entry.acc_name || '');
    
    // Ensure all dropdowns have ALL options loaded
    // Load all account names if not already loaded
    if (allAccountNames.length === 0) {
      const allAccountNamesList = await supabaseDB.getDistinctAccountNames();
      console.log('🔄 Loading all account names for edit form:', allAccountNamesList.length);
      const allAccountNamesData = allAccountNamesList.map(name => ({
        value: name?.trim() || '',
        label: name?.trim() || '',
      })).filter(item => item.value && item.label);
      setAllAccountNames(allAccountNamesData);
      console.log('✅ All account names set for edit form:', allAccountNamesData.length);
    }
    
    // Load all sub accounts if not already loaded
    if (allSubAccounts.length === 0) {
      const allSubAccountNamesList = await supabaseDB.getDistinctSubAccountNames();
      console.log('🔄 Loading all sub account names for edit form:', allSubAccountNamesList.length);
      const allSubAccountsData = allSubAccountNamesList.map(name => ({
        value: name?.trim() || '',
        label: name?.trim() || '',
      })).filter(item => item.value && item.label);
      setAllSubAccounts(allSubAccountsData);
      console.log('✅ All sub account names set for edit form:', allSubAccountsData.length);
    }
    
    // Also ensure companies are loaded for edit form - ALWAYS reload to ensure fresh data
    console.log('🔄 Ensuring companies are loaded for edit form...');
    const allCompaniesList = await supabaseDB.getCompanies();
    const allCompaniesData = allCompaniesList.map(company => ({
      value: company.company_name?.trim() || '',
      label: company.company_name?.trim() || '',
    })).filter(item => item.value && item.label);
    if (allCompaniesData.length > 0) {
      setCompanies(allCompaniesData);
      console.log('✅ All companies loaded for edit form:', allCompaniesData.length);
      console.log('✅ Company names (first 10):', allCompaniesData.slice(0, 10).map(c => c.label));
    } else {
      console.error('❌ ERROR: No companies found when opening edit form!');
      toast.error('No companies found. Please check your database.');
    }
    
    // Load options based on selected entry's company/account
    if (entry.company_name) {
      const accNames = await supabaseDB.getDistinctAccountNamesByCompany(entry.company_name);
      setEditAccountOptions(accNames.map(name => ({ value: name, label: name })));
      
      if (entry.acc_name) {
        const subAccs = await supabaseDB.getSubAccountsByAccountAndCompany(entry.acc_name, entry.company_name);
        setEditSubAccountOptions(subAccs.map(name => ({ value: name, label: name })));
      } else {
        setEditSubAccountOptions([]);
      }
    } else {
      const allAccs = await supabaseDB.getDistinctAccountNames();
      setEditAccountOptions(allAccs.map(name => ({ value: name, label: name })));
      
      if (entry.acc_name) {
        const subAccs = await supabaseDB.getSubAccountsByAccountName(entry.acc_name);
        setEditSubAccountOptions(subAccs.map(name => ({ value: name, label: name })));
      } else {
        setEditSubAccountOptions([]);
      }
    }

  };

  const handleSave = async () => {
    if (!selectedEntry) return;

    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing is blocked.');
      return;
    }

    // Validate manual date input format and validity
    const datePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = editDateInput.match(datePattern);
    if (!match) {
      toast.error('Please enter a valid date in dd/MM/yyyy format');
      return;
    }

    const [, dd, mm, yyyy] = match;
    const year = parseInt(yyyy);
    const month = parseInt(mm) - 1;
    const day = parseInt(dd);
    const testDate = new Date(year, month, day);

    if (
      testDate.getFullYear() !== year ||
      testDate.getMonth() !== month ||
      testDate.getDate() !== day
    ) {
      toast.error('The date entered is invalid (e.g., check days in month or leap years)');
      return;
    }

    const isoDateStr = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

    if (!isOnline && !selectedEntry.pending_sync) {
      askInternet('Editing a saved entry');
      return;
    }

    setLoading(true);
    try {
      // Not on the server yet: the change is made here and goes with the entry at sync
      if (selectedEntry.pending_sync) {
        const fixed = await supabaseDB.updatePendingEntry(
          selectedEntry.id,
          { ...selectedEntry, c_date: isoDateStr },
          user?.username || 'admin'
        );
        if (fixed) {
          await loadEntries();
          setEditMode(false);
          setSelectedEntry(fixed);
          toast.success('Entry updated on this computer. It will go to the server when the internet is back.');
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        } else {
          toast.error('This entry has just been sent to the server. Please refresh and try again.');
          await loadEntries();
          setEditMode(false);
        }
        return;
      }

      // If the entry was approved or rejected, set it to pending on edit
      const updates = { ...selectedEntry, c_date: isoDateStr };
      if (
        selectedEntry.approved === 'true' ||
        selectedEntry.approved === 'false'
      ) {
        updates.approved = '';
      }
      const updatedEntry = await supabaseDB.updateCashBookEntry(
        selectedEntry.id,
        updates,
        user?.username || 'admin'
      );
      if (updatedEntry) {
        await loadEntries();
        setEditMode(false);
        setSelectedEntry(updatedEntry);
        toast.success('Entry updated successfully!');
        
        // Trigger dashboard refresh
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        toast.error('Failed to update entry');
      }
    } catch (error) {
      console.error('Error updating entry:', error);
      toast.error('Failed to update entry');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (entry: any) => {
    if (!canDelete) {
      toast.error('You do not have permission to delete entries');
      return;
    }

    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Deletion is blocked.');
      return;
    }

    if (!isOnline && !entry.pending_sync) {
      askInternet('Deleting a saved entry');
      return;
    }

    if (entry.pending_sync) {
      if (window.confirm('This entry has not reached the server yet. Remove it? It stays listed in Sync Center under Discarded.')) {
        const removed = await supabaseDB.discardPendingEntry(entry.id, user?.username || 'admin', 'Removed in Edit Entry before it reached the server');
        if (removed) {
          toast.success('Entry removed. It is listed in Sync Center under Discarded.');
          setEditMode(false);
          setSelectedEntry(null);
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        } else {
          toast.error('This entry has just been sent to the server. Please refresh and try again.');
        }
        await loadEntries();
      }
      return;
    }

    if (
      window.confirm(`Are you sure you want to permanently delete entry #${entry.sno}? This cannot be undone.`)
    ) {
      try {
        // Start delete immediately
        const success = await supabaseDB.deleteCashBookEntry(
          entry.id,
          user?.username || 'admin'
        );
        if (success) {
          // Optimistic UI: close editor and refresh in background
          setEditMode(false);
          const freshEntries = await loadEntries();
          
          if (selectedDateFilter) {
            const normalizedFilterDate = normalizeDate(selectedDateFilter);
            const entriesForDate = freshEntries.filter(e => {
              if (normalizedFilterDate) {
                return normalizeDate(e.c_date) === normalizedFilterDate;
              }
              return false;
            });
            if (entriesForDate.length > 0) {
              setSelectedEntry(entriesForDate[0]);
            } else {
              setSelectedEntry(null);
            }
          } else {
            setSelectedEntry(null);
          }
          
          toast.success('Entry deleted successfully!');
          
          // Trigger dashboard refresh
          localStorage.setItem('dashboard-refresh', Date.now().toString());
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        } else {
          toast.error('Entry NOT deleted - it could not be saved to Deleted Records. Please try again.');
          console.error('Delete operation returned false - check supabaseDatabase.ts logs');
        }
      } catch (error) {
        console.error('Error deleting entry:', error);
        toast.error(
          `Failed to delete entry: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  };

  const handleCancel = () => {
    setEditMode(false);
    setSelectedEntry(null);
    setEntriesForSelectedDate([]); // Clear multiple entries selection
    // Reset filter values
    setFilterCompanyName('');
    setFilterAccountName('');
  };

  const handleInputChange = async (field: string, value: any) => {
    setSelectedEntry((prev: any) => {
      const updated = { ...prev, [field]: value };
      
      // Reset child dropdown values when parent changes in the edit form
      if (field === 'company_name') {
        updated.acc_name = '';
        updated.sub_acc_name = '';
      } else if (field === 'acc_name') {
        updated.sub_acc_name = '';
      }
      
      return updated;
    });

    // Load dependent dropdowns & reset child options when parent changes in the edit form
    if (field === 'company_name') {
      setEditSubAccountOptions([]);
      
      if (value) {
        const accNames = await supabaseDB.getDistinctAccountNamesByCompany(value);
        setEditAccountOptions(accNames.map(name => ({ value: name, label: name })));
      } else {
        const allAccs = await supabaseDB.getDistinctAccountNames();
        setEditAccountOptions(allAccs.map(name => ({ value: name, label: name })));
      }
    }
    
    if (field === 'acc_name') {
      if (value) {
        const currentCompany = selectedEntry?.company_name || '';
        if (currentCompany) {
          const subAccs = await supabaseDB.getSubAccountsByAccountAndCompany(value, currentCompany);
          setEditSubAccountOptions(subAccs.map(name => ({ value: name, label: name })));
        } else {
          const subAccs = await supabaseDB.getSubAccountsByAccountName(value);
          setEditSubAccountOptions(subAccs.map(name => ({ value: name, label: name })));
        }
      } else {
        setEditSubAccountOptions([]);
      }
    }

  };

  // Get dates that have entries - Enhanced with better error handling

  // Local calendar component removed to use the imported global CustomCalendar component




  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE':
        return 'text-green-600 bg-green-100';
      case 'UPDATE':
        return 'text-blue-600 bg-blue-100';
      case 'DELETE':
        return 'text-red-600 bg-red-100';
      case 'LOCK':
        return 'text-orange-600 bg-orange-100';
      case 'UNLOCK':
        return 'text-yellow-600 bg-yellow-100';
      case 'APPROVE':
        return 'text-purple-600 bg-purple-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'approved', label: 'Approved' },
    { value: 'pending', label: 'Pending' },
  ];

  // Print voucher for an entry
  function printVoucher(entry: any) {
    try {
      console.log('Printing voucher for entry:', entry);
      
      if (!entry) {
        toast.error('No entry selected for voucher');
        return;
      }

      const printWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
      
      if (!printWindow) {
        toast.error('Unable to open print window. Please check your popup blocker settings.');
        return;
      }

      const isCredit = Number(entry.credit || 0) > 0;
      const amountValue = isCredit ? Number(entry.credit || 0) : Number(entry.debit || 0);
      const amountLabel = isCredit ? 'CREDIT' : 'DEBIT';
      const saleQty = Number(entry.sale_qty || 0);
      const purchaseQty = Number(entry.purchase_qty || 0);

      const voucherContent = `
        <html>
        <head>
          <title>Voucher - Thirumala Group</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-transform: uppercase;
              margin: 40px; 
              line-height: 1.6;
            }
            .voucher-header { 
              text-align: center; 
              margin-bottom: 32px; 
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 20px;
            }
            .voucher-title { 
              font-size: 2rem; 
              font-weight: bold; 
              color: #2d3748; 
              margin-bottom: 8px;
            }
            .voucher-subtitle {
              font-size: 1.2rem; 
              color: #4b5563;
            }
            .amount-box {
              margin: 18px 0 24px 0;
              border: 2px solid ${isCredit ? '#10b981' : '#ef4444'};
              background: ${isCredit ? '#ecfdf5' : '#fef2f2'};
              padding: 12px 16px;
              border-radius: 8px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .amount-label { font-weight: 700; color: ${isCredit ? '#065f46' : '#7f1d1d'}; }
            .amount-value { font-size: 1.4rem; font-weight: 800; color: ${isCredit ? '#065f46' : '#7f1d1d'}; }
            .voucher-section { 
              margin-bottom: 16px; 
              display: flex;
              align-items: flex-start;
            }
            .voucher-label { 
              font-weight: bold; 
              color: #374151; 
              min-width: 140px; 
              display: inline-block;
            }
            .voucher-value { 
              color: #1a202c; 
              flex: 1;
            }
            .voucher-footer {
              margin-top: 40px;
              text-align: center;
              font-size: 0.9rem;
              color: #6b7280;
            }
            @media print {
              @page {
                size: portrait;
                margin: 8mm;
              }
              body { margin: 20px; }
              .voucher-section { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="voucher-header">
            <div class="voucher-title">Thirumala Group</div>
            <div class="voucher-subtitle">Voucher</div>
          </div>
          
          <div class="voucher-section">
            <span class="voucher-label">Voucher No:</span>
            <span class="voucher-value">${entry.sno || 'N/A'}</span>
          </div>
          <div class="voucher-section">
            <span class="voucher-label">Date:</span>
            <span class="voucher-value">${entry.c_date ? new Date(entry.c_date).toLocaleDateString('en-IN') : 'N/A'}</span>
          </div>
          
          <div class="voucher-section">
            <span class="voucher-label">Company:</span>
            <span class="voucher-value">${entry.company_name || 'N/A'}</span>
          </div>
          
          <div class="voucher-section">
            <span class="voucher-label">Main Account:</span>
            <span class="voucher-value">${entry.acc_name || 'N/A'}</span>
          </div>
          
          <div class="voucher-section">
            <span class="voucher-label">Sub Account:</span>
            <span class="voucher-value">${entry.sub_acc_name || '-'}</span>
          </div>
          
          <div class="voucher-section">
            <span class="voucher-label">Particulars:</span>
            <span class="voucher-value">${entry.particulars || 'N/A'}</span>
          </div>
          
          <div class="amount-box">
            <div class="amount-label">${amountLabel}</div>
            <div class="amount-value">${amountValue.toLocaleString('en-IN')}</div>
          </div>
          
          ${saleQty > 0 ? `<div class="voucher-section"><span class="voucher-label">Sale Quantity:</span><span class="voucher-value">${saleQty}</span></div>` : ''}
          ${purchaseQty > 0 ? `<div class="voucher-section"><span class="voucher-label">Purchase Quantity:</span><span class="voucher-value">${purchaseQty}</span></div>` : ''}
          
          <div class="voucher-section">
            <span class="voucher-label">Payment Mode:</span>
            <span class="voucher-value">${entry.payment_mode === 'Online' ? 'Double' : entry.payment_mode === 'Bank Transfer' ? 'Bank' : (entry.payment_mode || 'Cash')}</span>
          </div>
          
          <div class="voucher-footer">
            <p>Generated on: ${new Date().toLocaleString('en-IN')}</p>
          </div>
        </body>
        </html>
      `;

      printWindow.document.write(voucherContent);
      printWindow.document.close();
      
      // Wait for content to load before printing
      printWindow.onload = function() {
        printWindow.focus();
        printWindow.print();
      };
      
      // Fallback if onload doesn't fire
      setTimeout(() => {
        if (printWindow && !printWindow.closed) {
          printWindow.focus();
          printWindow.print();
        }
      }, 1000);
      
    } catch (error) {
      console.error('Error printing voucher:', error);
      toast.error('Failed to print voucher. Please try again.');
    }
  }

  return (
    <div className='min-h-screen flex flex-col w-full max-w-full'>
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm mb-4 flex items-center gap-3 no-print">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 animate-pulse" />
          <div>
            <h3 className="text-sm font-bold text-red-800">This Book Is Locked (Read Only)</h3>
            <p className="text-xs text-red-700">Writing, editing, and deletion operations are disabled for this accounting period.</p>
          </div>
        </div>
      )}

      <div className='flex items-center justify-between'>
        <div>
          <div className='flex items-center gap-3'>
            <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2'>
              Edit Form
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                currentBook?.is_locked 
                  ? 'bg-red-100 text-red-700' 
                  : tableMode === 'itr' 
                    ? 'bg-emerald-100 text-emerald-700' 
                    : 'bg-blue-100 text-blue-700'
              }`}>
                {currentBook?.book_code || 'No Book'}
              </span>
              {!isOnline && (
                <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5 rounded-full animate-pulse flex items-center gap-1">
                  📦 Using Offline Cache
                </span>
              )}
            </h1>
            <ModeLabel />
          </div>
          {!isOnline && (
            <p className='text-amber-800 font-semibold'>
              Offline: only entries that have not reached the server are shown, and those can be fixed here. Saved entries need internet.
            </p>
          )}
          <p className='text-gray-600'>
            , edit, and manage cash book entries with complete history tracking
          </p>
        </div>
        <div className='flex items-center gap-3'>
          {isOnline && (
            <Button
              variant='secondary'
              onClick={handleManualCacheRefresh}
              className='bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-800 font-bold'
              icon={Download}
              disabled={isCacheSyncing}
            >
              {isCacheSyncing ? 'Caching...' : 'Cache Offline Data'}
            </Button>
          )}
          <Button
            variant='secondary'
            onClick={async () => {
              await loadEntries();
              toast.success('Data refreshed!');
            }}
          >
            Refresh
          </Button>
        </div>
      </div>


      {/* Search and Filter */}
      <Card className='bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 p-6 mb-6'>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 w-full'>
          {/* Date - First (dd/MM/yyyy with calendar + typing) */}
          <div className='col-span-1 relative'>
            <label className='block text-xs font-medium text-gray-700 mb-1'>Date</label>
            <div className='relative'>
              <input
                type='text'
                value={filterDateInput}
                onChange={e => {
                  const v = e.target.value;
                  setFilterDateInput(v);
                  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                  if (m) {
                    const [, dd, mm, yyyy] = m;
                    setFilterDate(`${yyyy}-${mm}-${dd}`);
                  }
                }}
                className='w-full px-3 py-2 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
                placeholder='dd/MM/yyyy'
              />
              <button
                type='button'
                onClick={() => setShowCalendar(!showCalendar)}
                className='absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded'
              >
                <Calendar className='w-4 h-4 text-gray-500' />
              </button>
            </div>
            {showCalendar && (
              <CustomCalendar
                dotColor="red"
                onDateSelect={(date) => {
                  setFilterDate(date);
                  setFilterDateInput(format(new Date(date), 'dd/MM/yyyy'));
                  setShowCalendar(false);
                }}
                selectedDate={filterDate}
                onClose={() => setShowCalendar(false)}
              />
            )}
          </div>
          {/* Company Name - Second */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Company Name'
              value={filterCompanyName}
              onChange={(value) => {
                setFilterCompanyName(value);
                setFilterAccountName('');
                setFilterSubAccountName('');
              }}
              options={filterCompanies}
              placeholder={filterCompanies.length === 0 ? 'Loading companies...' : 'Select company...'}
            />
          </div>
          
          {/* Account Name - Third */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Account Name'
              value={filterAccountName}
              onChange={(value) => {
                setFilterAccountName(value);
                setFilterSubAccountName('');
              }}
              options={filterAccountOptions}
              placeholder='Select account...'
            />
          </div>
          
          {/* Sub Account - Fourth */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Sub Account'
              value={filterSubAccountName}
              onChange={setFilterSubAccountName}
              options={filterSubAccountOptions}
              placeholder='Select sub account...'
            />
          </div>
          
          {/* Staff - Fifth */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Staff'
              value={filterStaff}
              onChange={setFilterStaff}
              options={filterStaffOptions}
              placeholder='Select staff...'
            />
          </div>
          
          {/* Particulars */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Particulars'
              value={filterParticulars}
              onChange={setFilterParticulars}
              options={particularsOptions}
              placeholder='Select particulars...'
            />
          </div>
          
          {/* Credit */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Credit'
              value={filterCredit}
              onChange={setFilterCredit}
              options={creditOptions}
              placeholder='Select credit amount'
            />
          </div>
          
          {/* Debit */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Debit'
              value={filterDebit}
              onChange={setFilterDebit}
              options={debitOptions}
              placeholder='Select debit amount'
            />
          </div>
          
          {/* Payment Mode */}
          <div className='col-span-1'>
            <SearchableSelect
              label='Payment Mode'
              value={filterPaymentMode}
              onChange={setFilterPaymentMode}
              options={paymentModeOptions}
              placeholder='Select mode...'
            />
          </div>

          {/* User */}
          <div className='col-span-1'>
            <SearchableSelect
              label='User'
              value={filterUser}
              onChange={setFilterUser}
              options={users}
              placeholder='Select user...'
            />
          </div>
          
          {/* Remaining fields */}
          <div className='col-span-1'>
            <Input
              label='Search'
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder='Search entries...'
            />
          </div>
          <div className='col-span-1'>
            <SearchableSelect
              label='Status Filter'
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusOptions}
            />
          </div>
          <div className='col-span-1 flex items-end'>
            <Button
              onClick={async () => {
                setSearchTerm('');
                setFilterDate('');
                setStatusFilter('');
                setFilterCompanyName('');
                setFilterAccountName('');
                setFilterSubAccountName('');
                setFilterParticulars('');
                setFilterSaleQ('');
                setFilterPurchaseQ('');
                setFilterCredit('');
                setFilterDebit('');
                setFilterStaff('');
                setFilterUser('');
                setFilterPaymentMode('');
                setFilterDate('');
                setSelectedDateFilter(''); // Clear calendar date filter
                setEntriesForSelectedDate([]); // Clear multiple entries selection
                // Reload all entries since filters are cleared
                await loadEntries();
              }}
              variant='secondary'
              className='w-full'
            >
              Clear Filters
            </Button>
          </div>
          <div className='col-span-1 flex items-end'>
            <div className='text-sm text-gray-600 bg-white px-3 py-2 rounded-lg border border-gray-300 w-full text-center'>
              <strong>{filteredEntries.length}</strong> entries found
              {selectedDateFilter && (
                <div className='text-xs text-blue-600 mt-1'>
                  Filtered by: {format(new Date(selectedDateFilter), 'dd/MM/yyyy')}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Action Buttons Row */}
        <div className='mt-4 flex gap-2'>
          <Button
            size='sm'
            variant='secondary'
            icon={RefreshCw}
            onClick={async () => {
              console.log('🔄 Refreshing all data...');
              setLoading(true);
              try {
                // Reload all entries
                await loadEntries();
                
                // Refresh all dropdown options
                await loadDropdownData();
                
                // Refresh all filter dropdown options
                const allAccountNamesList = await supabaseDB.getDistinctAccountNames();
                setAllAccountNames(allAccountNamesList.map(name => ({ value: name, label: name })));
                
                const allSubAccountNamesList = await supabaseDB.getDistinctSubAccountNames();
                setAllSubAccounts(allSubAccountNamesList.map(name => ({ value: name, label: name })));
                
                toast.success('All data refreshed successfully');
              } catch (error) {
                console.error('Error refreshing data:', error);
                toast.error('Failed to refresh data');
              } finally {
                setLoading(false);
              }
            }}
          >
            Refresh
          </Button>
        </div>
      </Card>

      {/* Entries List - Improved Card Layout */}
      <Card
        title='Cash Book Entries'
        subtitle={`Manage and edit your transaction records`}
        className='mb-6 w-full'
      >
        <div className='space-y-4 w-full'>
          {loading ? (
            // Loading skeleton
            <div className='space-y-4'>
              {[...Array(5)].map((_, i) => (
                <div key={i} className='border rounded-xl shadow-md px-4 py-3 bg-gray-50 animate-pulse'>
                  <div className='flex flex-wrap items-center gap-4'>
                    <div className='h-4 bg-gray-300 rounded w-16'></div>
                    <div className='h-4 bg-gray-300 rounded w-24'></div>
                    <div className='h-4 bg-gray-300 rounded w-32'></div>
                    <div className='h-4 bg-gray-300 rounded w-28'></div>
                    <div className='h-4 bg-gray-300 rounded w-36'></div>
                    <div className='h-4 bg-gray-300 rounded w-40'></div>
                    <div className='h-4 bg-gray-300 rounded w-20'></div>
                    <div className='h-4 bg-gray-300 rounded w-20'></div>
                    <div className='h-4 bg-gray-300 rounded w-24'></div>
                    <div className='h-4 bg-gray-300 rounded w-32'></div>
                    <div className='h-4 bg-gray-300 rounded w-24'></div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className='text-center py-8 text-gray-500'>
              No entries found matching your criteria.
            </div>
          ) : (
            <div className='w-full'>
              <table className='fit-table fit-dense'>
                <thead className='bg-gray-50 border-b border-gray-200'>
                  <tr>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      S.No
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700 whitespace-nowrap'>
                      Date
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      Company
                    </th>
                    
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      Account
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      Sub Account
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      Particulars
                    </th>
                    <th className='px-1 py-1 text-right font-medium text-gray-700'>
                      Purchase Qty
                    </th>
                    <th className='px-1 py-1 text-right font-medium text-gray-700'>
                      Sale Qty
                    </th>
                    <th className='px-1 py-1 text-right font-medium text-gray-700'>
                      Credit
                    </th>
                    <th className='px-1 py-1 text-right font-medium text-gray-700'>
                      Debit
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      Payment Mode
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      Staff
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      User
                    </th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>
                      Entry Date and Time
                    </th>
                    <th className='px-1 py-1 text-center font-medium text-gray-700'>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, index) => (
                    <tr
                      key={entry.id}
                      className={`border-b hover:bg-gray-50 transition-colors cursor-pointer ${
                        !entry.approved 
                          ? 'bg-orange-100' 
                          : index % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                      }`}
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <td className='px-1 py-1 font-medium text-sm font-bold'>{index + 1}</td>
                      <td className='px-1 py-1 text-sm font-bold fit-nowrap'>
                        {format(new Date(entry.c_date), 'dd/MM/yyyy')}
                        {entry.pending_sync && (
                          <div className='text-xs font-bold text-amber-700' title='Not on the server yet'>Pending</div>
                        )}
                      </td>
                      <td className='px-1 py-1 font-medium text-blue-600 text-sm font-bold fit-name' title={entry.company_name}>
                        {entry.company_name}
                      </td>
                      
                      <td className='px-1 py-1 text-sm font-bold' title={entry.acc_name}>{entry.acc_name}</td>
                      <td className='px-1 py-1 text-sm font-bold' title={entry.sub_acc_name}>{entry.sub_acc_name || '-'}</td>
                      <td
                        className='px-1 py-1 text-sm font-bold fit-particulars'
                        title={entry.particulars}
                      >
                        {entry.particulars}
                      </td>
                      {/* Purchase Qty column */}
                      <td className='px-1 py-1 text-right text-sm font-bold fit-nowrap'>
                        {entry.purchase_qty !== null && entry.purchase_qty !== undefined && entry.purchase_qty !== ''
                          ? `${Number(entry.purchase_qty).toLocaleString()}`
                          : '-'}
                      </td>
                      {/* Sale Qty column */}
                      <td className='px-1 py-1 text-right text-sm font-bold fit-nowrap'>
                        {entry.sale_qty !== null && entry.sale_qty !== undefined && entry.sale_qty !== ''
                          ? `${Number(entry.sale_qty).toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-1 py-1 text-right font-medium text-green-600 text-sm font-bold fit-nowrap'>
                        {entry.credit > 0
                          ? `${entry.credit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-1 py-1 text-right font-medium text-red-600 text-sm font-bold fit-nowrap'>
                        {entry.debit > 0
                          ? `${entry.debit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-1 py-1 text-sm font-bold' title={entry.payment_mode || 'No payment mode'}>
                        {entry.payment_mode && String(entry.payment_mode).trim() ? (entry.payment_mode === 'Online' ? 'Double' : entry.payment_mode === 'Bank Transfer' ? 'Bank' : String(entry.payment_mode).trim()) : '-'}
                      </td>
                      <td className='px-1 py-1 text-sm font-bold' title={entry.staff}>{entry.staff}</td>
                      <td className='px-1 py-1 text-sm font-bold' title={entry.users || 'No user'}>
                        {entry.users || '-'}
                      </td>
                      <td className='px-1 py-1 text-left'>
                        <div className='text-sm font-bold'>
                          {format(new Date(entry.c_date), 'dd/MM/yyyy')}
                        </div>
                        <div className='text-sm text-gray-500 font-bold'>
                          {entry.entry_time ? format(new Date(entry.entry_time), 'hh:mm:ss a') : 'N/A'}
                        </div>
                      </td>
                      <td className='px-1 py-1 text-center'>
                        <div className='flex gap-2 justify-center items-center' onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant='secondary'
                            onClick={() => printVoucher(entry)}
                            className='h-10 w-14 !rounded-xl flex items-center justify-center !p-0 shadow-sm transition-colors'
                            title='View Record'
                          >
                            <Eye className='w-5 h-5 text-gray-700' />
                          </Button>
                          <Button
                            onClick={() => handleEdit(entry)}
                            className='h-10 w-14 !rounded-xl flex items-center justify-center !p-0 shadow-sm transition-colors'
                            title='Edit Record'
                          >
                            <Edit className='w-5 h-5 text-white' />
                          </Button>
                          {canDelete && (
                            <Button
                              variant='danger'
                              onClick={() => handleDelete(entry)}
                              className='h-10 w-14 !rounded-xl flex items-center justify-center !p-0 shadow-sm transition-colors'
                              title='Delete Record'
                            >
                              <Trash2 className='w-5 h-5 text-white' />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            {/* Debug info */}
            <div className='text-xs text-gray-500 mb-2'>
              Debug: entries.length={entries.length}, totalEntries={totalEntries}, showButtons={entries.length < totalEntries}
              {filterCompanyName && <div>Company Filter: {filterCompanyName}</div>}
            </div>
            
            {/* Show filter status if any filters are active */}
            {(() => {
              const hasActiveFilters = searchTerm || filterDate || statusFilter || filterCompanyName || 
                                     filterAccountName || filterSubAccountName || filterParticulars || 
                                     filterSaleQ || filterPurchaseQ;
              
              if (hasActiveFilters) {
                return (
                  <div className='text-center py-2'>
                    <div className='text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-3 max-w-md mx-auto'>
                      <div className='text-sm font-medium text-blue-800 mb-1'>
                        Filters Active
                      </div>
                      <div className='text-xs text-blue-700'>
                        Showing {filteredEntries.length} filtered entries from {totalEntries} total
                      </div>
                    </div>
                  </div>
                );
              }
              
              return null;
            })()}
            
            {/* Show Load More button if we have more entries to load */}
            {entries.length < totalEntries && (
              <div className='flex flex-col gap-3 items-center'>
                <div className='flex gap-2'>
                  <Button
                    onClick={() => loadMoreEntries()}
                    disabled={isLoadingMore || isLoadingAll}
                    variant='secondary'
                    icon={isLoadingMore ? RefreshCw : Plus}
                    className='min-w-[200px]'
                  >
                    {isLoadingMore ? 'Loading...' : `Load More (${totalEntries - entries.length} remaining)`}
                  </Button>
                  
                  {/* Show unfiltered option when filters are active */}
                  {(() => {
                    const hasActiveFilters = searchTerm || filterDate || statusFilter || filterCompanyName || 
                                           filterAccountName || filterSubAccountName || filterParticulars || 
                                           filterSaleQ || filterPurchaseQ;
                    
                    if (hasActiveFilters) {
                      return (
                        <Button
                          onClick={loadMoreUnfiltered}
                          disabled={isLoadingMore || isLoadingAll}
                          variant='secondary'
                          icon={Plus}
                          className='min-w-[200px]'
                        >
                          Load More (Unfiltered)
                        </Button>
                      );
                    }
                    
                    return null;
                  })()}
                </div>
                
                {/* Show additional info when filters are active */}
                {(() => {
                  const hasActiveFilters = searchTerm || filterDate || statusFilter || filterCompanyName || 
                                         filterAccountName || filterSubAccountName || filterParticulars || 
                                         filterSaleQ || filterPurchaseQ;
                  
                  if (hasActiveFilters) {
                    return (
                      <div className='text-xs text-gray-500 text-center max-w-2xl'>
                        <div className='bg-blue-50 border border-blue-200 rounded-lg p-3'>
                          <div className='font-medium text-blue-800 mb-2'>💡 Filter Options:</div>
                          <div className='grid grid-cols-1 md:grid-cols-2 gap-2 text-left'>
                            <div>
                              <div className='font-medium text-blue-700'>Load More (Filtered):</div>
                              <div>• Loads 1000 records from database</div>
                              <div>• Applies your filters (except date) to find matches</div>
                              <div>• Shows entries from different dates for diversity</div>
                              <div>• Auto-retry if no matches found</div>
                            </div>
                            <div>
                              <div className='font-medium text-blue-700'>Load More (Unfiltered):</div>
                              <div>• Loads 1000 records from database</div>
                              <div>• Shows all records without filtering</div>
                              <div>• Gives you more diverse data</div>
                              <div>• You can then apply filters manually</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  return null;
                })()}
              </div>
            )}
            
            {/* Show message if all entries are loaded */}
            {totalEntries > 0 && entries.length >= totalEntries && (
              <div className='text-green-600 font-medium'>
                ✅ All {totalEntries} entries loaded successfully!
                {filterCompanyName && <div className='text-sm'>for {filterCompanyName}</div>}
              </div>
            )}
            
          </div>
          
          {/* Pagination Info */}
          {totalEntries > 0 && (
            <div className='text-center text-sm text-gray-600 py-2'>
              Showing {entries.length} of {totalEntries} entries
              {filterCompanyName && <div className='text-xs text-blue-600'>for {filterCompanyName}</div>}
            </div>
          )}
        </div>
      </Card>

      {/* History Modal */}
      {showHistory && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto'>
            <div className='p-6'>
              <div className='flex items-center justify-between mb-6'>
                <h3 className='text-lg font-semibold flex items-center gap-2'>
                  <History className='w-5 h-5' />
                  Entry History
                </h3>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={() => setShowHistory(false)}
                >
                  Close
                </Button>
              </div>

              <div className='space-y-4'>
                {entryHistory.length === 0 ? (
                  <div className='text-center py-8 text-gray-500'>
                    No history found for this entry.
                  </div>
                ) : (
                  entryHistory.map(history => (
                    <div
                      key={history.id}
                      className='border border-gray-200 rounded-lg p-4'
                    >
                      <div className='flex items-start justify-between mb-3'>
                        <div className='flex items-center gap-2'>
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(history.action)}`}
                          >
                            {history.action}
                          </span>
                          <span className='font-medium text-gray-900'>
                            by {history.editedBy}
                          </span>
                        </div>
                        <div className='text-sm text-gray-500'>
                          {history.editedAt
                            ? format(
                                new Date(history.editedAt),
                                'MMM dd, yyyy HH:mm:ss'
                              )
                            : 'Unknown time'}
                        </div>
                      </div>

                      {history.changes && history.changes.length > 0 && (
                        <div className='space-y-2'>
                          <h5 className='font-medium text-gray-700'>
                            Changes Made:
                          </h5>
                          {history.changes.map((change, index) => (
                            <div
                              key={index}
                              className='bg-gray-50 p-3 rounded text-sm'
                            >
                              <div className='font-medium text-gray-700 mb-1'>
                                {change.field}:
                              </div>
                              <div className='flex items-center gap-2'>
                                <span className='text-red-600 bg-red-100 px-2 py-1 rounded'>
                                  {String(change.oldValue)}
                                </span>
                                <span>→</span>
                                <span className='text-green-600 bg-green-100 px-2 py-1 rounded'>
                                  {String(change.newValue)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multiple Entries for Selected Date */}
      {entriesForSelectedDate.length > 1 && (
        <div className='mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg'>
          <h4 className='text-sm font-semibold text-blue-800 mb-2'>
            Multiple Entries for {selectedEntry?.c_date ? format(new Date(selectedEntry.c_date), 'dd/MM/yyyy') : 'Selected Date'}
          </h4>
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2'>
            {entriesForSelectedDate.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedEntry(entry)}
                className={`p-2 text-xs rounded border text-left transition-colors ${
                  selectedEntry?.id === entry.id
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-100'
                }`}
              >
                <div className='font-medium'>Entry #{entry.sno ?? 'Pending'}</div>
                <div className='text-gray-500'>{entry.company_name}</div>
                <div className='text-gray-500'>{entry.acc_name}</div>
                {entry.credit > 0 && <div className='text-green-600'>Credit: {entry.credit}</div>}
                {entry.debit > 0 && <div className='text-red-600'>Debit: {entry.debit}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Edit Modal - Fixed Layout with Proper Spacing */}
      {selectedEntry && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-6xl w-full max-h-[90vh] flex flex-col shadow-lg'>
            {/* Header */}
            <div className='p-6 border-b border-gray-200 flex-shrink-0'>
              <div className='flex items-center justify-between'>
                <h3 className='text-lg font-semibold'>
                  {editMode ? 'Edit Entry' : 'View Entry'} #{selectedEntry.sno ?? 'Pending'}
                </h3>
                <div className='flex items-center gap-2'>
                  {!editMode && (
                    <Button
                      size='sm'
                      icon={Edit}
                      onClick={() => setEditMode(true)}
                    >
                      Edit
                    </Button>
                  )}
                  <Button size='sm' variant='secondary' onClick={handleCancel}>
                    Close
                  </Button>
                </div>
              </div>
            </div>

            {/* Content - Scrollable */}
            <div className='flex-1 p-1 overflow-y-auto'>
              <div className='w-full max-w-7xl mx-auto'>
                <Card className='p-1 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 shadow-lg'>
                  <form ref={formRef} className='space-y-1 text-xs'>
                    {/* Basic Information - Reordered */}
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1'>
                      <div className="relative">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Date
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={editDateInput}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditDateInput(v);
                              const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                              if (m) {
                                const [, dd, mm, yyyy] = m;
                                const year = parseInt(yyyy);
                                const month = parseInt(mm) - 1;
                                const day = parseInt(dd);
                                const testDate = new Date(year, month, day);
                                if (
                                  testDate.getFullYear() === year &&
                                  testDate.getMonth() === month &&
                                  testDate.getDate() === day
                                ) {
                                  handleInputChange('c_date', `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
                                }
                              }
                            }}
                            readOnly={!editMode}
                            className={`w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold ${
                              !editMode ? 'bg-gray-100 cursor-not-allowed text-gray-500' : 'bg-white text-gray-900'
                            }`}
                            style={{ fontWeight: 'bold' }}
                            placeholder="dd/MM/yyyy"
                          />
                          <button
                            type="button"
                            onClick={() => setShowCalendar(!showCalendar)}
                            disabled={false}
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Calendar className="w-4 h-4 text-gray-500" />
                          </button>
                        </div>
                        {showCalendar && (
                          <CustomCalendar
                            dotColor="red"
                            onDateSelect={(date) => {
                              if (editMode) {
                                handleInputChange('c_date', date);
                                try {
                                  setEditDateInput(format(new Date(date), 'dd/MM/yyyy'));
                                } catch (e) {
                                  console.error(e);
                                }
                              } else {
                                // In view mode, filter entries by selected date
                                setSelectedDateFilter(date);
                                
                                const normalizedFilterDate = normalizeDate(date);
                                const entriesForDate = entries.filter(entry => {
                                  if (normalizedFilterDate) {
                                    const normalizedEntryDate = normalizeDate(entry.c_date);
                                    return normalizedEntryDate === normalizedFilterDate;
                                  }
                                  return false;
                                });
                                
                                setEntriesForSelectedDate(entriesForDate);
                                
                                if (entriesForDate.length > 0) {
                                  // Show the first entry for that date
                                  setSelectedEntry(entriesForDate[0]);
                                  toast.success(`Found ${entriesForDate.length} entries for ${format(new Date(date), 'dd/MM/yyyy')}. Showing filtered results.`);
                                } else {
                                  // No entries for this date, show a message
                                  toast(`No entries found for ${format(new Date(date), 'dd/MM/yyyy')}`);
                                }
                              }
                              setShowCalendar(false);
                            }}
                            selectedDate={selectedEntry?.c_date ? format(new Date(selectedEntry.c_date), 'yyyy-MM-dd') : ''}
                            onClose={() => setShowCalendar(false)}
                          />
                        )}
                      </div>
                      <SearchableSelect
                        label='Company Name'
                        value={selectedEntry?.company_name || ''}
                        onChange={value => editMode ? handleInputChange('company_name', value) : undefined}
                        options={companies}
                        disabled={!editMode}
                        placeholder={companies.length === 0 ? 'Loading companies...' : 'Select company...'}
                      />
                      <SearchableSelect
                        label='Main Account'
                        value={selectedEntry?.acc_name || ''}
                        onChange={value => editMode ? handleInputChange('acc_name', value) : undefined}
                        options={editAccountOptions}
                        disabled={!editMode}
                        placeholder='Select account...'
                      />
                      <SearchableSelect
                        label='Sub Account'
                        value={selectedEntry?.sub_acc_name || ''}
                        onChange={value => editMode ? handleInputChange('sub_acc_name', value) : undefined}
                        options={editSubAccountOptions}
                        disabled={!editMode || !selectedEntry?.acc_name}
                        placeholder='Select sub account...'
                      />
                      <SearchableSelect
                        label='Staff'
                        value={selectedEntry?.staff || ''}
                        onChange={value => editMode ? handleInputChange('staff', value) : undefined}
                        options={editStaffOptions}
                        disabled={!editMode}
                        placeholder='Select staff...'
                      />
                      <SearchableSelect
                        label='User'
                        value={selectedEntry?.users || ''}
                        onChange={value => editMode ? handleInputChange('users', value) : undefined}
                        options={users}
                        disabled={!editMode}
                        placeholder='Select user...'
                      />
                    </div>

                    {/* Payment Mode */}
                    <SearchableSelect
                      label='Payment Mode'
                      value={selectedEntry?.payment_mode || ''}
                      onChange={value => editMode ? handleInputChange('payment_mode', value) : undefined}
                      options={[
                        { value: '', label: 'Select payment mode...' },
                        ...paymentModeOptions
                      ]}
                      disabled={!editMode}
                      placeholder='Select payment mode...'
                    />

                    {/* Particulars */}
                    <Input
                      label='Particulars'
                      value={selectedEntry?.particulars || ''}
                      onChange={value => editMode ? handleInputChange('particulars', value) : undefined}
                      placeholder='Enter transaction details...'
                      disabled={!editMode}
                    />

                    {/* Amounts - Only one field should accept entry */}
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-1'>
                      <Input
                        label='Credit'
                        value={selectedEntry?.credit || ''}
                        onChange={val => {
                          if (editMode) {
                            const creditValue = Number((parseFloat(val) || 0).toFixed(2));
                            // If credit is entered, clear debit
                            if (creditValue > 0) {
                              handleInputChange('credit', creditValue);
                              handleInputChange('debit', 0);
                            } else {
                              handleInputChange('credit', creditValue);
                            }
                          }
                        }}
                        placeholder='Enter credit amount...'
                        disabled={!editMode}
                        className={
                          (selectedEntry?.credit || 0) > 0
                            ? 'border-green-300 bg-green-50'
                            : ''
                        }
                        type='number'
                        min='0'
                        step='any'
                      />
                      <Input
                        label='Debit'
                        value={selectedEntry?.debit || ''}
                        onChange={val => {
                          if (editMode) {
                            const debitValue = Number((parseFloat(val) || 0).toFixed(2));
                            // If debit is entered, clear credit
                            if (debitValue > 0) {
                              handleInputChange('debit', debitValue);
                              handleInputChange('credit', 0);
                            } else {
                              handleInputChange('debit', debitValue);
                            }
                          }
                        }}
                        placeholder='Enter debit amount...'
                        disabled={!editMode}
                        className={
                          (selectedEntry?.debit || 0) > 0 ? 'border-red-300 bg-red-50' : ''
                        }
                        type='number'
                        min='0'
                        step='any'
                      />
                    </div>

                    {/* Quantity Details */}
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-1'>
                      <Input
                        label='Sale Quantity'
                        type='number'
                        value={selectedEntry?.sale_qty || ''}
                        onChange={val => {
                          if (editMode) {
                            const saleQtyValue = Number((parseFloat(val) || 0).toFixed(2));
                            if (saleQtyValue > 0) {
                              handleInputChange('sale_qty', saleQtyValue);
                              handleInputChange('purchase_qty', 0);
                            } else {
                              handleInputChange('sale_qty', saleQtyValue);
                            }
                          }
                        }}
                        placeholder='Enter sale quantity...'
                        disabled={!editMode}
                        min='0'
                        step='0.01'
                      />
                      <Input
                        label='Purchase Quantity'
                        type='number'
                        value={selectedEntry?.purchase_qty || ''}
                        onChange={val => {
                          if (editMode) {
                            const purchaseQtyValue = Number((parseFloat(val) || 0).toFixed(2));
                            if (purchaseQtyValue > 0) {
                              handleInputChange('purchase_qty', purchaseQtyValue);
                              handleInputChange('sale_qty', 0);
                            } else {
                              handleInputChange('purchase_qty', purchaseQtyValue);
                            }
                          }
                        }}
                        placeholder='Enter purchase quantity...'
                        disabled={!editMode}
                        min='0'
                        step='0.01'
                      />
                    </div>
                  </form>
                </Card>

                {/* Entry Metadata */}
                <div className='bg-gray-50 p-4 rounded-lg mt-8'>
                <h4 className='font-medium text-gray-900 mb-3'>
                  Entry Information
                </h4>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4 text-sm'>
                  <div>
                    <span className='font-medium text-gray-700'>
                      Edit Count:
                    </span>
                    <div>{selectedEntry?.e_count || 0}</div>
                  </div>
                  <div>
                    <span className='font-medium text-gray-700'>
                      Created By:
                    </span>
                    <div>{selectedEntry?.users || 'N/A'}</div>
                  </div>
                </div>
                
                {/* Entry Time - Display like Daily Report Approved row */}
                <div className='mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg'>
                  <div className='text-sm font-medium text-blue-800 mb-2'>Entry Time</div>
                  <div className='flex items-center space-x-2'>
                    <span className='text-sm text-gray-600'>A/C</span>
                    <span className='text-sm font-medium text-green-600'>{selectedEntry?.users || 'Unknown User'}</span>
                  </div>
                  <div className='text-xs text-gray-500 mt-1'>
                    {selectedEntry?.entry_time ? format(
                      new Date(selectedEntry.entry_time),
                      'dd/MM/yyyy HH:mm'
                    ) : 'N/A'}
                  </div>
                </div>
                {selectedEntry?.edited && (
                  <div className='mt-2 text-sm'>
                    <span className='font-medium text-gray-700'>
                      Last Edited:
                    </span>
                    <div>
                      on{' '}
                      {format(
                        new Date(selectedEntry.updated_at),
                        'MMM dd, yyyy HH:mm'
                      )}
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>

            {/* Footer - Fixed at Bottom */}
            {editMode && (
              <div className='p-6 border-t border-gray-200 bg-white flex-shrink-0'>
                <div className='flex gap-4'>
                  <Button
                    onClick={handleSave}
                    disabled={!editMode || loading}
                  >
                    {loading ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button variant='secondary' onClick={handleCancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EditEntry;
