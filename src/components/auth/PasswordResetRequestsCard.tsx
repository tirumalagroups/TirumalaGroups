import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { rawSupabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// Admin Dashboard card: "Forgot password" requests waiting for an admin. Checked every 30 seconds,
// so a new request shows without reloading the page. Shows nothing when there are none.

interface ResetRequest {
  id: string;
  username: string;
  requested_at: string;
}

const CHECK_EVERY_MS = 30000;

interface Props {
  /** User Management page of this mode (Finance has its own address) */
  managePath?: string;
}

const PasswordResetRequestsCard: React.FC<Props> = ({ managePath = '/user-management' }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const isAdmin = !!user?.is_admin;

  const load = useCallback(async () => {
    if (!isAdmin || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    const { data, error } = await rawSupabase
      .schema('public')
      .from('password_reset_requests')
      .select('id, username, requested_at')
      .eq('status', 'pending')
      .order('requested_at', { ascending: false });
    if (!error) setRequests((data as ResetRequest[]) || []);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    load().catch(() => {});
    const timer = window.setInterval(() => load().catch(() => {}), CHECK_EVERY_MS);
    const onFocus = () => load().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAdmin, load]);

  if (!isAdmin || requests.length === 0) return null;

  return (
    <div className='bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center gap-3 no-print'>
      <KeyRound className='h-5 w-5 text-amber-600 flex-shrink-0' />
      <div className='flex-1 min-w-0'>
        <h3 className='text-sm font-bold text-amber-900'>
          Password reset {requests.length === 1 ? 'request' : 'requests'} ({requests.length})
        </h3>
        <p className='text-xs text-amber-800 break-words'>
          {requests.slice(0, 5).map(r => `${r.username} (${new Date(r.requested_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })})`).join(', ')}
          {requests.length > 5 ? ` and ${requests.length - 5} more` : ''}
        </p>
      </div>
      <button
        type='button'
        onClick={() => navigate(`${managePath}?tab=security&show=requests`)}
        className='px-3 py-1.5 rounded-md text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 shadow-sm self-start sm:self-auto'
      >
        Open requests
      </button>
    </div>
  );
};

export default PasswordResetRequestsCard;
