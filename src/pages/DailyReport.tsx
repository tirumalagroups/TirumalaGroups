import React, { useState, useEffect, useMemo, useRef } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import SearchableSelect from '../components/UI/SearchableSelect';
import { supabaseDB } from '../lib/supabaseDatabase';
import { supabase } from '../lib/supabase';
import { getTableName } from '../lib/tableNames';
import { useTableMode } from '../contexts/TableModeContext';
import toast from 'react-hot-toast';
import ModeLabel from '../components/UI/ModeLabel';
import CustomCalendar from '../components/UI/CustomCalendar';
import { format, subDays } from 'date-fns';
import { Search, Calendar, AlertTriangle } from 'lucide-react';
import { useBook } from '../contexts/BookContext';
import { buildDailyReportHtml, printPreviewFrame } from '../utils/print';

interface DailyReportData {
  entries: any[];
  totalCredit: number;
  totalDebit: number;
  openingBalance: number;
  closingBalance: number;
  grandTotal: number;
  companyBalances: { [key: string]: number };
}

// Helper function to check if an entry matches the search term across all columns
const matchDailyReportSearchTerm = (entry: any, searchTerm: string): boolean => {
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
    } catch {
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

const DailyReport: React.FC = () => {
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();
  
  // Default to today's date whenever opened; do not load previously selected date
  const initialDate = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [displayDate, setDisplayDate] = useState(() => {
    const [y, m, d] = initialDate.split('-');
    return `${d}/${m}/${y}`;
  });
  const [selectedCompany, setSelectedCompany] = useState(
    () => localStorage.getItem('dailyReportCompany') || ''
  );
  const [searchTerm, setSearchTerm] = useState(() => localStorage.getItem('dailyReportSearch') || '');
  const [reportData, setReportData] = useState<DailyReportData>({
    entries: [],
    totalCredit: 0,
    totalDebit: 0,
    openingBalance: 0,
    closingBalance: 0,
    grandTotal: 0,
    companyBalances: {},
  });
  const [companies, setCompanies] = useState<
    { value: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [companyBalancesForPreview, setCompanyBalancesForPreview] = useState<Array<{companyName: string, openingBalance: number, closingBalance: number}>>([]);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  
  // Calendar entries - same structure as DetailedLedger
  const [calendarEntries, setCalendarEntries] = useState<any[]>([]);

  // Unique sorted dates containing transactions for navigation
  const availableDates = useMemo(() => {
    const dates = [...new Set(calendarEntries.map(e => e.c_date).filter(Boolean))];
    return dates.sort();
  }, [calendarEntries]);

  const hasPrev = useMemo(() => {
    return availableDates.some(d => d < selectedDate);
  }, [availableDates, selectedDate]);

  const hasNext = useMemo(() => {
    return availableDates.some(d => d > selectedDate);
  }, [availableDates, selectedDate]);

  const isPrevDisabled = !hasPrev;
  const isNextDisabled = !hasNext;

  const navigateDate = (direction: 'prev' | 'next') => {
    if (availableDates.length === 0) return;
    
    const currentIndex = availableDates.indexOf(selectedDate);
    let newDate = '';
    
    if (currentIndex !== -1) {
      if (direction === 'next' && currentIndex < availableDates.length - 1) {
        newDate = availableDates[currentIndex + 1];
      } else if (direction === 'prev' && currentIndex > 0) {
        newDate = availableDates[currentIndex - 1];
      }
    } else {
      // Find the closest date
      if (direction === 'next') {
        const next = availableDates.find(d => d > selectedDate);
        if (next) newDate = next;
      } else {
        const prev = [...availableDates].reverse().find(d => d < selectedDate);
        if (prev) newDate = prev;
      }
    }
    
    if (newDate) {
      setSelectedDate(newDate);
      setDisplayDate(convertToDisplayFormat(newDate));
    }
  };

  // Load all entries for calendar - exactly like DetailedLedger does
  useEffect(() => {
    const loadCalendarEntries = async () => {
      try {
        console.log('📅 Loading entries for calendar, mode:', tableMode);
        const entries = await supabaseDB.getAllCashBookEntries();
        console.log('📅 Loaded entries for calendar:', entries?.length || 0);
        
        // Convert to same format as DetailedLedger uses for calendar
        // DetailedLedger uses: ledgerEntries.map(e => ({ c_date: e.date }))
        // where e.date comes from entry.c_date
        // So we just need entries with c_date field
        const formattedEntries = entries.map((entry: any) => ({
          c_date: entry.c_date
        }));
        
        setCalendarEntries(formattedEntries);
        console.log('📅 Calendar entries formatted:', formattedEntries.length);
      } catch (error) {
        console.error('Error loading entries for calendar:', error);
        setCalendarEntries([]);
      }
    };
    
    loadCalendarEntries();
  }, [tableMode, currentBook?.id]);

  // Pre-calculate company balances for print preview when showing preview and no specific company is selected
  useEffect(() => {
    if (showPrintPreview && !selectedCompany && reportData.entries.length > 0) {
      const fetchBalances = async () => {
        try {
          const prevDate = format(subDays(new Date(selectedDate), 1), 'yyyy-MM-dd');
          const companyBalances = await supabaseDB.getCompanyClosingBalancesByDate(prevDate);
          
          const companyTotals: Record<string, { credit: number; debit: number }> = {};
          reportData.entries.forEach(entry => {
            const name = entry.company_name;
            if (!name) return;
            if (!companyTotals[name]) companyTotals[name] = { credit: 0, debit: 0 };
            companyTotals[name].credit += parseFloat(entry.credit) || 0;
            companyTotals[name].debit += parseFloat(entry.debit) || 0;
          });

          const formattedData = companyBalances.map(company => {
            const todayTotals = companyTotals[company.companyName] || { credit: 0, debit: 0 };
            const closingBalance = company.closingBalance + (todayTotals.credit - todayTotals.debit);
            return {
              companyName: company.companyName,
              openingBalance: company.closingBalance,
              closingBalance: closingBalance,
            };
          });
          setCompanyBalancesForPreview(formattedData);
        } catch (error) {
          console.warn('Error fetching company balances for preview:', error);
          setCompanyBalancesForPreview([]);
        }
      };
      fetchBalances();
    } else {
      setCompanyBalancesForPreview([]);
    }
  }, [showPrintPreview, selectedDate, reportData.entries, selectedCompany]);

  // Helper functions for date format conversion
  const convertToInternalFormat = (ddMMyyyy: string): string => {
    if (!ddMMyyyy) return '';
    const [day, month, year] = ddMMyyyy.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const convertToDisplayFormat = (yyyyMMdd: string): string => {
    if (!yyyyMMdd) return '';
    const [year, month, day] = yyyyMMdd.split('-');
    return `${day}/${month}/${year}`;
  };

  const handleDatePickerChange = async (dateValue: string) => {
    if (dateValue) {
      setSelectedDate(dateValue);
      setDisplayDate(convertToDisplayFormat(dateValue));
      // Don't clear company selection - allow multiple filters
      // Load companies for the new date
      await loadCompaniesByDate(dateValue);
    }
  };

  // Load base companies once on mount
  useEffect(() => {
    loadCompanies();
  }, [currentBook?.id]);

  // Re-generate report when any filter changes
  useEffect(() => {
    generateReport();
  }, [selectedDate, selectedCompany, searchTerm, currentBook?.id]);

  // Do not persist date to localStorage per user request
  useEffect(() => {
    localStorage.setItem('dailyReportCompany', selectedCompany || '');
  }, [selectedCompany]);
  useEffect(() => {
    localStorage.setItem('dailyReportSearch', searchTerm || '');
  }, [searchTerm]);


  // useEffect to load companies when date changes
  useEffect(() => {
    if (selectedDate) {
      console.log('🔄 Date changed, loading companies for date:', selectedDate);
      loadCompaniesByDate(selectedDate);
    }
  }, [selectedDate, currentBook?.id]);

  const loadCompanies = async () => {
    try {
      const companies = await supabaseDB.getCompaniesWithData();
      const companiesData = companies.map(company => ({
        value: company.company_name,
        label: company.company_name,
      }));
      setCompanies([{ value: '', label: 'All Companies' }, ...companiesData]);
    } catch (error) {
      console.error('Error loading companies:', error);
      toast.error('Failed to load companies');
    }
  };

  const loadCompaniesByDate = async (date: string) => {
    try {
      console.log('🔍 Loading companies for date:', date);
      
      // Don't clear company selection - allow multiple filters
      
      // Get all entries for the specific date
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('company_name')
        .eq('c_date', date);

      if (error) {
        console.error('Error loading companies by date:', error);
        return;
      }

      // Extract unique company names
      const uniqueCompanies = [...new Set(data.map(entry => entry.company_name).filter(Boolean))];
      
      console.log(`📊 Found ${uniqueCompanies.length} companies for date ${date}:`, uniqueCompanies);
      
      // Update companies dropdown with date-specific options (preserve selection when possible)
      const companiesData = uniqueCompanies.map(name => ({
        value: name,
        label: name,
      }));
      setCompanies([{ value: '', label: 'All Companies' }, ...companiesData]);
      // If current selection still exists in the new list, keep it
      if (selectedCompany && uniqueCompanies.includes(selectedCompany)) {
        // keep as is
      } else if (selectedCompany) {
        // previously selected company not available for this date
        setSelectedCompany('');
      }
      
      // Show toast with summary
      if (data.length > 0) {
        toast.success(`Found ${data.length} entries on ${date} with ${uniqueCompanies.length} companies: ${uniqueCompanies.join(', ')}`);
      } else {
        toast(`No entries found on ${date}`);
        // If no entries found, load all companies
        await loadCompanies();
      }
      
    } catch (error) {
      console.error('Error loading companies by date:', error);
      toast.error('Failed to load companies for selected date');
      // Fallback to loading all companies
      await loadCompanies();
    }
  };



  const generateReport = async () => {
    setLoading(true);
    try {
      console.log('🔄 Generating Daily Report with filters:', {
        selectedDate,
        selectedCompany,
        searchTerm
      });
      
      // Use server-side filtering for much faster performance
      const { data: entries, error } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('c_date', selectedDate)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching entries for date:', error);
        toast.error('Failed to load entries for selected date');
        return;
      }

      console.log(`✅ Loaded ${entries?.length || 0} entries for ${selectedDate}`);

      // Apply company filter
      let filteredEntries = entries || [];
      if (selectedCompany) {
        const beforeCompanyFilter = filteredEntries.length;
        filteredEntries = filteredEntries.filter(
          entry => entry.company_name === selectedCompany
        );
        console.log(`📊 Company filter: ${beforeCompanyFilter} → ${filteredEntries.length} entries`);
      }

      // Apply search filter - only search in Particulars, Credit, Debit
      if (searchTerm) {
        const beforeSearchFilter = filteredEntries.length;
        filteredEntries = filteredEntries.filter(entry => matchDailyReportSearchTerm(entry, searchTerm));
        console.log(`🔍 Search filter: ${beforeSearchFilter} → ${filteredEntries.length} entries`);
      }

      console.log(`📈 Final filtered entries: ${filteredEntries.length}`);

      // Calculate opening balance
      // If a company is selected, calculate opening balance only for that company
      // Otherwise, calculate opening balance for all companies
      const prevDate = format(subDays(new Date(selectedDate), 1), 'yyyy-MM-dd');
      let openingBalance = 0;
      try {
        if (selectedCompany) {
          // Calculate opening balance for the selected company only
          // Use the same method as "All Companies" for consistency
          const { data: previousEntries, error: prevError } = await supabase
            .from(getTableName('cash_book'))
            .select('credit, debit, company_name, c_date')
            .eq('company_name', selectedCompany)
            .lte('c_date', prevDate);

          if (prevError) throw prevError;

          // Sum entries only for the selected company up to previous date
          // Use proper number conversion with precision
          openingBalance = (previousEntries || []).reduce(
            (sum, entry) => {
              const credit = parseFloat(entry.credit) || 0;
              const debit = parseFloat(entry.debit) || 0;
              return sum + (credit - debit);
            },
            0
          );
          
          // Round to 2 decimal places for precision
          openingBalance = Math.round(openingBalance * 100) / 100;
          
          console.log(`💰 Opening balance for ${selectedCompany} (up to ${prevDate}): ${openingBalance.toLocaleString()}`);
          console.log(`📊 Previous entries count: ${previousEntries?.length || 0}`);
        } else {
          // Calculate opening balance for all companies (Dashboard net balance)
          const companyBalances = await supabaseDB.getCompanyClosingBalancesByDate(prevDate);
          
          // Sum ALL companies' closing balances for opening balance (Dashboard net balance)
          openingBalance = companyBalances.reduce(
            (sum, company) => sum + company.closingBalance,
            0
          );
          
          console.log(`💰 Opening balance (Dashboard net balance - sum of all companies up to ${prevDate}): ${openingBalance.toLocaleString()}`);
        }
      } catch (e) {
        console.warn('Error calculating opening balance from company balances, using fallback:', e);
        // Fallback: calculate from individual entries
        try {
          const query = supabase
            .from(getTableName('cash_book'))
            .select('credit, debit, company_name, c_date')
            .lte('c_date', prevDate);
          
          // Add company filter if a company is selected
          if (selectedCompany) {
            query.eq('company_name', selectedCompany);
          }
          
          const { data: previousEntries, error: prevError } = await query;

          if (prevError) throw prevError;

          // Sum entries (filtered by company if selected)
          // Use proper number conversion with precision
          openingBalance = (previousEntries || []).reduce(
            (sum, entry) => {
              const credit = parseFloat(entry.credit) || 0;
              const debit = parseFloat(entry.debit) || 0;
              return sum + (credit - debit);
            },
            0
          );
          
          // Round to 2 decimal places for precision
          openingBalance = Math.round(openingBalance * 100) / 100;
        } catch (fallbackError) {
          console.warn('Fallback also failed:', fallbackError);
          openingBalance = 0;
        }
      }

      // Calculate today's totals (for the selected date, filtered by company if selected)
      const totalCredit = filteredEntries.reduce((sum, entry) => sum + entry.credit, 0);
      const totalDebit = filteredEntries.reduce((sum, entry) => sum + entry.debit, 0);

      // Closing balance = Opening Balance + (Today's Total Credit - Today's Total Debit)
      // This closing balance becomes the next day's opening balance
      const closingBalance = openingBalance + (totalCredit - totalDebit);
      const grandTotal = totalCredit + totalDebit;

      // Calculate company-wise balances efficiently
      const companyBalances: { [key: string]: number } = {};
      const allCompanies = companies.filter(c => c.value !== '');

      allCompanies.forEach(company => {
        const companyEntries = filteredEntries.filter(
          entry => entry.company_name === company.value
        );
        const companyCredit = companyEntries.reduce(
          (sum, entry) => sum + entry.credit,
          0
        );
        const companyDebit = companyEntries.reduce(
          (sum, entry) => sum + entry.debit,
          0
        );
        companyBalances[company.value] = companyCredit - companyDebit;
      });

      setReportData({
        entries: filteredEntries,
        totalCredit,
        totalDebit,
        openingBalance,
        closingBalance,
        grandTotal,
        companyBalances,
      });


      console.log(`✅ Daily Report generated for ${selectedDate}: ${filteredEntries.length} entries`);
      toast.success(`Daily Report generated: ${filteredEntries.length} entries for ${selectedDate}`);
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  // One print document for both the preview and the printer, so they always match.
  // Date, Staff and Status are intentionally excluded from the print.
  const printPreviewHtml = useMemo(() => {
    if (!showPrintPreview) return '';
    const printData = reportData.entries.map((entry: any) => ({
      sno: entry.sno,
      companyName: entry.company_name,
      accountName: entry.acc_name,
      subAccount: entry.sub_acc_name || '',
      particulars: entry.particulars,
      credit: entry.credit,
      debit: entry.debit,
    }));
    return buildDailyReportHtml(printData, {
      title: `Daily Report - ${displayDate}`,
      subtitle: selectedCompany ? `Company: ${selectedCompany}` : 'All Companies',
      headerText: 'Thirumala Group - Daily Transaction Report',
      openingBalance: reportData.openingBalance,
      closingBalance: reportData.closingBalance,
      companyBalances: companyBalancesForPreview,
      showToolbar: false,
    });
  }, [showPrintPreview, reportData, displayDate, selectedCompany, companyBalancesForPreview]);

  const handleRealPrint = () => {
    if (!printPreviewFrame(previewFrameRef.current)) {
      toast.error('Print failed. Please try again.');
    }
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
        <div className='flex items-center justify-between'>
          <div>
            <div className='flex items-center gap-3 mb-1'>
              <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2.5'>
                Daily Report
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
              View daily transaction reports with company-wise breakdown
            </p>
          </div>
        </div>
        
        {/* Responsive filter bar */}
        <div className='flex flex-col md:flex-row gap-4 items-end'>
          <div className='flex-[1.3] min-w-[290px] w-full'>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
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
                  onChange={async (e) => {
                    const inputValue = e.target.value;
                    setDisplayDate(inputValue);
                    
                    // Convert to internal format for database queries
                    const internalDate = convertToInternalFormat(inputValue);
                    if (internalDate && internalDate !== '--') {
                      setSelectedDate(internalDate);
                      // Load companies for the new date
                      await loadCompaniesByDate(internalDate);
                    }
                  }}
                  onBlur={async (e) => {
                    const inputValue = e.target.value;
                    // Validate and format the date on blur
                    if (inputValue && inputValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                      const internalDate = convertToInternalFormat(inputValue);
                      if (internalDate && internalDate !== '--') {
                        setSelectedDate(internalDate);
                        setDisplayDate(inputValue); // Keep the formatted input
                        // Load companies for the new date
                        await loadCompaniesByDate(internalDate);
                      }
                    } else if (inputValue) {
                      // If invalid format, reset to current date
                      const currentDate = format(new Date(), 'yyyy-MM-dd');
                      setSelectedDate(currentDate);
                      setDisplayDate(convertToDisplayFormat(currentDate));
                    }
                  }}
                  className='w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
                {/* Calendar button */}
                <button
                  type='button'
                  onClick={() => setShowCalendar(!showCalendar)}
                  className='absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded'
                >
                  <Calendar className='w-5 h-5 text-gray-500' />
                </button>
                
                {/* Custom Calendar with red dots - exactly like DetailedLedger */}
                {showCalendar && (
                  <CustomCalendar
                    entries={calendarEntries}
                    onDateSelect={(date) => {
                      handleDatePickerChange(date);
                      setShowCalendar(false);
                    }}
                    selectedDate={selectedDate}
                    onClose={() => setShowCalendar(false)}
                    dotColor="red"
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
          <div className='flex-1'>
            <SearchableSelect
              label='Company'
              value={selectedCompany}
              onChange={value => setSelectedCompany(value)}
              options={companies}
              placeholder='Select or search company...'
            />
          </div>
          <div className='flex-1'>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              Search
            </label>
            <div className='relative'>
              <Search className='w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400' />
              <input
                type='text'
                placeholder='Search...'
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className='pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
              />
            </div>
          </div>
          <div className='flex flex-row gap-2 mt-2 md:mt-0'>
            <Button 
              variant='secondary' 
              onClick={() => {
                setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
                setDisplayDate(format(new Date(), 'dd/MM/yyyy'));
                setSelectedCompany('');
                setSearchTerm('');
                loadCompanies();
              }}
            >
              Clear Filters
            </Button>
            <Button variant='secondary' onClick={generateReport}>
              Refresh
            </Button>
            <Button variant='secondary' onClick={() => setShowPrintPreview(true)}>
              Print
            </Button>
          </div>
        </div>
        
        
        {/* Responsive table/card layout */}
        <Card className='overflow-x-auto p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'>
          {/* Progress Indicator */}
          {loading && (
            <div className='text-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto'></div>
              <p className='mt-2 text-gray-600'>Generating Daily Report for {displayDate}...</p>
            </div>
          )}
          
          {loading ? (
            <div className='text-center text-gray-500 py-8'>Loading...</div>
          ) : reportData.entries.length === 0 ? (
            <div className='text-center text-gray-500 py-8'>
              No entries found for this date.
            </div>
          ) : (
            <>
              <div className='mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2'>
                <div className='text-lg font-semibold'>
                  Daily Report for {displayDate}
                </div>
                <div className='flex flex-col md:flex-row md:items-center gap-4 text-sm text-gray-600'>
                  <span>Total Entries: {reportData.entries.length}</span>
                  <span className='text-xs text-green-600 font-medium'>
                    ✓ Optimized query for {selectedDate}
                  </span>
                  <span>
                    Total Credits: {reportData.totalCredit.toLocaleString()}
                  </span>
                  <span>
                    Opening Balance: {reportData.openingBalance.toLocaleString()}
                  </span>
                  <span>
                    Total Debits: {reportData.totalDebit.toLocaleString()}
                  </span>
                  <span>
                    Closing Balance: {reportData.closingBalance.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className='flex flex-col md:flex-row gap-4 mb-6'>
                <div className='flex-1 bg-green-100 rounded-lg p-4 flex flex-col items-start justify-center'>
                  <span className='text-green-900 font-semibold text-sm'>
                    Total Credit:
                  </span>
                  <span className='text-2xl font-bold text-green-900'>
{reportData.totalCredit.toLocaleString()}
                  </span>
                </div>
                <div className='flex-1 bg-emerald-100 rounded-lg p-4 flex flex-col items-start justify-center'>
                  <span className='text-emerald-900 font-semibold text-sm'>
                    Opening Balance:
                  </span>
                  <span className='text-2xl font-bold text-emerald-900'>
{reportData.openingBalance.toLocaleString()}
                  </span>
                </div>
                <div className='flex-1 bg-red-100 rounded-lg p-4 flex flex-col items-start justify-center'>
                  <span className='text-red-700 font-semibold text-sm'>
                    Total Debit:
                  </span>
                  <span className='text-2xl font-bold text-red-700'>
{reportData.totalDebit.toLocaleString()}
                  </span>
                </div>
                <div className='flex-1 bg-purple-100 rounded-lg p-4 flex flex-col items-start justify-center'>
                  <span className='text-purple-800 font-semibold text-sm'>
                    Closing Balance:
                  </span>
                  <span className={`text-2xl font-bold ${
                    reportData.closingBalance > 0
                      ? 'text-green-800'
                      : reportData.closingBalance < 0
                      ? 'text-red-800'
                      : 'text-purple-800'
                  }`}>
{reportData.closingBalance.toLocaleString()}
                  </span>
                  <span className='text-xs text-purple-600 mt-1'>
                    (Opening + Credit - Debit)
                  </span>
                </div>
              </div>

              {/* Online/Offline breakdown removed */}
              <table className='fit-table fit-lg'>
                <thead className='bg-blue-100'>
                  <tr>
                    <th className='px-3 py-2 text-left'>S.No</th>
                    <th className='px-3 py-2 text-left'>Date</th>
                    <th className='px-3 py-2 text-left'>Company</th>
                    <th className='px-3 py-2 text-left'>Account</th>
                    <th className='px-3 py-2 text-left'>Sub Account</th>
                    <th className='px-3 py-2 text-left'>Particulars</th>
                    <th className='px-3 py-2 text-right'>Credit</th>
                    <th className='px-3 py-2 text-right'>Debit</th>
                    <th className='px-3 py-2 text-left'>Staff</th>
                    <th className='px-3 py-2 text-left'>User</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.entries.map((entry: any, idx: number) => (
                    <tr
                      key={entry.sno}
                      className={idx % 2 === 0 ? 'bg-white' : 'bg-blue-50'}
                    >
                      <td className='px-3 py-2 font-bold text-base'>{idx + 1}</td>
                      <td className='px-3 py-2 font-bold text-base fit-nowrap'>
                        {entry.c_date ? format(new Date(entry.c_date), 'dd/MM/yyyy') : ''}
                      </td>
                      <td className='px-3 py-2 font-bold text-base'>{entry.company_name}</td>
                      <td className='px-3 py-2 font-bold text-base'>{entry.acc_name}</td>
                      <td className='px-3 py-2 font-bold text-base'>{entry.sub_acc_name || '-'}</td>
                      <td
                        className='px-3 py-2 font-bold text-base fit-particulars'
                        title={entry.particulars}
                      >
                        {entry.particulars}
                      </td>
                      <td className='px-3 py-2 text-right text-green-700 font-bold text-base fit-nowrap'>
                        {entry.credit > 0
                          ? `${entry.credit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-3 py-2 text-right text-red-700 font-bold text-base fit-nowrap'>
                        {entry.debit > 0
                          ? `${entry.debit.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className='px-3 py-2 font-bold text-base'>{entry.staff}</td>
                      <td className='px-3 py-2'>
                        {entry.approved ? (
                          <div className='text-xs'>
                            <div className='font-medium text-green-700'>
                              {entry.users || 'Unknown User'}
                            </div>
                            <div className='text-gray-500'>
                              {entry.entry_time ? format(new Date(entry.entry_time), 'dd/MM/yyyy hh:mm aa') : 'N/A'}
                            </div>
                          </div>
                        ) : (
                          <span className='text-orange-600 font-medium'>Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className='bg-gray-100 border-t-2 border-gray-400'>
                  <tr>
                    <td colSpan={6} className='px-3 py-3 font-bold text-base text-right'>
                      Total
                    </td>
                    <td className='px-3 py-3 text-right text-green-700 font-bold text-base fit-nowrap'>
                      {reportData.totalCredit.toLocaleString()}
                    </td>
                    <td className='px-3 py-3 text-right text-red-700 font-bold text-base fit-nowrap'>
                      {reportData.totalDebit.toLocaleString()}
                    </td>
                    <td colSpan={2} className='px-3 py-3'></td>
                  </tr>
                  <tr>
                    <td colSpan={6} className='px-3 py-3 font-bold text-base text-right'>
                      Opening Balance
                    </td>
                    <td className='px-3 py-3 text-right text-green-700 font-bold text-base fit-nowrap'>
                      {reportData.openingBalance.toLocaleString()}
                    </td>
                    <td className='px-3 py-3 text-right font-bold text-base'></td>
                    <td colSpan={2} className='px-3 py-3'></td>
                  </tr>
                  <tr>
                    <td colSpan={6} className='px-3 py-3 font-bold text-base text-right'>
                      Closing Balance
                    </td>
                    <td className='px-3 py-3 text-right font-bold text-base'></td>
                    <td className='px-3 py-3 text-right font-bold text-base'>
                      {reportData.closingBalance.toLocaleString()}
                    </td>
                    <td colSpan={2} className='px-3 py-3'></td>
                  </tr>
                  <tr className='bg-blue-100 border-t-2 border-blue-400'>
                    <td colSpan={6} className='px-3 py-3 font-bold text-base text-right'>
                      Grand Total
                    </td>
                    <td className='px-3 py-3 text-right text-green-700 font-bold text-base fit-nowrap'>
                      {(reportData.totalCredit + reportData.openingBalance).toLocaleString()}
                    </td>
                    <td className='px-3 py-3 text-right text-red-700 font-bold text-base fit-nowrap'>
                      {(reportData.totalDebit + reportData.closingBalance).toLocaleString()}
                    </td>
                    <td colSpan={2} className='px-3 py-3'></td>
                  </tr>
                </tfoot>
              </table>
              
              {/* Performance Info */}
              {reportData.entries.length > 0 && (
                <div className='text-center text-sm text-green-600 py-4 mt-4 border-t border-gray-200'>
                  ✓ Fast Daily Report generated using optimized server-side queries
                </div>
              )}
            </>
          )}
        </Card>

        {/* Company Closing Balances */}
        {reportData.entries.length > 0 && (
          <Card
            title='Company Closing Balances'
            subtitle={`Current balance for each company (Credit - Debit) for ${displayDate}`}
            className='bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
          >
            <div className='overflow-x-auto'>
              <div className='max-h-48 overflow-y-auto'>
                <table className='w-full text-xs'>
                  <thead className='sticky top-0 bg-gray-50 z-10'>
                    <tr className='border-b border-gray-200'>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Company Name
                      </th>
                      <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                        Total Credit
                      </th>
                      <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                        Total Debit
                      </th>
                      <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                        Closing Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(reportData.companyBalances).map(([companyName, balance], index) => {
                      // Calculate credit and debit for this company
                      const companyEntries = reportData.entries.filter(entry => entry.company_name === companyName);
                      const totalCredit = companyEntries.reduce((sum, entry) => sum + entry.credit, 0);
                      const totalDebit = companyEntries.reduce((sum, entry) => sum + entry.debit, 0);
                      
                      return (
                        <tr
                          key={companyName}
                          className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                            index % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                          }`}
                        >
                          <td className='py-3 px-4 font-medium text-gray-900 fit-name'>
                            {companyName}
                          </td>
                          <td className='py-3 px-4 text-right text-green-600 font-medium'>
{totalCredit.toLocaleString()}
                          </td>
                          <td className='py-3 px-4 text-right text-red-600 font-medium'>
{totalDebit.toLocaleString()}
                          </td>
                          <td className='py-3 px-4 text-right font-semibold'>
                            <span
                              className={`px-2 py-1 rounded-full text-sm ${
                                balance > 0
                                  ? 'bg-green-100 text-green-800'
                                  : balance < 0
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
{balance.toLocaleString()}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Summary Footer */}
              <div className='mt-4 p-4 bg-gray-100 rounded-lg border'>
                <div className='grid grid-cols-4 gap-4 text-sm'>
                  <div className='font-semibold text-gray-900'>
                    Total Companies: {Object.keys(reportData.companyBalances).length}
                  </div>
                  <div className='text-right text-green-600 font-semibold'>
{reportData.totalCredit.toLocaleString()}
                  </div>
                  <div className='text-right text-red-600 font-semibold'>
{reportData.totalDebit.toLocaleString()}
                  </div>
                  <div className='text-right'>
                    <span
                      className={`px-2 py-1 rounded-full text-sm font-bold ${
                        reportData.closingBalance > 0
                          ? 'bg-green-100 text-green-800'
                          : reportData.closingBalance < 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
{reportData.closingBalance.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Print Preview Modal: shows the exact document that gets printed */}
      {showPrintPreview && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 no-print'>
          <div className='bg-white rounded-lg max-w-5xl w-full h-[90vh] flex flex-col shadow-2xl'>
            <div className='flex items-center justify-between px-6 py-4 border-b'>
              <h3 className='text-lg font-bold text-gray-900'>
                Print Preview - Daily Report
              </h3>
              <div className='flex items-center gap-2'>
                <Button size='sm' onClick={handleRealPrint}>
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
              title='Daily Report print preview'
              srcDoc={printPreviewHtml}
              className='flex-1 w-full rounded-b-lg'
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyReport;
