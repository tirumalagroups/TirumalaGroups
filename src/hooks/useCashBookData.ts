import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabaseDB } from '../lib/supabaseDatabase';
import { queryKeys } from '../lib/queryClient';
import toast from 'react-hot-toast';

// Hook for paginated cash book entries
export const useCashBookEntries = (page: number = 0, limit: number = 1000) => {
  return useQuery({
    queryKey: queryKeys.cashBook.list(page, limit),
    queryFn: () => supabaseDB.getCashBookEntries(limit, page * limit),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    keepPreviousData: true, // Keep previous data while fetching new page
  });
};

// Hook for all cash book entries (for exports, etc.)
export const useAllCashBookEntries = () => {
  return useQuery({
    queryKey: queryKeys.cashBook.all(),
    queryFn: () => supabaseDB.getAllCashBookEntries(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    enabled: false, // Only fetch when explicitly called
  });
};

// Hook for cash book entries by date
export const useCashBookEntriesByDate = (date: string) => {
  return useQuery({
    queryKey: queryKeys.cashBook.byDate(date),
    queryFn: () => supabaseDB.getCashBookEntriesByDate(date),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: !!date, // Only fetch if date is provided
  });
};

// Hook for single cash book entry
export const useCashBookEntry = (id: string) => {
  return useQuery({
    queryKey: queryKeys.cashBook.byId(id),
    queryFn: () => supabaseDB.getCashBookEntry(id),
    staleTime: 5 * 60 * 1000, // 5 minutes for individual entries
    gcTime: 10 * 60 * 1000,
    enabled: !!id, // Only fetch if ID is provided
  });
};

// Mutation for creating new entry
export const useCreateCashBookEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entry: any) => supabaseDB.createCashBookEntry(entry),
    onSuccess: () => {
      // Invalidate relevant queries (using array format for broader invalidation)
      queryClient.invalidateQueries({ queryKey: ['cashBook'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'companyBalances'] });
      
      // Invalidate date-specific queries for recent entries
      queryClient.invalidateQueries({ queryKey: ['recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook', 'byDate'] });
      
      if (supabaseDB.isOnline) toast.success('Entry created successfully!');
    },
    onError: (error: any) => {
      console.error('Error creating entry:', error);
      toast.error('Failed to create entry');
    },
  });
};

// Mutation for updating entry
export const useUpdateCashBookEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entry }: { id: string; entry: any }) => 
      supabaseDB.updateCashBookEntry(id, entry),
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries (using array format for broader invalidation)
      queryClient.invalidateQueries({ queryKey: ['cashBook', 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'companyBalances'] });
      
      // Invalidate date-specific queries for recent entries
      queryClient.invalidateQueries({ queryKey: ['recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook', 'byDate'] });
      
      toast.success('Entry updated successfully!');
    },
    onError: (error: any) => {
      console.error('Error updating entry:', error);
      toast.error('Failed to update entry');
    },
  });
};

// Mutation for deleting entry
export const useDeleteCashBookEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => supabaseDB.deleteCashBookEntry(id),
    onSuccess: (_, id) => {
      // Invalidate relevant queries (using array format for broader invalidation)
      queryClient.invalidateQueries({ queryKey: ['cashBook', 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'companyBalances'] });
      
      // Invalidate date-specific queries for recent entries
      queryClient.invalidateQueries({ queryKey: ['recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook', 'byDate'] });
      
      toast.success('Entry deleted successfully!');
    },
    onError: (error: any) => {
      console.error('Error deleting entry:', error);
      toast.error('Failed to delete entry');
    },
  });
};

// Mutation for bulk operations
export const useBulkCashBookOperations = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (operations: any) => supabaseDB.bulkUpdateCashBookEntries(operations),
    onSuccess: () => {
      // Invalidate all cash book related queries (using array format for broader invalidation)
      queryClient.invalidateQueries({ queryKey: ['cashBook'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'companyBalances'] });
      
      // Invalidate date-specific queries for recent entries
      queryClient.invalidateQueries({ queryKey: ['recentEntries'] });
      queryClient.invalidateQueries({ queryKey: ['cashBook', 'byDate'] });
      
      if (supabaseDB.isOnline) toast.success('Bulk operations completed successfully!');
    },
    onError: (error: any) => {
      console.error('Error in bulk operations:', error);
      toast.error('Failed to complete bulk operations');
    },
  });
};
