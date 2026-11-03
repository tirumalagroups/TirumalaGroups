import React, { useState, useEffect } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import SearchableSelect from '../components/UI/SearchableSelect';
import { supabaseDB, BalanceSheetAccount } from '../lib/supabaseDatabase';
import { useTableMode } from '../contexts/TableModeContext';
import toast from 'react-hot-toast';
import ModeLabel from '../components/UI/ModeLabel';
import { format, parseISO } from 'date-fns';
import CustomCalendar from '../components/UI/CustomCalendar';
import { Calendar, AlertTriangle } from 'lucide-react';
import { getSharedPrintStyles, toDisplayCase } from '../utils/print';
import { useBook } from '../contexts/BookContext';

interface BalanceSheetFilters {
  companyName: string;
  betweenDates: boolean;
  fromDate: string;
  toDate: string;
  plYesNo: string;
  bothYesNo: string;
}

// BalanceSheetAccount interface is now imported from supabaseDatabase

const BalanceSheet: React.FC = () => {
  const { mode: tableMode } = useTableMode();
  const { currentBook, reportFilter } = useBook();

  const [filters, setFilters] = useState<BalanceSheetFilters>({
    companyName: '',
    betweenDates: true,
    fromDate: '2025-10-03',
    toDate: format(new Date(), 'yyyy-MM-dd'),
    plYesNo: '',
    bothYesNo: '',
  });

  const [balanceSheetData, setBalanceSheetData] = useState<
    BalanceSheetAccount[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [usingOptimizedAPI, setUsingOptimizedAPI] = useState(true);
  
  const [showFromCalendar, setShowFromCalendar] = useState(false);
  const [showToCalendar, setShowToCalendar] = useState(false);
  const [fromDateInput, setFromDateInput] = useState('');
  const [toDateInput, setToDateInput] = useState('');

  // Sync formatted text inputs with filter date values
  useEffect(() => {
    try {
      setFromDateInput(filters.fromDate ? format(new Date(filters.fromDate), 'dd/MM/yyyy') : '');
    } catch (e) {
      console.error('Error formatting fromDate:', e);
    }
  }, [filters.fromDate]);

  useEffect(() => {
    try {
      setToDateInput(filters.toDate ? format(new Date(filters.toDate), 'dd/MM/yyyy') : '');
    } catch (e) {
      console.error('Error formatting toDate:', e);
    }
  }, [filters.toDate]);
  
  // State for P&L selection and custom content
  const [selectedAccountsForPL, setSelectedAccountsForPL] = useState<Set<string>>(new Set());
  const [customRows, setCustomRows] = useState<BalanceSheetAccount[]>([]);
  const [newRowData, setNewRowData] = useState({
    accountName: '',
    credit: '',
    debit: '',
    balance: '',
    result: 'CREDIT',
    plYesNo: 'NO',
    bothYesNo: 'NO',
  });

  // Dropdown data
  const [companies, setCompanies] = useState<
    { value: string; label: string }[]
  >([]);



  useEffect(() => {
    loadDropdownData();
    generateBalanceSheet();
  }, [tableMode, currentBook?.id]);

  useEffect(() => {
    generateBalanceSheet();
  }, [filters, reportFilter]);

  const loadDropdownData = async () => {
    try {
      // Load companies
      const companies = await supabaseDB.getCompanies();
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

  const generateBalanceSheet = async () => {
    setLoading(true);
    try {
      console.log('🚀 Generating optimized balance sheet...');
      
      // Use the new optimized API endpoint
      const result = await supabaseDB.getOptimizedBalanceSheet({
        companyName: filters.companyName || undefined,
        fromDate: filters.betweenDates ? filters.fromDate : undefined,
        toDate: filters.betweenDates ? filters.toDate : undefined,
        plYesNo: filters.plYesNo || undefined,
        bothYesNo: filters.bothYesNo || undefined,
        betweenDates: filters.betweenDates,
        reportFilter: reportFilter
      });

      setBalanceSheetData(result.balanceSheetData);

      console.log(`✅ Optimized balance sheet generated: ${result.balanceSheetData.length} accounts from ${result.recordCount} transactions${result.cached ? ' (served from cache)' : ''}`);
      
      const message = result.cached 
        ? `Balance sheet loaded from cache (${result.balanceSheetData.length} accounts)`
        : `Balance sheet generated with ${result.balanceSheetData.length} accounts from ${result.recordCount} transactions`;
      
      toast.success(message);
      setUsingOptimizedAPI(true);
    } catch (error) {
      console.error('❌ Error generating balance sheet:', error);
      toast.error('Failed to generate balance sheet: ' + (error instanceof Error ? error.message : 'Unknown error'));
      
      // Fallback to old method if API fails
      console.log('🔄 Falling back to client-side processing...');
      await generateBalanceSheetFallback();
    } finally {
      setLoading(false);
    }
  };

  // Fallback method using the old client-side approach
  const generateBalanceSheetFallback = async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get filtered entries - use getAllCashBookEntries to get all 67k records
      const [entries, accountsList] = await Promise.all([
        supabaseDB.getAllCashBookEntries(),
        supabaseDB.getAccounts()
      ]);

      const accountCategoryMap = new Map<string, string>();
      accountsList.forEach(a => {
        if (a.acc_name) {
          accountCategoryMap.set(a.acc_name.toUpperCase(), a.report_category || 'BALANCE_SHEET');
        }
      });

      // Apply date filter
      let filteredEntries = entries;
      if (filters.betweenDates) {
        filteredEntries = filteredEntries.filter(entry => {
          const entryDate = new Date(entry.c_date);
          const fromDate = new Date(filters.fromDate);
          const toDate = new Date(filters.toDate);
          return entryDate >= fromDate && entryDate <= toDate;
        });
      }

      // Apply company filter
      if (filters.companyName) {
        filteredEntries = filteredEntries.filter(
          entry => entry.company_name === filters.companyName
        );
      }

      // Group by account name and calculate balances
      const accountMap = new Map<string, BalanceSheetAccount>();

      filteredEntries.forEach(entry => {
        const dbCategory = entry.report_category || accountCategoryMap.get(entry.acc_name.toUpperCase());
        const isPlFallback = getAccountPLStatus(entry.acc_name) === 'YES';
        const finalCategory = dbCategory || (isPlFallback ? 'PROFIT_LOSS' : 'BALANCE_SHEET');

        // Apply Report filter from context (All, Balance Sheet, Profit & Loss)
        if (reportFilter === 'BALANCE_SHEET' && finalCategory !== 'BALANCE_SHEET') return;
        if (reportFilter === 'PROFIT_LOSS' && finalCategory !== 'PROFIT_LOSS') return;

        if (!accountMap.has(entry.acc_name)) {
          accountMap.set(entry.acc_name, {
            accountName: entry.acc_name,
            credit: 0,
            debit: 0,
            balance: 0,
            plYesNo: finalCategory === 'PROFIT_LOSS' ? 'YES' : 'NO',
            bothYesNo: getAccountBothStatus(entry.acc_name),
            result: '',
          });
        }

        const account = accountMap.get(entry.acc_name)!;
        account.credit += entry.credit;
        account.debit += entry.debit;
        account.balance = account.credit - account.debit;
        account.result = account.balance >= 0 ? 'CREDIT' : 'DEBIT';
      });

      let balanceSheetAccounts = Array.from(accountMap.values());

      // Apply P&L filter
      if (filters.plYesNo) {
        balanceSheetAccounts = balanceSheetAccounts.filter(
          acc => acc.plYesNo === filters.plYesNo
        );
      }

      // Apply Both filter
      if (filters.bothYesNo) {
        balanceSheetAccounts = balanceSheetAccounts.filter(
          acc => acc.bothYesNo === filters.bothYesNo
        );
      }

      // Sort by account name
      balanceSheetAccounts.sort((a, b) =>
        a.accountName.localeCompare(b.accountName)
      );

      setBalanceSheetData(balanceSheetAccounts);

      console.log(`✅ Fallback balance sheet generated: ${balanceSheetAccounts.length} accounts`);
      toast.success(`Balance sheet generated (fallback method) with ${balanceSheetAccounts.length} accounts`);
      setUsingOptimizedAPI(false);
    } catch (error) {
      console.error('❌ Error in fallback balance sheet generation:', error);
      toast.error('Failed to generate balance sheet (fallback method)');
    }
  };

  const getAccountPLStatus = (accountName: string): string => {
    // Determine if account should be included in P&L
    const plAccounts = ['SALES', 'PURCHASE', 'EXPENSE', 'INCOME', 'REVENUE'];
    const isPlAccount = plAccounts.some(type =>
      accountName.toUpperCase().includes(type)
    );
    return isPlAccount ? 'YES' : 'NO';
  };

  const getAccountBothStatus = (accountName: string): string => {
    // Determine if account appears in both balance sheet and P&L
    const bothAccounts = ['CAPITAL', 'DRAWINGS', 'RESERVES'];
    const isBothAccount = bothAccounts.some(type =>
      accountName.toUpperCase().includes(type)
    );
    return isBothAccount ? 'BOTH' : 'NO';
  };

  const handleFilterChange = (field: keyof BalanceSheetFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handlePLSelectionChange = (accountName: string, isSelected: boolean) => {
    setSelectedAccountsForPL(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        newSet.add(accountName);
      } else {
        newSet.delete(accountName);
      }
      return newSet;
    });
  };

  const handleNewRowDataChange = (field: string, value: string | number) => {
    setNewRowData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const addCustomRow = () => {
    if (currentBook?.is_locked) {
      toast.error('This book is locked. Cannot add custom rows.');
      return;
    }

    if (!newRowData.accountName.trim()) {
      toast.error('Please enter an account name');
      return;
    }

    const credit = parseFloat(newRowData.credit.toString()) || 0;
    const debit = parseFloat(newRowData.debit.toString()) || 0;
    const typedBalance = newRowData.balance.toString().trim();
    // Same rule as the real rows: balance = credit - debit, unless a balance is typed in.
    const balance = typedBalance !== '' ? parseFloat(typedBalance) || 0 : credit - debit;
    const net = credit !== 0 || debit !== 0 ? credit - debit : balance;

    const customRow: BalanceSheetAccount = {
      accountName: newRowData.accountName.trim(),
      credit,
      debit,
      balance,
      result: net >= 0 ? 'CREDIT' : 'DEBIT',
      // 'YES' = Profit & Loss table, 'NO' = Balance Sheet table (chosen in the form)
      plYesNo: newRowData.plYesNo,
      bothYesNo: newRowData.bothYesNo,
    };

    setCustomRows(prev => [...prev, customRow]);
    
    // Reset form
    setNewRowData({
      accountName: '',
      credit: '',
      debit: '',
      balance: '',
      result: 'CREDIT',
      plYesNo: 'NO',
      bothYesNo: 'NO',
    });
    
    toast.success('Custom row added successfully!');
  };

  const refreshData = () => {
    generateBalanceSheet();
    toast.success('Balance sheet refreshed successfully!');
  };

  const resetFilters = () => {
    setFilters({
      companyName: '',
      betweenDates: true,
      fromDate: '2025-10-03',
      toDate: format(new Date(), 'yyyy-MM-dd'),
      plYesNo: '',
      bothYesNo: '',
    });
    toast.success('Filters reset');
  };

  const printReport = () => {
    const allAccounts = [...balanceSheetData, ...customRows];
    const plAccounts = allAccounts.filter(acc => acc.plYesNo === 'YES');
    const bsAccounts = allAccounts.filter(acc => acc.plYesNo === 'NO');
    const periodHtml = filters.betweenDates
      ? `<strong>${format(parseISO(filters.fromDate), 'dd/MM/yyyy')}</strong> to <strong>${format(parseISO(filters.toDate), 'dd/MM/yyyy')}</strong>`
      : 'All Time';

    const amount = (n: number) => (n > 0 ? n.toLocaleString() : '-');

    // One account table (used for the Balance Sheet, P&L, or both)
    const accountTable = (heading: string, accounts: typeof allAccounts, totalsLabel: string) => {
      const totalCredit = accounts.reduce((sum, acc) => sum + acc.credit, 0);
      const totalDebit = accounts.reduce((sum, acc) => sum + acc.debit, 0);
      const balance = accounts.reduce((sum, acc) => sum + acc.balance, 0);
      return `
        <div class="section">
          ${heading ? `<div class="section-title">${heading}</div>` : ''}
          <table>
            <thead>
              <tr>
                <th class="col-account">Account Name</th>
                <th class="col-credit">Credit</th>
                <th class="col-debit">Debit</th>
                <th class="col-balance">Balance</th>
                <th class="col-status">Result</th>
              </tr>
            </thead>
            <tbody>
              ${accounts.map(acc => `
                <tr>
                  <td class="col-account">${toDisplayCase(acc.accountName)}</td>
                  <td class="col-credit text-green">${amount(acc.credit)}</td>
                  <td class="col-debit text-red">${amount(acc.debit)}</td>
                  <td class="col-balance">${amount(acc.balance)}</td>
                  <td class="col-status">${toDisplayCase(acc.result)}</td>
                </tr>`).join('')}
              <tr class="totals">
                <td class="col-account">${totalsLabel}</td>
                <td class="col-credit text-green">${totalCredit.toLocaleString()}</td>
                <td class="col-debit text-red">${totalDebit.toLocaleString()}</td>
                <td class="col-balance">${balance.toLocaleString()}</td>
                <td class="col-status">${balance >= 0 ? 'Credit' : 'Debit'}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    };

    let title: string;
    let body: string;
    if (reportFilter === 'BALANCE_SHEET') {
      title = 'Balance Sheet Report';
      body = accountTable('', bsAccounts, 'Totals');
    } else if (reportFilter === 'PROFIT_LOSS') {
      title = 'Profit & Loss Statement';
      body = accountTable('', plAccounts, 'Totals');
    } else {
      title = 'Trial Balance Sheet & Profit & Loss Report';
      body =
        accountTable('Profit & Loss', plAccounts, 'P&L Totals') +
        accountTable('Balance Sheet', bsAccounts, 'Balance Sheet Totals');
    }

    const printContent = `<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8">
    <style>
      ${getSharedPrintStyles({ isLandscape: false, fontSizePt: 9 })}
      body { background: #f3f4f6; padding: 16px; }
      .page { background: #fff; max-width: 210mm; margin: 0 auto; padding: 10mm 8mm; border: 1px solid #d1d5db; box-sizing: border-box; }
      .header { text-align: center; border-bottom: 1.5px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
      .header h1 { margin: 0; font-size: 13pt; }
      .header .meta { margin-top: 2px; font-size: 9pt; }
      .header .generated { margin-top: 2px; font-size: 7.5pt; color: #555; }
      .section { margin-bottom: 10px; }
      .section-title { font-size: 10pt; font-weight: bold; margin: 4px 0; }
      /* Same amount-column widths in every table so the sections line up */
      table th.col-credit, table th.col-debit, table th.col-balance { width: 17% !important; }
      table th.col-status { width: 8% !important; }
      .text-green { color: #047857; }
      .text-red { color: #b91c1c; }
      .footer { margin-top: 10px; text-align: center; font-size: 7.5pt; color: #555; border-top: 1px solid #d1d5db; padding-top: 4px; }
      .toolbar { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; }
      .toolbar button { border: none; color: #fff; padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: bold; cursor: pointer; }
      @media print {
        body { background: #fff !important; padding: 0 !important; }
        .page { max-width: none; border: none; padding: 0; margin: 0; }
        .toolbar { display: none !important; }
      }
    </style>
  </head>
  <body>
    <div class="toolbar no-print">
      <button style="background:#2563eb" onclick="window.print()">Print</button>
      <button style="background:#6b7280" onclick="window.close()">Close</button>
    </div>
    <div class="page">
      <div class="header">
        <h1>${title}</h1>
        <div class="meta">Company: <strong>${filters.companyName ? toDisplayCase(filters.companyName) : 'All Companies'}</strong></div>
        <div class="meta">Period: ${periodHtml}</div>
        <div class="generated">Generated on ${format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
      </div>
      ${body}
      <div class="footer">Thirumala Group Business Management System</div>
    </div>
  </body>
</html>`;

    const previewWindow = window.open('', '_blank', 'width=1000,height=800,scrollbars=yes,resizable=yes');
    if (!previewWindow) {
      toast.error('Please allow popups to print');
      return;
    }
    previewWindow.document.write(printContent);
    previewWindow.document.close();
    previewWindow.focus();
    toast.success('Report preview opened! Use the Print button in the preview window to print.');
  };

  return (
    <div className='min-h-screen flex flex-col'>
      <div className='max-w-6xl w-full mx-auto space-y-6'>
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
                Balance Sheet
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
              Generate balance sheet reports with account-wise breakdown
            </p>
          </div>
        </div>
        
        {/* Performance Status Indicator */}
        <div className={`p-3 rounded-lg border ${usingOptimizedAPI ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
          <div className='flex items-center gap-2'>
            <div className={`w-3 h-3 rounded-full ${usingOptimizedAPI ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
            <span className={`text-sm font-medium ${usingOptimizedAPI ? 'text-green-800' : 'text-yellow-800'}`}>
              {usingOptimizedAPI ? '🚀 Using Optimized Server-Side API' : '⚠️ Using Fallback Client-Side Processing'}
            </span>
            {usingOptimizedAPI && (
              <span className='text-xs text-green-600'>
                (Faster loading with server-side aggregation & caching)
              </span>
            )}
          </div>
        </div>
        {/* Responsive filter bar */}
        <div className='flex flex-col md:flex-row gap-4 items-end'>
          <div className='flex-1 w-full relative'>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              From Date
            </label>
            <input
              type='text'
              placeholder='DD/MM/YYYY'
              value={fromDateInput}
              onChange={(e) => {
                setFromDateInput(e.target.value);
                const match = e.target.value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                if (match) {
                  const isoDate = `${match[3]}-${match[2]}-${match[1]}`;
                  handleFilterChange('fromDate', isoDate);
                }
              }}
              className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold'
              style={{ fontWeight: 'bold', fontSize: '14px' }}
            />
            <button
              type='button'
              tabIndex={-1}
              onClick={() => setShowFromCalendar(!showFromCalendar)}
              className='absolute right-2 top-7 p-1 hover:bg-gray-100 rounded'
            >
              <Calendar className='w-4 h-4 text-gray-500' />
            </button>
            {showFromCalendar && (
              <CustomCalendar
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
          <div className='flex-1 w-full relative'>
            <label className='block text-sm font-medium text-gray-700 mb-1'>
              To Date
            </label>
            <input
              type='text'
              placeholder='DD/MM/YYYY'
              value={toDateInput}
              onChange={(e) => {
                setToDateInput(e.target.value);
                const match = e.target.value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                if (match) {
                  const isoDate = `${match[3]}-${match[2]}-${match[1]}`;
                  handleFilterChange('toDate', isoDate);
                }
              }}
              className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold'
              style={{ fontWeight: 'bold', fontSize: '14px' }}
            />
            <button
              type='button'
              tabIndex={-1}
              onClick={() => setShowToCalendar(!showToCalendar)}
              className='absolute right-2 top-7 p-1 hover:bg-gray-100 rounded'
            >
              <Calendar className='w-4 h-4 text-gray-500' />
            </button>
            {showToCalendar && (
              <CustomCalendar
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
          <div className='flex-1 w-full'>
            <SearchableSelect
              label='Company'
              value={filters.companyName}
              onChange={value => handleFilterChange('companyName', value)}
              options={companies}
              placeholder='Select company...'
              className='w-full'
            />
          </div>
          <div className='flex flex-row gap-2 mt-2 md:mt-0'>
            <Button variant='secondary' onClick={refreshData}>
              Refresh
            </Button>
            <Button variant='primary' onClick={printReport}>
              Print
            </Button>
            <Button variant='secondary' onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </div>

        {/* Responsive table/card layout */}
        <Card className='overflow-x-auto p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'>
          {loading ? (
            <div className='text-center text-gray-500 py-8'>Loading...</div>
          ) : balanceSheetData.length === 0 ? (
            <div className='text-center text-gray-500 py-8'>
              No accounts found for these filters.
            </div>
          ) : (
            <table className='min-w-full text-sm'>
              <thead className='bg-blue-100'>
                <tr>
                  <th className='px-3 py-2 text-left'>Account Name</th>
                  <th className='px-3 py-2 text-right'>Credit</th>
                  <th className='px-3 py-2 text-right'>Debit</th>
                  <th className='px-3 py-2 text-right'>Balance</th>
                  <th className='px-3 py-2 text-center'>Result</th>
                </tr>
              </thead>
              <tbody>
                {balanceSheetData.map((acc, idx) => (
                  <tr
                    key={acc.accountName}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-blue-50'}
                  >
                    <td className='px-3 py-2'>{acc.accountName}</td>
                    <td className='px-3 py-2 text-right text-green-700'>
                      {acc.credit > 0 ? `${acc.credit.toLocaleString()}` : '-'}
                    </td>
                    <td className='px-3 py-2 text-right text-red-700'>
                      {acc.debit > 0 ? `${acc.debit.toLocaleString()}` : '-'}
                    </td>
                    <td className='px-3 py-2 text-right font-semibold'>
                      {acc.balance > 0
                        ? `${acc.balance.toLocaleString()}`
                        : '-'}
                    </td>
                    <td className='px-3 py-2 text-center font-bold'>
                      {acc.result}
                    </td>
                  </tr>
                ))}
                
                {/* Custom Rows */}
                {customRows.map((customRow, idx) => (
                  <tr key={`custom-${idx}`}>
                    <td className='px-3 py-2 font-semibold'>
                      {customRow.accountName}
                    </td>
                    <td className='px-3 py-2 text-right text-green-700'>
                      {customRow.credit > 0 ? `${customRow.credit.toLocaleString()}` : '-'}
                    </td>
                    <td className='px-3 py-2 text-right text-red-700'>
                      {customRow.debit > 0 ? `${customRow.debit.toLocaleString()}` : '-'}
                    </td>
                    <td className='px-3 py-2 text-right font-semibold'>
                      {customRow.balance > 0 ? `${customRow.balance.toLocaleString()}` : '-'}
                    </td>
                    <td className='px-3 py-2 text-center font-bold'>
                      {customRow.result}
                      <span className='block text-[11px] font-semibold text-blue-700'>
                        {customRow.plYesNo === 'YES' ? 'Profit & Loss' : 'Balance Sheet'}
                      </span>
                    </td>
                  </tr>
                ))}
                
                {/* Add Custom Row Button */}
                {/* Add Custom Row Form - Always Visible */}
                <tr className='bg-blue-50 border-2 border-blue-300'>
                  <td colSpan={5} className='px-3 py-2 text-center font-semibold text-blue-800'>
                    📝 Add Custom Row for Printing (Data not stored in database)
                  </td>
                </tr>
                <tr className='bg-blue-50 border-2 border-blue-300'>
                    <td className='px-3 py-2'>
                      <input
                        type='text'
                        value={newRowData.accountName}
                        onChange={(e) => handleNewRowDataChange('accountName', e.target.value)}
                        placeholder='Account Name'
                        className='w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
                        disabled={currentBook?.is_locked}
                      />
                    </td>
                    <td className='px-3 py-2'>
                      <input
                        type='number'
                        value={newRowData.credit}
                        onChange={(e) => handleNewRowDataChange('credit', e.target.value)}
                        placeholder='Credit'
                        className='w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
                        disabled={currentBook?.is_locked}
                      />
                    </td>
                    <td className='px-3 py-2'>
                      <input
                        type='number'
                        value={newRowData.debit}
                        onChange={(e) => handleNewRowDataChange('debit', e.target.value)}
                        placeholder='Debit'
                        className='w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
                        disabled={currentBook?.is_locked}
                      />
                    </td>
                    <td className='px-3 py-2'>
                      <input
                        type='number'
                        value={newRowData.balance}
                        onChange={(e) => handleNewRowDataChange('balance', e.target.value)}
                        placeholder='Balance'
                        className='w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
                        disabled={currentBook?.is_locked}
                      />
                    </td>
                    <td className='px-3 py-2'>
                      {/* Which printed table this row goes in. Credit/Debit come from the amounts typed. */}
                      <select
                        value={newRowData.plYesNo}
                        onChange={(e) => handleNewRowDataChange('plYesNo', e.target.value)}
                        className='w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
                        disabled={currentBook?.is_locked}
                        data-help='Choose which printed table this row goes in: Balance Sheet or Profit & Loss.'
                      >
                        <option value='NO'>Balance Sheet</option>
                        <option value='YES'>Profit & Loss</option>
                      </select>
                    </td>
                  </tr>
                
                {/* Add Row Button - Always Visible */}
                <tr className='bg-green-50 border-2 border-green-300'>
                  <td colSpan={5} className='px-3 py-2 text-center'>
                    <div className='flex gap-2 justify-center'>
                      <Button
                        variant='primary'
                        size='sm'
                        onClick={addCustomRow}
                        disabled={!newRowData.accountName.trim() || currentBook?.is_locked}
                      >
                        Add Row
                      </Button>
                      <Button
                        variant='secondary'
                        size='sm'
                        onClick={() => {
                          setNewRowData({
                            accountName: '',
                            credit: '',
                            debit: '',
                            balance: '',
                            result: 'CREDIT',
                            plYesNo: 'NO',
                            bothYesNo: 'NO'
                          });
                        }}
                        disabled={currentBook?.is_locked}
                      >
                        Clear Form
                      </Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
};

export default BalanceSheet;
