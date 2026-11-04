import React, { useState, useEffect, useMemo } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import SearchableSelect from '../components/UI/SearchableSelect';
import CustomCalendar from '../components/UI/CustomCalendar';
import { supabaseDB, supabase } from '../lib/supabaseDatabase';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import toast from 'react-hot-toast';
import ModeLabel from '../components/UI/ModeLabel';
import { format } from 'date-fns';
import { getTableName } from '../lib/tableNames';
import { getSharedPrintStyles } from '../utils/print';
import { useBook } from '../contexts/BookContext';
import {
  FileText,
  Users,
  CheckCircle,
  X,
  AlertCircle,
  Trash2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Calendar,
} from 'lucide-react';

interface ApprovalFilters {
  date: string;
  company: string;
  mainAccount: string;
  subAccount: string;
  staff: string;
  showUnfiltered: boolean;
}

const ApproveRecords: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();

  const isApprovedStatus = (val: any): boolean => {
    if (val === true) return true;
    if (typeof val === 'string') {
      const norm = val.toLowerCase().trim();
      return norm === 'true' || norm === 'approved';
    }
    return false;
  };

  const [filters, setFilters] = useState<ApprovalFilters>({
    date: format(new Date(), 'yyyy-MM-dd'),
    company: '',
    mainAccount: '',
    subAccount: '',
    staff: '',
    showUnfiltered: false,
  });

  // Display date in dd/MM/yyyy for UI consistency with Daily Report
  const [displayDate, setDisplayDate] = useState<string>(format(new Date(), 'dd/MM/yyyy'));

  // Helpers to convert between display and internal formats
  const convertToInternalFormat = (ddMMyyyy: string): string => {
    if (!ddMMyyyy) return '';
    const parts = ddMMyyyy.split('/');
    if (parts.length !== 3) return '';
    const [day, month, year] = parts;
    if (day.length !== 2 || month.length !== 2 || year.length !== 4) return '';
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const convertToDisplayFormat = (yyyyMMdd: string): string => {
    if (!yyyyMMdd) return '';
    const parts = yyyyMMdd.split('-');
    if (parts.length !== 3) return '';
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  };

  const [allPendingEntries, setAllPendingEntries] = useState<any[]>([]);
  const [approvedEntries, setApprovedEntries] = useState<any[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<any[]>([]);
  const [filteredApprovedEntries, setFilteredApprovedEntries] = useState<any[]>([]);
  const [deletedEntries, setDeletedEntries] = useState<any[]>([]);
  const [filteredDeletedEntries, setFilteredDeletedEntries] = useState<any[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(
    new Set()
  );
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [approvedPage, setApprovedPage] = useState(1);
  const [recordsPerPage] = useState(50);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewEntry, setViewEntry] = useState<any | null>(null);
  const [viewEditing, setViewEditing] = useState(false);
  const [viewDraft, setViewDraft] = useState<any | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  // Derive unique sorted dates containing pending records
  const pendingDates = useMemo(() => {
    const dates = [...new Set(allPendingEntries.map(e => e.c_date).filter(Boolean))];
    return dates.sort();
  }, [allPendingEntries]);

  const handleDatePickerChange = (date: string) => {
    setFilters(prev => ({
      ...prev,
      date: date,
    }));
  };

  // Default filter date to the latest pending date if current date is not in pendingDates
  useEffect(() => {
    if (pendingDates.length > 0) {
      if (!filters.date || !pendingDates.includes(filters.date)) {
        const latestDate = pendingDates[pendingDates.length - 1];
        setFilters(prev => ({ ...prev, date: latestDate }));
      }
    } else {
      if (!filters.date) {
        setFilters(prev => ({ ...prev, date: format(new Date(), 'yyyy-MM-dd') }));
      }
    }
  }, [pendingDates]);

  // Pending entries for the selected date
  const pendingEntriesForDate = useMemo(() => {
    return allPendingEntries.filter(entry => entry.c_date === filters.date);
  }, [allPendingEntries, filters.date]);

  const currentIndex = pendingDates.indexOf(filters.date);
  const isPrevDisabled = pendingDates.length === 0 || currentIndex <= 0;
  const isNextDisabled = pendingDates.length === 0 || currentIndex === -1 || currentIndex >= pendingDates.length - 1;

  // Derived filters based only on pending records for the selected date
  const companyOptions = useMemo(() => {
    const distinctCompanies = [...new Set(pendingEntriesForDate.map(e => e.company_name).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Companies' },
      ...distinctCompanies.map(name => ({ value: name, label: name }))
    ];
  }, [pendingEntriesForDate]);

  const accountOptions = useMemo(() => {
    let filtered = pendingEntriesForDate;
    if (filters.company) {
      filtered = filtered.filter(e => e.company_name === filters.company);
    }
    const distinctAccounts = [...new Set(filtered.map(e => e.acc_name).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Accounts' },
      ...distinctAccounts.map(name => ({ value: name, label: name }))
    ];
  }, [pendingEntriesForDate, filters.company]);

  const subAccountOptions = useMemo(() => {
    let filtered = pendingEntriesForDate;
    if (filters.company) {
      filtered = filtered.filter(e => e.company_name === filters.company);
    }
    if (filters.mainAccount) {
      filtered = filtered.filter(e => e.acc_name === filters.mainAccount);
    }
    const distinctSubAccounts = [...new Set(filtered.map(e => e.sub_acc_name).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Sub Accounts' },
      ...distinctSubAccounts.map(name => ({ value: name, label: name }))
    ];
  }, [pendingEntriesForDate, filters.company, filters.mainAccount]);

  const staffOptions = useMemo(() => {
    let filtered = pendingEntriesForDate;
    if (filters.company) {
      filtered = filtered.filter(e => e.company_name === filters.company);
    }
    if (filters.mainAccount) {
      filtered = filtered.filter(e => e.acc_name === filters.mainAccount);
    }
    if (filters.subAccount) {
      filtered = filtered.filter(e => e.sub_acc_name === filters.subAccount);
    }
    const distinctStaff = [...new Set(filtered.map(e => e.staff).filter(Boolean))].sort();
    return [
      { value: '', label: 'All Staff' },
      ...distinctStaff.map(name => ({ value: name, label: name }))
    ];
  }, [pendingEntriesForDate, filters.company, filters.mainAccount, filters.subAccount]);

  // Validate and auto-reset filters when options change
  useEffect(() => {
    if (filters.company && !companyOptions.some(o => o.value === filters.company)) {
      handleFilterChange('company', '');
    }
  }, [companyOptions, filters.company]);

  useEffect(() => {
    if (filters.mainAccount && !accountOptions.some(o => o.value === filters.mainAccount)) {
      handleFilterChange('mainAccount', '');
    }
  }, [accountOptions, filters.mainAccount]);

  useEffect(() => {
    if (filters.subAccount && !subAccountOptions.some(o => o.value === filters.subAccount)) {
      handleFilterChange('subAccount', '');
    }
  }, [subAccountOptions, filters.subAccount]);

  useEffect(() => {
    if (filters.staff && !staffOptions.some(o => o.value === filters.staff)) {
      handleFilterChange('staff', '');
    }
  }, [staffOptions, filters.staff]);

  // Calculate total pages for pending
  const totalPages = Math.ceil(filteredEntries.length / recordsPerPage);

  // Calculate total pages for approved
  const approvedTotalPages = Math.ceil(filteredApprovedEntries.length / recordsPerPage);

  // Summary data
  const [summary, setSummary] = useState({
    totalRecords: 0,
    approvedRecords: 0,
    rejectedRecords: 0,
    pendingRecords: 0,
    selectedCount: 0,
  });
  const [deletedSummary, setDeletedSummary] = useState({
    totalRecords: 0,
    approvedDeleted: 0,
    rejectedDeleted: 0,
    pendingDeleted: 0,
  });

  const loadEntries = async () => {
    console.log('[ApproveRecords] loadEntries called');
    setLoading(true);
    setFetchError(null);
    
    try {
      console.log('[ApproveRecords] Loading pending entries...');
      const { data: pendingData, error: pendingError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .or('approved.is.null,approved.eq.false,approved.eq.,approved.eq.false');
      
      if (pendingError) {
        console.error('[ApproveRecords] Error loading pending entries:', pendingError);
        throw pendingError;
      }

      // Merge offline operations into the pending list first
      const mergedPending = await supabaseDB.mergeOfflineOperations('cash_book', pendingData || []);

      // Filter out truly approved and rejected records
      const activePending = mergedPending.filter((e: any) => !isApprovedStatus(e.approved) && e.approved !== 'rejected');
      setAllPendingEntries(activePending);

      let approvedData: any[] = [];
      if (filters.date) {
        console.log('[ApproveRecords] Loading approved entries for date:', filters.date);
        const { data: approvedRes, error: approvedError } = await supabase
          .from(getTableName('cash_book'))
          .select('*')
          .eq('c_date', filters.date)
          .in('approved', [true, 'true', 'approved', 'Approved', 'APPROVED']);
        
        if (approvedError) {
          console.error('[ApproveRecords] Error loading approved entries:', approvedError);
          throw approvedError;
        }
        approvedData = approvedRes || [];
        approvedData = await supabaseDB.mergeOfflineOperations('cash_book', approvedData);

        // Scan the merged pending list for entries that were approved offline for this date and add them
        const offlineApprovedForDate = mergedPending.filter((e: any) => e.c_date === filters.date && isApprovedStatus(e.approved));
        
        // Combine them avoiding duplicates
        const approvedIds = new Set(approvedData.map(e => e.id));
        offlineApprovedForDate.forEach((e: any) => {
          if (!approvedIds.has(e.id)) {
            approvedData.push(e);
            approvedIds.add(e.id);
          }
        });
      }
      setApprovedEntries(approvedData);

      console.log('[ApproveRecords] Fetching deleted records...');
      let deleted = await supabaseDB.getDeletedCashBook();
      setDeletedEntries(deleted || []);
    } catch (error) {
      if (!navigator.onLine) {
        console.log('[ApproveRecords] App is offline, loading entries from local queue...');
        try {
          const mergedPending = await supabaseDB.mergeOfflineOperations('cash_book', []);
          const activePending = mergedPending.filter((e: any) => !isApprovedStatus(e.approved) && e.approved !== 'rejected');
          setAllPendingEntries(activePending);

          const approvedForDate = mergedPending.filter((e: any) => e.c_date === filters.date && isApprovedStatus(e.approved));
          setApprovedEntries(approvedForDate);

          const deleted = await supabaseDB.getDeletedCashBook();
          setDeletedEntries(deleted || []);
          
          toast.success('Offline mode: Loaded local changes');
          return; // Prevent standard error message
        } catch (offlineErr) {
          console.error('[ApproveRecords] Error loading offline data:', offlineErr);
        }
      }

      setFetchError('Failed to load entries from the database.');
      console.error('[ApproveRecords] Error loading entries:', error);
      toast.error('Failed to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadEntries();
    }
  }, [isAdmin, tableMode, filters.date, currentBook?.id]);

  useEffect(() => {
    const onRefresh = () => {
      setTimeout(() => {
        console.log('[ApproveRecords] Dashboard refresh triggered, reloading entries...');
        loadEntries();
      }, 500);
    };
    window.addEventListener('dashboard-refresh', onRefresh);
    return () => window.removeEventListener('dashboard-refresh', onRefresh);
  }, []);

  useEffect(() => {
    applyFilters();
  }, [allPendingEntries, approvedEntries, deletedEntries, filters]);

  useEffect(() => {
    updateSummary();
  }, [filteredEntries, filteredApprovedEntries, deletedEntries, selectedEntries]);

  // Keep display date in sync with internal filter date
  useEffect(() => {
    setDisplayDate(convertToDisplayFormat(filters.date) || format(new Date(), 'dd/MM/yyyy'));
  }, [filters.date]);

  // Clamp currentPage
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [filteredEntries.length, totalPages, currentPage]);

  // Clamp approvedPage
  useEffect(() => {
    if (approvedTotalPages > 0 && approvedPage > approvedTotalPages) {
      setApprovedPage(approvedTotalPages);
    }
  }, [filteredApprovedEntries.length, approvedTotalPages, approvedPage]);

  const applyFilters = () => {
    // 1. Filter pending entries by date and dropdown filters
    let pending = allPendingEntries.filter(entry => entry.c_date === filters.date);
    
    if (filters.company) {
      pending = pending.filter(entry => entry.company_name === filters.company);
    }
    if (filters.mainAccount) {
      pending = pending.filter(entry => entry.acc_name === filters.mainAccount);
    }
    if (filters.subAccount) {
      pending = pending.filter(entry => entry.sub_acc_name === filters.subAccount);
    }
    if (filters.staff) {
      pending = pending.filter(entry => {
        const entryStaff = entry.staff ? String(entry.staff).trim() : '';
        const filterStaff = String(filters.staff).trim();
        return entryStaff === filterStaff || entryStaff.toLowerCase().includes(filterStaff.toLowerCase());
      });
    }
    setFilteredEntries(pending);

    // 2. Filter approved entries by dropdown filters
    let approved = [...approvedEntries];
    if (filters.company) {
      approved = approved.filter(entry => entry.company_name === filters.company);
    }
    if (filters.mainAccount) {
      approved = approved.filter(entry => entry.acc_name === filters.mainAccount);
    }
    if (filters.subAccount) {
      approved = approved.filter(entry => entry.sub_acc_name === filters.subAccount);
    }
    if (filters.staff) {
      approved = approved.filter(entry => {
        const entryStaff = entry.staff ? String(entry.staff).trim() : '';
        const filterStaff = String(filters.staff).trim();
        return entryStaff === filterStaff || entryStaff.toLowerCase().includes(filterStaff.toLowerCase());
      });
    }
    setFilteredApprovedEntries(approved);

    // 3. Apply filters to deleted records
    let del = [...deletedEntries];
    if (filters.date) del = del.filter(d => d.c_date === filters.date);
    if (filters.company) del = del.filter(d => d.company_name === filters.company);
    if (filters.mainAccount) del = del.filter(d => d.acc_name === filters.mainAccount);
    if (filters.subAccount) del = del.filter(d => d.sub_acc_name === filters.subAccount);
    if (filters.staff) {
      del = del.filter(d => {
        const entryStaff = d.staff ? String(d.staff).trim() : '';
        const filterStaff = String(filters.staff).trim();
        return entryStaff === filterStaff || entryStaff.toLowerCase().includes(filterStaff.toLowerCase());
      });
    }
    
    const pendingDeleted = del.filter(d => {
      return !isApprovedStatus(d.approved) && d.approved !== 'rejected';
    });
    setFilteredDeletedEntries(pendingDeleted);

    const totalDeleted = del.length;
    const approvedDeleted = del.filter(d => isApprovedStatus(d.approved)).length;
    const rejectedDeleted = del.filter(d => d.approved === 'rejected').length;
    const pendingDeletedCount = totalDeleted - approvedDeleted - rejectedDeleted;
    setDeletedSummary({ totalRecords: totalDeleted, approvedDeleted, rejectedDeleted, pendingDeleted: pendingDeletedCount });
  };

  const updateSummary = () => {
    // Total pending on the selected date matching current filters
    const pendingCount = filteredEntries.length;
    
    // Total approved on the selected date matching current filters
    const approvedCount = filteredApprovedEntries.length;

    // Total rejected on the selected date
    const rejectedCount = 0;
    
    const selectedCount = selectedEntries.size;
    
    setSummary({
      totalRecords: pendingCount + approvedCount,
      approvedRecords: approvedCount,
      rejectedRecords: rejectedCount,
      pendingRecords: pendingCount,
      selectedCount
    });

    // Calculate deleted records summary
    let deletedFiltered = [...deletedEntries];
    
    // Apply same filters to deleted records
    if (filters.date) {
      deletedFiltered = deletedFiltered.filter(d => d.c_date === filters.date);
    }
    if (filters.company) {
      deletedFiltered = deletedFiltered.filter(d => d.company_name === filters.company);
    }
    if (filters.mainAccount) {
      deletedFiltered = deletedFiltered.filter(d => d.acc_name === filters.mainAccount);
    }
    if (filters.subAccount) {
      deletedFiltered = deletedFiltered.filter(d => d.sub_acc_name === filters.subAccount);
    }
    if (filters.staff) {
      deletedFiltered = deletedFiltered.filter(d => {
        const entryStaff = d.staff ? String(d.staff).trim() : '';
        const filterStaff = String(filters.staff).trim();
        return entryStaff === filterStaff || entryStaff.toLowerCase().includes(filterStaff.toLowerCase());
      });
    }
    
    const approvedDeleted = deletedFiltered.filter(d => isApprovedStatus(d.approved)).length;
    const rejectedDeleted = deletedFiltered.filter(d => d.approved === 'rejected').length;
    const totalDeleted = deletedFiltered.length;
    const pendingDeleted = deletedFiltered.filter(d => 
      !isApprovedStatus(d.approved) && d.approved !== 'rejected'
    ).length;
    
    setDeletedSummary({
      totalRecords: totalDeleted,
      approvedDeleted,
      rejectedDeleted,
      pendingDeleted
    });
  };

  const handleFilterChange = (field: keyof ApprovalFilters, value: any) => {
    setFilters(prev => {
      const updated = {
        ...prev,
        [field]: value,
      };
      if (field === 'company') {
        updated.mainAccount = '';
        updated.subAccount = '';
      } else if (field === 'mainAccount') {
        updated.subAccount = '';
      }
      return updated;
    });
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    if (pendingDates.length === 0) return;
    const currentIndex = pendingDates.indexOf(filters.date);
    let newIndex = currentIndex;
    if (direction === 'next') {
      if (currentIndex < pendingDates.length - 1) {
        newIndex = currentIndex + 1;
      }
    } else {
      if (currentIndex > 0) {
        newIndex = currentIndex - 1;
      }
    }
    const newDate = pendingDates[newIndex];
    if (newDate) {
      setFilters(prev => ({
        ...prev,
        date: newDate,
      }));
    }
  };

  const handleSelectEntry = (entryId: string) => {
    const newSelected = new Set(selectedEntries);
    if (newSelected.has(entryId)) {
      newSelected.delete(entryId);
    } else {
      newSelected.add(entryId);
    }
    setSelectedEntries(newSelected);
  };

  const handleSelectAll = () => {
    const currentPageEntries = getCurrentPageEntries();
    const allSelected = currentPageEntries.every(entry =>
      selectedEntries.has(entry.id)
    );

    const newSelected = new Set(selectedEntries);

    if (allSelected) {
      // Deselect all on current page
      currentPageEntries.forEach(entry => newSelected.delete(entry.id));
    } else {
      // Select all on current page
      currentPageEntries.forEach(entry => newSelected.add(entry.id));
    }

    setSelectedEntries(newSelected);
  };

  const handleDirectApprove = async (entryId: string) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    try {
      setLoading(true);
      
      const { error } = await supabase
        .from(getTableName('cash_book'))
        .update({
          approved: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', entryId);

      if (error) {
        console.error('Error approving record:', error);
        toast.error('Failed to approve record');
        return;
      }

      toast.success('Record approved successfully!');
      
      // Immediately remove the approved record from local state
      setAllPendingEntries(prev => prev.filter(entry => entry.id !== entryId));
      
      await loadEntries();
      
      localStorage.setItem('dashboard-refresh', Date.now().toString());
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    } catch (error) {
      console.error('Error approving record:', error);
      toast.error('Error approving record');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDirectApprove = async (entryId: string) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    try {
      setLoading(true);
      
      const { error } = await supabase
        .from(getTableName('cash_book'))
        .update({
          approved: '', // reset to pending
          updated_at: new Date().toISOString(),
        })
        .eq('id', entryId);

      if (error) {
        console.error('Error cancelling approval:', error);
        toast.error('Failed to cancel approval');
        return;
      }

      toast.success('Approval cancelled successfully!');
      
      setApprovedEntries(prev => prev.filter(entry => entry.id !== entryId));
      
      await loadEntries();
      
      localStorage.setItem('dashboard-refresh', Date.now().toString());
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    } catch (error) {
      console.error('Error cancelling approval:', error);
      toast.error('Error cancelling approval');
    } finally {
      setLoading(false);
    }
  };


  // Deleted records approve/reject handlers
  const handleDeletedApprove = async (id: string) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    try {
      setLoading(true);
      console.log('🗑️ Approving deleted record:', id);
      
      const { error } = await supabase
        .from(getTableName('deleted_cash_book'))
        .update({ approved: true })
        .eq('id', id);
      
      if (error) {
        console.error('❌ Error approving deleted record:', error);
        throw error;
      }
      
      console.log('✅ Deleted record approved successfully');
      toast.success('Deleted record approved');
      
      // Update localStorage to mark the record as approved
      try {
        const deletedRecordsStr = localStorage.getItem('deleted_records');
        if (deletedRecordsStr) {
          const deletedRecords = JSON.parse(deletedRecordsStr);
          const updatedRecords = deletedRecords.map((record: any) => 
            record.id === id ? { ...record, approved: true } : record
          );
          localStorage.setItem('deleted_records', JSON.stringify(updatedRecords));
          console.log('✅ Updated localStorage with approved status');
        }
      } catch (error) {
        console.error('❌ Error updating localStorage:', error);
      }
      
      // Immediately remove the approved record from the local state and update summary
      setDeletedEntries(prev => {
        const updated = prev.filter(entry => entry.id !== id);
        // Update summary immediately after state change
        setTimeout(() => {
          updateSummary();
          // Also update deleted summary directly
          setDeletedSummary(prevSummary => ({
            ...prevSummary,
            totalRecords: prevSummary.totalRecords - 1,
            approvedDeleted: prevSummary.approvedDeleted + 1,
            pendingDeleted: prevSummary.pendingDeleted - 1
          }));
        }, 0);
        return updated;
      });
      
      // Update filtered list immediately
      setFilteredDeletedEntries(prev => prev.filter(entry => entry.id !== id));
      
      // Also reload to get updated data
      console.log('🔄 Reloading entries after approval...');
      await loadEntries();
      console.log('✅ Entries reloaded');
      
      // Trigger dashboard refresh
      localStorage.setItem('dashboard-refresh', Date.now().toString());
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    } catch (e) {
      console.error('Deleted approve error:', e);
      toast.error('Failed to approve deleted record');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletedReject = async (id: string) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase
        .from(getTableName('deleted_cash_book'))
        .update({ approved: 'rejected' })
        .eq('id', id);
      if (error) throw error;
      toast.success('Deleted record rejected');
      
      // Update localStorage to mark the record as rejected
      try {
        const deletedRecordsStr = localStorage.getItem('deleted_records');
        if (deletedRecordsStr) {
          const deletedRecords = JSON.parse(deletedRecordsStr);
          const updatedRecords = deletedRecords.map((record: any) => 
            record.id === id ? { ...record, approved: 'rejected' } : record
          );
          localStorage.setItem('deleted_records', JSON.stringify(updatedRecords));
          console.log('✅ Updated localStorage with rejected status');
        }
      } catch (error) {
        console.error('❌ Error updating localStorage:', error);
      }
      
      // Immediately remove the rejected record from the local state and update summary
      setDeletedEntries(prev => {
        const updated = prev.filter(entry => entry.id !== id);
        // Update summary immediately after state change
        setTimeout(() => {
          updateSummary();
          // Also update deleted summary directly
          setDeletedSummary(prevSummary => ({
            ...prevSummary,
            totalRecords: prevSummary.totalRecords - 1,
            rejectedDeleted: prevSummary.rejectedDeleted + 1,
            pendingDeleted: prevSummary.pendingDeleted - 1
          }));
        }, 0);
        return updated;
      });
      
      // Update filtered list immediately
      setFilteredDeletedEntries(prev => prev.filter(entry => entry.id !== id));
      
      // Also reload to get updated data
      await loadEntries();
      
      // Trigger dashboard refresh
      localStorage.setItem('dashboard-refresh', Date.now().toString());
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    } catch (e) {
      console.error('Deleted reject error:', e);
      toast.error('Failed to reject deleted record');
    } finally {
      setLoading(false);
    }
  };

  const approveSelected = async () => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (selectedEntries.size === 0) {
      toast.error('Please select entries to approve');
      return;
    }

    setLoading(true);
    try {
      let approvedCount = 0;

      for (const entryId of selectedEntries) {
        const { error } = await supabase
          .from(getTableName('cash_book'))
          .update({
            approved: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', entryId);

        if (!error) {
          approvedCount++;
        }
      }

      if (approvedCount > 0) {
        await loadEntries();
        setSelectedEntries(new Set());
        toast.success(`${approvedCount} entries approved successfully!`);
        
        // Trigger dashboard refresh
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        toast.error('Failed to approve entries');
      }
    } catch (error) {
      toast.error('Failed to approve entries');
    } finally {
      setLoading(false);
    }
  };

  const approveAllCompanywise = async () => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (!filters.company) {
      toast.error('Please select a company first');
      return;
    }

    // Get all pending entries for the selected company (not approved and not rejected)
    const companyEntries = filteredEntries.filter(
      entry => {
        const matchesCompany = entry.company_name === filters.company;
        const isPending = !isApprovedStatus(entry.approved) && entry.approved !== 'rejected';
        return matchesCompany && isPending;
      }
    );

    if (companyEntries.length === 0) {
      toast.error('No pending entries found for this company');
      return;
    }

    if (
      window.confirm(
        `Approve all ${companyEntries.length} pending entries for ${filters.company}?`
      )
    ) {
      setLoading(true);
      try {
        let approvedCount = 0;
        let errorCount = 0;

        for (const entry of companyEntries) {
          try {
            const { error } = await supabase
              .from(getTableName('cash_book'))
              .update({
                approved: true,
                updated_at: new Date().toISOString(),
              })
              .eq('id', entry.id);

            if (error) {
              console.error(`Error approving entry ${entry.id}:`, error);
              errorCount++;
            } else {
              approvedCount++;
            }
          } catch (err) {
            console.error(`Exception approving entry ${entry.id}:`, err);
            errorCount++;
          }
        }

        if (approvedCount > 0) {
          await loadEntries();
          setSelectedEntries(new Set());
          if (errorCount > 0) {
            toast.success(`${approvedCount} entries approved for ${filters.company}! ${errorCount} failed.`);
          } else {
            toast.success(`${approvedCount} entries approved for ${filters.company}!`);
          }
          
          // Trigger dashboard refresh
          localStorage.setItem('dashboard-refresh', Date.now().toString());
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        } else {
          toast.error(`Failed to approve entries. ${errorCount} errors occurred.`);
        }
      } catch (error) {
        console.error('Error in approveAllCompanywise:', error);
        toast.error('Failed to approve company entries');
      } finally {
        setLoading(false);
      }
    }
  };

  const approveAllStaffwise = async () => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (!filters.staff) {
      toast.error('Please select staff first');
      return;
    }

    // Get all pending entries for the selected staff (not approved and not rejected)
    const staffEntries = filteredEntries.filter(
      entry => {
        const matchesStaff = entry.staff === filters.staff;
        const isPending = !isApprovedStatus(entry.approved) && entry.approved !== 'rejected';
        return matchesStaff && isPending;
      }
    );

    if (staffEntries.length === 0) {
      toast.error('No pending entries found for this staff member');
      return;
    }

    if (
      window.confirm(
        `Approve all ${staffEntries.length} pending entries for ${filters.staff}?`
      )
    ) {
      setLoading(true);
      try {
        let approvedCount = 0;
        let errorCount = 0;

        for (const entry of staffEntries) {
          try {
            const { error } = await supabase
              .from(getTableName('cash_book'))
              .update({
                approved: true,
                updated_at: new Date().toISOString(),
              })
              .eq('id', entry.id);

            if (error) {
              console.error(`Error approving entry ${entry.id}:`, error);
              errorCount++;
            } else {
              approvedCount++;
            }
          } catch (err) {
            console.error(`Exception approving entry ${entry.id}:`, err);
            errorCount++;
          }
        }

        if (approvedCount > 0) {
          await loadEntries();
          setSelectedEntries(new Set());
          if (errorCount > 0) {
            toast.success(`${approvedCount} entries approved for ${filters.staff}! ${errorCount} failed.`);
          } else {
            toast.success(`${approvedCount} entries approved for ${filters.staff}!`);
          }
          
          // Trigger dashboard refresh
          localStorage.setItem('dashboard-refresh', Date.now().toString());
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        } else {
          toast.error(`Failed to approve entries. ${errorCount} errors occurred.`);
        }
      } catch (error) {
        console.error('Error in approveAllStaffwise:', error);
        toast.error('Failed to approve staff entries');
      } finally {
        setLoading(false);
      }
    }
  };

  const approveAllWithoutConfirmation = async () => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    // Get all pending entries (not approved and not rejected)
    const pendingEntries = filteredEntries.filter(
      entry => !isApprovedStatus(entry.approved) && entry.approved !== 'rejected'
    );

    if (pendingEntries.length === 0) {
      toast.error('No pending entries to approve');
      return;
    }

    setLoading(true);
    try {
      let approvedCount = 0;
      let errorCount = 0;

      // Approve all entries directly without any confirmation
      for (const entry of pendingEntries) {
        try {
          const { error } = await supabase
            .from(getTableName('cash_book'))
            .update({
              approved: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', entry.id);

          if (error) {
            console.error(`Error approving entry ${entry.id}:`, error);
            errorCount++;
          } else {
            approvedCount++;
          }
        } catch (err) {
          console.error(`Exception approving entry ${entry.id}:`, err);
          errorCount++;
        }
      }

      if (approvedCount > 0) {
        await loadEntries();
        setSelectedEntries(new Set());
        if (errorCount > 0) {
          toast.success(`${approvedCount} entries approved without confirmation! ${errorCount} failed.`);
        } else {
          toast.success(`${approvedCount} entries approved without confirmation!`);
        }
        
        // Trigger dashboard refresh
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        toast.error(`Failed to approve entries. ${errorCount} errors occurred.`);
      }
    } catch (error) {
      console.error('Error in approveAllWithoutConfirmation:', error);
      toast.error('Failed to approve entries');
    } finally {
      setLoading(false);
    }
  };

  const approveAllWithConfirmation = async () => {
    // Get all pending entries (not approved and not rejected)
    const pendingEntries = filteredEntries.filter(
      entry => !isApprovedStatus(entry.approved) && entry.approved !== 'rejected'
    );

    if (pendingEntries.length === 0) {
      toast.error('No pending entries to approve');
      return;
    }

    setLoading(true);
    try {
      let approvedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      // Approve entries one by one with confirmation for each
      for (let i = 0; i < pendingEntries.length; i++) {
        const entry = pendingEntries[i];
        const entryInfo = `Entry ${i + 1} of ${pendingEntries.length}\nDate: ${entry.c_date}\nCompany: ${entry.company_name}\nAccount: ${entry.acc_name}\nAmount: ${entry.credit || entry.debit || 0}`;
        
        // Show confirmation dialog for each entry
        const shouldApprove = window.confirm(
          `Approve this entry?\n\n${entryInfo}\n\nClick OK to approve, Cancel to skip.`
        );

        if (shouldApprove) {
          try {
            const { error } = await supabase
              .from(getTableName('cash_book'))
              .update({
                approved: true,
                updated_at: new Date().toISOString(),
              })
              .eq('id', entry.id);

            if (error) {
              console.error(`Error approving entry ${entry.id}:`, error);
              errorCount++;
            } else {
              approvedCount++;
            }
          } catch (err) {
            console.error(`Exception approving entry ${entry.id}:`, err);
            errorCount++;
          }
        } else {
          skippedCount++;
        }
      }

      // Reload entries after processing all
      await loadEntries();
      setSelectedEntries(new Set());
      
      // Show summary message
      if (approvedCount > 0) {
        let message = `${approvedCount} entries approved with confirmation!`;
        if (skippedCount > 0) {
          message += ` ${skippedCount} skipped.`;
        }
        if (errorCount > 0) {
          message += ` ${errorCount} failed.`;
        }
        toast.success(message);
        
        // Trigger dashboard refresh
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        if (skippedCount > 0) {
          toast(`No entries approved. ${skippedCount} entries were skipped.`);
        } else {
          toast.error(`Failed to approve entries. ${errorCount} errors occurred.`);
        }
      }
    } catch (error) {
      console.error('Error in approveAllWithConfirmation:', error);
      toast.error('Failed to approve entries');
    } finally {
      setLoading(false);
    }
  };

  const cancelApprove = async () => {
    // Get all approved entries from filtered approved entries
    const approvedEntries = [...filteredApprovedEntries];

    if (approvedEntries.length === 0) {
      toast.error('No approved entries found to cancel');
      return;
    }

    if (!window.confirm(`Are you sure you want to cancel approval for ${approvedEntries.length} approved entries? This will reset them to pending status.`)) {
      return;
    }
    
    setLoading(true);
    try {
      let cancelledCount = 0;
      let errorCount = 0;

      for (const entry of approvedEntries) {
        try {
          const { error } = await supabase
            .from(getTableName('cash_book'))
            .update({ 
              approved: '', // Reset to pending (empty string)
              updated_at: new Date().toISOString() 
            })
            .eq('id', entry.id);

          if (error) {
            console.error(`Error cancelling approval for entry ${entry.id}:`, error);
            errorCount++;
          } else {
            cancelledCount++;
          }
        } catch (err) {
          console.error(`Exception cancelling approval for entry ${entry.id}:`, err);
          errorCount++;
        }
      }

      if (cancelledCount > 0) {
        await loadEntries();
        setSelectedEntries(new Set());
        if (errorCount > 0) {
          toast.success(`${cancelledCount} entries approval cancelled successfully! ${errorCount} failed.`);
        } else {
          toast.success(`${cancelledCount} entries approval cancelled successfully!`);
        }
        
        // Trigger dashboard refresh
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        toast.error(`Failed to cancel approval for entries. ${errorCount} errors occurred.`);
      }
    } catch (error) {
      console.error('Error cancelling approval:', error);
      toast.error('Failed to cancel approval for entries');
    } finally {
      setLoading(false);
    }
  };

  const printReport = () => {
    try {
      // Create a print-friendly version of the current page
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Popup blocked. Please allow popups for this site.');
        return;
      }

      const currentPageEntries = getCurrentPageEntries();
      const title = `Approve Records - ${filters.date}`;

      const printContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <style>
              @media print {
                @page { size: portrait; margin: 8mm; }
              }
              body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; }
              .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
              .title { font-size: 24px; font-weight: bold; margin: 0; }
              .subtitle { font-size: 16px; color: #666; margin: 5px 0; }
              table { width: 100%; border-collapse: collapse; margin: 20px 0; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f3f4f6; font-weight: bold; }
              .approved { background-color: #d1fae5; }
              .pending { background-color: #fef3c7; }
              .summary { margin: 20px 0; padding: 15px; background-color: #f8f9fa; border: 1px solid #dee2e6; }
              .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #666; }
              ${getSharedPrintStyles({ isLandscape: false })}
            </style>
          </head>
          <body>
            <div class="header">
              <h1 class="title">Thirumala Group</h1>
              <p class="subtitle">Approve Records Report</p>
              <p>Date: ${filters.date} | Company: ${filters.company || 'All'} | Main Account: ${filters.mainAccount || 'All'} | Sub Account: ${filters.subAccount || 'All'} | Staff: ${filters.staff || 'All'}</p>
            </div>

            <div class="summary">
              <h3>Summary</h3>
              <p>Total Records: ${summary.totalRecords} | Approved: ${summary.approvedRecords} | Rejected: ${summary.rejectedRecords} | Pending: ${summary.pendingRecords}</p>
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
                  <th class="col-credit">Credit</th>
                  <th class="col-debit">Debit</th>
                </tr>
              </thead>
              <tbody>
                ${currentPageEntries
                  .map(
                    (entry, index) => `
                  <tr class="${entry.approved ? 'approved' : 'pending'}">
                    <td class="col-sno text-center">${index + 1}</td>
                    <td class="col-date">${format(new Date(entry.c_date), 'dd/MM/yyyy')}</td>
                    <td class="col-company">${entry.company_name || ''}</td>
                    <td class="col-account">${entry.acc_name || ''}</td>
                    <td class="col-sub-account">${entry.sub_acc_name || '-'}</td>
                    <td class="col-particulars">${entry.particulars || ''}</td>
                    <td class="col-credit text-right">${entry.credit > 0 ? `${entry.credit.toLocaleString()}` : '-'}</td>
                    <td class="col-debit text-right">${entry.debit > 0 ? `${entry.debit.toLocaleString()}` : '-'}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>

            <div class="footer">
              <p>Generated by Thirumala Group Business Management System</p>
              <p>Generated on: ${new Date().toLocaleString()}</p>
            </div>
          </body>
        </html>
      `;

      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();

      // Wait for content to load then print
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);

      toast.success('Print dialog opened');
    } catch (error) {
      console.error('Print error:', error);
      toast.error('Failed to open print dialog');
    }
  };

  const printAll = () => {
    try {
      // Create a print-friendly version of all filtered records
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Popup blocked. Please allow popups for this site.');
        return;
      }

      const title = `All Approve Records - ${filters.date}`;

      const printContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <style>
              @media print {
                @page { size: portrait; margin: 8mm; }
              }
              body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; }
              .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
              .title { font-size: 24px; font-weight: bold; margin: 0; }
              .subtitle { font-size: 16px; color: #666; margin: 5px 0; }
              table { width: 100%; border-collapse: collapse; margin: 20px 0; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f3f4f6; font-weight: bold; }
              .approved { background-color: #d1fae5; }
              .pending { background-color: #fef3c7; }
              .summary { margin: 20px 0; padding: 15px; background-color: #f8f9fa; border: 1px solid #dee2e6; }
              .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #666; }
              .page-break { page-break-before: always; }
              ${getSharedPrintStyles({ isLandscape: false })}
            </style>
          </head>
          <body>
            <div class="header">
              <h1 class="title">Thirumala Group</h1>
              <p class="subtitle">All Approve Records Report</p>
              <p>Date: ${filters.date} | Company: ${filters.company || 'All'} | Staff: ${filters.staff || 'All'}</p>
            </div>

            <div class="summary">
              <h3>Summary</h3>
              <p>Total Records: ${summary.totalRecords} | Approved: ${summary.approvedRecords} | Rejected: ${summary.rejectedRecords} | Pending: ${summary.pendingRecords}</p>
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
                  <th class="col-credit">Credit</th>
                  <th class="col-debit">Debit</th>
                </tr>
              </thead>
              <tbody>
                ${filteredEntries
                  .map(
                    (entry, _) => `
                  <tr class="${entry.approved ? 'approved' : 'pending'}">
                    <td class="col-sno text-center">${entry.sno}</td>
                    <td class="col-date">${format(new Date(entry.c_date), 'dd/MM/yyyy')}</td>
                    <td class="col-company">${entry.company_name || ''}</td>
                    <td class="col-account">${entry.acc_name || ''}</td>
                    <td class="col-sub-account">${entry.sub_acc_name || '-'}</td>
                    <td class="col-particulars">${entry.particulars || ''}</td>
                    <td class="col-credit text-right">${entry.credit > 0 ? `${entry.credit.toLocaleString()}` : '-'}</td>
                    <td class="col-debit text-right">${entry.debit > 0 ? `${entry.debit.toLocaleString()}` : '-'}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>

            <div class="footer">
              <p>Generated by Thirumala Group Business Management System</p>
              <p>Generated on: ${new Date().toLocaleString()}</p>
            </div>
          </body>
        </html>
      `;

      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();

      // Wait for content to load then print
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);

      toast.success('Print all dialog opened');
    } catch (error) {
      console.error('Print all error:', error);
      toast.error('Failed to open print all dialog');
    }
  };

  const closeWindow = () => {
    // Close the current window/tab
    window.close();
  };

  const getCurrentPageEntries = () => {
    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = startIndex + recordsPerPage;
    return filteredEntries.slice(startIndex, endIndex);
  };

  const getApprovedPageEntries = () => {
    const startIndex = (approvedPage - 1) * recordsPerPage;
    const endIndex = startIndex + recordsPerPage;
    return filteredApprovedEntries.slice(startIndex, endIndex);
  };


  if (!isAdmin) {
    return (
      <div className='flex items-center justify-center min-h-96'>
        <div className='text-center'>
          <AlertCircle className='w-16 h-16 text-red-500 mx-auto mb-4' />
          <h2 className='text-xl font-semibold text-gray-900 mb-2'>
            Access Denied
          </h2>
          <p className='text-gray-600'>
            Only administrators can access the approval system.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6'>

      {loading && (
        <div className='text-center py-8 text-blue-600 font-semibold'>
          Loading records...
        </div>
      )}
      {fetchError && !loading && (
        <div className='text-center py-8 text-red-600 font-semibold'>
          {fetchError}
        </div>
      )}
      {/* Locked Book Banner */}
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm flex items-center gap-3 no-print mb-6">
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
              Approve Records
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
            Review and approve pending cash book entries
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <Button variant='secondary' onClick={loadEntries}>
            Refresh
          </Button>
          <Button variant='secondary' onClick={printReport}>
            Print
          </Button>
          <Button variant='secondary' onClick={printAll}>
            Print All
          </Button>
          <Button variant='secondary' onClick={closeWindow}>
            Close
          </Button>
        </div>
      </div>

      {/* Controls */}
      <Card className='bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'>
        <div className='grid grid-cols-1 md:grid-cols-6 gap-4 gap-y-4'>
          {/* Date Navigation */}
          <div className='md:col-span-2 w-full'>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Date (dd/MM/yyyy)
            </label>
            <div className='flex items-center gap-2 w-full'>
              <Button
                size='sm'
                variant='secondary'
                onClick={() => navigateDate('prev')}
                disabled={isPrevDisabled}
                className='px-3 shrink-0'
              >
                Previous
              </Button>
              <div className='relative flex-1 w-full'>
                <input
                  type='text'
                  value={displayDate}
                  placeholder='dd/MM/yyyy'
                  onChange={(e) => {
                    const inputValue = e.target.value;
                    setDisplayDate(inputValue);
                    const internalDate = convertToInternalFormat(inputValue);
                    if (inputValue.match(/^\d{2}\/\d{2}\/\d{4}$/) && internalDate) {
                      setFilters(prev => ({ ...prev, date: internalDate }));
                    }
                  }}
                  onBlur={(e) => {
                    const inputValue = e.target.value;
                    if (inputValue && inputValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                      const internalDate = convertToInternalFormat(inputValue);
                      if (internalDate) {
                        setFilters(prev => ({ ...prev, date: internalDate }));
                      }
                    } else if (inputValue) {
                      const currentDate = format(new Date(), 'yyyy-MM-dd');
                      setFilters(prev => ({ ...prev, date: currentDate }));
                    }
                  }}
                  className='w-full border border-gray-300 rounded-lg px-3 py-1.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm'
                />
                <button
                  type='button'
                  onClick={() => setShowCalendar(!showCalendar)}
                  className='absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded text-gray-500'
                >
                  <Calendar className='w-4 h-4' />
                </button>
                {showCalendar && (
                  <CustomCalendar
                    entries={allPendingEntries}
                    onDateSelect={(date) => {
                      handleDatePickerChange(date);
                      setShowCalendar(false);
                    }}
                    selectedDate={filters.date}
                    onClose={() => setShowCalendar(false)}
                    dotColor="red"
                    tooltipLabel="Pending Approvals"
                  />
                )}
              </div>
              <Button
                size='sm'
                variant='secondary'
                onClick={() => navigateDate('next')}
                disabled={isNextDisabled}
                className='px-3 shrink-0'
              >
                Next
              </Button>
            </div>
          </div>
          {/* Company Filter */}
          <div className='w-full'>
            <SearchableSelect
              label='Company'
              value={filters.company}
              onChange={value => handleFilterChange('company', value)}
              options={companyOptions}
              placeholder='Search company...'
              className='w-full'
            />
          </div>
          {/* Main Account Filter */}
          <div className='w-full'>
            <SearchableSelect
              label='Main Account'
              value={filters.mainAccount}
              onChange={value => handleFilterChange('mainAccount', value)}
              options={accountOptions}
              placeholder='Search main account...'
              className='w-full'
            />
          </div>
          {/* Sub Account Filter */}
          <div className='w-full'>
            <SearchableSelect
              label='Sub Account'
              value={filters.subAccount}
              onChange={value => handleFilterChange('subAccount', value)}
              options={subAccountOptions}
              placeholder='Search sub account...'
              className='w-full'
            />
          </div>
          {/* Staff Filter */}
          <div className='w-full'>
            <SearchableSelect
              label='Staff'
              value={filters.staff}
              onChange={value => handleFilterChange('staff', value)}
              options={staffOptions}
              placeholder='Search staff...'
              className='w-full'
            />
          </div>
          {/* Record Count */}
          <div className='flex items-end w-full'>
            <div className='text-sm text-gray-600 bg-white px-3 py-2 rounded-lg border border-gray-300 w-full text-center'>
              <strong>{summary.totalRecords}</strong> records
            </div>
          </div>
        </div>
      </Card>

      {/* Approval Actions */}
      <Card className='bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'>
        <div className='grid grid-cols-1 md:grid-cols-6 gap-3'>
          <Button
            onClick={approveAllCompanywise}
            className='bg-blue-600 hover:bg-blue-700 text-sm'
            disabled={!filters.company || loading}
          >
            Approve All Companywise
          </Button>

          <Button
            onClick={approveAllStaffwise}
            className='bg-purple-600 hover:bg-purple-700 text-sm'
            disabled={!filters.staff || loading}
          >
            Approve All Staffwise
          </Button>

          <Button
            onClick={approveAllWithoutConfirmation}
            className='bg-orange-600 hover:bg-orange-700 text-sm'
            disabled={loading}
          >
            Approve All Without Confirmation
          </Button>

          <Button
            onClick={approveAllWithConfirmation}
            className='bg-green-600 hover:bg-green-700 text-sm'
            disabled={loading}
          >
            Approve All With Confirmation
          </Button>

          <Button
            onClick={cancelApprove}
            variant='secondary'
            className='text-sm'
          >
            Cancel Approve
          </Button>

          <Button
            onClick={approveSelected}
            className='bg-indigo-600 hover:bg-indigo-700 text-sm'
            disabled={selectedEntries.size === 0 || loading}
          >
            Approve Selected ({selectedEntries.size})
          </Button>
        </div>
      </Card>

      {/* Summary Cards */}
      <div className='grid grid-cols-1 md:grid-cols-5 gap-4'>
        <Card className='bg-gradient-to-r from-gray-500 to-gray-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-gray-100 text-sm font-medium'>Total Records</p>
              <p className='text-2xl font-bold'>{summary.totalRecords}</p>
            </div>
            <FileText className='w-8 h-8 text-gray-200' />
          </div>
        </Card>

        <Card className='bg-white text-gray-900'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-green-700 text-sm font-medium'>Approved</p>
              <p className='text-2xl font-bold'>{summary.approvedRecords}</p>
            </div>
            <CheckCircle className='w-8 h-8 text-green-500' />
          </div>
        </Card>

        <Card className='bg-white text-gray-900'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-red-700 text-sm font-medium'>Rejected</p>
              <p className='text-2xl font-bold'>{summary.rejectedRecords}</p>
            </div>
            <X className='w-8 h-8 text-red-500' />
          </div>
        </Card>

        <Card className='bg-gradient-to-r from-orange-500 to-orange-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-orange-100 text-sm font-medium'>Pending</p>
              <p className='text-2xl font-bold'>{summary.pendingRecords}</p>
            </div>
            <Clock className='w-8 h-8 text-orange-200' />
          </div>
        </Card>

        <Card className='bg-gradient-to-r from-purple-500 to-purple-600 text-white'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-purple-100 text-sm font-medium'>Selected</p>
              <p className='text-2xl font-bold'>{summary.selectedCount}</p>
            </div>
            <Users className='w-8 h-8 text-purple-200' />
          </div>
        </Card>

        {/* Deleted Records Summary */}
        <Card className='bg-white text-gray-900'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-red-700 text-sm font-medium'>Deleted Pending</p>
              <p className='text-2xl font-bold'>{deletedSummary.pendingDeleted}</p>
            </div>
            <Trash2 className='w-8 h-8 text-red-500' />
          </div>
        </Card>
        <Card className='bg-white text-gray-900'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-green-700 text-sm font-medium'>Deleted Approved</p>
              <p className='text-2xl font-bold'>{deletedSummary.approvedDeleted}</p>
            </div>
            <CheckCircle className='w-8 h-8 text-green-500' />
          </div>
        </Card>
        <Card className='bg-white text-gray-900'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-red-700 text-sm font-medium'>Deleted Rejected</p>
              <p className='text-2xl font-bold'>{deletedSummary.rejectedDeleted}</p>
            </div>
            <X className='w-8 h-8 text-red-500' />
          </div>
        </Card>
      </div>

      {/* Records Table */}
      {!loading && (
        <Card
          title='Records for Approval'
          subtitle={`Showing ${getCurrentPageEntries().length} of ${filteredEntries.length} records`}
        >
          <div className='overflow-x-auto'>
            <table className='fit-table'>
              <thead className='bg-gray-50 border-b border-gray-200'>
                <tr>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    <input
                      type='checkbox'
                      checked={
                        selectedEntries.size === filteredEntries.length &&
                        filteredEntries.length > 0
                      }
                      onChange={handleSelectAll}
                      className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded'
                    />
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    S.No
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Date
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Company
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Account
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Sub Account
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Particulars
                  </th>
                  <th className='px-3 py-2 text-right font-medium text-gray-700'>
                    Credit
                  </th>
                  <th className='px-3 py-2 text-right font-medium text-gray-700'>
                    Debit
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Staff
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    User
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Entry Date & Time
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Status
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {getCurrentPageEntries().length === 0 ? (
                  <tr>
                    <td colSpan={14} className='text-center py-8 text-gray-500'>
                      No pending records found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  getCurrentPageEntries().map((entry, index) => (
                    <tr
                      key={entry.id}
                      className={`border-b transition-colors cursor-pointer ${
                        entry.edited === true || entry.edited === 'true'
                          ? 'bg-[#FDE7F3] hover:bg-[#FBCFE8]'
                          : 'bg-orange-50 hover:bg-orange-100'
                      }`}
                      onClick={e => {
                        if (
                          (e.target as HTMLElement).closest(
                            'input[type="checkbox"]'
                          ) ||
                          (e.target as HTMLElement).closest('button')
                        ) {
                          return;
                        }
                        handleSelectEntry(entry.id);
                      }}
                      onDoubleClick={() => {
                        setViewEntry(entry);
                        setViewDraft({ ...entry });
                        setViewEditing(false);
                        setViewOpen(true);
                      }}
                      title="Double click to view details"
                    >
                      <td className='px-3 py-2'>
                        <input
                          type='checkbox'
                          checked={selectedEntries.has(entry.id)}
                          onChange={e => {
                            e.stopPropagation();
                            handleSelectEntry(entry.id);
                          }}
                          className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded'
                        />
                      </td>
                      <td className='px-3 py-2 font-medium'>{index + 1 + (currentPage - 1) * recordsPerPage}</td>
                      <td className='px-3 py-2 fit-nowrap'>
                        {format(new Date(entry.c_date), 'dd/MM/yyyy')}
                      </td>
                      <td className='px-3 py-2 font-medium text-blue-600 fit-name'>
                        {entry.company_name}
                      </td>
                      <td className='px-3 py-2'>{entry.acc_name}</td>
                      <td className='px-3 py-2'>{entry.sub_acc_name || '-'}</td>
                      <td
                        className='px-3 py-2 fit-particulars'
                        title={entry.particulars}
                      >
                        {entry.particulars}
                      </td>
                      <td className='px-3 py-2 text-right font-medium text-green-600 fit-nowrap'>
                        {entry.credit > 0
                          ? `${entry.credit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-3 py-2 text-right font-medium text-red-600 fit-nowrap'>
                        {entry.debit > 0
                          ? `${entry.debit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-3 py-2'>{entry.staff}</td>
                      <td className='px-3 py-2'>{entry.users}</td>
                      <td className='px-3 py-2'>
                        <span className='fit-nowrap'>{format(new Date(entry.c_date), 'dd/MM/yyyy')}</span>{' '}
                        <span className='fit-nowrap'>{format(new Date(entry.entry_time), 'hh:mm:ss a')}</span>
                      </td>
                      <td className='px-3 py-2'>
                        {entry.edited === true || entry.edited === 'true' ? (
                          <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-pink-100 text-pink-800 border border-pink-200'>
                            ✏️ Edited
                          </span>
                        ) : (
                          <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200'>
                            📝 New
                          </span>
                        )}
                      </td>
                      <td className='px-3 py-2'>
                        <div className='flex gap-1.5'>
                          <Button
                            variant='secondary'
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewEntry(entry);
                              setViewDraft({ ...entry });
                              setViewEditing(false);
                              setViewOpen(true);
                            }}
                            className='text-xs px-2 py-1'
                          >
                            View
                          </Button>
                          <Button
                            variant='secondary'
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDirectApprove(entry.id);
                            }}
                            disabled={entry.approved === true}
                            className='text-xs px-2 py-1'
                          >
                            Approve
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className='flex items-center justify-between mt-4 px-2 py-3 sm:px-6'>
            <div className='flex-1 flex justify-between sm:hidden'>
              <Button
                variant='secondary'
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button
                variant='secondary'
                onClick={() =>
                  setCurrentPage(prev => Math.min(totalPages, prev + 1))
                }
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
            <div className='hidden sm:flex-1 sm:flex sm:items-center sm:justify-between'>
              <div className='flex-1 text-sm text-center'>
                <p className='text-sm text-gray-700'>
                  Showing{' '}
                  <span className='font-semibold'>
                    {filteredEntries.length === 0 ? 0 : (currentPage * recordsPerPage - recordsPerPage + 1)}
                  </span>{' '}
                  to{' '}
                  <span className='font-semibold'>
                    {Math.min(
                      currentPage * recordsPerPage,
                      filteredEntries.length
                    )}
                  </span>{' '}
                  of{' '}
                  <span className='font-semibold'>
                    {filteredEntries.length}
                  </span>{' '}
                  results
                </p>
              </div>
              <div>
                <nav
                  className='relative z-0 inline-flex rounded-md shadow-sm -space-x-px'
                  aria-label='Pagination'
                >
                  <Button
                    variant='secondary'
                    onClick={() =>
                      setCurrentPage(prev => Math.max(1, prev - 1))
                    }
                    disabled={currentPage === 1}
                    className='rounded-l-md'
                  >
                    Previous
                  </Button>
                  <Button
                    variant='secondary'
                    onClick={() =>
                      setCurrentPage(prev => Math.min(totalPages, prev + 1))
                    }
                    disabled={currentPage === totalPages}
                    className='rounded-r-md'
                  >
                    Next
                  </Button>
                </nav>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Approved Records Table */}
      {!loading && (
        <Card
          title='Approved Records'
          subtitle={`Showing ${getApprovedPageEntries().length} of ${filteredApprovedEntries.length} records`}
        >
          <div className='overflow-x-auto'>
            <table className='fit-table'>
              <thead className='bg-gray-50 border-b border-gray-200'>
                <tr>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    S.No
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Date
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Company
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Account
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Sub Account
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Particulars
                  </th>
                  <th className='px-3 py-2 text-right font-medium text-gray-700'>
                    Credit
                  </th>
                  <th className='px-3 py-2 text-right font-medium text-gray-700'>
                    Debit
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Staff
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    User
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Entry Date & Time
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Status
                  </th>
                  <th className='px-3 py-2 text-left font-medium text-gray-700'>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {getApprovedPageEntries().length === 0 ? (
                  <tr>
                    <td colSpan={13} className='text-center py-8 text-gray-500'>
                      No approved records found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  getApprovedPageEntries().map((entry, index) => (
                    <tr
                      key={entry.id}
                      className={`border-b transition-colors cursor-pointer ${
                        index % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-25 hover:bg-gray-50'
                      }`}
                      onDoubleClick={() => {
                        setViewEntry(entry);
                        setViewDraft({ ...entry });
                        setViewEditing(false);
                        setViewOpen(true);
                      }}
                      title="Double click to view details"
                    >
                      <td className='px-3 py-2 font-medium'>{index + 1 + (approvedPage - 1) * recordsPerPage}</td>
                      <td className='px-3 py-2 fit-nowrap'>
                        {format(new Date(entry.c_date), 'dd/MM/yyyy')}
                      </td>
                      <td className='px-3 py-2 font-medium text-blue-600 fit-name'>
                        {entry.company_name}
                      </td>
                      <td className='px-3 py-2'>{entry.acc_name}</td>
                      <td className='px-3 py-2'>{entry.sub_acc_name || '-'}</td>
                      <td
                        className='px-3 py-2 fit-particulars'
                        title={entry.particulars}
                      >
                        {entry.particulars}
                      </td>
                      <td className='px-3 py-2 text-right font-medium text-green-600 fit-nowrap'>
                        {entry.credit > 0
                          ? `${entry.credit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-3 py-2 text-right font-medium text-red-600 fit-nowrap'>
                        {entry.debit > 0
                          ? `${entry.debit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-3 py-2'>{entry.staff}</td>
                      <td className='px-3 py-2'>{entry.users}</td>
                      <td className='px-3 py-2'>
                        <span className='fit-nowrap'>{format(new Date(entry.c_date), 'dd/MM/yyyy')}</span>{' '}
                        <span className='fit-nowrap'>{format(new Date(entry.entry_time), 'hh:mm:ss a')}</span>
                      </td>
                      <td className='px-3 py-2'>
                        <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 border border-green-200'>
                          ✅ Approved
                        </span>
                      </td>
                      <td className='px-3 py-2'>
                        <div className='flex gap-1.5'>
                          <Button
                            variant='secondary'
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewEntry(entry);
                              setViewDraft({ ...entry });
                              setViewEditing(false);
                              setViewOpen(true);
                            }}
                            className='text-xs px-2 py-1'
                          >
                            View
                          </Button>
                          <Button
                            variant='secondary'
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelDirectApprove(entry.id);
                            }}
                            className='text-xs px-2 py-1'
                          >
                            Cancel Approve
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className='flex items-center justify-between mt-4 px-2 py-3 sm:px-6'>
            <div className='flex-1 flex justify-between sm:hidden'>
              <Button
                variant='secondary'
                onClick={() => setApprovedPage(prev => Math.max(1, prev - 1))}
                disabled={approvedPage === 1}
              >
                Previous
              </Button>
              <Button
                variant='secondary'
                onClick={() =>
                  setApprovedPage(prev => Math.min(approvedTotalPages, prev + 1))
                }
                disabled={approvedPage === approvedTotalPages}
              >
                Next
              </Button>
            </div>
            <div className='hidden sm:flex-1 sm:flex sm:items-center sm:justify-between'>
              <div className='flex-1 text-sm text-center'>
                <p className='text-sm text-gray-700'>
                  Showing{' '}
                  <span className='font-semibold'>
                    {filteredApprovedEntries.length === 0 ? 0 : (approvedPage * recordsPerPage - recordsPerPage + 1)}
                  </span>{' '}
                  to{' '}
                  <span className='font-semibold'>
                    {Math.min(
                      approvedPage * recordsPerPage,
                      filteredApprovedEntries.length
                    )}
                  </span>{' '}
                  of{' '}
                  <span className='font-semibold'>
                    {filteredApprovedEntries.length}
                  </span>{' '}
                  results
                </p>
              </div>
              <div>
                <nav
                  className='relative z-0 inline-flex rounded-md shadow-sm -space-x-px'
                  aria-label='Pagination'
                >
                  <Button
                    variant='secondary'
                    onClick={() =>
                      setApprovedPage(prev => Math.max(1, prev - 1))
                    }
                    disabled={approvedPage === 1}
                    className='rounded-l-md'
                  >
                    Previous
                  </Button>
                  <Button
                    variant='secondary'
                    onClick={() =>
                      setApprovedPage(prev => Math.min(approvedTotalPages, prev + 1))
                    }
                    disabled={approvedPage === approvedTotalPages}
                    className='rounded-r-md'
                  >
                    Next
                  </Button>
                </nav>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Deleted Records Approval */}
      {!loading && (
        <Card title='Deleted Records' subtitle={`Showing ${filteredDeletedEntries.length} of ${deletedSummary.totalRecords} deleted records`}>
          <div className='mb-4 flex gap-2'>
            <Button
              variant='secondary'
              size='sm'
              onClick={async () => {
                console.log('🔍 Debug: Checking deleted records...');
                console.log('🔍 Deleted entries from state:', deletedEntries);
                console.log('🔍 Filtered deleted entries:', filteredDeletedEntries);
                console.log('🔍 Deleted summary:', deletedSummary);
                
                // Try to fetch fresh data
                const freshDeleted = await supabaseDB.getDeletedCashBook();
                console.log('🔍 Fresh deleted records from DB:', freshDeleted);
                
                toast.success('Debug info logged to console');
              }}
              className='flex items-center gap-2'
            >
              <AlertTriangle className='w-4 h-4' />
              Debug Deleted Records
            </Button>
            <Button
              variant='secondary'
              size='sm'
              onClick={loadEntries}
              disabled={loading}
            >
              <RefreshCw className='w-4 h-4' />
              Refresh
            </Button>
          </div>
          <div className='overflow-x-auto'>
            <table className='fit-table'>
              <thead className='sticky top-0 bg-gray-50 z-10'>
                <tr className='border-b border-gray-200'>
                  <th className='px-1 py-1 text-left font-medium text-gray-700'>
                    S.No
                  </th>
                  <th className='px-1 py-1 text-left font-medium text-gray-700'>
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
                    Credit
                  </th>
                  <th className='px-1 py-1 text-right font-medium text-gray-700'>
                    Debit
                  </th>
                  <th className='px-1 py-1 text-left font-medium text-gray-700'>
                    Staff
                  </th>
                  <th className='px-1 py-1 text-left font-medium text-gray-700'>
                    User
                  </th>
                  <th className='px-1 py-1 text-left font-medium text-gray-700'>
                    Deleted At
                  </th>
                  <th className='px-1 py-1 text-center font-medium text-gray-700'>
                    Status
                  </th>
                  <th className='px-1 py-1 text-center font-medium text-gray-700'>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDeletedEntries.map((d, index) => (
                  <tr key={d.id} className={`border-b transition-colors ${
                    !isApprovedStatus(d.approved) && d.approved !== 'rejected' 
                      ? 'bg-red-50 hover:bg-red-100' 
                      : 'hover:bg-gray-50'
                  }`}>
                    <td className='px-1 py-1 font-medium text-xs'>{index + 1}</td>
                    <td className='px-1 py-1 text-xs fit-nowrap'>
                      {format(new Date(d.c_date), 'dd/MM/yyyy')}
                    </td>
                    <td className='px-1 py-1 font-medium text-blue-600 text-xs fit-name' title={d.company_name}>
                      {d.company_name}
                    </td>
                    <td className='px-1 py-1 text-xs' title={d.acc_name?.replace(/\[DELETED\]\s*/g, '')}>
                      {d.acc_name?.replace(/\[DELETED\]\s*/g, '') || '-'}
                    </td>
                    <td className='px-1 py-1 text-xs' title={d.sub_acc_name?.replace(/\[DELETED\]\s*/g, '')}>
                      {d.sub_acc_name?.replace(/\[DELETED\]\s*/g, '') || '-'}
                    </td>
                    <td className='px-1 py-1 text-xs fit-particulars' title={d.particulars?.replace(/\[DELETED\]\s*/g, '')}>
                      {d.particulars?.replace(/\[DELETED\]\s*/g, '') || '-'}
                    </td>
                    <td className='px-1 py-1 text-right font-medium text-green-600 text-xs fit-nowrap'>
                      {d.credit ? `${Number(d.credit).toLocaleString()}` : '-'}
                    </td>
                    <td className='px-1 py-1 text-right font-medium text-red-600 text-xs fit-nowrap'>
                      {d.debit ? `${Number(d.debit).toLocaleString()}` : '-'}
                    </td>
                    <td className='px-1 py-1 text-xs' title={d.staff}>
                      {d.staff}
                    </td>
                    <td className='px-1 py-1 text-xs' title={d.users}>
                      {d.users}
                    </td>
                    <td className='px-1 py-1 text-xs fit-nowrap'>
                      {format(new Date(d.deleted_at), 'hh:mm:ss a')}
                    </td>
                    <td className='px-1 py-1 text-center'>
                      {isApprovedStatus(d.approved) ? (
                        <span className='inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 border border-green-200'>
                          ✅ Approved
                        </span>
                      ) : d.approved === 'rejected' ? (
                        <span className='inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200'>
                          Rejected
                        </span>
                      ) : (
                        <span className='inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200 animate-pulse'>
                          🗑️ Delete Request
                        </span>
                      )}
                    </td>
                    <td className='px-1 py-1 text-center'>
                      <div className='flex flex-row gap-1'>
                        <Button
                          variant='secondary'
                          onClick={() => {
                            handleDeletedApprove(d.id);
                          }}
                          disabled={d.approved === true || d.approved === 'true'}
                          className='text-xs px-1 py-0.5'
                        >
                          Approve
                        </Button>
                        <Button
                          variant='secondary'
                          onClick={() => {
                            handleDeletedReject(d.id);
                          }}
                          disabled={d.approved === 'rejected'}
                          className='text-xs px-2 py-1'
                        >
                          Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {/* View/Edit Modal */}
      {viewOpen && viewEntry && (
        <div className='fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4'>
          <div className='bg-white rounded-lg w-full max-w-2xl p-4'>
            <div className='flex items-center justify-between mb-3'>
              <div className='flex items-center gap-2'>
                <h3 className='text-lg font-semibold'>Entry Details</h3>
                {(viewEntry.edited === true || viewEntry.edited === 'true') && (
                  <span className='inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-pink-100 text-pink-800 border border-pink-200 animate-pulse'>
                    ✏️ Edited Record
                  </span>
                )}
              </div>
              <button onClick={() => setViewOpen(false)} className='text-gray-500'>✕</button>
            </div>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
              <Input label='Date' value={viewDraft?.c_date || ''} onChange={v => setViewDraft((p:any)=>({ ...p, c_date: v }))} disabled={!viewEditing} />
              <Input label='Company' value={viewDraft?.company_name || ''} onChange={v => setViewDraft((p:any)=>({ ...p, company_name: v }))} disabled={!viewEditing} />
              <Input label='Main Account' value={viewDraft?.acc_name || ''} onChange={v => setViewDraft((p:any)=>({ ...p, acc_name: v }))} disabled={!viewEditing} />
              <Input label='Sub Account' value={viewDraft?.sub_acc_name || ''} onChange={v => setViewDraft((p:any)=>({ ...p, sub_acc_name: v }))} disabled={!viewEditing} />
              <Input label='Particulars' value={viewDraft?.particulars || ''} onChange={v => setViewDraft((p:any)=>({ ...p, particulars: v }))} disabled={!viewEditing} />
              <Input label='Credit' value={viewDraft?.credit ?? ''} onChange={v => setViewDraft((p:any)=>({ ...p, credit: Number((parseFloat(v)||0).toFixed(2)) }))} disabled={!viewEditing} type='number' min='0' step='any' />
              <Input label='Debit' value={viewDraft?.debit ?? ''} onChange={v => setViewDraft((p:any)=>({ ...p, debit: Number((parseFloat(v)||0).toFixed(2)) }))} disabled={!viewEditing} type='number' min='0' step='any' />
              <Input label='Staff' value={viewDraft?.staff || ''} onChange={v => setViewDraft((p:any)=>({ ...p, staff: v }))} disabled={!viewEditing} />
            </div>
            <div className='flex justify-end gap-2 mt-4'>
              {!viewEditing ? (
                <>
                  <Button variant='secondary' onClick={() => setViewOpen(false)}>Close</Button>
                  {!currentBook?.is_locked && (
                    <Button onClick={() => setViewEditing(true)}>Edit</Button>
                  )}
                </>
              ) : (
                <>
                  <Button variant='secondary' onClick={() => { setViewEditing(false); setViewDraft({ ...viewEntry }); }}>Cancel</Button>
                  <Button onClick={async () => {
                    if (currentBook?.is_locked) {
                      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
                      return;
                    }
                    try {
                      const saved = await supabaseDB.updateCashBookEntry(viewEntry.id, {
                        c_date: viewDraft.c_date,
                        company_name: viewDraft.company_name,
                        acc_name: viewDraft.acc_name,
                        sub_acc_name: viewDraft.sub_acc_name,
                        particulars: viewDraft.particulars,
                        credit: viewDraft.credit,
                        debit: viewDraft.debit,
                        staff: viewDraft.staff,
                      }, user?.username || 'admin');
                      if (saved) {
                        toast.success('Entry updated');
                        setViewEntry(saved);
                        setViewEditing(false);
                        await loadEntries();
                      } else {
                        toast.error('Failed to update');
                      }
                    } catch (e) {
                      toast.error('Update failed');
                    }
                  }}>Save</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApproveRecords;
