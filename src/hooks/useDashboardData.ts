import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseDB } from '../lib/supabaseDatabase';
import { queryKeys, FRESH_FOR_MS } from '../lib/queryClient';
import { getTableMode } from '../lib/tableNames';
import { useTableMode } from '../contexts/TableModeContext';

// Hook for dashboard stats
export const useDashboardStats = (selectedDate?: string) => {
  return useQuery({
    queryKey: queryKeys.dashboard.stats(selectedDate),
    queryFn: () => supabaseDB.getDashboardStats(selectedDate),
    staleTime: FRESH_FOR_MS,
    gcTime: 5 * 60 * 1000, // 5 minutes cache
  });
};

// Hook for recent entries (today's entries only for LIFO display)
export const useRecentEntries = () => {
  return useQuery({
    queryKey: queryKeys.dashboard.recentEntries(),
    queryFn: () => supabaseDB.getTodaysCashBookEntries(),
    staleTime: FRESH_FOR_MS,
    gcTime: 10 * 60 * 1000,
    keepPreviousData: true,
  });
};

// Hook for recent entries by specific date (for NewEntry form)
export const useRecentEntriesByDate = (date: string) => {
  // Use React context to get current mode (reacts to changes)
  const { mode: tableMode } = useTableMode();
  
  return useQuery({
    queryKey: ['recentEntries', tableMode, date],
    queryFn: () => {
      console.log('🔍 Fetching recent entries for date:', date, 'Mode:', tableMode);
      return supabaseDB.getCashBookEntriesByDate(date);
    },
    staleTime: FRESH_FOR_MS,
    gcTime: 10 * 60 * 1000,
    keepPreviousData: true,
    enabled: !!date, // Only fetch if date is provided
    onSuccess: (data) => {
      console.log('✅ Recent entries fetched successfully:', data?.length || 0, 'entries for date:', date, 'Mode:', tableMode);
    },
    onError: (error) => {
      console.error('❌ Error fetching recent entries for date:', date, error);
    }
  });
};

// Hook for company balances
export const useCompanyBalances = () => {
  return useQuery({
    queryKey: queryKeys.dashboard.companyBalances(),
    queryFn: () => supabaseDB.getCompanyClosingBalances(),
    staleTime: FRESH_FOR_MS,
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  });
};

