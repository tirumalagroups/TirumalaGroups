import React, { useState, useEffect } from 'react';
import { db, QueuedOperation } from '../lib/offlineQueueDB';
import { useOffline } from '../contexts/OfflineContext';
import { useAuth } from '../contexts/AuthContext';
import { supabaseDB } from '../lib/supabaseDatabase';
import { supabase } from '../lib/supabase';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { format, parseISO } from 'date-fns';
import { toast } from 'react-hot-toast';
import {
  RefreshCw,
  Trash2,
  Eye,
  Download,
  CheckCircle,
  Wifi,
  WifiOff,
  Settings,
  Info,
  X,
  ArrowRight
} from 'lucide-react';

const SyncCenter: React.FC = () => {
  const {
    isOnline,
    isSyncing,
    pendingCount,
    lastSyncAt,
    offlineSince,
    autoSyncEnabled,
    setAutoSyncEnabled,
    triggerSync,
    updateStats
  } = useOffline();

  const [operations, setOperations] = useState<QueuedOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'failed' | 'conflict' | 'synced' | 'discarded'>('pending');
  const { user, isAdmin } = useAuth();
  const [discardOp, setDiscardOp] = useState<QueuedOperation | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  
  // Modal viewer state
  const [selectedOp, setSelectedOp] = useState<QueuedOperation | null>(null);
  const [serverRecord, setServerRecord] = useState<any>(null);
  const [loadingServerRecord, setLoadingServerRecord] = useState(false);

  const fetchOperations = async () => {
    try {
      setLoading(true);
      const allOps = await db.queued_operations.toArray();
      setOperations(allOps);
    } catch (err) {
      console.error('Failed to load operations from IndexedDB:', err);
      toast.error('Could not load sync queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOperations();
    window.addEventListener('offline-queue-changed', fetchOperations);
    return () => {
      window.removeEventListener('offline-queue-changed', fetchOperations);
    };
  }, []);

  // Filtered lists
  const pendingOps = operations.filter(op => op.status === 'pending_sync' || op.status === 'syncing');
  const failedOps = operations.filter(op => op.status === 'failed');
  const conflictOps = operations.filter(op => op.status === 'conflict');
  const syncedOps = operations.filter(op => op.status === 'synced');
  const discardedOps = operations.filter(op => op.status === 'discarded');

  const getActiveList = () => {
    switch (activeTab) {
      case 'pending': return pendingOps;
      case 'failed': return failedOps;
      case 'conflict': return conflictOps;
      case 'synced': return syncedOps;
      case 'discarded': return discardedOps;
    }
  };

  const handleRetry = async (op: QueuedOperation) => {
    if (!isOnline) {
      toast.error('Cannot retry while offline.');
      return;
    }
    try {
      await db.queued_operations.update(op.offline_uuid, {
        status: 'pending_sync',
        error_message: undefined
      });
      toast.success('Queued operation for sync');
      fetchOperations();
      updateStats();
      triggerSync();
    } catch (err) {
      console.error(err);
      toast.error('Failed to queue operation');
    }
  };

  const handleRetryAllFailed = async () => {
    if (!isOnline) {
      toast.error('Cannot retry while offline.');
      return;
    }
    try {
      const targetIds = [...failedOps, ...conflictOps].map(op => op.offline_uuid);
      if (targetIds.length === 0) return;

      await db.queued_operations
        .where('offline_uuid')
        .anyOf(targetIds)
        .modify({
          status: 'pending_sync',
          error_message: undefined
        });

      toast.success('Queued all failed/conflict operations');
      fetchOperations();
      updateStats();
      triggerSync();
    } catch (err) {
      console.error(err);
      toast.error('Failed to retry operations');
    }
  };

  // Nothing is ever erased here: a discarded item stays listed with who, when and why
  const confirmDiscard = async () => {
    if (!discardOp || !discardReason.trim()) return;
    const done = await supabaseDB.discardQueuedOperation(discardOp.offline_uuid, user?.username || 'admin', discardReason.trim().toUpperCase());
    if (done) {
      toast.success('Discarded. It stays listed under Discarded.');
    } else {
      toast.error('This item can no longer be discarded. Please refresh.');
    }
    setDiscardOp(null);
    setDiscardReason('');
    setSelectedOp(null);
    fetchOperations();
    updateStats();
  };

  const describeOp = (op: QueuedOperation) => {
    const p: any = Array.isArray(op.payload) ? op.payload[0] : op.payload;
    if (op.table === 'cash_book') {
      const amount = Number(p?.credit) > 0 ? `Credit ${p.credit}` : `Debit ${p?.debit ?? 0}`;
      return `Entry: ${p?.company_name || '-'} / ${p?.acc_name || '-'}, ${amount}, ${p?.c_date || ''}`;
    }
    if (op.table === 'companies') return `New company: ${p?.company_name}`;
    if (op.table === 'company_main_accounts') return `New account: ${p?.acc_name} (${p?.company_name})`;
    if (op.table === 'company_main_sub_acc') return `New sub account: ${p?.sub_acc} (${p?.acc_name})`;
    return op.table;
  };

  const handleViewPayload = async (op: QueuedOperation) => {
    setSelectedOp(op);
    setServerRecord(null);

    // If it's a conflict and online, let's fetch the server counterpart
    if (op.status === 'conflict' && isOnline) {
      setLoadingServerRecord(true);
      try {
        const recordId = op.payload?.id || op.payload?.[0]?.id || '';
        if (recordId) {
          const { data, error } = await supabase
            .from(op.table)
            .select('*')
            .eq('id', recordId)
            .maybeSingle();

          if (!error && data) {
            setServerRecord(data);
          } else {
            console.log('Server counterpart not found or deleted:', error);
          }
        }
      } catch (err) {
        console.error('Error fetching server record for conflict resolution:', err);
      } finally {
        setLoadingServerRecord(false);
      }
    }
  };

  const resolveConflictKeepLocal = async (op: QueuedOperation) => {
    if (!isOnline) {
      toast.error('Must be online to resolve conflicts');
      return;
    }
    try {
      // Re-queue it with pending_sync status to overwrite the server version
      await db.queued_operations.update(op.offline_uuid, {
        status: 'pending_sync',
        error_message: undefined
      });
      toast.success('Trying again.');
      setSelectedOp(null);
      fetchOperations();
      updateStats();
      triggerSync();
    } catch (err) {
      console.error(err);
      toast.error('Error resolving conflict');
    }
  };

  const exportQueue = () => {
    try {
      const dataStr = JSON.stringify(operations, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `offline_queue_backup_${format(new Date(), 'yyyyMMdd_HHmmss')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Queue backup exported successfully');
    } catch (err) {
      console.error(err);
      toast.error('Failed to export backup');
    }
  };

  return (
    <div className="min-h-screen flex flex-col space-y-6 font-outfit p-1">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            Offline Synchronization Center
          </h1>
          <p className="text-gray-600 mt-1">
            Manage local data queue, resolve conflicts, and monitor sync history.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={exportQueue}
            variant="secondary"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Queue Backup
          </Button>

          <Button
            onClick={triggerSync}
            disabled={!isOnline || isSyncing || pendingCount === 0}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing Queue...' : 'Sync Now'}
          </Button>
        </div>
      </div>

      {/* Connection & Stats Blocks */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-slate-50 to-zinc-50 border-slate-200 flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Connection Status</div>
            <div className="flex items-center gap-2 mt-2">
              {isOnline ? (
                <>
                  <Wifi className="w-5 h-5 text-green-600" />
                  <span className="text-base font-bold text-green-800">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-5 h-5 text-red-600 animate-pulse" />
                  <span className="text-base font-bold text-red-800">Offline</span>
                </>
              )}
            </div>
          </div>
          <div className="text-[10px] text-slate-500 mt-4 font-semibold">
            {isOnline && lastSyncAt ? (
              `Last Sync: ${format(parseISO(lastSyncAt), 'dd-MM-yyyy hh:mm a')}`
            ) : offlineSince ? (
              `Offline Since: ${format(parseISO(offlineSince), 'dd-MM-yyyy hh:mm a')}`
            ) : (
              'No sync history recorded'
            )}
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <div className="text-[10px] uppercase font-bold tracking-wider text-blue-700">Pending Sync</div>
          <div className="text-3xl font-extrabold text-blue-900 mt-2">{pendingOps.length}</div>
          <p className="text-xs text-blue-600 mt-1">Changes awaiting connection.</p>
        </Card>

        <Card className="bg-gradient-to-br from-rose-50 to-red-50 border-red-200">
          <div className="text-[10px] uppercase font-bold tracking-wider text-red-700">Failed Records</div>
          <div className="text-3xl font-extrabold text-red-900 mt-2">{failedOps.length}</div>
          <p className="text-xs text-red-600 mt-1">Could not be sent, will try again.</p>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
          <div className="text-[10px] uppercase font-bold tracking-wider text-amber-700">Sync Conflicts</div>
          <div className="text-3xl font-extrabold text-amber-900 mt-2">{conflictOps.length}</div>
          <p className="text-xs text-amber-600 mt-1">Held for an admin to decide.</p>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <div className="text-[10px] uppercase font-bold tracking-wider text-green-700">Recently Synced</div>
          <div className="text-3xl font-extrabold text-green-950 mt-2">{syncedOps.length}</div>
          <p className="text-xs text-green-700 mt-1 font-medium">Synced logs (kept for 7 days).</p>
        </Card>
      </div>

      {/* Auto-Sync Widget & Control bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-slate-500" />
          <div>
            <div className="text-sm font-bold text-slate-800">Automatic Sync</div>
            <p className="text-xs text-slate-500">Sends waiting entries to the server by themselves when the internet is back.</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={autoSyncEnabled}
              onChange={(e) => setAutoSyncEnabled(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            <span className="ml-2 text-xs font-bold text-slate-700">{autoSyncEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>

          {(failedOps.length > 0 || conflictOps.length > 0) && (
            <button
              onClick={handleRetryAllFailed}
              disabled={!isOnline || isSyncing}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry All Failed / Conflicts
            </button>
          )}
        </div>
      </div>

      {/* Main Panel - Tabs & Tables */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        {/* Tab Headers */}
        <div className="border-b border-slate-200 bg-slate-50 flex">
          {[
            { id: 'pending', label: 'Pending Sync', count: pendingOps.length, bg: 'bg-blue-600' },
            { id: 'failed', label: 'Failed', count: failedOps.length, bg: 'bg-red-600' },
            { id: 'conflict', label: 'Conflicts', count: conflictOps.length, bg: 'bg-amber-600' },
            { id: 'synced', label: 'Recently Synced', count: syncedOps.length, bg: 'bg-green-600' },
            { id: 'discarded', label: 'Discarded', count: discardedOps.length, bg: 'bg-slate-600' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-5 py-3.5 text-xs font-bold transition-all border-b-2 flex items-center gap-2 select-none ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/50'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] text-white font-extrabold px-1.5 py-0.5 rounded-full ${tab.bg}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Content Panel */}
        <div className="p-4 overflow-x-auto min-h-[300px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <RefreshCw className="w-8 h-8 animate-spin text-slate-400" />
              <p className="mt-2 text-sm">Querying IndexedDB queue...</p>
            </div>
          ) : getActiveList().length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <CheckCircle className="w-12 h-12 text-slate-300" />
              <p className="mt-2 text-sm font-semibold">No records in this tab</p>
              <p className="text-xs text-slate-400">Everything is running smoothly.</p>
            </div>
          ) : (
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-3">Operation</th>
                  <th className="py-2.5 px-3">Details</th>
                  <th className="py-2.5 px-3">Context Scope</th>
                  <th className="py-2.5 px-3">Created</th>
                  {activeTab === 'synced' && <th className="py-2.5 px-3">Synced At</th>}
                  {(activeTab === 'failed' || activeTab === 'conflict') && <th className="py-2.5 px-3">What Happened</th>}
                  {activeTab === 'discarded' && <th className="py-2.5 px-3">Discarded By / Reason</th>}
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {getActiveList().map(op => (
                  <tr key={op.offline_uuid} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        op.operation_type === 'INSERT'
                          ? 'bg-green-100 text-green-800'
                          : op.operation_type === 'UPDATE'
                          ? 'bg-blue-100 text-blue-800'
                          : op.operation_type === 'DELETE'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {op.operation_type}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800">{describeOp(op)}</td>
                    <td className="py-3 px-3 text-slate-600">
                      <div>{op.book_name || `Book: ${op.book_id.substring(0, 8)}...`}</div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-0.5">{op.mode} mode</div>
                    </td>
                    <td className="py-3 px-3 text-slate-500">
                      {format(parseISO(op.created_at), 'dd-MM-yyyy hh:mm a')}
                    </td>
                    {activeTab === 'synced' && (
                      <td className="py-3 px-3 text-slate-500">
                        {op.synced_at ? format(parseISO(op.synced_at), 'dd-MM-yyyy hh:mm a') : '-'}
                      </td>
                    )}
                    {(activeTab === 'failed' || activeTab === 'conflict') && (
                      <td className="py-3 px-3 max-w-[320px]">
                        <span className="text-red-700 font-semibold break-words bg-red-50 p-1 rounded block text-xs">
                          {op.error_message || 'Could not be sent'}
                        </span>
                      </td>
                    )}
                    {activeTab === 'discarded' && (
                      <td className="py-3 px-3 text-slate-600">
                        <div className="font-semibold">{op.discarded_by || '-'}{op.discarded_at ? `, ${format(parseISO(op.discarded_at), 'dd-MM-yyyy hh:mm a')}` : ''}</div>
                        <div>{op.discarded_reason || ''}</div>
                      </td>
                    )}
                    <td className="py-3 px-3 text-right whitespace-nowrap space-x-1">
                      <button
                        onClick={() => handleViewPayload(op)}
                        className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-800 rounded transition-colors inline-flex items-center gap-1 font-bold text-[10px]"
                        title="View Payload"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                      
                      {(op.status === 'failed' || op.status === 'conflict') && (
                        <button
                          onClick={() => handleRetry(op)}
                          disabled={!isOnline}
                          className="p-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 rounded transition-colors inline-flex items-center gap-1 font-bold text-[10px]"
                          title="Retry Operation"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Retry
                        </button>
                      )}

                      {isAdmin && ['pending_sync', 'failed', 'conflict'].includes(op.status) && (
                        <button
                          onClick={() => { setDiscardReason(''); setDiscardOp(op); }}
                          className="p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded transition-colors inline-flex items-center gap-1 font-bold text-[10px]"
                          title="Discard"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Discard
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* JSON Viewer Modal / side-by-side comparison */}
      {selectedOp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  Operation details & Payload
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                    {selectedOp.offline_uuid}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Table: <span className="font-bold text-slate-700">{selectedOp.table}</span> | Action: <span className="font-bold text-slate-700">{selectedOp.operation_type}</span>
                </p>
              </div>
              <button
                onClick={() => setSelectedOp(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50">
              {/* Left Column: Local Payload */}
              <div className="flex flex-col space-y-2 h-full">
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Local Queue (Your Pending Changes)</span>
                  <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold animate-pulse">
                    Pending
                  </span>
                </div>
                <div className="flex-1 bg-slate-900 rounded-lg overflow-hidden border border-slate-950 flex flex-col min-h-[300px]">
                  <pre className="p-4 text-xs font-mono text-slate-100 overflow-auto flex-1 select-text">
                    {JSON.stringify(selectedOp.payload, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Right Column: Server Counterpart */}
              <div className="flex flex-col space-y-2 h-full">
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Server Database (Live Supabase State)</span>
                  {selectedOp.status === 'conflict' ? (
                    <span className="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200 font-bold">
                      Conflict State
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-bold">
                      Reference
                    </span>
                  )}
                </div>
                
                <div className="flex-1 bg-slate-900 rounded-lg overflow-hidden border border-slate-950 flex flex-col min-h-[300px] justify-center">
                  {loadingServerRecord ? (
                    <div className="flex flex-col items-center justify-center text-slate-400 py-12">
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      <span className="mt-2 text-xs">Querying database...</span>
                    </div>
                  ) : serverRecord ? (
                    <pre className="p-4 text-xs font-mono text-slate-100 overflow-auto flex-1 select-text">
                      {JSON.stringify(serverRecord, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-500 p-8 text-center">
                      <Info className="w-8 h-8 text-slate-600 mb-2" />
                      <span className="text-xs font-bold">No corresponding record found on server</span>
                      <p className="text-[10px] text-slate-500 mt-1 max-w-[250px]">
                        The record may have been deleted on the server, or the operation represents a new insertion not yet pushed.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-200 flex justify-between bg-white">
              <div>
                {selectedOp.status === 'conflict' && (
                  <div className="text-[10px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 max-w-md">
                    ⚠️ {selectedOp.error_message || 'This needs attention.'} {isAdmin ? 'Fix the cause, then Try Again, or Discard it.' : 'An admin needs to decide.'}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => setSelectedOp(null)}
                  className="border border-slate-200 hover:bg-slate-50 text-slate-700 bg-white"
                >
                  Close Window
                </Button>

                {selectedOp.status === 'conflict' && (
                  <>
                    {isAdmin && (
                      <Button
                        onClick={() => { setDiscardReason(''); setDiscardOp(selectedOp); }}
                        className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200"
                      >
                        Discard
                      </Button>
                    )}
                    <Button
                      onClick={() => resolveConflictKeepLocal(selectedOp)}
                      className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5"
                    >
                      Try Again
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {discardOp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" role="alertdialog" aria-label="Discard">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900">Discard this?</h2>
            <p className="text-sm text-gray-700 mt-2">{describeOp(discardOp)}</p>
            <p className="text-sm text-gray-700 mt-2">It will not go to the server. It stays listed under Discarded with your name and reason.</p>
            <label className="block text-sm font-bold text-gray-700 mt-4 mb-1">Reason <span className="text-red-500">*</span></label>
            <textarea
              autoFocus
              rows={2}
              value={discardReason}
              onChange={e => setDiscardReason(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={() => setDiscardOp(null)}>Cancel</Button>
              <Button variant="danger" disabled={!discardReason.trim()} onClick={confirmDiscard}>Discard</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncCenter;
