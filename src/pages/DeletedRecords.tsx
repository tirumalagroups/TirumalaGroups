import React, { useState, useEffect, useMemo } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import SearchableSelect from '../components/UI/SearchableSelect';
import { supabaseDB } from '../lib/supabaseDatabase';
import { useAuth } from '../contexts/AuthContext';
import { useBook } from '../contexts/BookContext';
import { useTableMode } from '../contexts/TableModeContext';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  Trash2,
  RotateCcw,
  Search,
  Calendar,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';

interface DeletedRecord {
  id: string;
  sno: number;
  acc_name: string;
  sub_acc_name: string | null;
  particulars: string | null;
  c_date: string;
  credit: number;
  debit: number;
  company_name: string;
  staff: string | null;
  users: string | null;
  deleted_by: string;
  deleted_at: string;
  approved: boolean;
  edited: boolean;
  created_at: string;
  updated_at: string;
}

const DeletedRecords: React.FC = () => {
  const { isAdmin } = useAuth();
  const { currentBook } = useBook();
  const { mode: tableMode } = useTableMode();
  const [deletedRecords, setDeletedRecords] = useState<DeletedRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  
  // Dropdown options
  const [companies, setCompanies] = useState<{ value: string; label: string }[]>([]);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  
  // Calendar state
  const [showCalendar, setShowCalendar] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage] = useState(50);

  useEffect(() => {
    loadDeletedRecords();
    loadDropdownData();
  }, [tableMode, currentBook?.id]); // Reload when mode or book changes

  useEffect(() => {
    applyFilters();
  }, [deletedRecords, searchTerm, selectedDate, selectedCompany, selectedUser]);

  // Handle click outside calendar to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showCalendar && !target.closest('.calendar-container') && !target.closest('button[type="button"]')) {
        setShowCalendar(false);
      }
    };

    if (showCalendar) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCalendar]);

  // Get dates that have deleted records
  const getDatesWithDeletedRecords = useMemo(() => {
    const datesWithDeleted = new Set<string>();
    deletedRecords.forEach(record => {
      if (record.deleted_at) {
        try {
          // Extract date from deleted_at (which is a timestamp)
          const deletedDate = new Date(record.deleted_at);
          if (!isNaN(deletedDate.getTime())) {
            const dateStr = format(deletedDate, 'yyyy-MM-dd');
            datesWithDeleted.add(dateStr);
          }
        } catch (error) {
          console.warn('Invalid date format for deleted record:', record.deleted_at, error);
        }
      }
    });
    
    console.log('Calendar: Dates with deleted records:', Array.from(datesWithDeleted).sort());
    
    return datesWithDeleted;
  }, [deletedRecords]);

  const loadDeletedRecords = async () => {
    setLoading(true);
    try {
      console.log('🔄 Loading deleted records...');
      
      // First, run debug to see what's in the database
      await supabaseDB.debugDeletedRecords();
      
      const records = await supabaseDB.getDeletedCashBook();
      console.log('📋 Raw records from getDeletedCashBook:', records);
      
      // Clean up any remaining [DELETED] text (but preserve deleted_by and deleted_at)
      const cleanedRecords = records.map(record => ({
        ...record,
        acc_name: record.acc_name ? record.acc_name.replace(/\[DELETED\]\s*/g, '').trim() : record.acc_name,
        particulars: record.particulars ? record.particulars.replace(/\[DELETED\]\s*/g, '').trim() : record.particulars,
        company_name: record.company_name ? record.company_name.replace(/\[DELETED\]\s*/g, '').trim() : record.company_name,
        sub_acc_name: record.sub_acc_name ? record.sub_acc_name.replace(/\[DELETED\]\s*/g, '').trim() : record.sub_acc_name,
        // Ensure deleted_by and deleted_at are preserved
        deleted_by: record.deleted_by || record.users || record.staff || 'Unknown',
        deleted_at: record.deleted_at || record.updated_at || record.created_at || new Date().toISOString()
      }));
      
      setDeletedRecords(cleanedRecords as DeletedRecord[]);
      console.log(`✅ Loaded ${records.length} deleted records`);
      
      if (records.length === 0) {
        console.log('⚠️ No deleted records found. This could mean:');
        console.log('1. No records have been deleted yet');
        console.log('2. The delete function is not working properly');
        console.log('3. The database query is not finding the records');
        toast('No deleted records found. Try deleting a record first.', { icon: '⚠️' });
      } else {
        toast.success(`Loaded ${records.length} deleted records`);
      }
    } catch (error) {
      console.error('Error loading deleted records:', error);
      toast.error('Failed to load deleted records');
    } finally {
      setLoading(false);
    }
  };

  const loadDropdownData = async () => {
    try {
      // Load companies
      const companiesData = await supabaseDB.getCompanies();
      const companiesOptions = companiesData.map(company => ({
        value: company.company_name,
        label: company.company_name,
      }));
      setCompanies([{ value: '', label: 'All Companies' }, ...companiesOptions]);

      // Load users
      const usersData = await supabaseDB.getUsers();
      const usersOptions = usersData.map(user => ({
        value: user.username,
        label: user.username,
      }));
      setUsers([{ value: '', label: 'All Users' }, ...usersOptions]);


    } catch (error) {
      console.error('Error loading dropdown data:', error);
    }
  };

  const applyFilters = () => {
    let filtered = [...deletedRecords];

    // Search filter matching all columns
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(record => {
        // Date checks
        let dateStr1 = '';
        let dateStr2 = '';
        if (record.c_date) {
          try {
            const dateObj = new Date(record.c_date);
            if (!isNaN(dateObj.getTime())) {
              dateStr1 = format(dateObj, 'dd/MM/yyyy');
              dateStr2 = format(dateObj, 'yyyy-MM-dd');
            }
          } catch {
            /* ignore date parsing errors */
          }
        }
        
        let delDateStr1 = '';
        let delDateStr2 = '';
        let delTimeStr = '';
        if (record.deleted_at) {
          try {
            const dateObj = new Date(record.deleted_at);
            if (!isNaN(dateObj.getTime())) {
              delDateStr1 = format(dateObj, 'dd/MM/yyyy');
              delDateStr2 = format(dateObj, 'yyyy-MM-dd');
              delTimeStr = format(dateObj, 'HH:mm');
            }
          } catch {
            /* ignore date parsing errors */
          }
        }

        const creditStr = record.credit != null ? String(record.credit) : '';
        const debitStr = record.debit != null ? String(record.debit) : '';
        const paymentModeStr = (record as any).payment_mode || '';
        
        return (
          (record.particulars || '').toLowerCase().includes(searchLower) ||
          (record.acc_name || '').toLowerCase().includes(searchLower) ||
          (record.sub_acc_name || '').toLowerCase().includes(searchLower) ||
          (record.company_name || '').toLowerCase().includes(searchLower) ||
          (record.staff || '').toLowerCase().includes(searchLower) ||
          (record.users || '').toLowerCase().includes(searchLower) ||
          (record.deleted_by || '').toLowerCase().includes(searchLower) ||
          paymentModeStr.toLowerCase().includes(searchLower) ||
          creditStr.includes(searchLower) ||
          debitStr.includes(searchLower) ||
          dateStr1.includes(searchLower) ||
          dateStr2.includes(searchLower) ||
          delDateStr1.includes(searchLower) ||
          delDateStr2.includes(searchLower) ||
          delTimeStr.includes(searchLower)
        );
      });
    }

    // Date filter
    if (selectedDate) {
      filtered = filtered.filter(record => 
        record.deleted_at?.startsWith(selectedDate)
      );
    }

    // Company filter
    if (selectedCompany) {
      filtered = filtered.filter(record => 
        record.company_name === selectedCompany
      );
    }

    // User filter
    if (selectedUser) {
      filtered = filtered.filter(record => 
        record.deleted_by === selectedUser
      );
    }

    setFilteredRecords(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const restoreRecord = async (record: DeletedRecord) => {
    if (currentBook?.is_locked) {
      toast.error('This book is locked. Cannot restore deleted records.');
      return;
    }

    if (!isAdmin) {
      toast.error('Only admins can restore deleted records');
      return;
    }

    if (!window.confirm(`Are you sure you want to restore entry #${record.sno}?`)) {
      return;
    }

    setRestoring(record.id);
    try {
      console.log('🔄 Restoring deleted record:', record.id);
      
      // Use the new restore function from supabaseDatabase
      const success = await supabaseDB.restoreCashBookEntry(record.id);

      if (success) {
        // Refresh the list
        await loadDeletedRecords();
        toast.success(`Entry #${record.sno} restored successfully!`);
        
        // Trigger dashboard refresh
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        toast.error('Failed to restore record');
      }
      
    } catch (error) {
      console.error('Error restoring record:', error);
      toast.error('Failed to restore record');
    } finally {
      setRestoring(null);
    }
  };



  const exportToExcel = () => {
    const exportData = filteredRecords.map((record, index) => ({
      'S.No': index + 1,
      'Date': format(new Date(record.c_date), 'dd-MMM-yyyy'),
      'Company': record.company_name,
      'Main Account': record.acc_name,
      'Sub Account': record.sub_acc_name || '',
      'Particulars': record.particulars,
      'Credit': record.credit,
      'Debit': record.debit,
      'Staff': record.staff,
      'User': record.users,
      'Deleted By': record.deleted_by,
      'Deleted At': format(new Date(record.deleted_at), 'dd/MM/yyyy HH:mm'),
      'Approved': record.approved ? 'Yes' : 'No',
      'Edited': record.edited ? 'Yes' : 'No',
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
    a.download = `deleted-records-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Deleted records exported successfully!');
  };

  // Pagination
  const totalPages = Math.ceil(filteredRecords.length / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = startIndex + recordsPerPage;
  const currentRecords = filteredRecords.slice(startIndex, endIndex);

  const getStatusIcon = (record: DeletedRecord) => {
    if (record.approved) {
      return (
        <span title="Approved">
          <CheckCircle className="w-4 h-4 text-green-600" />
        </span>
      );
    } else if (record.edited) {
      return (
        <span title="Edited">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
        </span>
      );
    } else {
      return (
        <span title="Pending">
          <XCircle className="w-4 h-4 text-red-600" />
        </span>
      );
    }
  };

  // Custom Calendar Component for Deleted Records
  const CustomCalendar = ({ onDateSelect, selectedDate, onClose }: {
    onDateSelect: (date: string) => void;
    selectedDate: string;
    onClose: () => void;
  }) => {
    const today = new Date();
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const days = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < 42; i++) {
      days.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const navigateMonth = (direction: 'prev' | 'next') => {
      setCurrentMonth(prev => {
        const newDate = new Date(prev);
        if (direction === 'prev') {
          newDate.setMonth(newDate.getMonth() - 1);
        } else {
          newDate.setMonth(newDate.getMonth() + 1);
        }
        return newDate;
      });
    };

    const handleDateClick = (date: Date) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      onDateSelect(dateStr);
      onClose();
    };

    const handleClearDate = () => {
      onDateSelect('');
      onClose();
    };

    return (
      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 p-4 min-w-[280px] calendar-container">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigateMonth('prev')}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="font-semibold text-sm">
            {monthNames[month]} {year}
          </h3>
          <button
            onClick={() => navigateMonth('next')}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        
        <div className="grid grid-cols-7 gap-1 text-xs">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="p-2 text-center font-medium text-gray-500">
              {day}
            </div>
          ))}
          
          {days.map((date, index) => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const isCurrentMonth = date.getMonth() === month;
            const isToday = dateStr === format(today, 'yyyy-MM-dd');
            const isSelected = dateStr === selectedDate;
            const hasDeletedRecords = getDatesWithDeletedRecords.has(dateStr);
            
            return (
              <button
                key={index}
                onClick={() => handleDateClick(date)}
                className={`
                  relative p-2 text-xs rounded hover:bg-red-100 transition-colors
                  ${!isCurrentMonth ? 'text-gray-300' : 'text-gray-700'}
                  ${isToday ? 'bg-red-200 font-bold' : ''}
                  ${isSelected ? 'bg-red-500 text-white' : ''}
                `}
              >
                {date.getDate()}
                {hasDeletedRecords && (
                  <div className="absolute bottom-0.5 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-red-500 rounded-full opacity-80 shadow-sm"></div>
                )}
              </button>
            );
          })}
        </div>
        
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-red-500 rounded-full opacity-80 shadow-sm"></div>
            <span>Has deleted records</span>
          </div>
          <div className="flex gap-2">
            {selectedDate && (
              <button
                onClick={handleClearDate}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className='min-h-screen flex flex-col'>
      <div className='w-full px-4 space-y-6'>
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
        <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-bold text-gray-900 flex items-center gap-2.5'>
              <Trash2 className='w-6 h-6 text-red-600' />
              Deleted Records
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
            <p className='text-gray-600 mt-1'>
              View and manage deleted cash book entries
            </p>
          </div>
          <div className='flex gap-2'>
            <Button
              variant='secondary'
              onClick={exportToExcel}
              className='flex items-center gap-2'
              icon={Download}
            >
              Export
            </Button>
            <Button
              variant='secondary'
              onClick={loadDeletedRecords}
              disabled={loading}
              className='flex items-center gap-2'
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className='bg-gradient-to-r from-red-50 to-orange-50 border-red-200'>
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4'>
            {/* Date Filter */}
            <div className='relative calendar-container'>
              <label className='block text-sm font-medium text-gray-700 mb-1'>
                Date
              </label>
              <div className='relative'>
                <input
                  type='text'
                  value={selectedDate ? format(new Date(selectedDate), 'dd/MM/yyyy') : ''}
                  placeholder='Select date...'
                  readOnly
                  onClick={() => setShowCalendar(!showCalendar)}
                  className='w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500'
                />
                <button
                  type='button'
                  onClick={() => setShowCalendar(!showCalendar)}
                  className='absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600'
                >
                  <Calendar className='w-4 h-4' />
                </button>
                {selectedDate && (
                  <button
                    type='button'
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDate('');
                      setShowCalendar(false);
                    }}
                    className='absolute right-8 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600'
                  >
                    <XCircle className='w-4 h-4' />
                  </button>
                )}
              </div>
              {showCalendar && (
                <CustomCalendar
                  onDateSelect={(date) => {
                    setSelectedDate(date);
                    setShowCalendar(false);
                  }}
                  selectedDate={selectedDate}
                  onClose={() => setShowCalendar(false)}
                />
              )}
            </div>

            {/* Company Filter */}
            <div>
              <SearchableSelect
                label='Company'
                value={selectedCompany}
                onChange={setSelectedCompany}
                options={companies}
                placeholder='Select company...'
              />
            </div>

            {/* Deleted By Filter */}
            <div>
              <SearchableSelect
                label='Deleted By'
                value={selectedUser}
                onChange={setSelectedUser}
                options={users}
                placeholder='Select user...'
              />
            </div>

            {/* Search Box */}
            <div className='lg:col-span-2'>
              <label className='block text-sm font-medium text-gray-700 mb-1'>
                Search
              </label>
              <div className='relative'>
                <Search className='w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400' />
                <input
                  type='text'
                  placeholder='Search entries...'
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className='pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500'
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Summary */}
        <Card className='bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'>
          <div className='grid grid-cols-1 md:grid-cols-4 gap-4 text-center'>
            <div className='bg-red-100 rounded-lg p-4'>
              <div className='text-red-800 font-semibold text-sm'>Total Deleted</div>
              <div className='text-2xl font-bold text-red-900'>{deletedRecords.length}</div>
            </div>
            <div className='bg-yellow-100 rounded-lg p-4'>
              <div className='text-yellow-800 font-semibold text-sm'>Filtered</div>
              <div className='text-2xl font-bold text-yellow-900'>{filteredRecords.length}</div>
            </div>
            <div className='bg-green-100 rounded-lg p-4'>
              <div className='text-green-800 font-semibold text-sm'>Approved</div>
              <div className='text-2xl font-bold text-green-900'>
                {filteredRecords.filter(r => r.approved).length}
              </div>
            </div>
            <div className='bg-orange-100 rounded-lg p-4'>
              <div className='text-orange-800 font-semibold text-sm'>Edited</div>
              <div className='text-2xl font-bold text-orange-900'>
                {filteredRecords.filter(r => r.edited).length}
              </div>
            </div>
          </div>
        </Card>

        {/* Records Table */}
        <Card className='overflow-x-auto'>
          {loading ? (
            <div className='text-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto'></div>
              <p className='mt-2 text-gray-600'>Loading deleted records...</p>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className='text-center py-8 text-gray-500'>
              {deletedRecords.length === 0 ? (
                <div>
                  <Trash2 className='w-12 h-12 mx-auto mb-4 text-gray-300' />
                  <p className='text-lg font-medium'>No deleted records found</p>
                  <p className='text-sm'>All records are currently active</p>
                </div>
              ) : (
                <div>
                  <Search className='w-12 h-12 mx-auto mb-4 text-gray-300' />
                  <p className='text-lg font-medium'>No records match your filters</p>
                  <p className='text-sm'>Try adjusting your search criteria</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className='mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2'>
                <div className='text-lg font-semibold'>
                  Deleted Records ({filteredRecords.length})
                </div>
                <div className='text-sm text-gray-600'>
                  Showing {startIndex + 1}-{Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length}
                </div>
              </div>

              <table className='fit-table'>
                <thead className='bg-red-50 border-b border-red-200'>
                  <tr>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>S.No</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Date</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Company</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Main A/c</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Sub Account</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Particulars</th>
                    <th className='px-1 py-1 text-right font-medium text-gray-700'>Credit</th>
                    <th className='px-1 py-1 text-right font-medium text-gray-700'>Debit</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Staff</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Deleted By</th>
                    <th className='px-1 py-1 text-left font-medium text-gray-700'>Deleted At</th>
                    <th className='px-1 py-1 text-center font-medium text-gray-700'>Status</th>
                    <th className='px-1 py-1 text-center font-medium text-gray-700'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRecords.map((record, idx) => {
                    const serialNumber = startIndex + idx + 1;
                    return (
                      <tr
                        key={record.id}
                        className={`border-b border-gray-100 hover:bg-red-50 transition-colors ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-red-25'
                        }`}
                      >
                        <td className='px-1 py-1 font-medium text-sm font-bold'>{serialNumber}</td>
                      <td className='px-1 py-1 text-sm font-bold fit-nowrap'>{format(new Date(record.c_date), 'dd/MM/yyyy')}</td>
                      <td className='px-1 py-1 text-sm font-bold' title={record.company_name}>{record.company_name}</td>
                      <td className='px-1 py-1 text-sm font-bold' title={record.acc_name}>{record.acc_name}</td>
                      <td className='px-1 py-1 text-sm font-bold' title={record.sub_acc_name || undefined}>{record.sub_acc_name || '-'}</td>
                      <td className='px-1 py-1 text-sm font-bold fit-particulars' title={record.particulars || ''}>
                        {record.particulars || '-'}
                      </td>
                      <td className='px-1 py-1 text-right text-green-700 text-sm font-bold fit-nowrap'>
                        {record.credit > 0 ? `${record.credit.toLocaleString()}` : '-'}
                      </td>
                      <td className='px-1 py-1 text-right text-red-700 text-sm font-bold fit-nowrap'>
                        {record.debit > 0 ? `${record.debit.toLocaleString()}` : '-'}
                      </td>
                      <td className='px-1 py-1 text-sm font-bold' title={record.staff || undefined}>{record.staff || '-'}</td>
                      <td className='px-1 py-1 font-medium text-red-700 text-sm font-bold'>{record.deleted_by || record.users || record.staff || '-'}</td>
                      <td className='px-1 py-1 text-gray-600 text-sm font-bold'>
                        {record.deleted_at ? format(new Date(record.deleted_at), 'dd/MM/yyyy HH:mm') : 
                         record.updated_at ? format(new Date(record.updated_at), 'dd/MM/yyyy HH:mm') : '-'}
                      </td>
                      <td className='px-1 py-1 text-center'>
                        {getStatusIcon(record)}
                      </td>
                        <td className='px-1 py-1 text-center'>
                          <div className='flex gap-0.5 justify-center'>
                            <Button
                              size='sm'
                              variant='secondary'
                              onClick={() => restoreRecord(record)}
                              disabled={restoring === record.id || !isAdmin || currentBook?.is_locked}
                              className='p-1 text-green-700 hover:text-green-800'
                              title={currentBook?.is_locked ? 'Book is locked' : 'Restore Record'}
                            >
                              <RotateCcw className='w-3 h-3' />
                              <span className='sr-only'>Restore</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className='flex items-center justify-between mt-4 pt-4 border-t border-gray-200'>
                  <div className='text-sm text-gray-600'>
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='secondary'
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      size='sm'
                      variant='secondary'
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

export default DeletedRecords;