// Hook for dropdown data (companies, accounts, sub accounts, users)
export const useDropdownData = () => {
  // Use React context to get current mode (reacts to changes)
  const { mode: tableMode } = useTableMode();
  
  const companiesQuery = useQuery({
    queryKey: queryKeys.dropdowns.companies(), // This includes table mode
    queryFn: () => {
      console.log('🔄 [useDropdownData] Fetching companies, mode:', tableMode);
      return supabaseDB.getCompanies(); // getCompanies() now uses getTableName('companies')
    },
    staleTime: 0, // Refetch immediately when mode changes
    gcTime: 30 * 60 * 1000, // 30 minutes cache
    enabled: true, // Always enabled
  });

  const distinctCompaniesCountQuery = useQuery({
    queryKey: ['companies', 'distinctCount', tableMode], // Include table mode
    queryFn: () => supabaseDB.getDistinctCompaniesCount(),
    staleTime: FRESH_FOR_MS,
    gcTime: 30 * 60 * 1000,
  });

  const accountsQuery = useQuery({
    queryKey: queryKeys.dropdowns.accounts(),
    queryFn: () => supabaseDB.getAccounts(),
    staleTime: FRESH_FOR_MS,
    gcTime: 30 * 60 * 1000,
  });

  const subAccountsQuery = useQuery({
    queryKey: queryKeys.dropdowns.subAccounts(),
    queryFn: () => supabaseDB.getSubAccounts(),
    staleTime: FRESH_FOR_MS,
    gcTime: 30 * 60 * 1000,
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.dropdowns.users(),
    queryFn: () => supabaseDB.getUsers(),
    staleTime: FRESH_FOR_MS,
    gcTime: 30 * 60 * 1000,
  });

  const pendingApprovalsQuery = useQuery({
    queryKey: queryKeys.approvals.count(),
    queryFn: () => supabaseDB.getPendingApprovalsCount(),
    staleTime: FRESH_FOR_MS,
    gcTime: 3 * 60 * 1000,
  });

  const uniqueSubAccountsCountQuery = useQuery({
    queryKey: ['subAccounts', 'uniqueCount', tableMode],
    queryFn: async () => {
      // Use the reference table method which correctly uses getTableName for ITR mode
      const count = await supabaseDB.getUniqueSubAccountsCount();
      console.log('📊 Sub Accounts count (Mode:', tableMode, '):', count);
      return count;
    },
    staleTime: 0, // refetch on mount so dashboard shows latest dropdown-aligned count
    gcTime: 30 * 60 * 1000,
  });

  const distinctMainAccountsCountQuery = useQuery({
    queryKey: ['accounts', 'distinctCount', tableMode],
    queryFn: async () => {
      // Align with ReplaceForm dropdown: count distinct main accounts from cash_book
      const names = await supabaseDB.getDistinctAccountNames();
      const normalized = names
        .map(name => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean)
        .map(name => name.toLowerCase());
      const unique = new Set(normalized);
      console.log('📊 Distinct main accounts count (Mode:', tableMode, '):', unique.size);
      return unique.size;
    },
    staleTime: 0, // refetch on mount for latest count
    gcTime: 30 * 60 * 1000,
  });

  const activeOperatorCountQuery = useQuery({
    queryKey: ['operators', 'activeCount'],
    queryFn: () => supabaseDB.getActiveOperatorCount(),
    staleTime: FRESH_FOR_MS,
    gcTime: 15 * 60 * 1000,
  });

  return {
    companies: companiesQuery,
    accounts: accountsQuery,
    subAccounts: subAccountsQuery,
    users: usersQuery,
    pendingApprovals: pendingApprovalsQuery,
    uniqueSubAccountsCount: uniqueSubAccountsCountQuery,
    distinctMainAccountsCount: distinctMainAccountsCountQuery,
    distinctCompaniesCount: distinctCompaniesCountQuery,
    activeOperatorCount: activeOperatorCountQuery,
    isLoading: companiesQuery.isLoading || accountsQuery.isLoading || subAccountsQuery.isLoading || usersQuery.isLoading || pendingApprovalsQuery.isLoading || uniqueSubAccountsCountQuery.isLoading || distinctMainAccountsCountQuery.isLoading || distinctCompaniesCountQuery.isLoading || activeOperatorCountQuery.isLoading,
    isError: companiesQuery.isError || accountsQuery.isError || subAccountsQuery.isError || usersQuery.isError || pendingApprovalsQuery.isError || uniqueSubAccountsCountQuery.isError || distinctMainAccountsCountQuery.isError || distinctCompaniesCountQuery.isError || activeOperatorCountQuery.isError,
  };
};

// Utility hook for invalidating dashboard data
export const useInvalidateDashboard = () => {
  const queryClient = useQueryClient();

  const invalidateAll = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['cashBook'] });
    queryClient.invalidateQueries({ queryKey: ['approvals'] });
    queryClient.invalidateQueries({ queryKey: ['dropdowns'] });
    // Also invalidate sub accounts unique count to keep dashboard in sync
    queryClient.invalidateQueries({ queryKey: ['subAccounts', 'uniqueCount'] });
  }, [queryClient]);

  const invalidateStats = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'companyBalances'] });
  }, [queryClient]);

  const invalidateRecentEntries = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'recentEntries'] });
    queryClient.invalidateQueries({ queryKey: ['cashBook'] });
  }, [queryClient]);

  return {
    invalidateAll,
    invalidateStats,
    invalidateRecentEntries,
  };
};
