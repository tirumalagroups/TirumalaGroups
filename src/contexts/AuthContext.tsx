import { backendReachable, clearOfflineSession, readOfflineSession, saveOfflineSession } from '../lib/offlineSession';
import { isNetworkFailure } from '../lib/offlineSyncEngine';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase, rawSupabase } from '../lib/supabase';
import { apiPost } from '../lib/apiClient';
import {
  LOGOUT_REASON_KEY, SESSION_ENDED_EVENT, parseSessionEnded, resetSessionEndedReport,
} from '../lib/sessionGuard';
import { queryClient } from '../lib/queryClient';
import { supabaseDB } from '../lib/supabaseDatabase';
import { initAudioContext } from '../utils/reminderSound';

type ModeKey = 'regular' | 'itr' | 'finance';

/** What the database says about the login (public.app_me) */
interface SessionMe {
  id: string;
  username: string;
  is_admin: boolean;
  mode?: string | null;
  must_change_password?: boolean;
  expires_at?: string;
  started_at?: string;
  idle_minutes?: number;
}

export const MIN_PASSWORD = 8;
/** Warn this long before the login ends (midnight or no use) */
const WARN_MS = 5 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'thirumala_last_activity';

/** Last use of the app in any tab of this browser */
const markActivity = (at: number = Date.now()) => {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    /* storage blocked: this tab only */
  }
};
const lastActivity = (): number => {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now();
  } catch {
    return Date.now();
  }
};

/** The next 12:00 AM, India time */
export const nextMidnightIndia = (from: number = Date.now()): number => {
  const IST = 5.5 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  return Math.floor((from + IST) / day) * day + day - IST;
};
const MODE_VALUES: ModeKey[] = ['regular', 'itr', 'finance'];
const getStoredMode = (): ModeKey => {
  const mode = sessionStorage.getItem('table_mode') || localStorage.getItem('table_mode');
  return (mode === 'itr' ? 'itr' : mode === 'finance' ? 'finance' : 'regular') as ModeKey;
};
const createEmptyModeFeatureMap = () =>
  MODE_VALUES.reduce(
    (acc, mode) => {
      acc[mode] = [];
      return acc;
    },
    {} as Record<ModeKey, string[]>
  );
const isModeColumnError = (error?: { message?: string; code?: string }) => {
  if (!error) return false;
  const msg = error.message?.toLowerCase() ?? '';
  return (
    msg.includes('column "mode"') ||
    msg.includes('mode') ||
    msg.includes('does not exist') ||
    error.code === '42703'
  );
};
const ADMIN_FEATURES = [
  'dashboard',
  'new_entry',
  'edit_entry',
  'daily_report',
  'detailed_ledger',
  'ledger_summary',
  'approve_records',
  'edited_records',
  'deleted_records',
  'replace_form',
  'balance_sheet',
  'export',
  'csv_upload',
  'vehicles',
  'drivers',
  'bank_guarantees',
  'users',
  'reminders',
  'delete_entry',
  'sync_center',
  // Finance Mode Features
  'finance_dashboard',
  'loan_entry',
  'edit_loan_entry',
  'partners',
  'search',
  'calculator',
  'capital_entry',
  'camera',
  'daybook',
  'general_ledger',
  'cd_ledger',
  'stbd_ledger',
  'hp_ledger',
  'tbd_ledger',
  'dues_ledger',
  'pl',
  'final_statement',
  'business_report',
  'partner_performance',
  'new_customers',
  'phone_editor',
  'aadhaar_search',
  'logs',
  'user_access_management',
  'finance_edit_entry',
  'finance_delete_entry',
  'finance_approve_records',
  'book_management',
];
const getFeaturesForMode = (
  featuresByMode: Record<ModeKey, string[]>,
  requestedMode: ModeKey
) => {
  const requested = featuresByMode[requestedMode];
  if (requested && requested.length > 0) {
    return requested;
  }
  const fallback = featuresByMode.regular ?? [];
  return fallback;
};

