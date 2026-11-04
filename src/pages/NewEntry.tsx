import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFormArrowNavigation } from '../hooks/useFormArrowNavigation';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import SearchableSelect from '../components/UI/SearchableSelect';
import { supabaseDB, Account } from '../lib/supabaseDatabase';
import { supabase } from '../lib/supabase';
import { getTableName } from '../lib/tableNames';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import { useCreateCashBookEntry, useBulkCashBookOperations } from '../hooks/useCashBookData';
import ModeLabel from '../components/UI/ModeLabel';
import { useBook } from '../contexts/BookContext';
import CustomCalendar from '../components/UI/CustomCalendar';
import { useOffline } from '../contexts/OfflineContext';
import { fetchAndCacheMasterData } from '../lib/offlineMasterData';
import { useDropdownData, useRecentEntriesByDate } from '../hooks/useDashboardData';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import toast from 'react-hot-toast';
import { format, differenceInDays } from 'date-fns';
import { importFromFile } from '../utils/excel';
import { checkPaymentModeColumnExists, getAddColumnSQL } from '../utils/addPaymentModeColumn';
import {
  Upload,
  FileText,
  AlertCircle,
  Building,
  RefreshCw,
  Calendar,
  Database,
  Copy,
  ExternalLink,
  Download,
  ChevronDown,
  ChevronUp,
  Settings,
  Edit,
  Trash2,
} from 'lucide-react';

interface NewEntryForm {
  date: string;
  companyName: string;
  accountName: string;
  reportCategory?: string;
  subAccount: string;
  particulars: string;
  saleQ: string;
  purchaseQ: string;
  credit: string;
  debit: string;
  creditOnline: string;
  creditOffline: string;
  debitOnline: string;
  debitOffline: string;
  staff: string;
  paymentMode: string;
  quantityChecked: boolean;
}

