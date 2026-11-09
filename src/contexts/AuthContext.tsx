import { backendReachable, clearOfflineSession, readOfflineSession, saveOfflineSession } from '../lib/offlineSession';
import { isNetworkFailure } from '../lib/offlineSyncEngine';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import bcrypt from 'bcryptjs';
import { queryClient } from '../lib/queryClient';
import { supabaseDB } from '../lib/supabaseDatabase';
import { initAudioContext } from '../utils/reminderSound';

type ModeKey = 'regular' | 'itr' | 'finance';
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

  useEffect(() => {
    // Check for existing session on app load
    const checkSession = async () => {
      try {
        let savedUser = sessionStorage.getItem('thirumala_user');
        let sessionTime = sessionStorage.getItem('thirumala_session_time');

        // Browser was closed and there is no internet: stay logged in on this computer for 24 hours
        if (!savedUser) {
          const offlineSession = readOfflineSession();
          if (offlineSession && !(await backendReachable())) {
            savedUser = JSON.stringify(offlineSession.user);
            sessionTime = String(offlineSession.time);
            sessionStorage.setItem('thirumala_user', savedUser);
            sessionStorage.setItem('thirumala_session_time', sessionTime);
          }
        }

        if (savedUser && sessionTime) {
          const parsedUser: User = JSON.parse(savedUser);
          const sessionAge = Date.now() - parseInt(sessionTime);
          const SESSION_DURATION = 24 * 60 * 60 * 1000;
          if (sessionAge < SESSION_DURATION) {
            // Check if user is active in DB
            const { data: dbUserCheck, error: checkError, status: checkStatus } = await supabase
              .from('users')
              .select('is_active')
              .eq('id', parsedUser.id)
              .single();

            // No internet is not a reason to log someone out, and permissions stay as they were
            const cannotCheck = !navigator.onLine || isNetworkFailure(checkError, checkStatus);

            if (!cannotCheck && (checkError || !dbUserCheck || dbUserCheck.is_active === false)) {
              sessionStorage.removeItem('thirumala_user');
              sessionStorage.removeItem('thirumala_session_time');
              clearOfflineSession();
              supabaseDB.setUserId('');
              setUser(null);
              setLoading(false);
              return;
            }

            if (!cannotCheck) try {
              const { featuresByMode } = await loadFeaturesForUser(
                parsedUser.id,
                Boolean(parsedUser.is_admin)
              );
              const activeMode = getStoredMode();
              parsedUser.featuresByMode = featuresByMode;
              if (parsedUser.is_admin) {
                parsedUser.features = [...ADMIN_FEATURES];
              } else {
                parsedUser.features = getFeaturesForMode(featuresByMode, activeMode);
              }
              sessionStorage.setItem('thirumala_user', JSON.stringify(parsedUser));
            } catch (featureError) {
              console.error('❌ Error reloading features for session:', featureError);
              if (!Array.isArray(parsedUser.features)) {
                parsedUser.features = [];
              }
            }

            saveOfflineSession(parsedUser, parseInt(sessionTime));
            setUser(parsedUser);
            supabaseDB.setUserId(parsedUser.id);
          } else {
            sessionStorage.removeItem('thirumala_user');
            sessionStorage.removeItem('thirumala_session_time');
            clearOfflineSession();
            supabaseDB.setUserId('');
          }
        }
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

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

  const parseUA = (uaString: string) => {
    let browser = 'Unknown Browser';
    let os = 'Unknown OS';
    let device = 'Desktop';
    if (uaString.includes('Firefox')) browser = 'Firefox';
    else if (uaString.includes('Chrome')) browser = 'Chrome';
    else if (uaString.includes('Safari')) browser = 'Safari';
    else if (uaString.includes('Edge')) browser = 'Edge';

    if (uaString.includes('Windows')) os = 'Windows';
    else if (uaString.includes('Macintosh')) os = 'Mac OS';
    else if (uaString.includes('Android')) os = 'Android';
    else if (uaString.includes('iPhone') || uaString.includes('iPad')) os = 'iOS';

    if (uaString.includes('Mobile') || uaString.includes('Android') || uaString.includes('iPhone')) device = 'Mobile';
    else if (uaString.includes('Tablet') || uaString.includes('iPad')) device = 'Tablet';
    return { browser, os, device };
  };

  const login = async (username: string, password: string) => {
    try {
      if (!username.trim() || !password.trim()) {
        return { success: false, error: 'Username and password are required' };
      }

      if (!(await backendReachable(8000))) {
        return { success: false, error: 'Login needs internet. Please connect and try again.' };
      }

      const trimmedUsername = username.trim();
      const ua = navigator.userAgent;
      const { browser, os, device } = parseUA(ua);
      let ip = '127.0.0.1';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json').then(res => res.json());
        if (ipRes && ipRes.ip) ip = ipRes.ip;
      } catch (err) {
        console.warn('Could not retrieve client IP address:', err);
      }

      // 1. Fetch user
      const { data: allUsers, error: fetchError } = await supabase
        .from('users')
        .select(`
          *,
          user_types!inner(user_type)
        `);
      
      if (fetchError || !allUsers) {
        return { success: false, error: 'Invalid username or password' };
      }
      
      const dbUser = allUsers.find(u => 
        u.username && u.username.toLowerCase() === trimmedUsername.toLowerCase()
      );
      
      if (!dbUser) {
        // Record failed attempt for non-existing user
        await supabase.from('login_history').insert({
          username: trimmedUsername,
          success: false,
          failure_reason: 'User not found',
          ip_address: ip,
          browser,
          device,
          os
        });
        return { success: false, error: 'Invalid username or password' };
      }

      // Check status/activation
      const currentStatus = dbUser.status || (dbUser.is_active === false ? 'Disabled' : 'Active');
      if (['Disabled', 'Locked', 'Suspended', 'Deleted'].includes(currentStatus)) {
        await supabase.from('login_history').insert({
          user_id: dbUser.id,
          username: dbUser.username,
          success: false,
          failure_reason: `Account is ${currentStatus.toLowerCase()}`,
          ip_address: ip,
          browser,
          device,
          os
        });
        return { success: false, error: `Account is ${currentStatus.toLowerCase()}` };
      }

      // 2. Check password
      const passwordMatch = await bcrypt.compare(password, dbUser.password_hash);
      if (!passwordMatch) {
        // Increment failed attempts
        const attempts = (dbUser.failed_login_attempts || 0) + 1;
        const updates: any = { failed_login_attempts: attempts };
        if (attempts >= 5) {
          updates.status = 'Locked';
        }
        await supabase.from('users').update(updates).eq('id', dbUser.id);

        await supabase.from('login_history').insert({
          user_id: dbUser.id,
          username: dbUser.username,
          success: false,
          failure_reason: attempts >= 5 ? 'Account locked: too many failures' : 'Invalid password',
          ip_address: ip,
          browser,
          device,
          os
        });

        return {
          success: false,
          error: attempts >= 5 
            ? 'Account is locked due to too many failed attempts' 
            : 'Invalid username or password'
        };
      }

      // 3. Success login
      await supabase.from('users').update({
        failed_login_attempts: 0,
        last_login: new Date().toISOString(),
        login_count: (dbUser.login_count || 0) + 1
      }).eq('id', dbUser.id);

      // Write login success
      const { data: histData } = await supabase.from('login_history').insert({
        user_id: dbUser.id,
        username: dbUser.username,
        success: true,
        ip_address: ip,
        browser,
        device,
        os
      }).select('id').single();

      if (histData?.id) {
        sessionStorage.setItem('thirumala_login_history_id', histData.id);
      }

      const isAdmin = dbUser.user_types?.user_type === 'Admin';
      let featuresByMode: Record<ModeKey, string[]> = createEmptyModeFeatureMap();
      try {
        const results = await loadFeaturesForUser(dbUser.id, isAdmin);
        featuresByMode = results.featuresByMode;
      } catch (featureError) {
        console.error('Error loading user features:', featureError);
      }
      const activeMode = getStoredMode();
      const features = isAdmin
        ? [...ADMIN_FEATURES]
        : getFeaturesForMode(featuresByMode, activeMode);
      
      const userData: User = {
        id: dbUser.id,
        username: dbUser.username,
        is_admin: isAdmin,
        features: features || [],
        featuresByMode,
        mode: dbUser.mode || null,
      };
      
      setUser(userData);
      supabaseDB.setUserId(userData.id);
      const loginTime = Date.now();
      sessionStorage.setItem('thirumala_user', JSON.stringify(userData));
      sessionStorage.setItem('thirumala_session_time', loginTime.toString());
      saveOfflineSession(userData, loginTime);

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
      const histId = sessionStorage.getItem('thirumala_login_history_id');
      const sessionStart = sessionStorage.getItem('thirumala_session_time');
      if (histId && sessionStart) {
        const durationSec = Math.round((Date.now() - parseInt(sessionStart)) / 1000);
        const durationText = durationSec > 60 
          ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` 
          : `${durationSec}s`;
        
        await supabase.from('login_history').update({
          logout_time: new Date().toISOString(),
          session_duration: durationText
        }).eq('id', histId);
      }

      localStorage.removeItem('table_mode');
      localStorage.removeItem('selectedMode');
      localStorage.removeItem('regularSelectedBook');
      localStorage.removeItem('itrSelectedBook');
      localStorage.removeItem('financeSelectedBook');
      localStorage.removeItem('currentBookId');

      clearOfflineSession();
      localStorage.removeItem('offlineBook_regular');
      localStorage.removeItem('offlineBook_itr');
      sessionStorage.removeItem('thirumala_user');
      sessionStorage.removeItem('thirumala_session_time');
      sessionStorage.removeItem('thirumala_login_history_id');
      sessionStorage.removeItem('table_mode');
      sessionStorage.removeItem('selectedMode');

      queryClient.clear();
      setUser(null);
      supabaseDB.setUserId('');
    } catch (error) {
      console.error('Logout error:', error);
    }
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
    try {
      if (!user) {
        return { success: false, error: 'User not logged in' };
      }

      if (!currentPassword.trim() || !newPassword.trim()) {
        return { success: false, error: 'Both passwords are required' };
      }

      if (newPassword.length < 4) {
        return { success: false, error: 'New password must be at least 4 characters' };
      }

      // 1. Fetch user from database
      const { data: dbUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (fetchError || !dbUser) {
        return { success: false, error: 'User not found' };
      }

      // 2. Verify current password
      const passwordMatch = await bcrypt.compare(
        currentPassword,
        dbUser.password_hash
      );

      if (!passwordMatch) {
        return { success: false, error: 'Current password is incorrect' };
      }

      // 3. Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // 4. Update password in database
      const { error: updateError } = await supabase
        .from('users')
        .update({
          password_hash: newPasswordHash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error updating password:', updateError);
        return { success: false, error: 'Failed to update password' };
      }

      return { success: true };
    } catch (err) {
      console.error('Change password error:', err);
      return { success: false, error: 'Failed to change password. Please try again.' };
    }
  };

  const isAdmin = !!user?.is_admin;
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, reloadPermissions, changePassword, isAdmin, isAuthenticated }}
    >
      {children}
    </AuthContext.Provider>
  );
};
