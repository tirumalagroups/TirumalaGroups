import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, KeyRound, LogOut, RefreshCw, ShieldCheck, Unlock } from 'lucide-react';
import { rawSupabase } from '../../lib/supabase';
import { apiPost } from '../../lib/apiClient';
import { MIN_PASSWORD, useAuth } from '../../contexts/AuthContext';
import Button from '../UI/Button';

// Admin screen: who is logged in now (with Log Out), alerts, "Forgot password" requests, and the
// login history of every user. All of it is read from the database tables of login security.

export type LoginSecurityTab = 'sessions' | 'alerts' | 'requests' | 'history';
type Tab = LoginSecurityTab;

const db = () => rawSupabase.schema('public');

const fmt = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())} ${ap}`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const END_LABEL: Record<string, string> = {
  logout: 'Logged out',
  replaced: 'Logged in on another device',
  admin: 'Logged out by admin',
  expired: 'Ended at 12:00 AM',
  idle: '30 minutes without use',
  disabled: 'Account disabled',
  password_reset: 'Password reset by admin',
};

interface Props {
  /** Called after something that changes the user list (unlock, reset) */
  onUsersChanged?: () => void;
  /** The tab to open first, for example "requests" from the Dashboard */
  initialTab?: Tab;
}

const LoginSecurityPanel: React.FC<Props> = ({ onUsersChanged, initialTab }) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab && initialTab !== 'history' ? initialTab : 'sessions');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [idleMinutes, setIdleMinutes] = useState(30);
  const [locked, setLocked] = useState<any[]>([]);
  const [failed, setFailed] = useState<{ username: string; count: number; last: string }[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [historyUser, setHistoryUser] = useState('');
  const [userNames, setUserNames] = useState<string[]>([]);
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [resetFor, setResetFor] = useState<{ requestId?: string; userId: string; username: string } | null>(null);
  const [resetText, setResetText] = useState('');

  const loadSessions = useCallback(async () => {
    const { data, error } = await db().from('app_sessions').select('*').is('ended_at', null).order('started_at', { ascending: false });
    if (error) throw error;
    const me = await rawSupabase.rpc('app_me');
    if (me.data?.idle_minutes) setIdleMinutes(me.data.idle_minutes);
    setSessions(data || []);
  }, []);

  const loadAlerts = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const [lockRes, failRes, reqRes] = await Promise.all([
      db().from('users').select('id, username, status, locked_until').or(`status.eq.Locked,locked_until.gt.${nowIso}`),
      db().from('login_history').select('username, login_time').eq('success', false)
        .gte('login_time', new Date(Date.now() - 86400000).toISOString()).order('login_time', { ascending: false }).limit(1000),
      db().from('password_reset_requests').select('*').eq('status', 'pending').order('requested_at', { ascending: false }),
    ]);
    if (lockRes.error) throw lockRes.error;
    setLocked(lockRes.data || []);
    const byUser = new Map<string, { username: string; count: number; last: string }>();
    (failRes.data || []).forEach((r: any) => {
      const key = String(r.username || '').toUpperCase();
      const cur = byUser.get(key) || { username: r.username, count: 0, last: r.login_time };
      cur.count += 1;
      byUser.set(key, cur);
    });
    setFailed([...byUser.values()].filter(f => f.count >= 3).sort((a, b) => b.count - a.count));
    setRequests(reqRes.data || []);
  }, []);

  const loadHistory = useCallback(async () => {
    let q = db().from('login_history').select('*')
      .gte('login_time', new Date(`${from}T00:00:00`).toISOString())
      .lte('login_time', new Date(`${to}T23:59:59.999`).toISOString())
      .order('login_time', { ascending: false })
      .limit(2000);
    if (historyUser) q = q.ilike('username', historyUser);
    const { data, error } = await q;
    if (error) throw error;
    setHistory(data || []);
  }, [from, to, historyUser]);

  // Usernames for the Login History "Username" list
  useEffect(() => {
    db().from('users').select('username').order('username').then(({ data }) => {
      const names = (data || []).map((u: any) => String(u.username || '')).filter(Boolean);
      setUserNames([...new Set(names)]);
    });
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.all([loadSessions(), loadAlerts(), tab === 'history' ? loadHistory() : Promise.resolve()]);
    } catch (e: any) {
      toast.error(e?.message || 'Could not load login security');
    } finally {
      setBusy(false);
    }
  }, [loadSessions, loadAlerts, loadHistory, tab]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      loadSessions().catch(() => {});
      loadAlerts().catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh, loadSessions, loadAlerts]);

  // A session that ran out (midnight or no use) is not shown as active
  const liveSessions = useMemo(() => {
    const now = Date.now();
    return sessions.filter(s => new Date(s.expires_at).getTime() > now
      && new Date(s.last_seen_at).getTime() > now - idleMinutes * 60000);
  }, [sessions, idleMinutes]);

  const alertCount = locked.length + failed.length + requests.length;

  const endOne = async (s: any) => {
    if (!window.confirm(`Log out ${s.username} on ${s.os || ''} ${s.browser || ''} now?`)) return;
    const { error } = await rawSupabase.rpc('admin_end_session', { p_session_id: s.id });
    if (error) toast.error(error.message);
    else toast.success(`${s.username} logged out`);
    await refresh();
  };

  const endAll = async (userId: string, username: string) => {
    if (!window.confirm(`Log out every login of ${username} now?`)) return;
    const { data, error } = await rawSupabase.rpc('admin_end_user_sessions', { p_user_id: userId });
    if (error) toast.error(error.message);
    else toast.success(`${username}: ${data || 0} login(s) ended`);
    await refresh();
  };

  const unlock = async (u: any) => {
    const { error } = await rawSupabase.rpc('admin_unlock_user', { p_user_id: u.id });
    if (error) toast.error(error.message);
    else toast.success(`${u.username} unlocked`);
    await refresh();
    onUsersChanged?.();
  };

  const dismiss = async (r: any) => {
    const { error } = await rawSupabase.rpc('admin_close_reset_request', { p_request_id: r.id, p_status: 'dismissed' });
    if (error) toast.error(error.message);
    await refresh();
  };

  const submitReset = async () => {
    if (!resetFor) return;
    if (resetText.length < MIN_PASSWORD) {
      toast.error(`The temporary password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/admin/users', {
        action: 'reset_password', user_id: resetFor.userId, password: resetText,
        reason: resetFor.requestId ? 'Forgot password request' : 'Password reset by admin',
      });
      toast.success(`Temporary password set for ${resetFor.username}. Tell it to them; they must change it when they log in.`, { duration: 10000 });
      setResetFor(null);
      setResetText('');
      await refresh();
      onUsersChanged?.();
    } catch (e: any) {
      toast.error(e?.message || 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  };

  const tabs: [Tab, string][] = [
    ['sessions', `Active Sessions (${liveSessions.length})`],
    ['alerts', `Alerts (${alertCount})`],
    ['requests', `Forgot Password (${requests.length})`],
    ['history', 'Login History'],
  ];

  return (
    <div className='bg-white rounded-xl border border-gray-200 shadow-sm mb-8'>
      <div className='flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-200'>
        <div className='flex items-center gap-2'>
          <ShieldCheck className='w-6 h-6 text-blue-600' />
          <h2 className='text-xl font-bold text-gray-900'>Login Security</h2>
          {alertCount > 0 && (
            <span className='inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700'>
              <AlertTriangle className='w-3.5 h-3.5' /> {alertCount} alert{alertCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <Button variant='secondary' size='sm' onClick={refresh} disabled={busy}>
          <span className='inline-flex items-center gap-1'><RefreshCw className='w-4 h-4' /> Refresh</span>
        </Button>
      </div>

      <div className='flex flex-wrap gap-2 px-5 pt-4 print:hidden'>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type='button'
            onClick={() => { setTab(key); if (key === 'history') loadHistory().catch(e => toast.error(e.message)); }}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold border ${tab === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className='p-5'>
        {tab === 'sessions' && (
          liveSessions.length === 0 ? (
            <p className='text-center text-gray-500 py-4 text-sm'>Nobody is logged in right now.</p>
          ) : (
            <table className='fit-table fit-lg border border-gray-200'>
              <thead className='bg-gray-50'>
                <tr>
                  <th className='text-left'>User</th>
                  <th className='text-left'>Device</th>
                  <th className='text-left'>IP Address</th>
                  <th className='text-left'>Logged In</th>
                  <th className='text-left'>Last Activity</th>
                  <th className='text-left'>Ends</th>
                  <th className='text-left'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {liveSessions.map(s => {
                  const mine = s.user_id === user?.id;
                  return (
                    <tr key={s.id} className='border-t border-gray-100'>
                      <td className='font-semibold'>{s.username}{mine ? ' (you)' : ''}</td>
                      <td>{s.device || '-'} / {s.os || '-'} / {s.browser || '-'}</td>
                      <td className='fit-nowrap font-mono'>{s.ip_address || '-'}</td>
                      <td className='fit-nowrap'>{fmt(s.started_at)}</td>
                      <td className='fit-nowrap'>{fmt(s.last_seen_at)}</td>
                      <td className='fit-nowrap'>{fmt(s.expires_at)}</td>
                      <td>
                        <div className='flex flex-wrap gap-1'>
                          <Button variant='secondary' size='sm' disabled={mine || busy} onClick={() => endOne(s)}>
                            <span className='inline-flex items-center gap-1'><LogOut className='w-4 h-4' /> Log Out</span>
                          </Button>
                          <Button variant='secondary' size='sm' disabled={mine || busy} onClick={() => endAll(s.user_id, s.username)}>
                            Log Out All
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === 'alerts' && (
          <div className='space-y-5'>
            {alertCount === 0 && <p className='text-center text-gray-500 py-4 text-sm'>No alerts.</p>}
            {locked.length > 0 && (
              <div>
                <h3 className='font-bold text-gray-900 mb-2'>Locked accounts</h3>
                <table className='fit-table fit-lg border border-gray-200'>
                  <thead className='bg-gray-50'><tr><th className='text-left'>User</th><th className='text-left'>Why</th><th className='text-left'>Action</th></tr></thead>
                  <tbody>
                    {locked.map(u => (
                      <tr key={u.id} className='border-t border-gray-100'>
                        <td className='font-semibold'>{u.username}</td>
                        <td>{u.status === 'Locked' ? 'Locked by an admin' : `Too many wrong passwords, until ${fmt(u.locked_until)}`}</td>
                        <td>
                          <Button variant='secondary' size='sm' disabled={busy} onClick={() => unlock(u)}>
                            <span className='inline-flex items-center gap-1'><Unlock className='w-4 h-4' /> Unlock</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {failed.length > 0 && (
              <div>
                <h3 className='font-bold text-gray-900 mb-2'>Wrong passwords in the last 24 hours (3 or more)</h3>
                <table className='fit-table fit-lg border border-gray-200'>
                  <thead className='bg-gray-50'><tr><th className='text-left'>Username tried</th><th className='text-left'>Failed tries</th><th className='text-left'>Last try</th></tr></thead>
                  <tbody>
                    {failed.map(f => (
                      <tr key={f.username} className='border-t border-gray-100'>
                        <td className='font-semibold'>{f.username || '-'}</td>
                        <td>{f.count}</td>
                        <td className='fit-nowrap'>{fmt(f.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {requests.length > 0 && (
              <p className='text-sm font-semibold text-amber-800'>
                {requests.length} forgot-password request{requests.length === 1 ? '' : 's'} waiting: see the Forgot Password tab.
              </p>
            )}
          </div>
        )}

        {tab === 'requests' && (
          requests.length === 0 ? (
            <p className='text-center text-gray-500 py-4 text-sm'>No forgot-password requests.</p>
          ) : (
            <table className='fit-table fit-lg border border-gray-200'>
              <thead className='bg-gray-50'><tr><th className='text-left'>Username entered</th><th className='text-left'>Asked At</th><th className='text-left'>Actions</th></tr></thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id} className='border-t border-gray-100'>
                    <td className='font-semibold'>{r.username}{r.user_id ? '' : ' (no such user)'}</td>
                    <td className='fit-nowrap'>{fmt(r.requested_at)}</td>
                    <td>
                      <div className='flex flex-wrap gap-1'>
                        {r.user_id && (
                          <Button size='sm' disabled={busy} onClick={() => { setResetText(''); setResetFor({ requestId: r.id, userId: r.user_id, username: r.username }); }}>
                            <span className='inline-flex items-center gap-1'><KeyRound className='w-4 h-4' /> Set Temporary Password</span>
                          </Button>
                        )}
                        <Button variant='secondary' size='sm' disabled={busy} onClick={() => dismiss(r)}>Dismiss</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === 'history' && (
          <div className='space-y-3'>
            <div className='flex flex-wrap items-end gap-3 print:hidden'>
              <label className='text-sm font-medium text-gray-700'>From
                <input type='date' value={from} onChange={e => setFrom(e.target.value)} className='block mt-1 px-2 py-1.5 border border-gray-300 rounded-md' />
              </label>
              <label className='text-sm font-medium text-gray-700'>To
                <input type='date' value={to} onChange={e => setTo(e.target.value)} className='block mt-1 px-2 py-1.5 border border-gray-300 rounded-md' />
              </label>
              <label className='text-sm font-medium text-gray-700'>Username
                <select value={historyUser} onChange={e => setHistoryUser(e.target.value)} className='block mt-1 px-2 py-1.5 border border-gray-300 rounded-md bg-white min-w-[10rem]'>
                  <option value=''>All users</option>
                  {userNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <Button size='sm' disabled={busy} onClick={() => loadHistory().catch(e => toast.error(e.message))}>Show</Button>
            </div>
            {history.length === 0 ? (
              <p className='text-center text-gray-500 py-4 text-sm'>No logins in this period.</p>
            ) : (
              <table className='fit-table fit-lg border border-gray-200'>
                <thead className='bg-gray-50'>
                  <tr>
                    <th className='text-left'>Login</th>
                    <th className='text-left'>User</th>
                    <th className='text-left'>Result</th>
                    <th className='text-left'>IP Address</th>
                    <th className='text-left'>Location</th>
                    <th className='text-left'>Device</th>
                    <th className='text-left'>Logout</th>
                    <th className='text-left'>How It Ended</th>
                    <th className='text-left'>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className='border-t border-gray-100'>
                      <td className='fit-nowrap'>{fmt(h.login_time)}</td>
                      <td className='font-semibold'>{h.username || '-'}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${h.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {h.success ? 'Success' : 'Failed'}
                        </span>
                        {!h.success && h.failure_reason ? <span className='block text-xs text-red-700'>{h.failure_reason}</span> : null}
                      </td>
                      <td className='fit-nowrap font-mono'>{h.ip_address || '-'}</td>
                      <td>{h.location || '-'}</td>
                      <td>{h.device || '-'} / {h.os || '-'} / {h.browser || '-'}</td>
                      <td className='fit-nowrap'>{h.success ? fmt(h.logout_time) : '-'}</td>
                      <td>{h.end_reason ? END_LABEL[h.end_reason] || h.end_reason : h.success && !h.logout_time ? 'Still logged in, or old record' : '-'}</td>
                      <td className='fit-nowrap'>{h.session_duration || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {resetFor && (
        <div className='fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4' role='dialog'>
          <div className='bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4'>
            <h3 className='text-lg font-bold text-gray-900'>Temporary password for {resetFor.username}</h3>
            <p className='text-sm text-gray-700'>
              At least {MIN_PASSWORD} characters. Tell it to {resetFor.username}; they must choose their own at the next login.
              Any login of theirs ends now. The password is not stored anywhere readable.
            </p>
            <input
              data-password='true'
              type='text'
              value={resetText}
              onChange={e => setResetText(e.target.value)}
              autoFocus
              className='w-full px-3 py-2 border border-gray-300 rounded-md font-mono'
            />
            <div className='flex justify-end gap-2'>
              <Button variant='secondary' onClick={() => setResetFor(null)}>Cancel</Button>
              <Button onClick={submitReset} disabled={busy}>Set Password</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginSecurityPanel;