interface User {
  id: string;
  username: string;
  is_admin: boolean;
  features: string[];
  featuresByMode?: Record<ModeKey, string[]>;
  mode?: 'regular' | 'itr' | 'finance' | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (
    username: string,
    password: string
  ) => Promise<{ success: boolean; error?: string; userMode?: 'regular' | 'itr' | 'finance' | null }>;
  logout: () => Promise<void>;
  reloadPermissions: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  isAdmin: boolean;
  isAuthenticated: boolean;
  /** After an admin reset (or a password shorter than 8): must change it before using the app */
  mustChangePassword: boolean;
  /** Shown shortly before the login ends (midnight, or no use) */
  sessionWarning: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const loadFeaturesForUser = async (
    userId: string,
    isAdminUser: boolean
  ): Promise<{
    featuresByMode: Record<ModeKey, string[]>;
    modeColumnExists: boolean;
  }> => {
    if (isAdminUser) {
      const map = createEmptyModeFeatureMap();
      MODE_VALUES.forEach(mode => {
        map[mode] = [...ADMIN_FEATURES];
      });
      return { featuresByMode: map, modeColumnExists: true };
    }

    let rows:
      | { feature_key: string | null; mode?: ModeKey | null }[]
      | null = null;
    let modeColumnExists = true;
    const { data, error } = await supabase
      .from('user_access')
      .select('feature_key, mode')
      .eq('user_id', userId);

    if (error) {
      if (isModeColumnError(error)) {
        modeColumnExists = false;
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('user_access')
          .select('feature_key')
          .eq('user_id', userId);
        if (fallbackError) {
          throw fallbackError;
        }
        rows =
          fallbackData?.map(item => ({
            feature_key: item.feature_key,
            mode: 'regular' as ModeKey,
          })) ?? [];
      } else {
        throw error;
      }
    } else {
      rows = data ?? [];
    }

    const map = createEmptyModeFeatureMap();
    rows?.forEach(item => {
      const featureKey = item?.feature_key;
      if (!featureKey) return;
      const mode = item?.mode === 'itr' ? 'itr' : 'regular';
      if (!map[mode].includes(featureKey)) {
        map[mode].push(featureKey);
      }
    });

    // Load finance permissions from finance_user_permissions table
    try {
      const { data: financeAccess, error: financeAccessError } = await supabase
        .from('finance_user_permissions')
        .select('feature_key')
        .eq('user_id', userId);

      if (!financeAccessError && financeAccess) {
        financeAccess.forEach(item => {
          if (item.feature_key && !map.finance.includes(item.feature_key)) {
            map.finance.push(item.feature_key);
          }
        });
      }
    } catch (err) {
      console.error('Error loading finance permissions:', err);
    }

    return { featuresByMode: map, modeColumnExists };
  };

  // ─── Login session ─────────────────────────────────────────────────────────
  // The login lives in Supabase (token kept by the Supabase client, shared by all tabs). The database
  // ends it at midnight, after 30 minutes without use, when the same user logs in elsewhere, or when
  // an admin logs them out; every request then fails with SESSION_ENDED and the app logs out here.
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const expiresAtRef = useRef<number>(0);
  const idleMinutesRef = useRef<number>(30);

  const buildUser = async (me: SessionMe): Promise<User> => {
    let featuresByMode: Record<ModeKey, string[]> = createEmptyModeFeatureMap();
    try {
      featuresByMode = (await loadFeaturesForUser(me.id, Boolean(me.is_admin))).featuresByMode;
    } catch (featureError) {
      console.error('Error loading user features:', featureError);
    }
    const activeMode = getStoredMode();
    return {
      id: me.id,
      username: me.username,
      is_admin: Boolean(me.is_admin),
      features: me.is_admin ? [...ADMIN_FEATURES] : getFeaturesForMode(featuresByMode, activeMode) || [],
      featuresByMode,
      mode: (me.mode as User['mode']) || null,
    };
  };

  const startSession = (userData: User, me: Partial<SessionMe>, loginTime: number) => {
    const expiresAt = me.expires_at ? new Date(me.expires_at).getTime() : nextMidnightIndia(loginTime);
    expiresAtRef.current = expiresAt;
    idleMinutesRef.current = me.idle_minutes || 30;
    setMustChangePassword(Boolean(me.must_change_password));
    setUser(userData);
    supabaseDB.setUserId(userData.id);
    sessionStorage.setItem('thirumala_user', JSON.stringify(userData));
    sessionStorage.setItem('thirumala_session_time', String(loginTime));
    saveOfflineSession(userData, loginTime, expiresAt);
    markActivity();
  };