const NewEntry: React.FC = () => {
  const { user } = useAuth();
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();
  const { isOnline } = useOffline();
  const [isCacheSyncing, setIsCacheSyncing] = useState(false);
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);

  // Enable arrow key navigation only in non-finance modes (Regular/ITR)
  useFormArrowNavigation(formRef, tableMode !== 'finance');

  const handleManualCacheRefresh = async () => {
    setIsCacheSyncing(true);
    try {
      await fetchAndCacheMasterData(tableMode === 'itr' ? 'itr' : 'regular');
      toast.success('Offline cache updated successfully!');
      queryClient.invalidateQueries({ queryKey: queryKeys.dropdowns.companies() });
      await loadUsersData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to refresh offline cache');
    } finally {
      setIsCacheSyncing(false);
    }
  };

  const [vehicleStats, setVehicleStats] = useState<{ expired: number; expiring: number } | null>(null);
  const [bgStats, setBgStats] = useState<{ expired: number; expiring: number } | null>(null);
  const [driverStats, setDriverStats] = useState<{ expired: number; expiring: number } | null>(null);

  useEffect(() => {
    const checkExpiries = async () => {
      try {
        const today = new Date();
        
        // Check Vehicles
        const vehiclesData = await supabaseDB.getVehicles();
        let expiredVCount = 0;
        let expiringVCount = 0;
        
        vehiclesData.forEach(vehicle => {
          const dates = [
            vehicle.tax_exp_date,
            vehicle.insurance_exp_date,
            vehicle.fitness_exp_date,
            vehicle.permit_exp_date,
          ];
          
          let hasExpired = false;
          let hasExpiring = false;
          
          dates.forEach(dStr => {
            if (dStr) {
              const expiry = new Date(dStr);
              const diffDays = differenceInDays(expiry, today);
              if (diffDays < 0) {
                hasExpired = true;
              } else if (diffDays <= 30) {
                hasExpiring = true;
              }
            }
          });
          
          if (hasExpired) {
            expiredVCount++;
          } else if (hasExpiring) {
            expiringVCount++;
          }
        });
        
        // Set vehicle stats
        if (expiredVCount > 0 || expiringVCount > 0) {
          setVehicleStats({ expired: expiredVCount, expiring: expiringVCount });
        } else {
          setVehicleStats(null);
        }
        
        // Check Bank Guarantees
        const bgData = await supabaseDB.getBankGuarantees();
        let expiredBGCount = 0;
        let expiringBGCount = 0;
        
        bgData.forEach(bg => {
          if (!bg.cancelled && bg.exp_date) {
            const expiry = new Date(bg.exp_date);
            const diffDays = differenceInDays(expiry, today);
            if (diffDays < 0) {
              expiredBGCount++;
            } else if (diffDays <= 30) {
              expiringBGCount++;
            }
          }
        });
        
        // Set bg stats
        if (expiredBGCount > 0 || expiringBGCount > 0) {
          setBgStats({ expired: expiredBGCount, expiring: expiringBGCount });
        } else {
          setBgStats(null);
        }

        // Check Drivers
        const driversData = await supabaseDB.getDrivers();
        let expiredDCount = 0;
        let expiringDCount = 0;
        
        driversData.forEach(driver => {
          if (driver.exp_date) {
            const expiry = new Date(driver.exp_date);
            const diffDays = differenceInDays(expiry, today);
            if (diffDays < 0) {
              expiredDCount++;
            } else if (diffDays <= 30) {
              expiringDCount++;
            }
          }
        });
        
        // Set driver stats
        if (expiredDCount > 0 || expiringDCount > 0) {
          setDriverStats({ expired: expiredDCount, expiring: expiringDCount });
        } else {
          setDriverStats(null);
        }
      } catch (error) {
        console.error('Error checking expiries for notifications:', error);
      }
    };
    
    checkExpiries();
  }, [tableMode]);
  
  // React Query hooks
  const createEntryMutation = useCreateCashBookEntry();
  const bulkOperationsMutation = useBulkCashBookOperations();
  const { companies } = useDropdownData();
  const queryClient = useQueryClient();

  const [sessionStaff, setSessionStaff] = useState('D');

  const [entry, setEntry] = useState<NewEntryForm>({
    date: format(new Date(), 'yyyy-MM-dd'),
    companyName: '',
    accountName: '',
    reportCategory: '',
    subAccount: '',
    particulars: '',
    saleQ: '',
    purchaseQ: '',
    credit: '',
    debit: '',
    creditOnline: '',
    creditOffline: '',
    debitOnline: '',
    debitOffline: '',
    staff: 'D',
    paymentMode: localStorage.getItem('lastSelectedPaymentMode') || '',
    quantityChecked: false,
  });

  const { data: recentEntries, isLoading: recentLoading } = useRecentEntriesByDate(entry.date);

  const totalCredit = React.useMemo(() => {
    return Array.isArray(recentEntries) ? recentEntries.reduce((sum, r) => sum + (Number(r.credit) || 0), 0) : 0;
  }, [recentEntries]);

  const totalDebit = React.useMemo(() => {
    return Array.isArray(recentEntries) ? recentEntries.reduce((sum, r) => sum + (Number(r.debit) || 0), 0) : 0;
  }, [recentEntries]);

  const netBalance = totalCredit - totalDebit;

  const [dualEntryEnabled, setDualEntryEnabled] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [mainDateInput, setMainDateInput] = useState('');
  const [dualDateInput, setDualDateInput] = useState('');
  const [showMainCalendar, setShowMainCalendar] = useState(false);

  // Refs to track manual edits of dual entry amounts
  const dualCreditManuallyEdited = useRef(false);
  const dualDebitManuallyEdited = useRef(false);
  const dualPurchaseQManuallyEdited = useRef(false);
  const dualSaleQManuallyEdited = useRef(false);

  const [dualEntry, setDualEntry] = useState<NewEntryForm>({
    date: format(new Date(), 'yyyy-MM-dd'),
    companyName: '',
    accountName: '',
    reportCategory: '',
    subAccount: '',
    particulars: '',
    saleQ: '',
    purchaseQ: '',
    credit: '',
    debit: '',
    creditOnline: '',
    creditOffline: '',
    debitOnline: '',
    debitOffline: '',
    staff: 'D',
    paymentMode: localStorage.getItem('lastSelectedPaymentMode') || '',
    quantityChecked: false,
  });

  // Convert React Query data to dropdown format
  const companiesOptions = companies?.data?.map(c => ({ value: c.company_name, label: c.company_name })) || [];
  // Load account options from cash_book distincts (same as Edit Entry)
  const [accountOptions, setAccountOptions] = useState<{ value: string; label: string }[]>([]);
  const [dualAccountOptions, setDualAccountOptions] = useState<{ value: string; label: string }[]>([]);
  const [companyAccounts, setCompanyAccounts] = useState<any[]>([]);
  const [dualCompanyAccounts, setDualCompanyAccounts] = useState<any[]>([]);
  const [subAccounts, setSubAccounts] = useState<
    { value: string; label: string }[]
  >([]);
  const [dualSubAccounts, setDualSubAccounts] = useState<
    { value: string; label: string }[]
  >([]);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentDailyEntryNo, setCurrentDailyEntryNo] = useState(0);
  const [totalEntryCount, setTotalEntryCount] = useState(0);
  // Recent entries are now managed by React Query

  // Modal states for creating new items
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showManageAccounts, setShowManageAccounts] = useState(false);
  // Which form the Add / Manage / Del buttons were pressed in: the main entry or the dual entry.
  const [actionTarget, setActionTarget] = useState<'main' | 'dual'>('main');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingAccountName, setEditingAccountName] = useState('');
  const [editingAccountCategory, setEditingAccountCategory] = useState<'BALANCE_SHEET' | 'PROFIT_LOSS'>('BALANCE_SHEET');
  const [showNewSubAccount, setShowNewSubAccount] = useState(false);
  const [showNewStaff, setShowNewStaff] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteType, setDeleteType] = useState<
    'company' | 'account' | 'subAccount' | 'staff'
  >('company');


  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyAddress, setNewCompanyAddress] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountReportCategory, setNewAccountReportCategory] = useState('BALANCE_SHEET');
  const [newSubAccountName, setNewSubAccountName] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');

  // Synchronize date between main entry and dual entry
  useEffect(() => {
    setDualEntry(prev => {
      if (prev.date !== entry.date) {
        return {
          ...prev,
          date: entry.date,
        };
      }
      return prev;
    });
  }, [entry.date]);

  // Sync flag to prevent infinite loops when syncing quantity details
  const syncingRef = useRef(false);

  // Synchronize quantityChecked between main entry and dual entry
  // When main entry quantityChecked changes, sync to dual entry
  useEffect(() => {
    if (!dualEntryEnabled || syncingRef.current) return;
    if (entry.quantityChecked !== dualEntry.quantityChecked) {
      syncingRef.current = true;
      setDualEntry(prev => ({
        ...prev,
        quantityChecked: entry.quantityChecked,
      }));
      setTimeout(() => { syncingRef.current = false; }, 0);
    }
  }, [entry.quantityChecked, dualEntryEnabled]);

  // When dual entry quantityChecked changes, sync to main entry
  useEffect(() => {
    if (!dualEntryEnabled || syncingRef.current) return;
    if (dualEntry.quantityChecked !== entry.quantityChecked) {
      syncingRef.current = true;
      setEntry(prev => ({
        ...prev,
        quantityChecked: dualEntry.quantityChecked,
      }));
      setTimeout(() => { syncingRef.current = false; }, 0);
    }
  }, [dualEntry.quantityChecked, dualEntryEnabled]);

  // Auto-fill dual entry quantities when dual entry is enabled or main quantities change
  useEffect(() => {
    if (!entry.saleQ) {
      dualSaleQManuallyEdited.current = false;
    }
    if (!entry.purchaseQ) {
      dualPurchaseQManuallyEdited.current = false;
    }

    if (!dualEntryEnabled) return;

    if (entry.saleQ) {
      if (!dualSaleQManuallyEdited.current) {
        setDualEntry(prev => ({
          ...prev,
          purchaseQ: entry.saleQ,
          saleQ: ''
        }));
      }
    } else if (entry.purchaseQ) {
      if (!dualPurchaseQManuallyEdited.current) {
        setDualEntry(prev => ({
          ...prev,
          saleQ: entry.purchaseQ,
          purchaseQ: ''
        }));
      }
    } else {
      setDualEntry(prev => ({
        ...prev,
        saleQ: '',
        purchaseQ: ''
      }));
    }
  }, [dualEntryEnabled, entry.saleQ, entry.purchaseQ]);

  // Auto-fill dual entry when dual entry is enabled or main amounts change
  useEffect(() => {
    if (!entry.credit) {
      dualDebitManuallyEdited.current = false;
    }
    if (!entry.debit) {
      dualCreditManuallyEdited.current = false;
    }

    if (!dualEntryEnabled) return;

    if (entry.credit) {
      if (!dualDebitManuallyEdited.current) {
        setDualEntry(prev => ({
          ...prev,
          debit: entry.credit,
          credit: ''
        }));
      }
    } else if (entry.debit) {
      if (!dualCreditManuallyEdited.current) {
        setDualEntry(prev => ({
          ...prev,
          credit: entry.debit,
          debit: ''
        }));
      }
    } else {
      setDualEntry(prev => ({
        ...prev,
        credit: '',
        debit: ''
      }));
    }
  }, [dualEntryEnabled, entry.credit, entry.debit]);


  // CSV Upload states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<any[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  // Upload progress is now handled by React Query mutations
  const [importProgress, setImportProgress] = useState({
    current: 0,
    total: 0,
    percentage: 0,
    successCount: 0,
    errorCount: 0,
    currentBatch: 0,
    totalBatches: 0,
  });
  const [importErrors, setImportErrors] = useState<string[]>([]);


  // Refs for form navigation
  const dateRef = useRef<HTMLInputElement>(null);
  const companyNameRef = useRef<HTMLInputElement>(null);
  const mainAccountRef = useRef<HTMLInputElement>(null);
  const subAccountRef = useRef<HTMLInputElement>(null);
  const particularsRef = useRef<HTMLInputElement>(null);
  const staffRef = useRef<HTMLInputElement>(null);
  const creditRef = useRef<HTMLInputElement>(null);
  const debitRef = useRef<HTMLInputElement>(null);
  const paymentModeRef = useRef<HTMLInputElement>(null);
  const quantityCheckedRef = useRef<HTMLInputElement>(null);
  const purchaseQRef = useRef<HTMLInputElement>(null);
  const saleQRef = useRef<HTMLInputElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);

  // Refs for dual entry form navigation
  const dualCompanyNameRef = useRef<HTMLInputElement>(null);
  const dualMainAccountRef = useRef<HTMLInputElement>(null);
  const dualSubAccountRef = useRef<HTMLInputElement>(null);
  const dualParticularsRef = useRef<HTMLInputElement>(null);
  const dualCreditRef = useRef<HTMLInputElement>(null);
  const dualDebitRef = useRef<HTMLInputElement>(null);
  const dualQuantityCheckedRef = useRef<HTMLInputElement>(null);
  const dualPurchaseQRef = useRef<HTMLInputElement>(null);
  const dualSaleQRef = useRef<HTMLInputElement>(null);

  // Function to handle Enter key navigation
  const handleKeyDown = (e: React.KeyboardEvent, nextRef: React.RefObject<HTMLElement> | null) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nextRef && nextRef.current) {
        nextRef.current.focus();
      }
    }
  };

  // State for payment_mode column check
  const [paymentModeColumnStatus, setPaymentModeColumnStatus] = useState<{
    exists: boolean;
    checking: boolean;
    sqlCommand: string;
  }>({
    exists: true, // Optimistic - assume it exists
    checking: false,
    sqlCommand: '',
  });

  // Check if payment_mode column exists on mount and mode changes
  useEffect(() => {
    const checkPaymentModeColumn = async () => {
      setPaymentModeColumnStatus(prev => ({ ...prev, checking: true }));
      try {
        const result = await checkPaymentModeColumnExists();
        setPaymentModeColumnStatus({
          exists: result.exists,
          checking: false,
          sqlCommand: result.exists ? '' : getAddColumnSQL(),
        });
        
        if (!result.exists) {
          console.error('❌ payment_mode column missing!', result.message);
          toast.error('⚠️ Payment mode column missing. Click "Add Column" button below.', {
            duration: 8000,
          });
        }
      } catch (error) {
        console.error('Error checking payment_mode column:', error);
        setPaymentModeColumnStatus(prev => ({ ...prev, checking: false }));
      }
    };
    
    checkPaymentModeColumn();
  }, [tableMode]);

  // Copy SQL to clipboard
  const copySQLToClipboard = () => {
    if (paymentModeColumnStatus.sqlCommand) {
      navigator.clipboard.writeText(paymentModeColumnStatus.sqlCommand);
      toast.success('SQL copied to clipboard! Paste it in Supabase SQL Editor.');
    }
  };

  // Open Supabase dashboard
  const openSupabaseDashboard = () => {
    window.open('https://supabase.com/dashboard', '_blank');
  };

  useEffect(() => {
    loadUsersData();
    updateDailyEntryNumber();
    updateTotalEntryCount();
  }, []);

  // Refresh staff dropdown when table mode changes
  useEffect(() => {
    loadUsersData();
  }, [tableMode]);

  // keep visible date inputs synced to ISO values
  useEffect(() => {
    try {
      setMainDateInput(entry.date ? format(new Date(entry.date), 'dd/MM/yyyy') : '');
    } catch (e) {
      console.error('Error formatting main date:', e);
    }
  }, [entry.date]);
  useEffect(() => {
    try {
      setDualDateInput(dualEntry.date ? format(new Date(dualEntry.date), 'dd/MM/yyyy') : '');
    } catch (e) {
      console.error('Error formatting dual date:', e);
    }
  }, [dualEntry.date]);

  useEffect(() => {
    updateDailyEntryNumber();
  }, [entry.date]);

  // Listen for dashboard refresh events (emitted after replacements, edits, etc.)
  // This ensures recent transactions and dropdowns update automatically when records are replaced
  useEffect(() => {
    const handleDashboardRefresh = () => {
      console.log('🔄 New Entry: Dashboard refresh event received, refreshing recent entries and dropdowns...');
      
      // Refetch recent entries for the current date to show updated data immediately
      // This ensures replaced records show with new company/account names without manual refresh
      queryClient.refetchQueries({ queryKey: ['recentEntries', entry.date] });
      queryClient.invalidateQueries({ queryKey: ['recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook'] });
      
      // Refetch companies dropdown to show updated company list after replacement
      // This ensures the company dropdown automatically updates when companies are replaced/deleted
      queryClient.invalidateQueries({ queryKey: queryKeys.dropdowns.companies() });
      queryClient.refetchQueries({ queryKey: queryKeys.dropdowns.companies() });
      
      // Also refetch accounts and sub accounts as they may have changed
      queryClient.invalidateQueries({ queryKey: ['dropdowns', 'accounts'] });
      queryClient.refetchQueries({ queryKey: ['dropdowns', 'accounts'] });
      queryClient.invalidateQueries({ queryKey: ['dropdowns', 'subAccounts'] });
      queryClient.refetchQueries({ queryKey: ['dropdowns', 'subAccounts'] });
      
      console.log('✅ New Entry: Recent entries and dropdowns refreshed automatically');
    };

    window.addEventListener('dashboard-refresh', handleDashboardRefresh);
    return () => window.removeEventListener('dashboard-refresh', handleDashboardRefresh);
  }, [entry.date, queryClient]);

  // Refresh recent entries when table mode changes
  useEffect(() => {
    if (entry.date) {
      console.log('🔄 Table mode changed, refreshing recent entries for date:', entry.date, 'Mode:', tableMode);
      queryClient.invalidateQueries({ queryKey: ['recentEntries'] });
      queryClient.refetchQueries({ queryKey: ['recentEntries'] });
    }
  }, [tableMode, entry.date, queryClient]);

  useEffect(() => {
    const loadAccounts = async () => {
      try {
        if (entry.companyName) {
          console.log(`🔍 [NEW ENTRY] Loading accounts for company: "${entry.companyName}" (Mode: ${tableMode})`);
          const [names, fullAccs] = await Promise.all([
            supabaseDB.getDistinctAccountNamesByCompany(entry.companyName),
            supabaseDB.getAccountsByCompany(entry.companyName)
          ]);
          console.log(`🔍 [NEW ENTRY] Found ${names.length} accounts for company "${entry.companyName}":`, names);
          setAccountOptions(names.map(name => ({ value: name, label: name })));
          setCompanyAccounts(fullAccs);
          setEntry(prev => ({ ...prev, accountName: '', reportCategory: '', subAccount: '' }));
          setSubAccounts([]);
        } else {
          console.log('🔍 [NEW ENTRY] No company selected, clearing account options');
          setAccountOptions([]);
          setCompanyAccounts([]);
        }
      } catch (error) {
        console.error('Error loading account names by company:', error);
        toast.error('Failed to load account names');
      }
    };
    loadAccounts();
  }, [entry.companyName, tableMode]);

  useEffect(() => {
    const loadDualAccounts = async () => {
      try {
        if (dualEntry.companyName) {
          console.log(`🔍 [DUAL ENTRY] Loading accounts for company: "${dualEntry.companyName}" (Mode: ${tableMode})`);
          const [names, fullAccs] = await Promise.all([
            supabaseDB.getDistinctAccountNamesByCompany(dualEntry.companyName),
            supabaseDB.getAccountsByCompany(dualEntry.companyName)
          ]);
          console.log(`🔍 [DUAL ENTRY] Found ${names.length} accounts for company "${dualEntry.companyName}":`, names);
          setDualAccountOptions(names.map(name => ({ value: name, label: name })));
          setDualCompanyAccounts(fullAccs);
          setDualEntry(prev => ({ ...prev, accountName: '', reportCategory: '', subAccount: '' }));
          setDualSubAccounts([]);
        } else {
          console.log('🔍 [DUAL ENTRY] No company selected, clearing account options');
          setDualAccountOptions([]);
          setDualCompanyAccounts([]);
        }
      } catch (error) {
        console.error('Error loading dual account names by company:', error);
        toast.error('Failed to load account names');
      }
    };
    loadDualAccounts();
  }, [dualEntry.companyName, tableMode]);

  useEffect(() => {
    const loadSubs = async () => {
      try {
        if (entry.companyName && entry.accountName) {
          console.log(`🔍 [NEW ENTRY] Loading sub-accounts for company: "${entry.companyName}" and account: "${entry.accountName}" (Mode: ${tableMode})`);
          const subs = await supabaseDB.getSubAccountsByAccountAndCompany(entry.accountName, entry.companyName);
          console.log(`🔍 [NEW ENTRY] Found ${subs.length} sub-accounts for account "${entry.accountName}":`, subs);
          const data = subs.map(name => ({ value: name, label: name }));
          setSubAccounts(data);
          setEntry(prev => ({ ...prev, subAccount: '' }));
        } else {
          console.log('🔍 [NEW ENTRY] No company or account selected, clearing sub-account options');
          setSubAccounts([]);
        }
      } catch (error) {
        console.error('Error loading sub accounts:', error);
        toast.error('Failed to load sub accounts');
      }
    };
    loadSubs();
  }, [entry.companyName, entry.accountName, tableMode]);

  useEffect(() => {
    const loadDualSubAccounts = async () => {
      try {
        if (dualEntry.companyName && dualEntry.accountName) {
          console.log(`🔍 [DUAL ENTRY] Loading sub-accounts for company: "${dualEntry.companyName}" and account: "${dualEntry.accountName}" (Mode: ${tableMode})`);
          const subs = await supabaseDB.getSubAccountsByAccountAndCompany(
            dualEntry.accountName,
            dualEntry.companyName
          );
          console.log(`🔍 [DUAL ENTRY] Found ${subs.length} sub-accounts for account "${dualEntry.accountName}":`, subs);
          const data = subs.map(name => ({ value: name, label: name }));
          setDualSubAccounts(data);
          setDualEntry(prev => ({ ...prev, subAccount: '' }));
        } else {
          console.log('🔍 [DUAL ENTRY] No company or account selected, clearing sub-account options');
          setDualSubAccounts([]);
        }
      } catch (error) {
        console.error('Error loading dual sub accounts:', error);
        toast.error('Failed to load sub accounts');
      }
    };
    loadDualSubAccounts();
  }, [dualEntry.companyName, dualEntry.accountName, tableMode]);

  useEffect(() => {
    // Recent entries are now managed by React Query
    const fetchRecentEntries = async () => {
      // This function is no longer needed as recent entries are handled by React Query
      console.log('Recent entries are now managed by React Query');
    };
    fetchRecentEntries();
  }, []);

  const updateDailyEntryNumber = async () => {
    try {
      // Get today's entries count for daily entry number
      const todayEntries = await supabaseDB.getCashBookEntries();
      const todayCount = todayEntries.filter(
        dbEntry => dbEntry.c_date === entry.date
      ).length;
      setCurrentDailyEntryNo(todayCount);
    } catch (error) {
      console.error('Error updating daily entry number:', error);
      setCurrentDailyEntryNo(0);
    }
  };

  const updateTotalEntryCount = async () => {
    try {
      const totalCount = await supabaseDB.getCashBookEntriesCount();
      setTotalEntryCount(totalCount);
    } catch (error) {
      console.error('Error updating total entry count:', error);
      setTotalEntryCount(0);
    }
  };

  // Load staff names from existing entries (decoupled from User Management)
  const loadUsersData = async () => {
    try {
      const staffOptions = await supabaseDB.getDistinctStaffNames();
      console.log('👥 Staff options loaded:', staffOptions.length);
      setUsers(staffOptions);
    } catch (error) {
      console.error('❌ Error loading users data:', error);
      toast.error('Failed to load staff list.');
    }
  };

  // (Replaced by cash_book-based loaders above)

  // (Replaced by cash_book-based loaders above)

  const handleInputChange = (
    field: keyof NewEntryForm,
    value: string | number
  ) => {
    setEntry(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing is blocked.');
      return;
    }

    // Validate main entry (all mandatory except credit/debit where either is required)
    if (
      !entry.date ||
      !entry.companyName ||
      !entry.accountName ||
      !entry.subAccount ||
      !entry.particulars ||
      !entry.staff ||
      !entry.paymentMode
    ) {
      toast.error('Please fill in all required fields');
      return;
    }
    const mainCredit = parseFloat(entry.credit) || 0;
    const mainDebit = parseFloat(entry.debit) || 0;
    if (mainCredit === 0 && mainDebit === 0) {
      toast.error('Please enter either credit or debit amount in main entry');
      return;
    }
    if (mainCredit > 0 && mainDebit > 0) {
      toast.error('You can enter only Credit OR Debit amount in Main Entry, not both.');
      return;
    }

    // Validate quantity details in main entry
    if (entry.quantityChecked) {
      const saleQty = parseFloat(entry.saleQ) || 0;
      const purchaseQty = parseFloat(entry.purchaseQ) || 0;
      if (saleQty > 0 && purchaseQty > 0) {
        toast.error('You can enter only Purchase OR Sale Quantity, not both.');
        return;
      }
    }
    
    // Save selected staff to sessionState
    if (entry.staff) {
      setSessionStaff(entry.staff);
    }
    // Save selected payment mode to localStorage
    if (entry.paymentMode) {
      localStorage.setItem('lastSelectedPaymentMode', entry.paymentMode);
    }

    // If dual entry enabled, validate dual entry
    let dualCredit = 0,
      dualDebit = 0;
    if (dualEntryEnabled) {
      if (
        !dualEntry.date ||
        !dualEntry.companyName ||
        !dualEntry.accountName ||
        !dualEntry.subAccount ||
        !dualEntry.particulars
      ) {
        toast.error('Please fill in all required fields in Dual Entry');
        return;
      }
      dualCredit = parseFloat(dualEntry.credit) || 0;
      dualDebit = parseFloat(dualEntry.debit) || 0;
      if (dualCredit === 0 && dualDebit === 0) {
        toast.error('Please enter either credit or debit amount in Dual Entry');
        return;
      }

      // Validate opposite side only
      if (mainCredit > 0 && dualCredit > 0) {
        toast.error('Dual Entry amount must be on the opposite side (Debit) of Main Entry.');
        return;
      }
      if (mainDebit > 0 && dualDebit > 0) {
        toast.error('Dual Entry amount must be on the opposite side (Credit) of Main Entry.');
        return;
      }
      if (mainCredit > 0 && dualDebit === 0) {
        toast.error('Dual Entry must have a Debit amount since Main Entry is Credit.');
        return;
      }
      if (mainDebit > 0 && dualCredit === 0) {
        toast.error('Dual Entry must have a Credit amount since Main Entry is Debit.');
        return;
      }

      // Validate quantity details in dual entry
      if (dualEntry.quantityChecked) {
        const dualSaleQty = parseFloat(dualEntry.saleQ) || 0;
        const dualPurchaseQty = parseFloat(dualEntry.purchaseQ) || 0;
        if (dualSaleQty > 0 && dualPurchaseQty > 0) {
          toast.error('You can enter only Purchase OR Sale Quantity in Dual Entry, not both.');
          return;
        }
      }
    }
    setLoading(true);
    try {
      // Prepare main entry data
      const mainCreditNum = parseFloat(entry.credit) || 0;
      const mainDebitNum = parseFloat(entry.debit) || 0;
      
      // Prepare payment_mode value - trim if exists, otherwise null
      const paymentModeValue = entry.paymentMode && entry.paymentMode.trim() 
        ? entry.paymentMode.trim() 
        : null;
      
      console.log('💾 Saving entry with payment_mode:', {
        input: entry.paymentMode,
        processed: paymentModeValue,
        company: entry.companyName,
        account: entry.accountName
      });

      const matchedAcc = companyAccounts.find(acc => acc.acc_name === entry.accountName);
      const headOfAccountId = matchedAcc ? matchedAcc.id : null;
      // Balance Sheet / Profit & Loss comes from the account (set via Add / Manage under Main Account)
      const reportCategory = matchedAcc?.report_category || entry.reportCategory || null;
      
      const mainEntryData = {
        acc_name: entry.accountName,
        sub_acc_name: entry.subAccount,
        particulars: entry.particulars,
        c_date: entry.date,
        credit: mainCreditNum,
        debit: mainDebitNum,
        credit_online: 0,
        credit_offline: 0,
        debit_online: 0,
        debit_offline: 0,
        company_name: entry.companyName,
        address: '',
        staff: entry.staff,
        users: user?.username || '',
        payment_mode: paymentModeValue, // Save payment_mode value or null if empty
        sale_qty: entry.quantityChecked ? parseFloat(entry.saleQ) || 0 : 0,
        purchase_qty: entry.quantityChecked
          ? parseFloat(entry.purchaseQ) || 0
          : 0,
        cb: 'CB',
        report_category: reportCategory,
        head_of_account_id: headOfAccountId,
      };

      // If dual entry, prepare both entries for bulk operation
      if (dualEntryEnabled) {
        const dualCreditNum = parseFloat(dualEntry.credit) || 0;
        const dualDebitNum = parseFloat(dualEntry.debit) || 0;
        const dualMatchedAcc = dualCompanyAccounts.find(acc => acc.acc_name === dualEntry.accountName);
        const dualHeadOfAccountId = dualMatchedAcc ? dualMatchedAcc.id : null;
        const dualReportCategory = dualMatchedAcc?.report_category || dualEntry.reportCategory || null;
        
        // Payment mode removed from dual entry per user request
        const dualEntryData = {
          acc_name: dualEntry.accountName,
          sub_acc_name: dualEntry.subAccount,
          particulars: dualEntry.particulars,
          c_date: dualEntry.date,
          credit: dualCreditNum,
          debit: dualDebitNum,
          credit_online: 0,
          credit_offline: 0,
          debit_online: 0,
          debit_offline: 0,
          company_name: dualEntry.companyName,
          address: '',
          staff: entry.staff,
          users: user?.username || '',
          payment_mode: null, // Payment mode removed from dual entry
          sale_qty: dualEntry.quantityChecked
            ? parseFloat(dualEntry.saleQ) || 0
            : 0,
          purchase_qty: dualEntry.quantityChecked
            ? parseFloat(dualEntry.purchaseQ) || 0
            : 0,
          cb: 'CB',
          report_category: dualReportCategory,
          head_of_account_id: dualHeadOfAccountId,
        };

        // Use bulk operations for dual entries
        const savedEntries = await bulkOperationsMutation.mutateAsync([mainEntryData, dualEntryData]);
        
        // Debug: Verify payment_mode was saved for dual entries
        if (savedEntries && savedEntries.length > 0) {
          savedEntries.forEach((savedEntry: any, idx: number) => {
            console.log(`✅ Dual Entry ${idx + 1} saved, checking payment_mode:`, {
              saved_entry_id: savedEntry?.id,
              payment_mode_saved: savedEntry?.payment_mode,
              payment_mode_input: idx === 0 ? paymentModeValue : null // Dual entry has no payment mode
            });
          });
          
          // Show warning if payment_mode wasn't saved (only for main entry)
          const hasPaymentMode = savedEntries.some((e: any) => e?.payment_mode);
          if (paymentModeValue && !hasPaymentMode) {
            toast.error('⚠️ Payment mode column missing in database. Please add it using SQL: ALTER TABLE cash_book ADD COLUMN payment_mode TEXT;');
          }
        }
        
        // Explicitly refetch recent entries for the current date to show payment_mode immediately
        await queryClient.refetchQueries({ queryKey: ['recentEntries', entry.date] });
        
        // Notify other pages (like Edit Entry) to refresh
        try {
          localStorage.setItem('dashboard-refresh', Date.now().toString());
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        } catch (e) {
          console.error('Error dispatching dashboard-refresh:', e);
        }
      } else {
        // Use single entry mutation
        const savedEntry = await createEntryMutation.mutateAsync(mainEntryData);
        
        // Debug: Verify payment_mode was saved
        console.log('✅ Entry saved, checking payment_mode:', {
          saved_entry_id: savedEntry?.id,
          payment_mode_saved: savedEntry?.payment_mode,
          payment_mode_input: paymentModeValue,
          payment_mode_match: savedEntry?.payment_mode === paymentModeValue
        });
        
        // Show user-friendly message if payment_mode wasn't saved
        if (paymentModeValue && !savedEntry?.payment_mode) {
          toast.error('⚠️ Payment mode column missing in database. Please add it using SQL: ALTER TABLE cash_book ADD COLUMN payment_mode TEXT;');
        }
        
        // Explicitly refetch recent entries for the current date to show payment_mode immediately
        await queryClient.refetchQueries({ queryKey: ['recentEntries', entry.date] });
        
        // Notify other pages (like Edit Entry) to refresh
        try {
          localStorage.setItem('dashboard-refresh', Date.now().toString());
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        } catch (e) {
          console.error('Error dispatching dashboard-refresh:', e);
        }
      }
      
      // Reset forms
      const currentDate = entry.date;
      const currentPaymentMode = entry.paymentMode || localStorage.getItem('lastSelectedPaymentMode') || '';
      setEntry({
        date: currentDate,
        companyName: '',
        accountName: '',
        subAccount: '',
        particulars: '',
        saleQ: '',
        purchaseQ: '',
        credit: '',
        debit: '',
        creditOnline: '',
        creditOffline: '',
        debitOnline: '',
        debitOffline: '',
        staff: sessionStaff, // Preserve the session staff selection
        paymentMode: currentPaymentMode, // Keep same Payment Mode
        quantityChecked: false,
      });
      // Accounts are now managed by React Query
      setSubAccounts([]);
      setDualEntry({
        date: currentDate,
        companyName: '',
        accountName: '',
        subAccount: '',
        particulars: '',
        saleQ: '',
        purchaseQ: '',
        credit: '',
        debit: '',
        creditOnline: '',
        creditOffline: '',
        debitOnline: '',
        debitOffline: '',
        staff: sessionStaff, // Preserve the session staff selection
        paymentMode: currentPaymentMode, // Keep same Payment Mode
        quantityChecked: false,
      });
      setDualEntryEnabled(false);
      dualCreditManuallyEdited.current = false;
      dualDebitManuallyEdited.current = false;
      dualPurchaseQManuallyEdited.current = false;
      dualSaleQManuallyEdited.current = false;
      
      // Focus back to main Date field
      setTimeout(() => {
        if (dateRef.current) {
          dateRef.current.focus();
          try {
            dateRef.current.select();
          } catch (err) {
            // Safe fallback
          }
        }
      }, 150);
      
      // Invalidate React Query cache to refresh recent entries
      console.log('🔄 Invalidating cache for date:', entry.date);
      queryClient.invalidateQueries({ queryKey: ['recentEntries', entry.date] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook'] });
      
      // Force refetch the recent entries for the current date
      console.log('🔄 Force refetching recent entries for date:', entry.date);
      queryClient.refetchQueries({ queryKey: ['recentEntries', entry.date] });
      
      updateDailyEntryNumber();
      await updateTotalEntryCount();
    } catch (error) {
      console.error('Error saving entry:', error);
      toast.error(
        `Failed to save entry: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoading(false);
    }
  };

  // Company / accounts of the form (main or dual) the user is working in.
  const targetEntry = actionTarget === 'dual' ? dualEntry : entry;
  const setTargetEntry = actionTarget === 'dual' ? setDualEntry : setEntry;
  const targetCompanyAccounts = actionTarget === 'dual' ? dualCompanyAccounts : companyAccounts;

  // Reload the account lists of every form showing this company (main and/or dual).
  const refreshAccountsForCompany = async (companyName: string) => {
    const [names, fullAccs] = await Promise.all([
      supabaseDB.getDistinctAccountNamesByCompany(companyName),
      supabaseDB.getAccountsByCompany(companyName)
    ]);
    const options = names.map(name => ({ value: name, label: name }));
    if (entry.companyName === companyName) {
      setAccountOptions(options);
      setCompanyAccounts(fullAccs);
    }
    if (dualEntry.companyName === companyName) {
      setDualAccountOptions(options);
      setDualCompanyAccounts(fullAccs);
    }
  };

  const openNewAccount = (target: 'main' | 'dual') => {
    setActionTarget(target);
    setShowNewAccount(true);
  };

  const openManageAccounts = (target: 'main' | 'dual') => {
    const companyName = target === 'dual' ? dualEntry.companyName : entry.companyName;
    if (!companyName) {
      toast.error('Please select a company first');
      return;
    }
    setActionTarget(target);
    setShowManageAccounts(true);
  };

  const handleCreateCompany = async () => {
    if (!newCompanyName.trim()) {
      toast.error('Company name is required');
      return;
    }

    try {
      console.log('Creating company:', {
        name: newCompanyName.trim(),
        address: newCompanyAddress.trim(),
      });
      const company = await supabaseDB.addCompany(
        newCompanyName.trim(),
        newCompanyAddress.trim()
      );
      console.log('Company created successfully:', company);
      
      // Invalidate and immediately refetch companies query to refresh the dropdown
      await queryClient.invalidateQueries({ queryKey: queryKeys.dropdowns.companies() });
      await queryClient.refetchQueries({ queryKey: queryKeys.dropdowns.companies() });
      
      setTargetEntry(prev => ({ ...prev, companyName: company.company_name }));
      setNewCompanyName('');
      setNewCompanyAddress('');
      setShowNewCompany(false);
      toast.success('Company created successfully!');
    } catch (error) {
      console.error('Error creating company:', error);
      toast.error(
        `Failed to create company: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const handleCreateAccount = async () => {
    const companyName = targetEntry.companyName;
    if (!newAccountName.trim() || !companyName) {
      toast.error('Account name and company selection are required');
      return;
    }

    try {
      const account = await supabaseDB.addAccount(
        companyName,
        newAccountName.trim(),
        newAccountReportCategory
      );

      // Refresh account options for the current company (main and/or dual form)
      await refreshAccountsForCompany(companyName);

      // Invalidate companies query to refresh the dropdown (in case account creation affects company data)
      queryClient.invalidateQueries({ queryKey: queryKeys.dropdowns.companies() });

      // Set the newly created account as selected
      setTargetEntry(prev => ({
        ...prev, 
        accountName: account.acc_name,
        reportCategory: account.report_category
      }));
      setNewAccountName('');
      setNewAccountReportCategory('BALANCE_SHEET');
      setShowNewAccount(false);
      toast.success('Account created successfully!');
    } catch (error) {
      toast.error('Failed to create account');
    }
  };

  const handleUpdateAccountSubmit = async (acc: Account) => {
    if (!editingAccountName.trim()) {
      toast.error('Account name cannot be empty');
      return;
    }
    try {
      const companyName = targetEntry.companyName;
      const newName = editingAccountName.trim().toUpperCase();
      const res = await supabaseDB.updateAccount(
        companyName,
        acc.acc_name,
        newName,
        editingAccountCategory
      );
      if (res.success) {
        toast.success('Account updated successfully');
        setEditingAccountId(null);
        // Refresh accounts list
        await refreshAccountsForCompany(companyName);
        // Keep the selected account's report category in step with the edit
        const syncSelected = (prev: NewEntryForm) =>
          prev.companyName === companyName && prev.accountName === acc.acc_name
            ? { ...prev, accountName: newName, reportCategory: editingAccountCategory }
            : prev;
        setEntry(syncSelected);
        setDualEntry(syncSelected);
      } else {
        toast.error(res.error || 'Failed to update account');
      }
    } catch (e) {
      toast.error('Error updating account');
    }
  };

  const handleDeleteAccountSubmit = async (acc: Account) => {
    if (!window.confirm(`Are you sure you want to delete account "${acc.acc_name}"?`)) {
      return;
    }
    try {
      const companyName = targetEntry.companyName;
      const res = await supabaseDB.deleteAccount(companyName, acc.acc_name);
      if (res.success) {
        toast.success('Account deleted successfully');
        // Refresh accounts list
        await refreshAccountsForCompany(companyName);
      } else {
        toast.error(res.error || 'Failed to delete account');
      }
    } catch (e) {
      toast.error('Error deleting account');
    }
  };

  const handleCreateSubAccount = async () => {
    if (!newSubAccountName.trim() || !entry.companyName || !entry.accountName) {
      toast.error(
        'Sub account name, company, and account selection are required'
      );
      return;
    }

    try {
      const subAccount = await supabaseDB.addSubAccount(
        entry.companyName,
        entry.accountName,
        newSubAccountName.trim()
      );
      
      // Refresh sub-account options for the current company and account
      const subs = await supabaseDB.getSubAccountsByAccountAndCompany(entry.accountName, entry.companyName);
      const data = subs.map(name => ({ value: name, label: name }));
      setSubAccounts(data);
      
      // Invalidate sub accounts dropdown and unique count for dashboard
      await queryClient.invalidateQueries({ queryKey: ['dropdowns', 'subAccounts'] });
      await queryClient.invalidateQueries({ queryKey: ['subAccounts', 'uniqueCount'] });
      await queryClient.refetchQueries({ queryKey: ['dropdowns', 'subAccounts'] });
      await queryClient.refetchQueries({ queryKey: ['subAccounts', 'uniqueCount'] });
      
      // Set the newly created sub-account as selected
      setEntry(prev => ({ ...prev, subAccount: subAccount.sub_acc }));
      setNewSubAccountName('');
      setShowNewSubAccount(false);
      toast.success('Sub account created successfully!');
    } catch (error) {
      toast.error('Failed to create sub account');
    }
  };

  const handleCreateStaff = async () => {
    if (loading) return;
    const name = newStaffName.trim();
    if (!name) {
      toast.error('Staff name is required');
      return;
    }
    setLoading(true);
    try {
      // Add to local staff list (decoupled from User Management)
      setUsers(prev => {
        const exists = prev.some(opt => opt.value.toLowerCase() === name.toLowerCase());
        return exists ? prev : [...prev, { value: name, label: name }].sort((a, b) => a.label.localeCompare(b.label));
      });
      setEntry(prev => ({ ...prev, staff: name }));
      setDualEntry(prev => ({ ...prev, staff: name }));
      setSessionStaff(name);
      setNewStaffName('');
      setNewStaffEmail('');
      setShowNewStaff(false);
      toast.success('Staff added');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (
    type: 'company' | 'account' | 'subAccount' | 'staff',
    target: 'main' | 'dual' = 'main'
  ) => {
    setActionTarget(target);
    setDeleteType(type);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    try {
      let success = false;
      let message = '';

      switch (deleteType) {
        case 'company':
          if (targetEntry.companyName) {
            const deletedCompany = targetEntry.companyName;
            const result = await supabaseDB.deleteCompany(deletedCompany);
            success = result.success;
            if (success) {
              // Invalidate and refetch companies query
              await queryClient.invalidateQueries({ queryKey: queryKeys.dropdowns.companies() });
              await queryClient.refetchQueries({ queryKey: queryKeys.dropdowns.companies() });
              // Companies are now managed by React Query - will be refetched automatically
              // Clear the company in every form (main and/or dual) that had it selected
              const clearCompany = (prev: NewEntryForm) =>
                prev.companyName === deletedCompany
                  ? { ...prev, companyName: '', accountName: '', reportCategory: '', subAccount: '' }
                  : prev;
              setEntry(clearCompany);
              setDualEntry(clearCompany);
              message = 'Company deleted successfully!';
            } else {
              message = result.error || 'Failed to delete company';
            }
          }
          break;
        case 'account':
          if (targetEntry.companyName && targetEntry.accountName) {
            const companyName = targetEntry.companyName;
            const deletedAccount = targetEntry.accountName;
            const result = await supabaseDB.deleteAccount(companyName, deletedAccount);
            success = result.success;
            if (success) {
              // Invalidate and refetch accounts query
              await queryClient.invalidateQueries({ queryKey: ['dropdowns', 'accounts'] });
              await queryClient.refetchQueries({ queryKey: ['dropdowns', 'accounts'] });
              await refreshAccountsForCompany(companyName);
              // Clear the account in every form (main and/or dual) that had it selected
              const clearAccount = (prev: NewEntryForm) =>
                prev.companyName === companyName && prev.accountName === deletedAccount
                  ? { ...prev, accountName: '', reportCategory: '', subAccount: '' }
                  : prev;
              setEntry(clearAccount);
              setDualEntry(clearAccount);
              message = 'Account deleted successfully!';
            } else {
              message = result.error || 'Failed to delete account';
            }
          }
          break;
        case 'subAccount':
          if (entry.companyName && entry.accountName && entry.subAccount) {
            const result = await supabaseDB.deleteSubAccount(entry.subAccount);
            success = result.success;
            if (success) {
              // Invalidate and refetch sub accounts query and unique count for dashboard
              await queryClient.invalidateQueries({ queryKey: ['dropdowns', 'subAccounts'] });
              await queryClient.invalidateQueries({ queryKey: ['subAccounts', 'uniqueCount'] });
              await queryClient.refetchQueries({ queryKey: ['dropdowns', 'subAccounts'] });
              await queryClient.refetchQueries({ queryKey: ['subAccounts', 'uniqueCount'] });
              setSubAccounts(prev =>
                prev.filter(s => s.value !== entry.subAccount)
              );
              setEntry(prev => ({ ...prev, subAccount: '' }));
              message = 'Sub account deleted successfully!';
            } else {
              message = result.error || 'Failed to delete sub account';
            }
          }
          break;
        case 'staff':
          if (entry.staff) {
            // Find the user ID by username
            const user = users.find(u => u.value === entry.staff);
            if (user) {
              // For now, just clear the selection since we don't have user ID in the options
              setEntry(prev => ({ ...prev, staff: '' }));
              setDualEntry(prev => ({ ...prev, staff: '' }));
              message = 'Staff member selection cleared!';
              success = true;
            }
          }
          break;
      }

      if (success) {
        toast.success(message);
      } else {
        toast.error(message || `Failed to delete ${deleteType}. It may be in use.`);
      }
    } catch (error) {
      toast.error(`Error deleting ${deleteType}`);
    }

    setShowDeleteModal(false);
    updateTotalEntryCount(); // Update total entry count after deletion
  };

  // CSV Upload Functions
  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    setUploadedFile(file);
    setUploadLoading(true);
    // Upload progress is now handled by React Query mutations

    try {
      const result = await importFromFile(file);

      if (result.success && result.data) {
        // Log the actual columns in the CSV for debugging
        console.log('CSV Columns:', Object.keys(result.data[0] || {}));
        console.log('Total rows:', result.data.length);

        // Skip validation completely - accept any CSV format

        setUploadPreview(result.data.slice(0, 5)); // Show first 5 rows as preview
        toast.success(
          `Successfully loaded ${result.data.length} entries from CSV`
        );
      } else {
        toast.error(result.error || 'Failed to read CSV file');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload CSV file');
    } finally {
      setUploadLoading(false);
      // Upload progress is now handled by React Query mutations
    }
  };


  const handleImportCSV = async () => {
    if (!uploadedFile || uploadPreview.length === 0) {
      toast.error('Please upload a valid CSV file first');
      return;
    }

    setUploadLoading(true);
    // Upload progress is now handled by React Query mutations
    setImportErrors([]);

    try {
      const result = await importFromFile(uploadedFile);

      if (result.success && result.data) {
        let successCount = 0;
        let errorCount = 0;
        const errors: string[] = [];

        // Optimized batch size for balanced performance
        const batchSize = 500; // Balanced batch size for optimal speed and reliability
        const totalBatches = Math.ceil(result.data.length / batchSize);

        // Initialize progress
        setImportProgress({
          current: 0,
          total: result.data.length,
          percentage: 0,
          successCount: 0,
          errorCount: 0,
          currentBatch: 0,
          totalBatches,
        });

                // Process batches sequentially but with maximum speed optimizations
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const startIndex = batchIndex * batchSize;
          const endIndex = Math.min(startIndex + batchSize, result.data.length);
          const batch = result.data.slice(startIndex, endIndex);

          // Process batch data and prepare for bulk insert
          const batchEntries = [];
          
                      for (let i = 0; i < batch.length; i++) {
              const row = batch[i];
              const globalIndex = startIndex + i;

            try {
              // Optimized data mapping for maximum speed
              const sanitizeString = (value: any) => {
                if (!value) return '';
                return String(value).trim();
              };

              const sanitizeNumber = (value: any) => {
                if (!value) return 0;
                const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
                return isNaN(num) ? 0 : num;
              };

              const sanitizeDate = (value: any) => {
                if (!value) return format(new Date(), 'yyyy-MM-dd');
                
                // Convert to string and trim
                const dateStr = String(value).trim();
                if (!dateStr) return format(new Date(), 'yyyy-MM-dd');
                
                try {
                  // Try multiple date formats for better compatibility
                  let date: Date;
                  
                  // Check if it's already in ISO format (YYYY-MM-DD)
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    date = new Date(dateStr);
                  }
                  // Check for DD/MM/YYYY format
                  else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
                    const [day, month, year] = dateStr.split('/');
                    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                  }
                  // Check for DD-MM-YYYY format
                  else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
                    const [day, month, year] = dateStr.split('-');
                    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                  }
                  // Try default Date constructor as fallback
                  else {
                    date = new Date(dateStr);
                  }
                  
                  // Validate the parsed date
                  if (isNaN(date.getTime()) || date.getFullYear() < 1900 || date.getFullYear() > 2100) {
                    console.warn(`Invalid date format: "${dateStr}", using current date`);
                    return format(new Date(), 'yyyy-MM-dd');
                  }
                  
                  return format(date, 'yyyy-MM-dd');
                } catch (error) {
                  console.warn(`Date parsing error for "${dateStr}":`, error);
                  return format(new Date(), 'yyyy-MM-dd');
                }
              };

              // Fast field value extraction
              const getFieldValue = (row: any, possibleNames: string[], defaultValue: any) => {
                for (const name of possibleNames) {
                  const value = row[name];
                  if (value !== undefined && value !== null && value !== '') {
                    return value;
                  }
                }
                return defaultValue;
              };

              // Map CSV columns to database fields with ultra-flexible column names
              const entry = {
                acc_name: sanitizeString(
                  getFieldValue(
                    row,
                    [
                      'Main Account',
                      'Account',
                      'Account Name',
                      'AccountName',
                      'MainAccount',
                      'Account Type',
                      'AccountType',
                      'Account Category',
                      'AccountCategory',
                    ],
                    'Default Account'
                  )
                ),
                sub_acc_name: sanitizeString(
                  getFieldValue(
                    row,
                    [
                      'Sub Account',
                      'SubAccount',
                      'Sub Account Name',
                      'SubAccountName',
                      'Sub Account Type',
                      'SubAccountType',
                      'Branch',
                      'Location',
                    ],
                    ''
                  )
                ),
                particulars: sanitizeString(
                  getFieldValue(
                    row,
                    [
                      'Particulars',
                      'Description',
                      'Details',
                      'Transaction Details',
                      'TransactionDetails',
                      'Narration',
                      'Notes',
                      'Remarks',
                      'Comment',
                      'Memo',
                    ],
                    `Transaction ${globalIndex + 1}`
                  )
                ),
                c_date: sanitizeDate(
                  getFieldValue(
                    row,
                    [
                      'Date',
                      'Transaction Date',
                      'Entry Date',
                      'TransactionDate',
                      'EntryDate',
                      'Posting Date',
                      'PostingDate',
                      'Value Date',
                      'ValueDate',
                      'c_date',
                      'C_Date',
                    ],
                    format(new Date(), 'yyyy-MM-dd')
                  )
                ),
                credit: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Credit',
                      'Credit Amount',
                      'CreditAmount',
                      'Credit Amt',
                      'CreditAmt',
                      'Credit Value',
                      'CreditValue',
                      'Credit Total',
                      'CreditTotal',
                    ],
                    0
                  )
                ),
                debit: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Debit',
                      'Debit Amount',
                      'DebitAmount',
                      'Debit Amt',
                      'DebitAmt',
                      'Debit Value',
                      'DebitValue',
                      'Debit Total',
                      'DebitTotal',
                    ],
                    0
                  )
                ),
                credit_online: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Credit Online',
                      'Online Credit',
                      'OnlineCredit',
                      'Credit Online Amount',
                      'Online Credit Amount',
                      'Credit Digital',
                      'Digital Credit',
                    ],
                    0
                  )
                ),
                credit_offline: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Credit Offline',
                      'Offline Credit',
                      'OfflineCredit',
                      'Credit Offline Amount',
                      'Offline Credit Amount',
                      'Credit Cash',
                      'Cash Credit',
                    ],
                    0
                  )
                ),
                debit_online: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Debit Online',
                      'Online Debit',
                      'OnlineDebit',
                      'Debit Online Amount',
                      'Online Debit Amount',
                      'Debit Digital',
                      'Digital Debit',
                    ],
                    0
                  )
                ),
                debit_offline: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Debit Offline',
                      'Offline Debit',
                      'OfflineDebit',
                      'Debit Offline Amount',
                      'Offline Debit Amount',
                      'Debit Cash',
                      'Cash Debit',
                    ],
                    0
                  )
                ),
                company_name: sanitizeString(
                  getFieldValue(
                    row,
                    [
                      'Company',
                      'Company Name',
                      'CompanyName',
                      'Firm',
                      'Organization',
                      'Business',
                      'Entity',
                      'Client',
                      'Customer',
                      'Party',
                    ],
                    'Default Company'
                  )
                ),
                address: sanitizeString(
                  getFieldValue(
                    row,
                    [
                      'Address',
                      'Company Address',
                      'CompanyAddress',
                      'Location',
                      'Street',
                      'City',
                      'State',
                      'Country',
                      'Place',
                    ],
                    ''
                  )
                ),
                staff: sanitizeString(
                  getFieldValue(
                    row,
                    [
                      'Staff',
                      'Staff Name',
                      'StaffName',
                      'Employee',
                      'User',
                      'Created By',
                      'CreatedBy',
                      'Entered By',
                      'EnteredBy',
                      'Operator',
                    ],
                    user?.username || 'admin'
                  )
                ),
                users: user?.username || 'admin',
                book_id: currentBook?.id || undefined,
                sale_qty: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Sale Qty',
                      'Sale Quantity',
                      'Sales Qty',
                      'Quantity Sold',
                      'SaleQty',
                      'SaleQuantity',
                      'SalesQty',
                      'QuantitySold',
                      'Sales Quantity',
                      'SalesQuantity',
                      'Qty Sold',
                      'QtySold',
                    ],
                    0
                  )
                ),
                purchase_qty: sanitizeNumber(
                  getFieldValue(
                    row,
                    [
                      'Purchase Qty',
                      'Purchase Quantity',
                      'Quantity Purchased',
                      'PurchaseQty',
                      'PurchaseQuantity',
                      'QuantityPurchased',
                      'Buy Qty',
                      'BuyQty',
                      'Buy Quantity',
                      'BuyQuantity',
                    ],
                    0
                  )
                ),
                cb: 'CB',
              };

              // Add to batch for bulk insertion
              batchEntries.push(entry);
            } catch (error) {
              console.error(
                `Error processing row ${globalIndex + 1}:`,
                error
              );
              // Continue processing other rows
            }
          }

          // Bulk insert the batch
          if (batchEntries.length > 0) {
            try {
              console.log(`Bulk inserting ${batchEntries.length} entries for batch ${batchIndex + 1}`);
              
              // Add retry logic for bulk operations
              let retryCount = 0;
              const maxRetries = 3;
              let success = false;

              while (retryCount < maxRetries && !success) {
                try {
                  // Use bulk insert for better performance
                  const { data: bulkResult, error: bulkError } = await supabase
                    .from(getTableName('cash_book'))
                    .insert(batchEntries)
                    .select('id');

                  if (!bulkError && bulkResult) {
                    console.log(`✅ Bulk insert successful: ${bulkResult.length} entries inserted`);
                    success = true;
                  } else {
                    throw bulkError;
                  }
                } catch (dbError) {
                  retryCount++;
                  if (retryCount < maxRetries) {
                    // Ultra-fast retry with minimal delay
                    await new Promise(resolve =>
                      setTimeout(resolve, 25 * retryCount)
                    );
                  } else {
                    throw dbError;
                  }
                }
              }

              if (success) {
                successCount += batchEntries.length;
              } else {
                errorCount += batchEntries.length;
                errors.push(`Batch ${batchIndex + 1}: Bulk insert failed after ${maxRetries} retries`);
              }
            } catch (error) {
              console.error(`Bulk insert error for batch ${batchIndex + 1}:`, error);
              errorCount += batchEntries.length;
              errors.push(`Batch ${batchIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }

          // Batch processing completed

          // Update progress
          const currentProgress = startIndex + batch.length;
          const percentage = Math.round(
            (currentProgress / result.data.length) * 100
          );

          setImportProgress({
            current: currentProgress,
            total: result.data.length,
            percentage,
            successCount,
            errorCount,
            currentBatch: batchIndex + 1,
            totalBatches,
          });

          // No delay between batches for maximum speed
          // await new Promise(resolve => setTimeout(resolve, 0));
        }

        toast.success(
          `Import completed! ${successCount} entries imported, ${errorCount} failed`
        );
        setImportErrors(errors);
        setShowUploadModal(false);
        setUploadedFile(null);
        setUploadPreview([]);

        // Refresh data
        updateTotalEntryCount();
        // Recent entries are now managed by React Query - no need to manually update

        // Trigger dashboard refresh after CSV import
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        toast.error(result.error || 'Failed to import CSV data');
      }
    } catch (error) {
      console.error('Error importing CSV:', error);
      toast.error('Failed to import CSV data');
    } finally {
      setUploadLoading(false);
    }
  };

  // Admin function to delete empty companies
  // Removed handleDeleteEmptyCompanies function - Clean Companies button removed per user request

  return (
    <div className='min-h-screen flex flex-col w-full max-w-full'>
      {/* Payment Mode Column Missing Alert */}
      {!paymentModeColumnStatus.exists && !paymentModeColumnStatus.checking && (
        <div className='bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-2 mx-1'>
          <div className='flex items-start'>
            <div className='flex-shrink-0'>
              <Database className='h-5 w-5 text-yellow-400' />
            </div>
            <div className='ml-3 flex-1'>
              <h3 className='text-sm font-medium text-yellow-800'>
                ⚠️ Payment Mode Column Missing
              </h3>
              <div className='mt-2 text-sm text-yellow-700'>
                <p className='mb-2'>
                  The <code className='bg-yellow-100 px-1 rounded'>payment_mode</code> column is missing from your database.
                  Please add it to enable payment mode functionality.
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <Button
                    onClick={copySQLToClipboard}
                    variant='secondary'
                    size='sm'
                    className='text-xs'
                  >
                    <Copy className='h-3 w-3 mr-1' />
                    Copy SQL Command
                  </Button>
                  <Button
                    onClick={openSupabaseDashboard}
                    variant='secondary'
                    size='sm'
                    className='text-xs'
                  >
                    <ExternalLink className='h-3 w-3 mr-1' />
                    Open Supabase Dashboard
                  </Button>
                </div>
                <div className='mt-3 p-2 bg-yellow-100 rounded text-xs font-mono text-yellow-900 overflow-x-auto'>
                  {paymentModeColumnStatus.sqlCommand}
                </div>
                <p className='mt-2 text-xs text-yellow-600'>
                  <strong>Steps:</strong> 1) Copy SQL above 2) Open Supabase Dashboard 3) Go to SQL Editor 4) Paste & Run 5) Refresh this page
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Locked Book Banner */}
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-lg shadow-sm flex items-center gap-2 m-4 no-print flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 animate-pulse" />
          <div>
            <h3 className="text-xs font-bold text-red-800">This Book Is Locked (Read Only)</h3>
            <p className="text-[10px] text-red-700">Writing, editing, and deletion operations are disabled for this accounting period.</p>
          </div>
        </div>
      )}

      {/* Header - Fixed at top */}
      <div className='flex items-center justify-between p-1 bg-white border-b border-gray-200 flex-shrink-0'>
        <div>
          <div className='flex items-center gap-2 mb-1'>
            <h1 className='text-lg font-bold text-gray-900 flex items-center gap-2'>
              New Entry
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                currentBook?.is_locked 
                  ? 'bg-red-100 text-red-700' 
                  : tableMode === 'itr' 
                    ? 'bg-emerald-100 text-emerald-700' 
                    : 'bg-blue-100 text-blue-700'
              }`}>
                {currentBook?.book_code || 'No Book'}
              </span>
              {!isOnline && (
                <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse flex items-center gap-1">
                  📦 Using Offline Cache
                </span>
              )}
            </h1>
            <ModeLabel />
          </div>
          <p className='text-xs text-gray-600'>
            Create new cash book entries with automatic daily entry numbering
          </p>
        </div>
        <div className='text-right'>
          <div className='flex flex-col items-end gap-1'>
            <div className='flex items-center gap-3'>
              <div>
                <div className='text-xs text-gray-600'>Total Entries</div>
                <div className='text-lg font-bold text-purple-600'>
                  {totalEntryCount.toLocaleString()}
                </div>
              </div>
              <div className='w-px h-6 bg-gray-300'></div>
              <div>
                <div className='text-xs text-gray-600'>Daily Entry #</div>
                <div className='text-lg font-bold text-blue-600'>
                  {currentDailyEntryNo}
                </div>
              </div>
            </div>
            <div className='flex gap-1'>
              {isOnline && (
                <Button
                  variant='secondary'
                  onClick={handleManualCacheRefresh}
                  size='sm'
                  className='text-xs bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-800 font-bold'
                  icon={Download}
                  disabled={isCacheSyncing}
                >
                  {isCacheSyncing ? 'Caching...' : 'Cache Offline Data'}
                </Button>
              )}
              <Button
                variant='secondary'
                onClick={loadUsersData}
                size='sm'
                className='text-xs'
                icon={RefreshCw}
              >
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Persistent Expiry Notifications Box */}
      {(vehicleStats || bgStats || driverStats) && (
        <div className='flex flex-wrap gap-2 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-shrink-0'>
          {vehicleStats && (
            <div 
              onClick={() => navigate('/vehicles?highlightExpiring=true')}
              className='bg-white border border-gray-200 hover:border-gray-300 transition-all rounded px-2.5 py-1 flex items-center gap-1.5 cursor-pointer shadow-sm text-[11px]'
            >
              <span className='font-bold text-gray-700'>Vehicle Expiry:</span>
              {vehicleStats.expired > 0 && (
                <span className='text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded'>
                  {vehicleStats.expired} expired
                </span>
              )}
              {vehicleStats.expiring > 0 && (
                <span className='text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded'>
                  {vehicleStats.expiring} expiring soon
                </span>
              )}
              <ExternalLink className='w-3 h-3 text-gray-400 ml-0.5' />
            </div>
          )}
          {bgStats && (
            <div 
              onClick={() => navigate('/bank-guarantees?highlightExpiring=true')}
              className='bg-white border border-gray-200 hover:border-gray-300 transition-all rounded px-2.5 py-1 flex items-center gap-1.5 cursor-pointer shadow-sm text-[11px]'
            >
              <span className='font-bold text-gray-700'>Bank Guarantee Expiry:</span>
              {bgStats.expired > 0 && (
                <span className='text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded'>
                  {bgStats.expired} expired
                </span>
              )}
              {bgStats.expiring > 0 && (
                <span className='text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded'>
                  {bgStats.expiring} expiring soon
                </span>
              )}
              <ExternalLink className='w-3 h-3 text-gray-400 ml-0.5' />
            </div>
          )}
          {driverStats && (
            <div 
              onClick={() => navigate('/drivers?highlightExpiring=true')}
              className='bg-white border border-gray-200 hover:border-gray-300 transition-all rounded px-2.5 py-1 flex items-center gap-1.5 cursor-pointer shadow-sm text-[11px]'
            >
              <span className='font-bold text-gray-700'>Driver Expiry:</span>
              {driverStats.expired > 0 && (
                <span className='text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded'>
                  {driverStats.expired} expired
                </span>
              )}
              {driverStats.expiring > 0 && (
                <span className='text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded'>
                  {driverStats.expiring} expiring soon
                </span>
              )}
              <ExternalLink className='w-3 h-3 text-gray-400 ml-0.5' />
            </div>
          )}
        </div>
      )}

      {/* Main Content - Stacked: Recent Transactions on Top, Form on Bottom */}
      <div className='flex-1 p-2 w-full'>
        <div className='w-full max-w-7xl mx-auto space-y-3'>
          {/* Recent Transactions Section */}
          <div className='w-full space-y-2'>
            {/* Totals Ribbon */}
            <div className='flex gap-3 p-3 bg-white border border-gray-250 rounded shadow-sm text-sm font-bold uppercase items-center justify-between'>
              <div className='flex items-center gap-1'>Total Cr: <span className='text-green-750 font-mono'>{totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              <div className='w-px h-4 bg-gray-300'></div>
              <div className='flex items-center gap-1'>Total Dr: <span className='text-red-755 font-mono'>{totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              <div className='w-px h-4 bg-gray-300'></div>
              <div className='flex items-center gap-1'>Balance: <span className={`${netBalance >= 0 ? 'text-green-800' : 'text-red-800'} font-mono`}>{netBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            </div>

            <Card
              title='Recent Transactions'
              subtitle={`Entries for ${format(new Date(entry.date), 'dd-MMM-yyyy')} (LIFO)`}
              className='bg-white border-gray-250 shadow-sm'
            >
              {recentLoading ? (
                <div className='text-center py-8'>
                  <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto'></div>
                  <p className='mt-2 text-gray-600 font-medium text-base'>Loading transactions...</p>
                </div>
              ) : !recentEntries || !Array.isArray(recentEntries) || recentEntries.length === 0 ? (
                <div className='text-center py-8 text-gray-500'>
                  <div className='text-lg font-medium mb-2'>No transactions found for {format(new Date(entry.date), 'dd-MMM-yyyy')}</div>
                  <div className='text-sm'>Try selecting a different date or create a new entry for this date.</div>
                </div>
              ) : (
                <div className='w-full border border-gray-200 rounded-lg shadow-sm bg-white'>
                  <div className='max-h-96 overflow-y-auto custom-scrollbar'>
                    <table className='fit-table fit-lg w-full divide-y divide-gray-200'>
                      <thead className='sticky top-0 bg-gray-50 z-10'>
                        <tr className='border-b border-gray-200'>
                          <th className=' px-1.5 py-2 text-center font-semibold text-gray-700 text-[14px] leading-tight'>
                            S.No
                          </th>
                          <th className=' px-1.5 py-2 text-left font-semibold text-gray-700 text-[14px] leading-tight'>
                            Date
                          </th>
                          <th className=' px-1.5 py-2 text-left font-semibold text-gray-700 text-[14px] leading-tight'>
                            Company
                          </th>
                          <th className=' px-1.5 py-2 text-left font-semibold text-gray-700 text-[14px] leading-tight'>
                            Account
                          </th>
                          <th className=' px-1.5 py-2 text-left font-semibold text-gray-700 text-[14px] leading-tight'>
                            Sub Account
                          </th>
                          <th className=' px-1.5 py-2 text-left font-semibold text-gray-700 text-[14px] leading-tight'>
                            Particulars
                          </th>
                          <th className=' px-1.5 py-2 text-right font-semibold text-gray-700 text-[14px] leading-tight'>
                            Credit
                          </th>
                          <th className=' px-1.5 py-2 text-right font-semibold text-gray-700 text-[14px] leading-tight'>
                            Debit
                          </th>
                          <th className=' px-1.5 py-2 text-left font-semibold text-gray-700 text-[14px] leading-tight'>
                            Payment Mode
                          </th>
                          <th className=' px-1.5 py-2 text-left font-semibold text-gray-700 text-[14px] leading-tight'>
                            Staff
                          </th>
                        </tr>
                      </thead>
                      <tbody className='divide-y divide-gray-100'>
                        {Array.isArray(recentEntries) && (showAllRecent ? recentEntries : recentEntries.slice(0, 4)).map((entry: any, index: number) => (
                          <tr
                            key={entry.id}
                            className={`hover:bg-gray-50 transition-colors ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                            }`}
                          >
                            <td className=' px-1.5 py-1.5 text-center font-medium text-gray-600'>{index + 1}</td>
                            <td className=' px-1.5 py-1.5 font-medium text-gray-800 leading-tight'>
                              <div className='fit-nowrap'>{format(new Date(entry.c_date), 'dd-MMM-yy')}</div>
                              {entry.pending_sync && (
                                <span className='inline-flex items-center text-[9px] font-bold text-amber-600 bg-amber-50 px-1 py-0.2 rounded border border-amber-200 animate-pulse'>
                                  Sync
                                </span>
                              )}
                            </td>
                            <td className=' px-1.5 py-1.5 font-bold text-blue-600' title={entry.company_name}>
                              {entry.company_name}
                            </td>
                            <td className=' px-1.5 py-1.5 font-medium text-gray-800' title={entry.acc_name?.replace(/\[DELETED\]\s*/g, '')}>
                              {entry.acc_name?.replace(/\[DELETED\]\s*/g, '') || '-'}
                            </td>
                            <td className=' px-1.5 py-1.5 font-medium text-gray-800' title={entry.sub_acc_name?.replace(/\[DELETED\]\s*/g, '')}>
                              {entry.sub_acc_name?.replace(/\[DELETED\]\s*/g, '') || '-'}
                            </td>
                            <td
                              className=' px-1.5 py-1.5 font-medium text-gray-800'
                              title={entry.particulars?.replace(/\[DELETED\]\s*/g, '')}
                            >
                              {entry.particulars?.replace(/\[DELETED\]\s*/g, '') || '-'}
                            </td>
                            <td className=' px-1.5 py-1.5 text-right font-semibold text-green-750 tabular-nums fit-nowrap'>
                              {entry.credit > 0
                                ? `${entry.credit.toLocaleString()}`
                                : '-'}
                            </td>
                            <td className=' px-1.5 py-1.5 text-right font-semibold text-red-750 tabular-nums fit-nowrap'>
                              {entry.debit > 0
                                ? `${entry.debit.toLocaleString()}`
                                : '-'}
                            </td>
                            <td className=' px-1.5 py-1.5 font-medium text-gray-800' title={entry.payment_mode || 'No payment mode'}>
                              {entry.payment_mode && String(entry.payment_mode).trim() ? (entry.payment_mode === 'Online' ? 'Double' : entry.payment_mode === 'Bank Transfer' ? 'Bank' : String(entry.payment_mode).trim()) : '-'}
                            </td>
                            <td className=' px-1.5 py-1.5 font-medium text-gray-800' title={entry.staff}>
                              {entry.staff}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {Array.isArray(recentEntries) && recentEntries.length > 4 && (
                    <div className='px-4 py-2 border-t border-gray-200 bg-gray-50 flex justify-center'>
                      <button
                        type='button'
                        onClick={() => setShowAllRecent(!showAllRecent)}
                        className='text-xs font-bold text-blue-600 hover:text-blue-800 focus:outline-none flex items-center gap-1 transition-all'
                      >
                        {showAllRecent ? (
                          <>
                            Show Less <ChevronUp className="w-3.5 h-3.5" />
                          </>
                        ) : (
                          <>
                            Show All ({recentEntries.length} entries) <ChevronDown className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Entry Form */}
          <div className='w-full'>
            <Card
              className='p-3 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 shadow-lg'
            >
              <form ref={formRef} onSubmit={handleSubmit} className='space-y-2 text-xs' style={{ fontFamily: 'Times New Roman', fontSize: '12px' }}>
                {/* Dual Entry Toggle */}
                <div className='flex items-center justify-center mb-0.5 p-1 bg-blue-50 rounded border border-blue-200'>
                  <input
                    type='checkbox'
                    id='dualEntryEnabled'
                    checked={dualEntryEnabled}
                    onChange={e => setDualEntryEnabled(e.target.checked)}
                    className='mr-3 w-4 h-4'
                    tabIndex={-1}
                  />
                  <label
                    htmlFor='dualEntryEnabled'
                    className='text-sm font-bold text-blue-800'
                    style={{ fontFamily: 'Times New Roman', fontSize: '14px', fontWeight: 'bold' }}
                  >
                    Enable Dual Entry
                  </label>
                </div>

                {/* Line 1: Date, Company, Main Account */}
                <div className='grid grid-cols-1 md:grid-cols-3 gap-1'>
                  <div className='relative'>
                    <label className='block font-bold text-gray-700 mb-1 text-xs' style={{ fontFamily: 'Times New Roman', fontSize: '14px', fontWeight: 'bold' }}>Date</label>
                    <input
                      ref={dateRef as any}
                      type='text'
                      value={mainDateInput}
                      onChange={e => {
                        const v = e.target.value;
                        setMainDateInput(v);
                        const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                        if (m) {
                          const [, dd, mm, yyyy] = m;
                          handleInputChange('date', `${yyyy}-${mm}-${dd}`);
                        }
                      }}
                      onKeyDown={(e) => handleKeyDown(e, companyNameRef)}
                      placeholder='dd/MM/yyyy'
                      className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold'
                      style={{ fontWeight: 'bold', fontSize: '14px' }}
                    />
                    <button
                      type='button'
                      tabIndex={-1}
                      onClick={() => setShowMainCalendar(!showMainCalendar)}
                      className='absolute right-2 top-7 p-1 hover:bg-gray-100 rounded'
                    >
                      <Calendar className='w-4 h-4 text-gray-500' />
                    </button>
                    {showMainCalendar && (
                      <CustomCalendar
                        onDateSelect={(date) => {
                          handleInputChange('date', date);
                          const parts = date.split('-');
                          if (parts.length === 3) {
                            setMainDateInput(`${parts[2]}/${parts[1]}/${parts[0]}`);
                          } else {
                            setMainDateInput(date);
                          }
                          setShowMainCalendar(false);
                        }}
                        selectedDate={entry.date}
                        onClose={() => setShowMainCalendar(false)}
                      />
                    )}
                  </div>

                  <div className='space-y-0.5'>
                    <SearchableSelect
                      ref={companyNameRef}
                      label='Company Name'
                      value={entry.companyName}
                      onChange={value =>
                        handleInputChange('companyName', value)
                      }
                      onSelect={() => {
                        // Auto-navigate to next field when company is selected
                        setTimeout(() => {
                          if (mainAccountRef.current) {
                            mainAccountRef.current.focus();
                          }
                        }, 100);
                      }}
                      options={companiesOptions}
                      placeholder='Select company...'
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(e, mainAccountRef)}
                      required
                      size='sm'
                    />
                    <div className='flex gap-1'>
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        onClick={() => { setActionTarget('main'); setShowNewCompany(true); }}
                        className='text-xs px-1 py-1'
                        icon={Building}
                        tabIndex={-1}
                      >
                        Add
                      </Button>
                      {entry.companyName && (
                        <Button
                          type='button'
                          size='sm'
                          variant='danger'
                          onClick={() => handleDelete('company', 'main')}
                          className='text-xs px-1 py-1'
                          icon={AlertCircle}
                          tabIndex={-1}
                        >
                          Del
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className='flex gap-1 items-end w-full' style={{ minWidth: 0 }}>
                    <div className='w-full' style={{ minWidth: 0 }}>
                      <SearchableSelect
                        ref={mainAccountRef}
                        label='Main Account'
                        value={entry.accountName}
                        onChange={value =>
                          handleInputChange('accountName', value)
                        }
                        onSelect={value => {
                          // The report (Balance Sheet / Profit & Loss) comes from the account itself,
                          // set when the account is created with "Add" or changed in "Manage".
                          const matchedAcc = companyAccounts.find(acc => acc.acc_name === value);
                          handleInputChange('reportCategory', matchedAcc?.report_category || '');
                          setTimeout(() => {
                            if (staffRef.current) {
                              staffRef.current.focus();
                            }
                          }, 100);
                        }}
                        options={accountOptions}
                        placeholder='Select account...'
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(e, staffRef)}
                        required
                        disabled={!entry.companyName}
                        size='sm'
                      />
                      <div className='flex gap-1 mt-1'>
                        <Button
                          type='button'
                          size='sm'
                          variant='secondary'
                          onClick={() => openNewAccount('main')}
                          className='text-xs px-1 py-1'
                          icon={FileText}
                          tabIndex={-1}
                        >
                          Add
                        </Button>
                        <Button
                          type='button'
                          size='sm'
                          variant='secondary'
                          onClick={() => openManageAccounts('main')}
                          className='text-xs px-1 py-1'
                          icon={Settings}
                          tabIndex={-1}
                        >
                          Manage
                        </Button>
                        {entry.accountName && (
                          <Button
                            type='button'
                            size='sm'
                            variant='danger'
                            onClick={() => handleDelete('account', 'main')}
                            className='text-xs px-1 py-1'
                            icon={AlertCircle}
                            tabIndex={-1}
                          >
                            Del
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Line 2: Sub Account, Particulars, Staff */}
                <div className='grid grid-cols-1 md:grid-cols-12 gap-1'>
                  <div className='space-y-0.5 md:col-span-3'>
                    <SearchableSelect
                      ref={subAccountRef}
                      label='Sub Account'
                      value={entry.subAccount}
                      onChange={value => handleInputChange('subAccount', value)}
                      onSelect={() => {
                        // Auto-navigate to particulars when sub account is selected
                        setTimeout(() => {
                          if (particularsRef.current) {
                            particularsRef.current.focus();
                          }
                        }, 100);
                      }}
                      options={subAccounts}
                      placeholder='Select sub account...'
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(e, particularsRef)}
                      disabled={!entry.accountName}
                      required
                      size='sm'
                    />
                    <div className='flex gap-1'>
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        onClick={() => setShowNewSubAccount(true)}
                        className='text-xs px-1 py-1'
                        icon={FileText}
                        tabIndex={-1}
                      >
                        Add
                      </Button>
                      {entry.subAccount && (
                        <Button
                          type='button'
                          size='sm'
                          variant='danger'
                          onClick={() => handleDelete('subAccount')}
                          className='text-xs px-1 py-1'
                          icon={AlertCircle}
                          tabIndex={-1}
                        >
                          Del
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className='space-y-0.5 md:col-span-7'>
                    <Input
                      ref={particularsRef}
                      label='Particulars'
                      value={entry.particulars}
                      onChange={value => handleInputChange('particulars', value)}
                      onKeyDown={(e) => handleKeyDown(e, creditRef)}
                      placeholder='Enter transaction details...'
                      required
                      size='sm'
                      uppercase={true}
                    />
                  </div>

                  <div className='space-y-0.5 md:col-span-2'>
                    <SearchableSelect
                      ref={staffRef}
                      label='Staff'
                      value={entry.staff}
                      onChange={value => {
                        setEntry(prev => ({ ...prev, staff: value }));
                        setSessionStaff(value);
                      }}
                      onSelect={() => {
                        setTimeout(() => {
                          if (subAccountRef.current) {
                            subAccountRef.current.focus();
                          }
                        }, 100);
                      }}
                      options={users}
                      placeholder='Select staff...'
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(e, subAccountRef)}
                      required
                      size='sm'
                      className='staff-field'
                    />
                    <div className='flex gap-1'>
                      <Button
                        type='button'
                        variant='secondary'
                        size='sm'
                        onClick={() => setShowNewStaff(true)}
                        className='text-xs px-1 py-1'
                        icon={Building}
                        tabIndex={-1}
                      >
                        Add
                      </Button>
                      <Button
                        type='button'
                        variant='danger'
                        size='sm'
                        onClick={() => handleDelete('staff')}
                        className='text-xs px-1 py-1'
                        icon={AlertCircle}
                        tabIndex={-1}
                      >
                        Del
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Line 3: Credits, Debits, Payment Mode */}
                <div className='grid grid-cols-1 md:grid-cols-3 gap-1'>
                  <Input
                    ref={creditRef}
                    label='Credit'
                    value={entry.credit}
                    onChange={val => {
                      setEntry(prev => ({ 
                        ...prev, 
                        credit: val,
                        debit: val ? '' : prev.debit 
                      }));
                    }}
                    disabled={!!entry.debit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (debitRef.current && !debitRef.current.disabled) {
                          debitRef.current.focus();
                        } else {
                          if (dualEntryEnabled && dualCompanyNameRef.current) {
                            dualCompanyNameRef.current.focus();
                          } else if (saveBtnRef.current) {
                            saveBtnRef.current.focus();
                          }
                        }
                      }
                    }}
                    placeholder='Enter credit amount'
                    type='number'
                    min='0'
                    step='any'
                    size='sm'
                  />
                  <Input
                    ref={debitRef}
                    label='Debit'
                    value={entry.debit}
                    onChange={val => {
                      setEntry(prev => ({ 
                        ...prev, 
                        debit: val,
                        credit: val ? '' : prev.credit 
                      }));
                    }}
                    disabled={!!entry.credit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (dualEntryEnabled && dualCompanyNameRef.current) {
                          dualCompanyNameRef.current.focus();
                        } else if (saveBtnRef.current) {
                          saveBtnRef.current.focus();
                        }
                      }
                    }}
                    placeholder='Enter debit amount'
                    type='number'
                    min='0'
                    step='any'
                    size='sm'
                  />
                  <SearchableSelect
                    ref={paymentModeRef}
                    label='Payment Mode'
                    value={entry.paymentMode}
                    onChange={val => {
                      setEntry(prev => ({ ...prev, paymentMode: val }));
                      localStorage.setItem('lastSelectedPaymentMode', val);
                    }}
                    options={[
                      { value: '', label: 'Select payment mode...' },
                      { value: 'Cash', label: 'Cash' },
                      { value: 'Bank Transfer', label: 'Bank' },
                      { value: 'Online', label: 'Double' }
                    ]}
                    placeholder='Select payment mode...'
                    required
                    size='sm'
                    tabIndex={-1}
                  />
                </div>

                {/* Quantity Checkbox */}
                <div className='flex items-center space-x-2'>
                  <input
                    ref={quantityCheckedRef}
                    type='checkbox'
                    id='quantityChecked'
                    checked={entry.quantityChecked}
                    onChange={e =>
                      setEntry(prev => ({
                        ...prev,
                        quantityChecked: e.target.checked,
                      }))
                    }
                    tabIndex={-1}
                    className='w-4 h-4'
                  />
                  <label
                    htmlFor='quantityChecked'
                    className='text-sm font-bold text-gray-700'
                    style={{ fontFamily: 'Times New Roman', fontSize: '14px', fontWeight: 'bold' }}
                  >
                    Quantity Details
                  </label>
                </div>


                {/* Quantity Details - Only show when checked */}
                {entry.quantityChecked && (
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-1'>
                    <Input
                      ref={purchaseQRef}
                      label='Purchase Quantity'
                      value={entry.saleQ}
                      onChange={val => {
                        // If sale quantity is entered, clear purchase quantity
                        const saleVal = val.trim();
                        setEntry(prev => ({ 
                          ...prev, 
                          saleQ: saleVal,
                          purchaseQ: saleVal ? '' : prev.purchaseQ // Clear purchase if sale has value
                        }));
                      }}
                      disabled={!!entry.purchaseQ}
                      placeholder='0'
                      type='number'
                      min='0'
                      step='0.01'
                      size='sm'
                      tabIndex={-1}
                    />
                    <Input
                      ref={saleQRef}
                      label='Sale Quantity'
                      value={entry.purchaseQ}
                      onChange={val => {
                        // If purchase quantity is entered, clear sale quantity
                        const purchaseVal = val.trim();
                        setEntry(prev => ({ 
                          ...prev, 
                          purchaseQ: purchaseVal,
                          saleQ: purchaseVal ? '' : prev.saleQ // Clear sale if purchase has value
                        }));
                      }}
                      disabled={!!entry.saleQ}
                      placeholder='0'
                      type='number'
                      min='0'
                      step='0.01'
                      size='sm'
                      tabIndex={-1}
                    />
                  </div>
                )}

                {/* Dual Entry Section */}
                {dualEntryEnabled && (
                  <div className='border border-blue-300 rounded p-1 mt-0.5 bg-blue-50'>
                    <h3 className='text-sm font-bold mb-1 text-blue-700 text-center' style={{ fontFamily: 'Times New Roman', fontSize: '14px', fontWeight: 'bold' }}>
                      Dual Entry
                    </h3>
                    {/* Line 1: Date, Company Name, Main Account */}
                    <div className='grid grid-cols-1 md:grid-cols-3 gap-1'>
                      <div className='relative'>
                        <label className='block font-bold text-gray-700 mb-1 text-xs' style={{ fontFamily: 'Times New Roman', fontSize: '14px', fontWeight: 'bold' }}>Date</label>
                        <input
                          type='text'
                          value={dualDateInput}
                          disabled
                          placeholder='dd/MM/yyyy'
                          className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-500 font-bold cursor-not-allowed'
                          style={{ fontWeight: 'bold', fontSize: '14px' }}
                        />
                      </div>
                      <div className='space-y-0.5'>
                        <SearchableSelect
                          ref={dualCompanyNameRef}
                          label='Company Name'
                          value={dualEntry.companyName}
                          onChange={value =>
                            setDualEntry(prev => ({
                              ...prev,
                              companyName: value,
                            }))
                          }
                          onSelect={() => {
                            // Auto-navigate to next field when company is selected
                            setTimeout(() => {
                              if (dualMainAccountRef.current) {
                                dualMainAccountRef.current.focus();
                              }
                            }, 100);
                          }}
                          options={companiesOptions}
                          placeholder='Select company...'
                          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(e, dualMainAccountRef)}
                          required
                          size='sm'
                        />
                        <div className='flex gap-1'>
                          <Button
                            type='button'
                            size='sm'
                            variant='secondary'
                            onClick={() => { setActionTarget('dual'); setShowNewCompany(true); }}
                            className='text-xs px-1 py-1'
                            icon={Building}
                            tabIndex={-1}
                          >
                            Add
                          </Button>
                          {dualEntry.companyName && (
                            <Button
                              type='button'
                              size='sm'
                              variant='danger'
                              onClick={() => handleDelete('company', 'dual')}
                              className='text-xs px-1 py-1'
                              icon={AlertCircle}
                              tabIndex={-1}
                            >
                              Del
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className='flex gap-1 items-end w-full' style={{ minWidth: 0 }}>
                        <div className='w-full' style={{ minWidth: 0 }}>
                          <SearchableSelect
                            ref={dualMainAccountRef}
                            label='Main Account'
                            value={dualEntry.accountName}
                            onChange={value =>
                              setDualEntry(prev => ({
                                ...prev,
                                accountName: value,
                              }))
                            }
                            onSelect={value => {
                              // The report (Balance Sheet / Profit & Loss) comes from the account itself.
                              const matchedAcc = dualCompanyAccounts.find(acc => acc.acc_name === value);
                              setDualEntry(prev => ({ ...prev, reportCategory: matchedAcc?.report_category || '' }));
                              setTimeout(() => {
                                if (dualSubAccountRef.current) {
                                  dualSubAccountRef.current.focus();
                                }
                              }, 100);
                            }}
                            options={dualAccountOptions}
                            placeholder='Select account...'
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(e, dualSubAccountRef)}
                            required
                            disabled={!dualEntry.companyName}
                            size='sm'
                          />
                          <div className='flex gap-1 mt-1'>
                            <Button
                              type='button'
                              size='sm'
                              variant='secondary'
                              onClick={() => openNewAccount('dual')}
                              className='text-xs px-1 py-1'
                              icon={FileText}
                              tabIndex={-1}
                            >
                              Add
                            </Button>
                            <Button
                              type='button'
                              size='sm'
                              variant='secondary'
                              onClick={() => openManageAccounts('dual')}
                              className='text-xs px-1 py-1'
                              icon={Settings}
                              tabIndex={-1}
                            >
                              Manage
                            </Button>
                            {dualEntry.accountName && (
                              <Button
                                type='button'
                                size='sm'
                                variant='danger'
                                onClick={() => handleDelete('account', 'dual')}
                                className='text-xs px-1 py-1'
                                icon={AlertCircle}
                                tabIndex={-1}
                              >
                                Del
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Line 2: Sub Account, Particulars */}
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-1 mt-1'>
                      <SearchableSelect
                        ref={dualSubAccountRef}
                        label='Sub Account'
                        value={dualEntry.subAccount}
                        onChange={value =>
                          setDualEntry(prev => ({ ...prev, subAccount: value }))
                        }
                        onSelect={() => {
                          setTimeout(() => {
                            if (dualParticularsRef.current) {
                              dualParticularsRef.current.focus();
                            }
                          }, 100);
                        }}
                        options={dualSubAccounts}
                        placeholder='Select sub account...'
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(e, dualParticularsRef)}
                        disabled={!dualEntry.accountName}
                      required
                        size='sm'
                      />
                      <Input
                        ref={dualParticularsRef}
                        label='Particulars'
                        value={dualEntry.particulars}
                        onChange={value =>
                          setDualEntry(prev => ({ ...prev, particulars: value }))
                        }
                        onKeyDown={(e) => handleKeyDown(e, dualCreditRef)}
                        placeholder='Enter transaction details...'
                        required
                        size='sm'
                        uppercase={true}
                      />
                    </div>
                    {/* Line 3: Credits, Debits, Payment Mode */}
                    <div className='grid grid-cols-1 md:grid-cols-3 gap-1 mt-1'>
                      <Input
                        ref={dualCreditRef}
                        label='Credit'
                        value={dualEntry.credit}
                        onChange={val => {
                          setDualEntry(prev => ({ ...prev, credit: val }));
                          if (val !== '') {
                            dualCreditManuallyEdited.current = true;
                          } else {
                            dualCreditManuallyEdited.current = false;
                          }
                        }}
                        disabled={!!entry.credit || !!dualEntry.debit || (!entry.credit && !entry.debit)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (dualDebitRef.current && !dualDebitRef.current.disabled) {
                              dualDebitRef.current.focus();
                            } else {
                              if (saveBtnRef.current) {
                                saveBtnRef.current.focus();
                              }
                            }
                          }
                        }}
                        placeholder='Enter credit amount'
                        type='number'
                        min='0'
                        step='any'
                        size='sm'
                      />
                      <Input
                        ref={dualDebitRef}
                        label='Debit'
                        value={dualEntry.debit}
                        onChange={val => {
                          setDualEntry(prev => ({ ...prev, debit: val }));
                          if (val !== '') {
                            dualDebitManuallyEdited.current = true;
                          } else {
                            dualDebitManuallyEdited.current = false;
                          }
                        }}
                        disabled={!!entry.debit || !!dualEntry.credit || (!entry.credit && !entry.debit)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (saveBtnRef.current) {
                              saveBtnRef.current.focus();
                            }
                          }
                        }}
                        placeholder='Enter debit amount'
                        type='number'
                        min='0'
                        step='any'
                        size='sm'
                      />
                    </div>

                    {/* Combined Quantity Checkbox and Inputs for Dual Entry */}
                    <div className='space-y-4 mt-2'>
                      <div className='flex items-center gap-2'>
                        <input
                          ref={dualQuantityCheckedRef}
                          type='checkbox'
                          checked={dualEntry.quantityChecked}
                          onChange={e =>
                            setDualEntry(prev => ({
                              ...prev,
                              quantityChecked: e.target.checked,
                              saleQ: e.target.checked ? prev.saleQ : '',
                              purchaseQ: e.target.checked ? prev.purchaseQ : '',
                            }))
                          }
                          id='dualQuantityChecked'
                          tabIndex={-1}
                        />
                        <label
                          htmlFor='dualQuantityChecked'
                          className='text-sm font-medium'
                        >
                          Quantity Details
                        </label>
                      </div>

                      {dualEntry.quantityChecked && (
                        <div className='grid grid-cols-1 md:grid-cols-2 gap-1'>
                          <Input
                            ref={dualPurchaseQRef}
                            label='Purchase Quantity'
                            value={dualEntry.saleQ}
                            onChange={val => {
                              // If sale quantity is entered, clear purchase quantity
                              const saleVal = val.trim();
                              setDualEntry(prev => ({ 
                                ...prev, 
                                saleQ: saleVal,
                                purchaseQ: saleVal ? '' : prev.purchaseQ // Clear purchase if sale has value
                              }));
                              if (saleVal !== '') {
                                dualPurchaseQManuallyEdited.current = true;
                              } else {
                                dualPurchaseQManuallyEdited.current = false;
                              }
                            }}
                            disabled={!entry.purchaseQ}
                            placeholder='0'
                            type='number'
                            min='0'
                            tabIndex={-1}
                          />
                          <Input
                            ref={dualSaleQRef}
                            label='Sale Quantity'
                            value={dualEntry.purchaseQ}
                            onChange={val => {
                              // If purchase quantity is entered, clear sale quantity
                              const purchaseVal = val.trim();
                              setDualEntry(prev => ({
                                ...prev,
                                purchaseQ: purchaseVal,
                                saleQ: purchaseVal ? '' : prev.saleQ // Clear sale if purchase has value
                              }));
                              if (purchaseVal !== '') {
                                dualSaleQManuallyEdited.current = true;
                              } else {
                                dualSaleQManuallyEdited.current = false;
                              }
                            }}
                            disabled={!entry.saleQ}
                            placeholder='0'
                            type='number'
                            min='0'
                            tabIndex={-1}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className='flex justify-center gap-1 pt-1 border-t border-gray-200'>
                  <Button
                    ref={saveBtnRef}
                    type='submit'
                    disabled={loading}
                    size='sm'
                    className='px-6 py-1 text-xs font-bold'
                  >
                    {loading ? 'Saving...' : 'Save Entry'}
                  </Button>
                  <Button
                    type='button'
                    variant='secondary'
                    size='sm'
                    onClick={() => {
                      const currentPaymentMode = entry.paymentMode || localStorage.getItem('lastSelectedPaymentMode') || '';
                      setEntry({
                        date: entry.date,
                        companyName: '',
                        accountName: '',
                        subAccount: '',
                        particulars: '',
                        saleQ: '',
                        purchaseQ: '',
                        credit: '',
                        debit: '',
                        creditOnline: '',
                        creditOffline: '',
                        debitOnline: '',
                        debitOffline: '',
                        staff: sessionStaff, // Preserve the session staff selection
                        paymentMode: currentPaymentMode, // Keep same Payment Mode
                        quantityChecked: false,
                      });
                      setDualEntry({
                        date: entry.date,
                        companyName: '',
                        accountName: '',
                        subAccount: '',
                        particulars: '',
                        saleQ: '',
                        purchaseQ: '',
                        credit: '',
                        debit: '',
                        creditOnline: '',
                        creditOffline: '',
                        debitOnline: '',
                        debitOffline: '',
                        staff: sessionStaff, // Preserve the session staff selection
                        paymentMode: currentPaymentMode, // Keep same Payment Mode
                        quantityChecked: false,
                      });
                      setDualEntryEnabled(false);
                      dualCreditManuallyEdited.current = false;
                      dualDebitManuallyEdited.current = false;
                      dualPurchaseQManuallyEdited.current = false;
                      dualSaleQManuallyEdited.current = false;
                      // Accounts are now managed by React Query
                      setSubAccounts([]);

                      // Focus back to main Date field
                      setTimeout(() => {
                        if (dateRef.current) {
                          dateRef.current.focus();
                          try {
                            dateRef.current.select();
                          } catch (err) {
                            // Safe fallback
                          }
                        }
                      }, 150);
                    }}
                    className='px-4 py-1 text-xs font-bold'
                    tabIndex={-1}
                  >
                    Reset
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </div>

      {/* Create Company Modal */}
      {showNewCompany && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold mb-4'>Create New Company</h3>
            <div className='space-y-4'>
              <Input
                label='Company Name'
                value={newCompanyName}
                onChange={value => setNewCompanyName(value)}
                placeholder='Enter company name...'
                required
                uppercase={true}
              />
              <Input
                label='Address'
                value={newCompanyAddress}
                onChange={value => setNewCompanyAddress(value)}
                placeholder='Enter company address...'
                uppercase={true}
              />
              <div className='flex gap-2'>
                <Button onClick={handleCreateCompany} className='flex-1'>
                  Create
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => setShowNewCompany(false)}
                  className='flex-1'
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Account Modal */}
      {showNewAccount && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold mb-4'>Create New Account</h3>
            <div className='space-y-4'>
              <Input
                label='Account Name'
                value={newAccountName}
                onChange={value => setNewAccountName(value)}
                placeholder='Enter account name...'
                required
                uppercase={true}
              />
              <div className='space-y-1 text-xs'>
                <label className='block font-semibold text-gray-700'>Report Category *</label>
                <select
                  value={newAccountReportCategory}
                  onChange={e => setNewAccountReportCategory(e.target.value)}
                  className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold bg-white text-gray-900'
                  required
                >
                  <option value="BALANCE_SHEET">Balance Sheet</option>
                  <option value="PROFIT_LOSS">Profit & Loss</option>
                </select>
              </div>
              <div className='flex gap-2'>
                <Button onClick={handleCreateAccount} className='flex-1'>
                  Create
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => setShowNewAccount(false)}
                  className='flex-1'
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Accounts Modal */}
      {showManageAccounts && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-2xl w-full p-6 max-h-[85vh] flex flex-col'>
            <div className='flex justify-between items-center mb-4'>
              <h3 className='text-lg font-semibold text-gray-900'>Manage Main Accounts ({targetEntry.companyName})</h3>
              <button 
                onClick={() => { setShowManageAccounts(false); setEditingAccountId(null); }}
                className='text-gray-400 hover:text-gray-650 text-xl font-bold'
              >
                &times;
              </button>
            </div>
            
            <div className='overflow-y-auto flex-1 pr-1'>
              <table className='min-w-full divide-y divide-gray-200 text-sm'>
                <thead className='bg-gray-50'>
                  <tr>
                    <th className='px-4 py-2 text-left font-semibold text-gray-600'>Account Name</th>
                    <th className='px-4 py-2 text-left font-semibold text-gray-600'>Report Category</th>
                    <th className='px-4 py-2 text-right font-semibold text-gray-600'>Actions</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-200'>
                  {targetCompanyAccounts.map(acc => {
                    const isEditing = editingAccountId === acc.id;
                    return (
                      <tr key={acc.id} className='hover:bg-gray-50'>
                        <td className='px-4 py-2'>
                          {isEditing ? (
                            <input
                              type='text'
                              value={editingAccountName}
                              onChange={e => setEditingAccountName(e.target.value)}
                              className='border border-gray-300 rounded px-2 py-1 w-full font-bold uppercase text-gray-900'
                            />
                          ) : (
                            <span className='font-bold text-gray-900'>{acc.acc_name}</span>
                          )}
                        </td>
                        <td className='px-4 py-2'>
                          {isEditing ? (
                            <select
                              value={editingAccountCategory}
                              onChange={e => setEditingAccountCategory(e.target.value as any)}
                              className='border border-gray-300 rounded px-2 py-1 font-bold text-gray-900'
                            >
                              <option value="BALANCE_SHEET">Balance Sheet</option>
                              <option value="PROFIT_LOSS">Profit & Loss</option>
                            </select>
                          ) : (
                            <span className='text-xs font-semibold px-2.5 py-0.5 rounded bg-blue-100 text-blue-800 uppercase'>
                              {acc.report_category === 'PROFIT_LOSS' ? 'Profit & Loss' : 'Balance Sheet'}
                            </span>
                          )}
                        </td>
                        <td className='px-4 py-2 text-right whitespace-nowrap'>
                          {isEditing ? (
                            <div className='flex justify-end gap-2'>
                              <button
                                onClick={() => handleUpdateAccountSubmit(acc)}
                                className='text-emerald-600 hover:text-emerald-800 font-semibold text-xs'
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingAccountId(null)}
                                className='text-gray-500 hover:text-gray-700 font-semibold text-xs'
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className='flex justify-end gap-3'>
                              <button
                                onClick={() => {
                                  setEditingAccountId(acc.id);
                                  setEditingAccountName(acc.acc_name);
                                  setEditingAccountCategory(acc.report_category as any || 'BALANCE_SHEET');
                                }}
                                className='text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 text-xs'
                              >
                                <Edit className='w-3 h-3' /> Edit
                              </button>
                              <button
                                onClick={() => handleDeleteAccountSubmit(acc)}
                                className='text-red-600 hover:text-red-800 inline-flex items-center gap-1 text-xs'
                              >
                                <Trash2 className='w-3 h-3' /> Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {targetCompanyAccounts.length === 0 && (
                    <tr>
                      <td colSpan={3} className='text-center py-4 text-gray-500'>
                        No accounts created for this company yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className='mt-4 pt-3 border-t border-gray-200 flex justify-end'>
              <Button onClick={() => { setShowManageAccounts(false); setEditingAccountId(null); }}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Sub Account Modal */}
      {showNewSubAccount && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold mb-4'>
              Create New Sub Account
            </h3>
            <div className='space-y-4'>
              <Input
                label='Sub Account Name'
                value={newSubAccountName}
                onChange={value => setNewSubAccountName(value)}
                placeholder='Enter sub account name...'
                required
                uppercase={true}
              />
              <div className='flex gap-2'>
                <Button onClick={handleCreateSubAccount} className='flex-1'>
                  Create
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => setShowNewSubAccount(false)}
                  className='flex-1'
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Staff Modal */}
      {showNewStaff && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold mb-4'>Create New Staff Member</h3>
            <div className='space-y-4'>
              <Input
                label='Staff Name'
                value={newStaffName}
                onChange={value => setNewStaffName(value)}
                placeholder='Enter staff name...'
                required
                uppercase={true}
              />
              <Input
                label='Email (Optional)'
                value={newStaffEmail}
                onChange={value => setNewStaffEmail(value)}
                placeholder='Enter email address...'
                type='email'
              />
              <div className='text-sm text-gray-600 bg-blue-50 p-3 rounded-lg'>
                <strong>Note:</strong> A default password "password123" will be assigned. 
                The staff member can change it after logging in.
              </div>
              <div className='flex gap-2'>
                <Button onClick={handleCreateStaff} className='flex-1' disabled={loading}>
                  {loading ? 'Creating...' : 'Create'}
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => {
                    setShowNewStaff(false);
                    setNewStaffName('');
                    setNewStaffEmail('');
                  }}
                  className='flex-1'
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV Upload Modal */}
      {showUploadModal && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6'>
            <div className='flex items-center justify-between mb-6'>
              <h3 className='text-lg font-semibold'>Upload CSV Data</h3>
              <Button
                variant='secondary'
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadedFile(null);
                  setUploadPreview([]);
                }}
              >
                Close
              </Button>
            </div>

            <div className='space-y-6'>
              {/* File Upload Section */}
              <div className='border-2 border-dashed border-gray-300 rounded-lg p-6 text-center'>
                <Upload className='w-12 h-12 text-gray-400 mx-auto mb-4' />
                <h4 className='text-lg font-medium text-gray-900 mb-2'>
                  Upload CSV File
                </h4>
                <p className='text-gray-600 mb-4'>
                  Upload any CSV file. The system will import ALL your data with
                  automatic column mapping and default values for any missing
                  fields. <strong>Recommended columns:</strong> Date, Company,
                  Main Account, Sub Account, Particulars, Credit, Debit, Staff,
                  Purchase Qty, Sale Qty, Address.
                </p>
                <div className='flex gap-2 justify-center'>
                  <Button
                    variant='secondary'
                    size='sm'
                    onClick={() => {
                      const sampleData = [
                        {
                          Date: '2024-01-15',
                          Company: 'Sample Company',
                          'Main Account': 'Cash',
                          'Sub Account': 'Main Branch',
                          Particulars: 'Sample transaction',
                          Credit: '1000',
                          Debit: '0',
                          Staff: 'admin',
                          'Purchase Qty': '0',
                          'Sale Qty': '0',
                        },
                        {
                          Date: '2024-01-15',
                          Company: 'Sample Company',
                          'Main Account': 'Bank',
                          'Sub Account': 'Main Branch',
                          Particulars: 'Sample transaction 2',
                          Credit: '0',
                          Debit: '500',
                          Staff: 'admin',
                          'Purchase Qty': '0',
                          'Sale Qty': '0',
                        },
                      ];

                      const headers = Object.keys(sampleData[0]);
                      const csvContent = [
                        headers.join(','),
                        ...sampleData.map(row =>
                          headers
                            .map(header => {
                              const value = row[header as keyof typeof row];
                              const escapedValue = String(value).replace(
                                /"/g,
                                '""'
                              );
                              return `"${escapedValue}"`;
                            })
                            .join(',')
                        ),
                      ].join('\n');

                      const blob = new Blob([csvContent], {
                        type: 'text/csv;charset=utf-8;',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'sample-csv-format.csv';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download Sample CSV
                  </Button>
                </div>

                <input
                  type='file'
                  accept='.csv'
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileUpload(file);
                    }
                  }}
                  className='hidden'
                  id='csv-upload'
                />
                <label
                  htmlFor='csv-upload'
                  className='inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 cursor-pointer'
                >
                  Choose CSV File
                </label>
              </div>

              {/* Progress Bar */}
              {uploadLoading && (
                <div className='space-y-4'>
                  {/* Overall Progress */}
                  <div className='space-y-2'>
                    <div className='flex justify-between text-sm text-gray-600'>
                      <span>Importing Data...</span>
                      <span>{importProgress.percentage}%</span>
                    </div>
                    <div className='w-full bg-gray-200 rounded-full h-3'>
                      <div
                        className='bg-blue-600 h-3 rounded-full transition-all duration-300'
                        style={{ width: `${importProgress.percentage}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Detailed Progress Info */}
                  <div className='grid grid-cols-2 md:grid-cols-4 gap-4 text-sm'>
                    <div className='bg-blue-50 p-3 rounded-lg'>
                      <div className='text-blue-800 font-medium'>Progress</div>
                      <div className='text-blue-600'>
                        {importProgress.current.toLocaleString()} /{' '}
                        {importProgress.total.toLocaleString()}
                      </div>
                    </div>
                    <div className='bg-green-50 p-3 rounded-lg'>
                      <div className='text-green-800 font-medium'>Success</div>
                      <div className='text-green-600'>
                        {importProgress.successCount.toLocaleString()}
                      </div>
                    </div>
                    <div className='bg-red-50 p-3 rounded-lg'>
                      <div className='text-red-800 font-medium'>Errors</div>
                      <div className='text-red-600'>
                        {importProgress.errorCount.toLocaleString()}
                      </div>
                    </div>
                    <div className='bg-purple-50 p-3 rounded-lg'>
                      <div className='text-purple-800 font-medium'>Batch</div>
                      <div className='text-purple-600'>
                        {importProgress.currentBatch} /{' '}
                        {importProgress.totalBatches}
                      </div>
                    </div>
                  </div>

                  {/* Speed Indicator */}
                  <div className='text-xs text-gray-500 text-center'>
                    Processing{' '}
                    {importProgress.current > 0
                      ? Math.round(
                          importProgress.current /
                            (importProgress.currentBatch || 1)
                        )
                      : 0}{' '}
                    records per batch
                  </div>
                </div>
              )}

              {/* File Info */}
              {uploadedFile && (
                <div className='bg-green-50 border border-green-200 rounded-lg p-4'>
                  <div className='flex items-center gap-2'>
                    <FileText className='w-5 h-5 text-green-600' />
                    <span className='font-medium text-green-800'>
                      {uploadedFile.name}
                    </span>
                  </div>
                  <p className='text-sm text-green-600 mt-1'>
                    File size: {(uploadedFile.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              )}

              {/* Preview Section */}
              {uploadPreview.length > 0 && (
                <div className='space-y-4'>
                  <h4 className='font-medium text-gray-900'>
                    Preview (First 5 rows)
                  </h4>
                  <div className='overflow-x-auto'>
                    <table className='w-full text-sm border border-gray-200'>
                      <thead className='bg-gray-50 border-b border-gray-200'>
                        <tr>
                          {Object.keys(uploadPreview[0]).map(header => (
                            <th key={header} className='px-3 py-2 text-left'>
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadPreview.map((row, index) => (
                          <tr key={index} className='border-b border-gray-100'>
                            {Object.values(row).map((value: any, cellIndex) => (
                              <td key={cellIndex} className='px-3 py-2'>
                                {String(value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Import Errors */}
              {importErrors.length > 0 && (
                <div className='bg-red-50 border border-red-200 rounded-lg p-4'>
                  <div className='flex items-center gap-2 mb-2'>
                    <AlertCircle className='w-5 h-5 text-red-600' />
                    <span className='font-medium text-red-800'>
                      Import Errors (First 20)
                    </span>
                  </div>
                  <div className='text-sm text-red-700 max-h-40 overflow-y-auto'>
                    {importErrors.map((error, index) => (
                      <div key={index} className='mb-1'>
                        {error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className='flex gap-4'>
                <Button
                  onClick={handleImportCSV}
                  disabled={
                    !uploadedFile || uploadPreview.length === 0 || uploadLoading
                  }
                  className='flex-1'
                >
                  {uploadLoading ? 'Importing...' : 'Import CSV Data'}
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadedFile(null);
                    setUploadPreview([]);
                    setImportErrors([]);
                  }}
                  className='flex-1'
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold mb-4'>Confirm Delete</h3>
            <p className='text-gray-600 mb-4'>
              Are you sure you want to delete this {deleteType}? This action
              cannot be undone.
            </p>
            <div className='flex gap-2'>
              <Button
                onClick={confirmDelete}
                variant='danger'
                className='flex-1'
              >
                Delete
              </Button>
              <Button
                variant='secondary'
                onClick={() => setShowDeleteModal(false)}
                className='flex-1'
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default NewEntry;
