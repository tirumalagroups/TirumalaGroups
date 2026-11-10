import { QueryClient } from '@tanstack/react-query';
import { getTableMode } from './tableNames';

// Helper to get current table mode for query keys
const getTableModeForQuery = (): string => {
  return getTableMode();
};

// Helper to get current table book ID for query keys
const getTableBookForQuery = (): string => {
  const mode = getTableMode();
  const storageKey = mode === 'itr' ? 'itrSelectedBook' : 'regularSelectedBook';
  return localStorage.getItem(storageKey) || '';
};

// Lists show the saved copy at once and reload it in the background when it is older than this,
// so a change made anywhere shows up without reloading the page.
export const FRESH_FOR_MS = 30 * 1000;
const online = () => typeof navigator === 'undefined' || navigator.onLine;

// Create a client with optimized settings for SPA behavior
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      // Opening a screen shows the saved copy at once and refreshes it in the background if older
      staleTime: FRESH_FOR_MS,
      // Keep cache around longer between navigations
      gcTime: 30 * 60 * 1000, // 30 minutes
      // Retry failed requests 2 times
      retry: 2,
      // Coming back to the window refreshes what is on screen (not while offline)
      refetchOnWindowFocus: online,
      // Only refetch on reconnect if stale
      refetchOnReconnect: 'always',
      // Opening a screen refreshes its lists when they are older than FRESH_FOR_MS (not while offline)
      refetchOnMount: online,
      // Structural sharing for faster cache updates
      structuralSharing: true,
    },
    mutations: {
      networkMode: 'always',
      // Retry mutations once
      retry: 1,
    },
  },
});

// Query keys for consistent caching
// Include table mode and book ID in query keys so React Query treats different modes/books as separate
export const queryKeys = {
  // Dashboard queries
  dashboard: {
    stats: (date?: string) => ['dashboard', 'stats', getTableModeForQuery(), getTableBookForQuery(), date] as const,
    recentEntries: () => ['dashboard', 'recentEntries', getTableModeForQuery(), getTableBookForQuery()] as const,
    companyBalances: () => ['dashboard', 'companyBalances', getTableModeForQuery(), getTableBookForQuery()] as const,
  },
  // Cash book queries
  cashBook: {
    all: () => ['cashBook', 'all', getTableModeForQuery(), getTableBookForQuery()] as const,
    list: (page: number, limit: number) => ['cashBook', 'list', getTableModeForQuery(), getTableBookForQuery(), page, limit] as const,
    byId: (id: string) => ['cashBook', 'detail', getTableModeForQuery(), getTableBookForQuery(), id] as const,
    byDate: (date: string) => ['cashBook', 'byDate', getTableModeForQuery(), getTableBookForQuery(), date] as const,
  },
  // Dropdown data queries (accounts/subaccounts/companies change with mode/book, users don't)
  dropdowns: {
    companies: () => ['dropdowns', 'companies', getTableModeForQuery(), getTableBookForQuery()] as const,
    accounts: () => ['dropdowns', 'accounts', getTableModeForQuery(), getTableBookForQuery()] as const,
    subAccounts: () => ['dropdowns', 'subAccounts', getTableModeForQuery(), getTableBookForQuery()] as const,
    users: () => ['dropdowns', 'users'] as const, // Shared between modes
  },
  // Approval queries
  approvals: {
    pending: () => ['approvals', 'pending', getTableModeForQuery(), getTableBookForQuery()] as const,
    count: () => ['approvals', 'count', getTableModeForQuery(), getTableBookForQuery()] as const,
  },
} as const;

