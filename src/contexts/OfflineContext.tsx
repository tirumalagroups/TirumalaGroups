import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { db } from '../lib/offlineQueueDB';
import { supabaseDB } from '../lib/supabaseDatabase';
import { syncAllMasterData } from '../lib/offlineMasterData';
import { backendReachable } from '../lib/offlineSession';
import { queryClient } from '../lib/queryClient';

export type ConnectionStatus = 'ONLINE' | 'OFFLINE' | 'CHECKING' | 'BACKEND_ERROR';

interface OfflineContextType {
  isOnline: boolean;
  connectionStatus: ConnectionStatus;
  isSyncing: boolean;
  /** Entries waiting to go to the server */
  pendingCount: number;
  /** Entries held or failed, which someone needs to look at */
  attentionCount: number;
  lastSyncAt: string | null;
  offlineSince: string | null;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (val: boolean) => void;
  triggerSync: () => Promise<void>;
  updateStats: () => Promise<void>;
  /** Shows the "Internet needed" box for something that cannot be done offline */
  askInternet: (what: string) => void;
}

const OfflineContext = createContext<OfflineContextType | undefined>(undefined);

const PROBE_MS = 10000;
const RETRY_SYNC_MS = 60000;

export const OfflineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('CHECKING');
  const [isOnline, setIsOnline] = useState<boolean>(true); // Assume online during CHECKING to avoid UI block
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [attentionCount, setAttentionCount] = useState<number>(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => localStorage.getItem('last_sync_at'));
  const [offlineSince, setOfflineSince] = useState<string | null>(() => localStorage.getItem('offline_since'));
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState<boolean>(() => {
    const saved = localStorage.getItem('auto_sync_enabled');
    return saved !== 'false'; // Default to true
  });
  const [internetBox, setInternetBox] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const statusRef = useRef<ConnectionStatus>('CHECKING');
  const failedProbes = useRef(0);
  const autoSyncRef = useRef(autoSyncEnabled);
  autoSyncRef.current = autoSyncEnabled;

  const setAutoSyncEnabled = (val: boolean) => {
    setAutoSyncEnabledState(val);
    localStorage.setItem('auto_sync_enabled', String(val));
  };

  const askInternet = useCallback((what: string) => setInternetBox(what), []);

  const updateStats = useCallback(async () => {
    try {
      const count = await db.queued_operations.where('status').anyOf(['pending_sync', 'syncing']).count();
      setPendingCount(count);
      setAttentionCount(await db.queued_operations.where('status').anyOf(['failed', 'conflict']).count());
      setLastSyncAt(localStorage.getItem('last_sync_at'));
      setOfflineSince(localStorage.getItem('offline_since'));
    } catch (err) {
      console.error('Failed to update offline stats:', err);
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    supabaseDB.isSyncing = true;
    try {
      const result = await supabaseDB.syncOfflineQueue();
      const now = new Date().toISOString();
      localStorage.setItem('last_sync_at', now);
      setLastSyncAt(now);
      if (result && result.synced > 0) {
        toast.success(`${result.synced} offline ${result.synced === 1 ? 'entry' : 'entries'} sent to the server`);
        queryClient.invalidateQueries();
        localStorage.setItem('dashboard-refresh', Date.now().toString());
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      }
      if (result && result.held + result.failed > 0) {
        toast.error(`${result.held + result.failed} need attention in Sync Center. They are safe on this computer.`, {
          id: 'sync-attention',
        });
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      supabaseDB.isSyncing = false;
      await updateStats();
    }
  }, [updateStats]);

  // Run retention cleanup for records older than 7 days
  const cleanUpRetentionHistory = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const threshold = sevenDaysAgo.toISOString();
      await db.queued_operations
        .where('synced_at')
        .below(threshold)
        .and(op => op.status === 'synced')
        .delete();
    } catch (err) {
      console.error('Failed to clean up sync retention history:', err);
    }
  }, []);

  const applyStatus = useCallback(
    (next: ConnectionStatus) => {
      const previous = statusRef.current;
      statusRef.current = next;
      const online = next !== 'OFFLINE';
      setIsOnline(online);
      supabaseDB.isOnline = online;
      setConnectionStatus(next);
      if (online) {
        localStorage.removeItem('offline_since');
        setOfflineSince(null);
      } else if (!localStorage.getItem('offline_since')) {
        const now = new Date().toISOString();
        localStorage.setItem('offline_since', now);
        setOfflineSince(now);
      }
      if (previous !== next && (previous === 'OFFLINE' || next === 'OFFLINE')) {
        // Screens reload what they can: saved lists offline, live data when back online
        queryClient.invalidateQueries();
        updateStats();
      }
    },
    [updateStats]
  );

  // WiFi with no internet counts as offline: only an answer from the server counts as online.
  const checkConnectivity = useCallback(async () => {
    const reachable = await backendReachable(5000);
    if (reachable) {
      failedProbes.current = 0;
      applyStatus('ONLINE');
      return;
    }
    failedProbes.current += 1;
    // One slow answer while working is not an outage, unless the browser itself says it is offline
    const certain = !navigator.onLine || statusRef.current === 'CHECKING' || failedProbes.current >= 2;
    if (certain) applyStatus('OFFLINE');
  }, [applyStatus]);

  useEffect(() => {
    checkConnectivity();

    const handleOnline = () => checkConnectivity();
    const handleOffline = () => applyStatus('OFFLINE');
    const handleQueueChange = () => updateStats();
    // A save just failed because the connection dropped between checks
    const handleNetworkFailure = () => {
      failedProbes.current = 2;
      applyStatus('OFFLINE');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('offline-queue-changed', handleQueueChange);
    window.addEventListener('offline-network-failure', handleNetworkFailure);

    updateStats();
    cleanUpRetentionHistory();

    // Ask the browser not to clear this computer's unsynced entries when it is short of space
    navigator.storage?.persist?.().catch(() => undefined);

    const probeInterval = setInterval(checkConnectivity, PROBE_MS);
    // If a sync stopped part way because the internet dropped again, carry on
    const retryInterval = setInterval(async () => {
      if (statusRef.current === 'OFFLINE' || !autoSyncRef.current) return;
      const waiting = await db.queued_operations.where('status').equals('pending_sync').count();
      if (waiting > 0) triggerSync();
    }, RETRY_SYNC_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('offline-queue-changed', handleQueueChange);
      window.removeEventListener('offline-network-failure', handleNetworkFailure);
      clearInterval(probeInterval);
      clearInterval(retryInterval);
    };
  }, [applyStatus, checkConnectivity, cleanUpRetentionHistory, triggerSync, updateStats]);

  // Handle sync/master data load upon transitioning to ONLINE
  useEffect(() => {
    if (connectionStatus === 'ONLINE' || connectionStatus === 'BACKEND_ERROR') {
      if (autoSyncEnabled) {
        triggerSync();
      } else {
        updateStats();
      }

      // Sync master data cache
      syncAllMasterData().catch(err => console.error('Error syncing master data cache:', err));
    }
  }, [connectionStatus, autoSyncEnabled, triggerSync, updateStats]);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        connectionStatus,
        isSyncing,
        pendingCount,
        attentionCount,
        lastSyncAt,
        offlineSince,
        autoSyncEnabled,
        setAutoSyncEnabled,
        triggerSync,
        updateStats,
        askInternet,
      }}
    >
      {children}
      {internetBox && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]' role='alertdialog' aria-label='Internet needed'>
          <div className='bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-center'>
            <div className='w-14 h-14 mx-auto mb-3 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center'>
              <WifiOff className='w-7 h-7' />
            </div>
            <h2 className='text-xl font-bold text-gray-900'>Internet needed</h2>
            <p className='text-gray-700 mt-2'>
              {internetBox} needs a connection, so nothing goes unrecorded. Please reconnect and try again.
            </p>
            <button
              type='button'
              onClick={() => setInternetBox(null)}
              className='mt-5 px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700'
            >
              OK
            </button>
          </div>
        </div>
      )}
    </OfflineContext.Provider>
  );
};

export const useOffline = () => {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
};