  const clearLocalState = () => {
    localStorage.removeItem('table_mode');
    localStorage.removeItem('selectedMode');
    localStorage.removeItem('regularSelectedBook');
    localStorage.removeItem('itrSelectedBook');
    localStorage.removeItem('financeSelectedBook');
    localStorage.removeItem('currentBookId');
    localStorage.removeItem('user_credentials'); // old: plain passwords of new users were kept here
    clearOfflineSession();
    localStorage.removeItem('offlineBook_regular');
    localStorage.removeItem('offlineBook_itr');
    sessionStorage.removeItem('thirumala_user');
    sessionStorage.removeItem('thirumala_session_time');
    sessionStorage.removeItem('thirumala_login_history_id');
    sessionStorage.removeItem('table_mode');
    sessionStorage.removeItem('selectedMode');
  };

  /** Logs out on this computer. With a reason, the login page says why. */
  const endLocally = async (reason?: string) => {
    try {
      await rawSupabase.auth.signOut({ scope: 'local' });
    } catch {
      /* the token is removed from this computer either way */
    }
    clearLocalState();
    if (reason) sessionStorage.setItem(LOGOUT_REASON_KEY, reason);
    queryClient.clear();
    setUser(null);
    setMustChangePassword(false);
    setSessionWarning(null);
    supabaseDB.setUserId('');
  };

