import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../lib/offlineQueueDB';
import { toast } from 'react-hot-toast';
import { queryClient } from '../lib/queryClient';
import { useAuth } from './AuthContext';

type TableMode = 'regular' | 'itr' | 'finance' | null;

interface TableModeContextType {
  mode: TableMode;
  toggleMode: () => void | Promise<void>;
  setMode: (mode: TableMode) => void | Promise<void>;
  isITRMode: boolean;
  isFinanceMode: boolean;
}

const TableModeContext = createContext<TableModeContextType | undefined>(undefined);

export const useTableMode = () => {
  const context = useContext(TableModeContext);
  if (context === undefined) {
    throw new Error('useTableMode must be used within a TableModeProvider');
  }
  return context;
};

export const TableModeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading: authLoading, reloadPermissions } = useAuth();

  // Load mode from sessionStorage or localStorage, default to null (no mode selected)
  const [mode, setMode] = useState<TableMode>(() => {
    const saved = sessionStorage.getItem('table_mode') || localStorage.getItem('table_mode');
    if (saved === 'itr' || saved === 'finance' || saved === 'regular') {
      return saved as TableMode;
    }
    return null;
  });

  // Reset mode when user logs out
  useEffect(() => {
    // While the session is still being checked at startup there is no user yet,
    // and that must not erase the saved mode
    if (!authLoading && !user) {
      setMode(null);
    }
  }, [user, authLoading]);

  // Save to storage whenever mode changes
  useEffect(() => {
    if (mode) {
      sessionStorage.setItem('table_mode', mode);
      localStorage.setItem('table_mode', mode);
    } else {
      sessionStorage.removeItem('table_mode');
      localStorage.removeItem('table_mode');
    }
    window.dispatchEvent(
      new CustomEvent<TableMode>('table-mode-changed', {
        detail: mode,
      })
    );
  }, [mode]);

  const toggleMode = async () => {
    try {
      const count = await db.queued_operations
        .where('status')
        .equals('pending_sync')
        .count();
      if (count > 0) {
        toast.error(`Cannot switch modes while there are ${count} unsynchronized records. Please sync first.`);
        return;
      }
    } catch (err) {
      console.error('Failed to check offline queue before toggling mode:', err);
    }
    // Clear all React Query cache so next render fetches fresh data for the new mode
    queryClient.clear();
    setMode(prev => (prev === 'regular' ? 'itr' : prev === 'itr' ? 'finance' : 'regular'));
  };

  const setModeDirect = async (newMode: TableMode) => {
    if (newMode === mode) return;
    
    // Only check offline queue if switching from one active mode to another active mode
    if (mode !== null && newMode !== null && newMode !== mode) {
      try {
        const count = await db.queued_operations
          .where('status')
          .equals('pending_sync')
          .count();
        if (count > 0) {
          toast.error(`Cannot switch modes while there are ${count} unsynchronized records. Please sync first.`);
          return;
        }
      } catch (err) {
        console.error('Failed to check offline queue before setting mode:', err);
      }
    }
    
    // Clear all React Query cache so next render fetches fresh data for the new mode
    queryClient.clear();
    setMode(newMode);

    // Reload permissions/features for the newly selected mode
    if (newMode !== null) {
      await reloadPermissions();
    }
  };

  const value: TableModeContextType = {
    mode,
    toggleMode,
    setMode: setModeDirect,
    isITRMode: mode === 'itr',
    isFinanceMode: mode === 'finance',
  };

  return (
    <TableModeContext.Provider value={value}>
      {children}
    </TableModeContext.Provider>
  );
};
