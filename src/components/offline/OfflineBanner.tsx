import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { useOffline } from '../../contexts/OfflineContext';

/** Tells the person using the app what is happening with their offline entries. */
const OfflineBanner: React.FC = () => {
  const { isOnline, connectionStatus, pendingCount, attentionCount } = useOffline();
  const offline = !isOnline && connectionStatus === 'OFFLINE';
  if (!offline && pendingCount === 0 && attentionCount === 0) return null;

  return (
    <div className='no-print'>
      {offline && (
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm font-semibold'>
          <WifiOff className='w-4 h-4 shrink-0' />
          <span>
            Working offline. New entries are saved on this computer only, and go to the server by themselves when the
            internet is back. Please connect at least once a day.
          </span>
          {pendingCount > 0 && (
            <Link to='/sync-center' className='underline font-bold'>
              {pendingCount} not synced
            </Link>
          )}
        </div>
      )}
      {!offline && pendingCount > 0 && (
        <div className='px-6 py-2 bg-blue-50 border-b border-blue-200 text-blue-900 text-sm font-semibold'>
          <Link to='/sync-center' className='underline font-bold'>
            {pendingCount} {pendingCount === 1 ? 'entry' : 'entries'} waiting to sync
          </Link>
        </div>
      )}
      {attentionCount > 0 && (
        <div className='flex items-center gap-2 px-6 py-2 bg-red-50 border-b border-red-200 text-red-900 text-sm font-semibold'>
          <AlertTriangle className='w-4 h-4 shrink-0' />
          <Link to='/sync-center' className='underline font-bold'>
            {attentionCount} {attentionCount === 1 ? 'entry needs' : 'entries need'} attention in Sync Center
          </Link>
          <span>They have not reached the server yet, and they are safe on this computer.</span>
        </div>
      )}
    </div>
  );
};

export default OfflineBanner;