  useEffect(() => {
    // Check for an existing login on app load
    const checkSession = async () => {
      try {
        const { data } = await rawSupabase.auth.getSession();
        if (data.session && navigator.onLine) {
          const { data: me, error, status } = await rawSupabase.rpc('app_me');
          if (me) {
            resetSessionEndedReport();
            const userData = await buildUser(me as SessionMe);
            const started = me.started_at ? new Date(me.started_at).getTime() : Date.now();
            startSession(userData, me as SessionMe, started);
            return;
          }
          const reason = parseSessionEnded(error?.message);
          if (reason || !isNetworkFailure(error, status)) {
            await endLocally(reason || 'login_required');
            return;
          }
        }

        // No internet: stay logged in on this computer until the login's end (12:00 AM)
        const offlineSession = readOfflineSession();
        if (offlineSession && !(await backendReachable())) {
          expiresAtRef.current = offlineSession.expiresAt;
          setUser(offlineSession.user);
          supabaseDB.setUserId(offlineSession.user.id);
          sessionStorage.setItem('thirumala_user', JSON.stringify(offlineSession.user));
          sessionStorage.setItem('thirumala_session_time', String(offlineSession.time));
          return;
        }
        if (data.session) await endLocally();
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  // The database refused a request because this login ended
  useEffect(() => {
    const onEnded = (event: Event) => {
      const reason = (event as CustomEvent<string>).detail;
      if (!sessionStorage.getItem('thirumala_user')) return;
      endLocally(reason);
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  // While logged in: record use, tell the server every minute, warn before the login ends
  useEffect(() => {
    if (!user) return undefined;
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel', 'mousemove'];
    let lastMark = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastMark > 5000) {
        lastMark = now;
        markActivity(now);
      }
    };
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));

    let ticks = 0;
    let lastTouch = Date.now();
    const tick = async () => {
      const now = Date.now();
      const last = lastActivity();
      const idleLeft = last + idleMinutesRef.current * 60000 - now;
      const expiresAt = expiresAtRef.current;

      if (expiresAt && now >= expiresAt) {
        endLocally('expired');
        return;
      }
      if (expiresAt && expiresAt - now <= WARN_MS) {
        const mins = Math.max(1, Math.ceil((expiresAt - now) / 60000));
        setSessionWarning(`Logins end at 12:00 AM. You will be logged out in ${mins} minute${mins === 1 ? '' : 's'}. Please save your work.`);
      } else if (idleLeft <= WARN_MS) {
        const mins = Math.max(1, Math.ceil(idleLeft / 60000));
        setSessionWarning(`No use for a while: you will be logged out in ${mins} minute${mins === 1 ? '' : 's'}. Move the mouse or press a key to stay logged in.`);
      } else {
        setSessionWarning(null);
      }

      ticks += 1;
      if (ticks % 2 !== 0 || !navigator.onLine) return; // the server check runs every 30 seconds
      try {
        const active = last > lastTouch;
        const { data, error, status } = await rawSupabase.rpc('app_touch', { p_active: active });
        if (active) lastTouch = now;
        if (data && data.ok === false) {
          endLocally(data.reason);
        } else if (data?.ok) {
          if (data.expires_at) expiresAtRef.current = new Date(data.expires_at).getTime();
          if (data.idle_minutes) idleMinutesRef.current = data.idle_minutes;
          setMustChangePassword(Boolean(data.must_change_password));
        } else if (error && !isNetworkFailure(error, status)) {
          const reason = parseSessionEnded(error.message);
          if (reason) endLocally(reason);
        }
      } catch {
        /* no connection: try again next minute */
      }
    };
    const timer = window.setInterval(tick, 15000);
    tick();
    return () => {
      window.clearInterval(timer);
      events.forEach(e => window.removeEventListener(e, onActivity));
    };
  }, [user?.id]);

  useEffect(() => {
    const handleModeChange = (event: Event) => {
      const detail = (event as CustomEvent<ModeKey>).detail;
      const nextMode = detail === 'itr' ? 'itr' : detail === 'finance' ? 'finance' : 'regular';
      setUser(prev => {
        if (!prev) return prev;
        if (prev.is_admin) {
          return prev;
        }
        if (!prev.featuresByMode) {
          return prev;
        }
        const nextFeatures = getFeaturesForMode(prev.featuresByMode, nextMode);
        const updatedUser = { ...prev, features: nextFeatures };
        sessionStorage.setItem('thirumala_user', JSON.stringify(updatedUser));
        return updatedUser;
      });
    };

    window.addEventListener('table-mode-changed', handleModeChange as EventListener);
    return () => {
      window.removeEventListener(
        'table-mode-changed',
        handleModeChange as EventListener
      );
    };
  }, []);

  const login = async (username: string, password: string) => {
    try {
      if (!username.trim() || !password.trim()) {
        return { success: false, error: 'Username and password are required' };
      }

      if (!(await backendReachable(8000))) {
        return { success: false, error: 'Login needs internet. Please connect and try again.' };
      }

      // The password is checked on the server (api/auth/login.js), never in the browser
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.session?.access_token || !body?.me) {
        return { success: false, error: body?.error || 'Login failed. Please try again.' };
      }

      const { error: setError } = await rawSupabase.auth.setSession({
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
      });
      if (setError) {
        console.error('Could not keep the login:', setError);
        return { success: false, error: 'Login failed. Please try again.' };
      }
      resetSessionEndedReport();
      sessionStorage.removeItem(LOGOUT_REASON_KEY);

      const me = body.me as SessionMe;
      const userData = await buildUser(me);
      startSession(userData, me, Date.now());

      initAudioContext();

      if (navigator.onLine) {
        import('../lib/offlineMasterData').then(({ syncAllMasterData }) => {
          syncAllMasterData().catch(err => console.error('Error syncing master data on login:', err));
        }).catch(err => console.error('Error importing offlineMasterData:', err));
      }

      return { success: true, userMode: userData.mode };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, error: 'Login failed. Please try again.' };
    }
  };

  const logout = async () => {
    try {
      await rawSupabase.rpc('app_logout');
    } catch {
      /* ends on this computer anyway; the server ends it at midnight or after 30 minutes */
    }
    await endLocally();
  };

  const reloadPermissions = async () => {
    if (!user) return;
    try {
      const { featuresByMode } = await loadFeaturesForUser(user.id, user.is_admin);
      const activeMode = getStoredMode();
      const nextFeatures = user.is_admin
        ? [...ADMIN_FEATURES]
        : getFeaturesForMode(featuresByMode, activeMode);

      const updatedUser = {
        ...user,
        features: nextFeatures,
        featuresByMode,
      };

      setUser(updatedUser);
      sessionStorage.setItem('thirumala_user', JSON.stringify(updatedUser));
    } catch (error) {
      console.error('Error reloading permissions:', error);
    }
  };

  const changePassword = async (
    currentPassword: string,
    newPassword: string
  ) => {
    if (!user) {
      return { success: false, error: 'User not logged in' };
    }
    if (!mustChangePassword && !currentPassword.trim()) {
      return { success: false, error: 'Please enter your current password' };
    }
    if (newPassword.length < MIN_PASSWORD) {
      return { success: false, error: `New password must be at least ${MIN_PASSWORD} characters` };
    }
    try {
      await apiPost('/api/auth/change-password', { currentPassword, newPassword });
      setMustChangePassword(false);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to change password. Please try again.' };
    }
  };

  const isAdmin = !!user?.is_admin;
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, reloadPermissions, changePassword, isAdmin, isAuthenticated, mustChangePassword, sessionWarning }}
    >
      {children}
    </AuthContext.Provider>
  );
};
