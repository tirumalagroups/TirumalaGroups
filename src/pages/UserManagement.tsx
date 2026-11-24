import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { rawSupabase } from '../lib/supabase';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Card from '../components/UI/Card';
import toast from 'react-hot-toast';
import { apiPost } from '../lib/apiClient';
import { USER_COLUMNS, OPTIONAL_PROFILE_COLUMNS } from '../lib/userColumns';
import LoginSecurityPanel, { LoginSecurityTab } from '../components/users/LoginSecurityPanel';
import { MIN_PASSWORD } from '../contexts/AuthContext';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import {
  UserIcon,
  Shield,
  Save,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Briefcase,
  Clock,
  Landmark,
  Key,
  Lock,
  Unlock,
  Ban,
  RotateCcw,
  X,
} from 'lucide-react';

/**
 * One User Management screen for Regular, ITR and Finance.
 * An admin can create users and give permissions for any module from any mode.
 * Permissions stay in their existing tables, so nobody loses access:
 *   Regular / ITR -> public.user_access (feature_key + mode)
 *   Finance       -> public.user_permissions (feature_key)
 */

type ModeKey = 'regular' | 'itr' | 'finance';
type TabKey = 'profile' | 'permissions' | 'activity' | 'login_history' | 'audit';
type ModeFeatures = Record<ModeKey, string[]>;

interface Feature {
  key: string;
  name: string;
  /** Menu only admins can open: listed so every menu shows, but greyed out and cannot be given */
  adminOnly?: boolean;
}

const MODE_VALUES: ModeKey[] = ['regular', 'itr', 'finance'];
const MODE_BADGE: Record<ModeKey, { pill: string; dot: string }> = {
  regular: { pill: 'bg-blue-100 text-blue-800 border-blue-200', dot: 'bg-blue-500' },
  itr: { pill: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  finance: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
};
const MODE_LABELS: Record<ModeKey, string> = {
  regular: 'Regular Mode',
  itr: 'ITR Mode',
  finance: 'Finance Mode',
};
const MODE_GRADIENT: Record<ModeKey, string> = {
  regular: 'from-blue-500 to-blue-600',
  itr: 'from-orange-500 to-red-600',
  finance: 'from-emerald-500 to-teal-600',
};

const REGULAR_FEATURES: Feature[] = [
  { key: 'dashboard', name: 'Dashboard' },
  { key: 'new_entry', name: 'New Entry' },
  { key: 'edit_entry', name: 'Edit Entry' },
  { key: 'delete_entry', name: 'Delete Entry' },
  { key: 'daily_report', name: 'Daily Report' },
  { key: 'detailed_ledger', name: 'Detailed Ledger' },
  { key: 'ledger_summary', name: 'Ledger Summary' },
  { key: 'approve_records', name: 'Approve Records' },
  { key: 'edited_records', name: 'Edited Records' },
  { key: 'deleted_records', name: 'Deleted Records' },
  { key: 'replace_form', name: 'Replace Form' },
  { key: 'export', name: 'Export' },
  { key: 'csv_upload', name: 'CSV Upload' },
  { key: 'balance_sheet', name: 'Balance Sheet' },
  { key: 'vehicles', name: 'Vehicles' },
  { key: 'reminders', name: 'Reminders' },
  { key: 'sync_center', name: 'Sync Center' },
  { key: 'bank_guarantees', name: 'Bank Guarantees' },
  { key: 'drivers', name: 'Drivers' },
  { key: 'book_management', name: 'Book Management' },
  { key: 'users', name: 'User Management', adminOnly: true },
  { key: 'attendance', name: 'Attendance', adminOnly: true },
];

// ITR has the same menus as Regular, except Attendance (Regular only)
const ITR_FEATURES: Feature[] = REGULAR_FEATURES.filter(f => f.key !== 'attendance');

const FINANCE_FEATURES: Feature[] = [
  { key: 'finance_dashboard', name: 'Dashboard' },
  { key: 'sync_center', name: 'Sync Center' },
  { key: 'loan_entry', name: 'New Loan' },
  { key: 'edit_loan_entry', name: 'Edit Loan' },
  { key: 'finance_edit_entry', name: 'Edit Entry' },
  { key: 'finance_delete_entry', name: 'Delete Entry' },
  { key: 'finance_approve_records', name: 'Approve Records' },
  { key: 'new_customers', name: 'New Customer & Customers' },
  { key: 'partners', name: 'New Partner & Partners' },
  { key: 'daybook', name: 'Day Book Entry' },
  { key: 'capital_entry', name: 'Capital Entry' },
  { key: 'calculator', name: 'Calculator' },
  { key: 'search', name: 'Aadhaar Search' },
  { key: 'aadhaar_search', name: 'Aadhaar Search (old link)' },
  { key: 'camera', name: 'Camera' },
  { key: 'phone_editor', name: 'Phone Number Editor' },
  { key: 'cd_ledger', name: 'CD Ledger' },
  { key: 'hp_ledger', name: 'HP Ledger' },
  { key: 'stbd_ledger', name: 'STBD Ledger' },
  { key: 'tbd_ledger', name: 'TBD Ledger' },
  { key: 'daily_report', name: 'Daily Report' },
  { key: 'detailed_ledger', name: 'Detailed Ledger' },
  { key: 'general_ledger', name: 'General Ledger' },
  { key: 'dues_ledger', name: 'Dues List' },
  { key: 'payment_followup', name: 'Payment Follow-up & Call History' },
  { key: 'pl', name: 'P&L / Balance Sheet' },
  { key: 'final_statement', name: 'Final Statement' },
  { key: 'business_report', name: 'Business Details' },
  { key: 'partner_performance', name: 'Partner Performance' },
  { key: 'logs', name: 'Edited / Deleted Entry' },
  { key: 'ledger_settings', name: 'Ledger Settings', adminOnly: true },
  { key: 'user_access_management', name: 'User Management', adminOnly: true },
];

const FEATURES_BY_MODE: Record<ModeKey, Feature[]> = {
  regular: REGULAR_FEATURES,
  itr: ITR_FEATURES,
  finance: FINANCE_FEATURES,
};

// Giving Edit Entry also gives Delete Entry (same rule as Regular / ITR)
const EDIT_DELETE_PAIR: Record<ModeKey, [string, string]> = {
  regular: ['edit_entry', 'delete_entry'],
  itr: ['edit_entry', 'delete_entry'],
  finance: ['finance_edit_entry', 'finance_delete_entry'],
};

const FINANCE_KEYS = new Set(FINANCE_FEATURES.map(f => f.key));
const emptyFeatures = (): ModeFeatures => ({ regular: [], itr: [], finance: [] });
const unique = (items: string[]) => [...new Set(items.filter(Boolean))];
const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a);
  return x.size === new Set(b).size && b.every(k => x.has(k));
};

const getStaffName = () => {
  try {
    return JSON.parse(sessionStorage.getItem('thirumala_user') || '{}').username || 'Admin';
  } catch {
    return 'Admin';
  }
};

const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('en-IN') : '-');

// ─── Audit Log in plain words ────────────────────────────────────────────────

const PROFILE_LABELS: Record<string, string> = {
  full_name: 'Full name', phone: 'Phone', email: 'Email', address: 'Address', aadhaar_number: 'Aadhaar',
  date_of_birth: 'Date of birth', other_details: 'Other details', branch: 'Branch', employee_id: 'Employee ID',
  designation: 'Designation', role: 'Role', status: 'Status',
};

const parseKeys = (v: string | null | undefined): string[] => {
  if (!v) return [];
  try {
    const list = JSON.parse(v);
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
};

/** One audit row as plain sentences, e.g. "Finance permissions: added CD Ledger; removed Calculator" */
export const describeAudit = (log: { field?: string | null; old_value?: string | null; new_value?: string | null }): string[] => {
  const field = String(log.field || '');
  const oldV = log.old_value ?? '';
  const newV = log.new_value ?? '';
  const perm = field.match(/^permissions \((.+)\)$/);
  if (perm) {
    const modeLabel = perm[1];
    const isFinance = /finance/i.test(modeLabel);
    const list = isFinance ? FINANCE_FEATURES : REGULAR_FEATURES;
    const nameOf = (k: string) => list.find(f => f.key === k)?.name || k;
    const before = parseKeys(oldV);
    const after = parseKeys(newV);
    const added = after.filter(k => !before.includes(k)).map(nameOf);
    const removed = before.filter(k => !after.includes(k)).map(nameOf);
    const what = modeLabel.replace(/\s*Mode$/i, '');
    const parts: string[] = [];
    if (added.length) parts.push(`added ${added.join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    return [`${what} permissions: ${parts.length ? parts.join('; ') : 'no change'}`];
  }
  if (field === 'user') return [newV ? `New user created: ${newV.replace(/^Created as /, 'as ')}` : 'New user created'];
  if (field === 'password') return [newV === 'TEMPORARY_SET' ? 'Temporary password set by admin (the user must change it at the next login)' : 'Password changed'];
  if (field === 'status') {
    if (newV === 'Deleted') return [`User deleted (status was ${oldV || '-'})`];
    if (oldV === 'Deleted') return [`User restored (status now ${newV || '-'})`];
    return [`Status: ${oldV || '-'} → ${newV || '-'}`];
  }
  const label = PROFILE_LABELS[field] || field.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
  if (!oldV && newV) return [`${label} added: ${newV}`];
  if (oldV && !newV) return [`${label} removed (was ${oldV})`];
  return [`${label}: ${oldV || '-'} → ${newV || '-'}`];
};

const isRecentlyCreated = (createdAt?: string | null) => {
  if (!createdAt) return false;
  return (Date.now() - new Date(createdAt).getTime()) / 86400000 <= 7;
};

const db = () => rawSupabase.schema('public');

interface UserRow {
  raw: any;
  id: string;
  username: string;
  userType: string;
  userTypeId: string;
  is_admin: boolean;
  status: string;
  created_at: string | null;
  features: ModeFeatures;
  /** Keys saved by the old Finance screen that no menu uses; kept when saving so nothing is lost */
  oldFinanceKeys: string[];
}

interface ProfileForm {
  full_name: string;
  phone: string;
  email: string;
  address: string;
  aadhaar_number: string;
  date_of_birth: string;
  other_details: string;
  branch: string;
  employee_id: string;
  designation: string;
  user_type_id: string;
}

const emptyProfile = (): ProfileForm => ({
  full_name: '',
  phone: '',
  email: '',
  address: '',
  aadhaar_number: '',
  date_of_birth: '',
  other_details: '',
  branch: '',
  employee_id: '',
  designation: '',
  user_type_id: '',
});

const emptyNewUser = () => ({
  ...emptyProfile(),
  username: '',
  password: '',
  is_admin: false,
  features: emptyFeatures(),
});

// ─── Permission picker: Regular / ITR / Finance tabs ─────────────────────────

const PermissionPicker: React.FC<{
  value: ModeFeatures;
  onToggle: (mode: ModeKey, key: string) => void;
  disabled?: boolean;
}> = ({ value, onToggle, disabled }) => {
  const { mode: currentMode } = useTableMode();
  const [mode, setMode] = useState<ModeKey>((currentMode as ModeKey) || 'regular');
  const selected = value[mode] || [];
  return (
    <div>
      <div className='flex flex-wrap gap-2 mb-3'>
        {MODE_VALUES.map(m => (
          <button
            key={m}
            type='button'
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              mode === m
                ? `text-white border-transparent bg-gradient-to-r ${MODE_GRADIENT[m]}`
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {MODE_LABELS[m]} ({(value[m] || []).length})
          </button>
        ))}
      </div>
      <div className='border border-gray-200 rounded-2xl shadow-sm overflow-hidden'>
        <div className={`px-4 py-3 flex items-center justify-between text-white bg-gradient-to-r ${MODE_GRADIENT[mode]}`}>
          <div className='flex items-center gap-2 text-base font-semibold'>
            {mode === 'itr' ? <FileCheck className='w-5 h-5' /> : mode === 'finance' ? <Landmark className='w-5 h-5' /> : <Briefcase className='w-5 h-5' />}
            {MODE_LABELS[mode]}
          </div>
          <span className='text-sm font-medium bg-white/20 px-3 py-1 rounded-full'>{selected.length} selected</span>
        </div>
        <div className='p-4'>
          <div className='flex flex-wrap gap-2 sm:gap-3'>
            {FEATURES_BY_MODE[mode].map(f => {
              if (f.adminOnly) {
                return (
                  <label
                    key={`${mode}-${f.key}`}
                    title='Only admins can open this menu'
                    className='flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border-2 select-none text-xs sm:text-sm font-medium cursor-not-allowed bg-gray-100 text-gray-400 border-gray-200'
                  >
                    <input type='checkbox' checked={false} disabled readOnly className='w-5 h-5' />
                    <span>{f.name}</span>
                    <span className='px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 text-[10px] font-bold uppercase'>Admin only</span>
                  </label>
                );
              }
              const isSelected = selected.includes(f.key);
              return (
                <label
                  key={`${mode}-${f.key}`}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full shadow border-2 transition-all select-none text-xs sm:text-sm font-medium ${
                    disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
                  } ${
                    isSelected
                      ? 'bg-gradient-to-r from-blue-200 to-indigo-200 text-blue-900 border-blue-400'
                      : 'bg-blue-50 text-blue-800 border-blue-100 hover:border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  <input
                    type='checkbox'
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => onToggle(mode, f.key)}
                    className='accent-blue-600 w-5 h-5'
                  />
                  <span>{f.name}</span>
                </label>
              );
            })}
          </div>
          <p className='mt-3 text-xs text-gray-500'>
            Select the features this user should have in {MODE_LABELS[mode]}. They will only see these options when using this mode.
            {' '}Menus marked &quot;Admin only&quot; open for admins only and cannot be given to other users.
          </p>
        </div>
      </div>
    </div>
  );
};

const toggleFeature = (current: ModeFeatures, mode: ModeKey, key: string): ModeFeatures => {
  const list = current[mode] || [];
  const turningOn = !list.includes(key);
  let next = turningOn ? [...list, key] : list.filter(k => k !== key);
  const [editKey, deleteKey] = EDIT_DELETE_PAIR[mode];
  if (turningOn && key === editKey && !next.includes(deleteKey)) next = [...next, deleteKey];
  return { ...current, [mode]: next };
};

// ─── Main page ───────────────────────────────────────────────────────────────

const UserManagement: React.FC = () => {
  const { user } = useAuth();
  const { mode: currentMode } = useTableMode();
  const pageMode = ((currentMode as ModeKey) || 'regular') as ModeKey;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<{ id: string; user_type: string }[]>([]);
  const [modeColumn, setModeColumn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  // Two tabs: Users (the list, as before) and Login Security. ?tab=security&show=requests opens the second.
  const [searchParams, setSearchParams] = useSearchParams();
  const pageTab: 'users' | 'security' = searchParams.get('tab') === 'security' ? 'security' : 'users';
  const securityShow = (searchParams.get('show') || undefined) as LoginSecurityTab | undefined;
  const openTab = (t: 'users' | 'security') => setSearchParams(t === 'security' ? { tab: 'security' } : {}, { replace: true });
  const [newUser, setNewUser] = useState(emptyNewUser);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('profile');
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [editFeatures, setEditFeatures] = useState<ModeFeatures>(emptyFeatures);
  const [tabRows, setTabRows] = useState<any[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [copyFromId, setCopyFromId] = useState('');

  // Every change asks for a reason, which goes into the audit log
  const [reasonPrompt, setReasonPrompt] = useState<{ title: string; run: (reason: string) => Promise<void> } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [passwordFor, setPasswordFor] = useState<UserRow | null>(null);
  const [passwordText, setPasswordText] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const { data: roleRows } = await db().from('user_types').select('id, user_type').order('user_type');
      setRoles(roleRows || []);

      const readUsers = (cols: string) =>
        db().from('users').select(`${cols}, user_types(user_type)`).order('created_at', { ascending: false });
      let { data: dbUsers, error: usersErr } = await readUsers(`${USER_COLUMNS}, ${OPTIONAL_PROFILE_COLUMNS}`);
      // This database has no profile columns: list the users without them
      if (usersErr && ['42703', 'PGRST204'].includes((usersErr as any).code || '')) {
        ({ data: dbUsers, error: usersErr } = await readUsers(USER_COLUMNS));
      }
      if (usersErr) throw usersErr;

      let accessRows: any[] = [];
      let hasMode = true;
      const accessRes = await db().from('user_access').select('user_id, feature_key, mode');
      if (accessRes.error) {
        hasMode = false;
        const fallback = await db().from('user_access').select('user_id, feature_key');
        accessRows = fallback.data || [];
      } else {
        accessRows = accessRes.data || [];
      }
      setModeColumn(hasMode);

      const { data: permRows, error: permErr } = await db().from('user_permissions').select('user_id, feature_key');
      if (permErr) console.warn('Could not load finance permissions:', permErr);

      const rows: UserRow[] = (dbUsers || []).map((u: any) => {
        const features = emptyFeatures();
        accessRows
          .filter(a => a.user_id === u.id && a.feature_key)
          .forEach(a => {
            const m: ModeKey = a.mode === 'itr' ? 'itr' : 'regular';
            if (!features[m].includes(a.feature_key)) features[m].push(a.feature_key);
          });
        const financeKeys = unique((permRows || []).filter((p: any) => p.user_id === u.id).map((p: any) => p.feature_key));
        features.finance = financeKeys.filter(k => FINANCE_KEYS.has(k));
        const userType = u.user_types?.user_type || 'Operator';
        return {
          raw: u,
          id: u.id,
          username: u.username,
          userType,
          userTypeId: u.user_type_id || '',
          is_admin: userType === 'Admin',
          status: u.status || (u.is_active === false ? 'Disabled' : 'Active'),
          created_at: u.created_at || null,
          features,
          oldFinanceKeys: financeKeys.filter(k => !FINANCE_KEYS.has(k)),
        };
      });
      setUsers(rows);
      return rows;
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to load users');
      return [];
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const expanded = useMemo(() => users.find(u => u.id === expandedId) || null, [users, expandedId]);

  const hydrate = (u: UserRow) => {
    const r = u.raw;
    setProfile({
      full_name: r.full_name || '',
      phone: r.phone || '',
      email: r.email || '',
      address: r.address || '',
      aadhaar_number: r.aadhaar_number || '',
      date_of_birth: r.date_of_birth || '',
      other_details: r.other_details || '',
      branch: r.branch || '',
      employee_id: r.employee_id || '',
      designation: r.designation || '',
      user_type_id: u.userTypeId,
    });
    setEditFeatures({ ...u.features });
    setCopyFromId('');
  };

  const toggleCard = (u: UserRow) => {
    if (expandedId === u.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(u.id);
    setTab('profile');
    hydrate(u);
  };

  // Activity / login history / audit are loaded when their tab opens
  useEffect(() => {
    if (!expandedId || !['activity', 'login_history', 'audit'].includes(tab)) return;
    let alive = true;
    const load = async () => {
      setTabLoading(true);
      setTabRows([]);
      try {
        const query =
          tab === 'activity'
            ? db().from('user_activities').select('*').eq('user_id', expandedId).order('created_at', { ascending: false }).limit(50)
            : tab === 'login_history'
            ? db().from('login_history').select('*').eq('user_id', expandedId).order('login_time', { ascending: false }).limit(50)
            : db().from('audit_logs').select('*').eq('target_user_id', expandedId).order('created_at', { ascending: false }).limit(50);
        const { data } = await query;
        if (alive) setTabRows(data || []);
      } catch (e) {
        console.error(e);
      } finally {
        if (alive) setTabLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [expandedId, tab]);

  const logAudit = async (target: { id: string; username: string }, field: string, oldVal: string | null, newVal: string | null, reason: string) => {
    try {
      await db().from('audit_logs').insert({
        changed_by: getStaffName(),
        target_user_id: target.id,
        target_username: target.username,
        field,
        old_value: oldVal,
        new_value: newVal,
        reason,
      });
      await db().from('user_activities').insert({
        user_id: target.id,
        username: target.username,
        activity_type: 'Profile Update',
        description: `Field '${field}' modified from '${oldVal}' to '${newVal}'`,
      });
    } catch (e) {
      console.error('Audit failed:', e);
    }
  };

  const askReason = (title: string, run: (reason: string) => Promise<void>) => {
    setReasonText('');
    setReasonPrompt({ title, run });
  };

  const confirmReason = async () => {
    if (!reasonText.trim()) {
      toast.error('Reason is required');
      return;
    }
    const pending = reasonPrompt;
    setReasonPrompt(null);
    if (!pending) return;
    setLoading(true);
    try {
      await pending.run(reasonText.trim());
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  const refreshExpanded = async (id: string) => {
    const rows = await loadUsers();
    const fresh = rows.find(r => r.id === id);
    if (fresh) hydrate(fresh);
  };

  // ─── Permissions ───────────────────────────────────────────────────────────

  const writePermissions = async (target: { id: string; username: string }, before: ModeFeatures, after: ModeFeatures, oldFinanceKeys: string[], reason: string) => {
    const regularChanged = !sameSet(before.regular, after.regular) || !sameSet(before.itr, after.itr);
    const financeChanged = !sameSet(before.finance, after.finance);

    if (regularChanged) {
      const keys = unique([...after.regular, ...after.itr]);
      for (const key of keys) {
        const def = REGULAR_FEATURES.find(f => f.key === key);
        if (def) await db().from('features').upsert({ key: def.key, name: def.name }, { onConflict: 'key' });
      }
      const { error: delErr } = await db().from('user_access').delete().eq('user_id', target.id);
      if (delErr) throw delErr;
      const rows: any[] = modeColumn
        ? [
            ...unique(after.regular).map(k => ({ user_id: target.id, feature_key: k, mode: 'regular' })),
            ...unique(after.itr).map(k => ({ user_id: target.id, feature_key: k, mode: 'itr' })),
          ]
        : keys.map(k => ({ user_id: target.id, feature_key: k }));
      if (rows.length > 0) {
        const { error: insErr } = await db().from('user_access').insert(rows);
        if (insErr) throw insErr;
      }
    }

    if (financeChanged) {
      const { error: delErr } = await db().from('user_permissions').delete().eq('user_id', target.id);
      if (delErr) throw delErr;
      const rows = unique([...after.finance, ...oldFinanceKeys]).map(k => ({ user_id: target.id, feature_key: k }));
      if (rows.length > 0) {
        const { error: insErr } = await db().from('user_permissions').insert(rows);
        if (insErr) throw insErr;
      }
    }

    for (const m of MODE_VALUES) {
      if (!sameSet(before[m], after[m])) {
        await logAudit(target, `permissions (${MODE_LABELS[m]})`, JSON.stringify(before[m]), JSON.stringify(after[m]), reason);
      }
    }
  };

  const savePermissions = (u: UserRow) => {
    const after = editFeatures;
    if (MODE_VALUES.every(m => sameSet(u.features[m], after[m]))) {
      toast('No permission changes to save');
      return;
    }
    askReason(`Save permissions for ${u.username}`, async reason => {
      await writePermissions(u, u.features, after, u.oldFinanceKeys, reason);
      toast.success('Feature access updated');
      await refreshExpanded(u.id);
    });
  };

  const copyPermissions = () => {
    const from = users.find(x => x.id === copyFromId);
    if (!from) {
      toast.error('Select a user to copy from');
      return;
    }
    setEditFeatures({ ...from.features });
    toast.success(`Copied from ${from.username}. Click Save to apply.`);
  };

  // ─── Profile, password, status ─────────────────────────────────────────────

  const saveProfile = (u: UserRow) => {
    const updates: Record<string, any> = {};
    const changes: { field: string; old: string | null; next: string | null }[] = [];
    (Object.keys(profile) as (keyof ProfileForm)[]).forEach(key => {
      if (key === 'user_type_id') return;
      if (!(key in u.raw)) return; // column not in this database
      const oldVal = u.raw[key] || '';
      const nextVal = profile[key].trim();
      if (oldVal !== nextVal) {
        updates[key] = nextVal || null;
        changes.push({ field: key, old: oldVal || null, next: nextVal || null });
      }
    });
    if (profile.user_type_id && profile.user_type_id !== u.userTypeId) {
      updates.user_type_id = profile.user_type_id;
      changes.push({
        field: 'role',
        old: u.userType,
        next: roles.find(r => r.id === profile.user_type_id)?.user_type || '',
      });
    }
    if (profile.aadhaar_number.trim() && !/^\d{12}$/.test(profile.aadhaar_number.trim())) {
      toast.error('Aadhaar must be 12 digits');
      return;
    }
    if (changes.length === 0) {
      toast('No profile changes to save');
      return;
    }
    askReason(`Save profile of ${u.username}`, async reason => {
      const { error } = await db().from('users').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', u.id);
      if (error) throw error;
      for (const c of changes) await logAudit(u, c.field, c.old, c.next, reason);
      toast.success('Profile saved');
      await refreshExpanded(u.id);
    });
  };

  const changeStatus = (u: UserRow, target: string) => {
    askReason(`Set ${u.username} to ${target}`, async reason => {
      const updates: Record<string, any> = {
        status: target,
        is_active: target === 'Active',
        updated_at: new Date().toISOString(),
      };
      const { error } = await db().from('users').update(updates).eq('id', u.id);
      if (error) throw error;
      // Unlocking clears the wrong-password count and lock, otherwise the next mistake locks it again
      if (target === 'Active') await rawSupabase.rpc('admin_unlock_user', { p_user_id: u.id });
      await logAudit(u, 'status', u.status, target, reason);
      toast.success(`User status updated to ${target}`);
      await refreshExpanded(u.id);
    });
  };

  const submitPasswordReset = () => {
    const u = passwordFor;
    if (!u) return;
    const temp = passwordText.trim();
    if (temp.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setPasswordFor(null);
    setPasswordText('');
    askReason(`Reset password of ${u.username}`, async reason => {
      // Set on the server; the person must choose their own at the next login, and any login of theirs ends
      await apiPost('/api/admin/users', { action: 'reset_password', user_id: u.id, password: temp, reason });
      toast.success(`Password reset. Temporary password: ${temp}. They must change it when they log in.`, { duration: 12000 });
      await refreshExpanded(u.id);
    });
  };

  const deleteUser = (u: UserRow) => {
    askReason(`Delete user ${u.username}`, async reason => {
      const { error } = await db().from('users').update({
        status: 'Deleted',
        is_active: false,
        deleted_by: getStaffName(),
        deleted_at: new Date().toISOString(),
        deletion_reason: reason,
      }).eq('id', u.id);
      if (error) throw error;
      await logAudit(u, 'status', u.status, 'Deleted', reason);
      toast.success('User deleted');
      if (expandedId === u.id) setExpandedId(null);
      await loadUsers();
    });
  };

  const restoreUser = (u: UserRow) => {
    askReason(`Restore user ${u.username}`, async reason => {
      const { error } = await db().from('users').update({
        status: 'Active',
        is_active: true,
        deleted_by: null,
        deleted_at: null,
        deletion_reason: null,
      }).eq('id', u.id);
      if (error) throw error;
      await logAudit(u, 'status', 'Deleted', 'Active', reason);
      toast.success('User restored');
      await loadUsers();
    });
  };

  // ─── Create user ───────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = newUser.username.trim();
    if (!username || !newUser.password) {
      toast.error('Username and password required');
      return;
    }
    if (newUser.password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      toast.error('This username already exists');
      return;
    }
    if (newUser.aadhaar_number.trim() && !/^\d{12}$/.test(newUser.aadhaar_number.trim())) {
      toast.error('Aadhaar must be 12 digits');
      return;
    }
    const roleName = newUser.is_admin ? 'Admin' : 'Operator';
    const roleId = roles.find(r => r.user_type === roleName)?.id;
    if (!roleId) {
      toast.error(`User type "${roleName}" not found`);
      return;
    }

    setLoading(true);
    try {
      const row: Record<string, any> = {
        username,
        user_type_id: roleId,
        email: newUser.email.trim() || `${username}@thirumala.com`,
        full_name: newUser.full_name.trim() || null,
        phone: newUser.phone.trim() || null,
        address: newUser.address.trim() || null,
        aadhaar_number: newUser.aadhaar_number.trim() || null,
        date_of_birth: newUser.date_of_birth || null,
        other_details: newUser.other_details.trim() || null,
        branch: newUser.branch.trim() || null,
        employee_id: newUser.employee_id.trim() || null,
        designation: newUser.designation.trim() || null,
        created_by: getStaffName(),
        status: 'Active',
        is_active: true,
      };

      // Created on the server: the password goes only to the login, never into the users table
      const { user: created } = await apiPost<{ user: any }>('/api/admin/users', { action: 'create', user: row, password: newUser.password });
      if (!created?.id) throw new Error('User was not created');

      const target = { id: created.id, username };
      if (!newUser.is_admin) {
        await writePermissions(target, emptyFeatures(), newUser.features, [], 'New user created');
      }
      await logAudit(target, 'user', null, `Created as ${roleName}`, 'New user created');

      toast.success(`Login Credentials Created!\n\nUsername: ${username}\nPassword: ${newUser.password}`, { duration: 12000 });
      setShowAddForm(false);
      setNewUser(emptyNewUser());
      await loadUsers();
      window.dispatchEvent(new Event('dashboard-refresh'));
    } catch (err: any) {
      toast.error(err.message || 'Error creating user');
    } finally {
      setLoading(false);
    }
  };

  const setNew = (field: string, value: any) => setNewUser(prev => ({ ...prev, [field]: value }));
  const setProf = (field: keyof ProfileForm, value: string) => setProfile(prev => ({ ...prev, [field]: value }));

  if (!user?.is_admin) {
    return <div className='p-8 text-center text-red-600 text-xl font-bold'>You are not authorized to view this page.</div>;
  }

  const active = users.filter(u => u.status !== 'Deleted');
  const admins = active.filter(u => u.is_admin);
  const others = active.filter(u => !u.is_admin);
  const deleted = users.filter(u => u.status === 'Deleted');

  // ─── One user card ─────────────────────────────────────────────────────────

  const renderCard = (u: UserRow) => {
    const isOpen = expandedId === u.id;
    const isSelf = u.username === user?.username;
    const isDeleted = u.status === 'Deleted';
    const shown = [...u.features.finance, ...u.features.regular, ...u.features.itr];
    const names = unique(u.features.finance.map(k => FINANCE_FEATURES.find(f => f.key === k)?.name || k).concat(
      [...u.features.regular, ...u.features.itr].map(k => REGULAR_FEATURES.find(f => f.key === k)?.name || k)
    ));
    return (
      <div
        key={u.id}
        className={`flex flex-col border rounded-xl shadow-md px-4 md:px-8 py-5 md:py-6 transition-shadow hover:shadow-lg bg-white w-full ${isOpen ? 'ring-2 ring-blue-200' : 'border-gray-200'}`}
      >
        <div className='flex items-center justify-between gap-4 cursor-pointer w-full' onClick={() => toggleCard(u)}>
          <div className='flex items-center gap-5 flex-1 min-w-0'>
            <div className='w-16 h-16 shrink-0 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-lg border-4 border-white'>
              {u.username.charAt(0).toUpperCase()}
            </div>
            <div className='flex flex-col min-w-0'>
              <div className='flex flex-wrap items-center gap-2 mb-2'>
                <span className='text-xl font-semibold text-blue-900 break-words'>{u.username}</span>
                {u.is_admin && (
                  <span className='inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-semibold'>
                    <Shield className='w-4 h-4' /> Admin
                  </span>
                )}
                {isRecentlyCreated(u.created_at) && (
                  <span className='inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full text-xs font-semibold'>
                    <Clock className='w-3 h-3' /> New
                  </span>
                )}
                {u.status !== 'Active' && (
                  <span className='inline-flex items-center gap-1 bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-semibold'>
                    <Lock className='w-3 h-3' /> {u.status}
                  </span>
                )}
              </div>
              <div className='flex flex-wrap gap-2 items-center'>
                {u.is_admin ? (
                  <span className='inline-block bg-gradient-to-r from-green-100 to-green-300 text-green-900 px-3 py-1 rounded-full text-xs font-semibold border border-green-200 shadow-sm'>
                    All Access (Admin)
                  </span>
                ) : shown.length === 0 ? (
                  <span className='inline-block bg-gray-100 text-gray-500 px-2 py-1 rounded-full text-xs font-medium border border-gray-200'>No access</span>
                ) : (
                  <>
                    {names.slice(0, 3).map(name => (
                      <span key={name} className='bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium border border-blue-200 shadow-sm'>
                        {name}
                      </span>
                    ))}
                    {names.length > 3 && (
                      <span className='bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs font-medium border border-blue-200'>+{names.length - 3} more</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className='flex flex-col items-end gap-2 shrink-0' onClick={e => e.stopPropagation()}>
            {isDeleted ? (
              <Button variant='secondary' size='sm' onClick={() => restoreUser(u)} disabled={loading}>
                Restore
              </Button>
            ) : (
              <Button variant='danger' size='sm' disabled={isSelf || loading} onClick={() => deleteUser(u)}>
                Delete
              </Button>
            )}
            <button
              type='button'
              className='text-gray-400 hover:text-blue-600 transition-colors'
              onClick={() => toggleCard(u)}
              aria-label={isOpen ? 'Collapse details' : 'Expand details'}
            >
              {isOpen ? <ChevronUp className='w-5 h-5' /> : <ChevronDown className='w-5 h-5' />}
            </button>
          </div>
        </div>

        {isOpen && expanded && (
          <div className='mt-4 pt-3 border-t border-gray-100'>
            <div className='flex flex-wrap gap-1 border-b border-gray-200 mb-4'>
              {([
                ['profile', 'Profile'],
                ['permissions', 'Permissions'],
                ['activity', 'Activity'],
                ['login_history', 'Login History'],
                ['audit', 'Audit Log'],
              ] as [TabKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type='button'
                  onClick={() => setTab(key)}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'profile' && (
              <div className='space-y-4'>
                <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'>
                  <Input label='Full Name' value={profile.full_name} onChange={v => setProf('full_name', v)} />
                  <Input label='Email' type='email' value={profile.email} onChange={v => setProf('email', v)} />
                  <Input label='Phone Number' type='tel' value={profile.phone} onChange={v => setProf('phone', v)} />
                  <Input label='Aadhaar Number' value={profile.aadhaar_number} onChange={v => setProf('aadhaar_number', v)} maxLength={12} />
                  <Input label='Date of Birth' type='date' value={profile.date_of_birth} onChange={v => setProf('date_of_birth', v)} />
                  <Input label='Address' value={profile.address} onChange={v => setProf('address', v)} />
                  <Input label='Branch' value={profile.branch} onChange={v => setProf('branch', v)} />
                  <Input label='Employee ID' value={profile.employee_id} onChange={v => setProf('employee_id', v)} />
                  <Input label='Designation' value={profile.designation} onChange={v => setProf('designation', v)} />
                  <div>
                    <label className='block text-sm font-medium text-gray-700 mb-1'>Role</label>
                    <select
                      value={profile.user_type_id}
                      onChange={e => setProf('user_type_id', e.target.value)}
                      disabled={isSelf}
                      className='w-full h-[42px] px-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
                    >
                      {roles.map(r => (
                        <option key={r.id} value={r.id}>{r.user_type}</option>
                      ))}
                    </select>
                  </div>
                  <div className='md:col-span-2'>
                    <label className='block text-sm font-medium text-gray-700 mb-1'>Other Personal Details</label>
                    <textarea
                      value={profile.other_details}
                      onChange={e => setProf('other_details', e.target.value)}
                      rows={2}
                      className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                    />
                  </div>
                </div>

                <div className='grid grid-cols-2 md:grid-cols-4 gap-3 text-sm bg-gray-50 rounded-lg p-3'>
                  <div><div className='text-xs text-gray-500'>Created</div><div className='font-medium text-gray-800'>{fmtDateTime(u.created_at)}</div></div>
                  <div><div className='text-xs text-gray-500'>Created By</div><div className='font-medium text-gray-800'>{u.raw.created_by || '-'}</div></div>
                  <div><div className='text-xs text-gray-500'>Last Login</div><div className='font-medium text-gray-800'>{fmtDateTime(u.raw.last_login)}</div></div>
                  <div><div className='text-xs text-gray-500'>Last Password Change</div><div className='font-medium text-gray-800'>{fmtDateTime(u.raw.last_password_change)}</div></div>
                </div>

                {!isDeleted && (
                  <div className='flex flex-wrap gap-2'>
                    <Button size='sm' onClick={() => saveProfile(u)} disabled={loading}>
                      <span className='inline-flex items-center gap-1'><Save className='w-4 h-4' /> Save Profile</span>
                    </Button>
                    <Button variant='secondary' size='sm' onClick={() => { setPasswordText(''); setPasswordFor(u); }} disabled={loading}>
                      <span className='inline-flex items-center gap-1'><Key className='w-4 h-4' /> Reset Password</span>
                    </Button>
                    {u.status === 'Active' ? (
                      <>
                        <Button variant='secondary' size='sm' disabled={isSelf || loading} onClick={() => changeStatus(u, 'Locked')}>
                          <span className='inline-flex items-center gap-1'><Lock className='w-4 h-4' /> Lock Account</span>
                        </Button>
                        <Button variant='secondary' size='sm' disabled={isSelf || loading} onClick={() => changeStatus(u, 'Suspended')}>
                          <span className='inline-flex items-center gap-1'><Ban className='w-4 h-4' /> Suspend</span>
                        </Button>
                        <Button variant='secondary' size='sm' disabled={isSelf || loading} onClick={() => changeStatus(u, 'Disabled')}>
                          <span className='inline-flex items-center gap-1'><X className='w-4 h-4' /> Disable</span>
                        </Button>
                      </>
                    ) : (
                      <Button variant='secondary' size='sm' disabled={loading} onClick={() => changeStatus(u, 'Active')}>
                        <span className='inline-flex items-center gap-1'>
                          {u.status === 'Locked' ? <Unlock className='w-4 h-4' /> : <RotateCcw className='w-4 h-4' />}
                          {u.status === 'Locked' ? 'Unlock Account' : 'Activate Account'}
                        </span>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'permissions' && (
              u.is_admin ? (
                <div className='text-blue-600 text-sm p-4 bg-blue-50 rounded border border-blue-200'>
                  Admin users have access to all features automatically. No need to select individual features.
                </div>
              ) : (
                <div className='space-y-3'>
                  <PermissionPicker
                    value={editFeatures}
                    onToggle={(m, k) => setEditFeatures(prev => toggleFeature(prev, m, k))}
                    disabled={isDeleted}
                  />
                  {u.oldFinanceKeys.length > 0 && (
                    <p className='text-xs text-gray-500'>
                      {u.oldFinanceKeys.length} older Finance permission(s) from the previous screen are kept as they are.
                    </p>
                  )}
                  {!isDeleted && (
                    <div className='flex flex-wrap items-center gap-2'>
                      <Button size='sm' onClick={() => savePermissions(u)} disabled={loading}>
                        <span className='inline-flex items-center gap-1'><Save className='w-4 h-4' /> Save Permissions</span>
                      </Button>
                      <select
                        value={copyFromId}
                        onChange={e => setCopyFromId(e.target.value)}
                        className='h-[38px] px-2 border border-gray-300 rounded-md bg-white text-sm'
                      >
                        <option value=''>Copy permissions from…</option>
                        {others.filter(x => x.id !== u.id).map(x => (
                          <option key={x.id} value={x.id}>{x.username}</option>
                        ))}
                      </select>
                      <Button variant='secondary' size='sm' onClick={copyPermissions} disabled={!copyFromId}>Copy</Button>
                    </div>
                  )}
                </div>
              )
            )}

            {tab === 'activity' && (
              <div className='space-y-3'>
                <div className='grid grid-cols-3 gap-3 text-center'>
                  <div className='p-3 bg-gray-50 border border-gray-200 rounded-lg'>
                    <div className='text-xs text-gray-500'>Login Count</div>
                    <div className='text-lg font-bold text-gray-800'>{u.raw.login_count || 0}</div>
                  </div>
                  <div className='p-3 bg-gray-50 border border-gray-200 rounded-lg'>
                    <div className='text-xs text-gray-500'>Failed Attempts</div>
                    <div className='text-lg font-bold text-gray-800'>{u.raw.failed_login_attempts || 0}</div>
                  </div>
                  <div className='p-3 bg-gray-50 border border-gray-200 rounded-lg'>
                    <div className='text-xs text-gray-500'>Last Active</div>
                    <div className='text-sm font-bold text-gray-800'>{fmtDateTime(u.raw.last_login)}</div>
                  </div>
                </div>
                {tabLoading ? (
                  <p className='text-center text-gray-500 py-4 text-sm'>Loading activity…</p>
                ) : tabRows.length === 0 ? (
                  <p className='text-center text-gray-500 py-4 text-sm'>No activity logged yet.</p>
                ) : (
                  tabRows.map(a => (
                    <div key={a.id} className='p-3 border border-gray-200 rounded-lg text-sm flex justify-between gap-4'>
                      <div className='min-w-0'>
                        <div className='font-semibold text-gray-800'>{a.activity_type}</div>
                        <p className='text-gray-600 break-words'>{a.description}</p>
                      </div>
                      <span className='text-gray-500 shrink-0'>{fmtDateTime(a.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'login_history' && (
              tabLoading ? (
                <p className='text-center text-gray-500 py-4 text-sm'>Loading login history…</p>
              ) : tabRows.length === 0 ? (
                <p className='text-center text-gray-500 py-4 text-sm'>No login records found.</p>
              ) : (
                <table className='fit-table fit-lg border border-gray-200'>
                  <thead className='bg-gray-50'>
                    <tr>
                      <th className='text-left'>Date &amp; Time</th>
                      <th className='text-left'>IP Address</th>
                      <th className='text-left'>Location</th>
                      <th className='text-left'>Device</th>
                      <th className='text-left'>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabRows.map(lh => (
                      <tr key={lh.id} className='border-t border-gray-100'>
                        <td className='fit-nowrap'>{fmtDateTime(lh.login_time)}</td>
                        <td className='fit-nowrap font-mono'>{lh.ip_address || '-'}</td>
                        <td>{lh.location || '-'}</td>
                        <td>{lh.os || 'Unknown'} / {lh.browser || 'Unknown'}</td>
                        <td className='fit-nowrap'>
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${lh.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {lh.success ? 'Success' : 'Failed'}
                          </span>
                          {!lh.success && lh.failure_reason ? ` ${lh.failure_reason}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {tab === 'audit' && (
              tabLoading ? (
                <p className='text-center text-gray-500 py-4 text-sm'>Loading audit log…</p>
              ) : tabRows.length === 0 ? (
                <p className='text-center text-gray-500 py-4 text-sm'>No administrative changes logged.</p>
              ) : (
                <table className='fit-table fit-lg border border-gray-200'>
                  <thead className='bg-gray-50'>
                    <tr>
                      <th className='text-left'>Date &amp; Time</th>
                      <th className='text-left'>Changed By</th>
                      <th className='text-left'>What Changed</th>
                      <th className='text-left'>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabRows.map(log => (
                      <tr key={log.id} className='border-t border-gray-100 align-top'>
                        <td className='fit-nowrap'>{fmtDateTime(log.created_at)}</td>
                        <td className='fit-nowrap font-semibold'>{log.changed_by || '-'}</td>
                        <td className='break-words'>
                          {describeAudit(log).map((line, i) => <div key={i}>{line}</div>)}
                        </td>
                        <td className='break-words text-gray-600'>{log.reason || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Page ──────────────────────────────────────────────────────────────────

  // Admins, or Finance users given the User Management permission
  if (user && !user.is_admin && !(Array.isArray(user.features) && user.features.includes('user_access_management'))) {
    return <Navigate to='/' replace />;
  }

  return (
    <div className='min-h-full bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col'>
      <div className='max-w-7xl w-full mx-auto py-8 px-4'>
        <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8'>
          <div>
            <div className='flex items-center gap-3 mb-1'>
              <h1 className='text-3xl font-bold text-gray-900'>User Management</h1>
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${MODE_BADGE[pageMode].pill}`}>
                <span className={`w-2 h-2 rounded-full ${MODE_BADGE[pageMode].dot}`} />
                {MODE_LABELS[pageMode]}
              </span>
            </div>
            <p className='text-gray-600'>Create login credentials and manage feature access for your organization members</p>
            <p className='text-gray-500 text-sm mt-2'>Permissions for Regular, ITR and Finance can all be given from here.</p>
            <div className='text-sm text-gray-500 mt-2'>
              Total Users: <span className='font-semibold text-gray-700'>{active.length}</span>
            </div>
          </div>
          {pageTab === 'users' && (<Button
            size='lg'
            className='bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg'
            onClick={() => setShowAddForm(v => !v)}
          >
            {showAddForm ? 'Close Add User' : 'Create Login Credentials'}
          </Button>)}
        </div>

        <div className='flex gap-2 mb-6 border-b border-gray-200'>
          {([['users', 'Users'], ['security', 'Login Security']] as const).map(([key, label]) => (
            <button
              key={key}
              type='button'
              onClick={() => openTab(key)}
              className={`px-4 py-2 -mb-px text-sm font-semibold border-b-2 ${pageTab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {pageTab === 'security' && (
          <LoginSecurityPanel key={securityShow || 'default'} initialTab={securityShow} onUsersChanged={() => loadUsers()} />
        )}

        {pageTab === 'users' && (<>

        {showAddForm && (
          <Card className='mb-8 p-0 overflow-visible'>
            <div className='bg-gradient-to-r from-blue-500 to-indigo-600 px-4 sm:px-8 py-4 sm:py-5 flex items-center gap-3 rounded-t-2xl'>
              <UserIcon className='w-7 h-7 sm:w-8 sm:h-8 text-white' />
              <h2 className='text-xl sm:text-2xl font-bold text-white flex-1'>Create Login Credentials</h2>
            </div>
            <form onSubmit={handleCreate} className='space-y-6 px-4 sm:px-10 py-6 sm:py-8'>
              <div className='bg-blue-50 border-l-4 border-blue-500 p-4 rounded'>
                <p className='text-sm text-blue-800'>
                  <strong>Note:</strong> Creating a user here will generate login credentials. The member can use the username and password to log in to the system.
                </p>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4'>
                <Input label='Full Name' value={newUser.full_name} onChange={v => setNew('full_name', v)} placeholder='Enter full name' />
                <Input label='Username (Login ID)' value={newUser.username} onChange={v => setNew('username', v)} placeholder='Enter username for login' required />
                <Input label='Password (Login Password)' password type='password' value={newUser.password} onChange={v => setNew('password', v)} placeholder='Enter password for login' required />
                <Input label='Email' type='email' value={newUser.email} onChange={v => setNew('email', v)} placeholder='Enter email address' />
                <Input label='Phone Number' type='tel' value={newUser.phone} onChange={v => setNew('phone', v)} placeholder='Enter phone number' />
                <Input label='Address' value={newUser.address} onChange={v => setNew('address', v)} placeholder='Enter address' />
                <Input label='Aadhaar Number' value={newUser.aadhaar_number} onChange={v => setNew('aadhaar_number', v)} placeholder='Enter Aadhaar number (12 digits)' maxLength={12} />
                <Input label='Date of Birth' type='date' value={newUser.date_of_birth} onChange={v => setNew('date_of_birth', v)} />
                <Input label='Branch' value={newUser.branch} onChange={v => setNew('branch', v)} placeholder='Enter branch' />
                <Input label='Employee ID' value={newUser.employee_id} onChange={v => setNew('employee_id', v)} placeholder='Enter employee ID' />
                <Input label='Designation' value={newUser.designation} onChange={v => setNew('designation', v)} placeholder='Enter designation' />
                <div className='md:col-span-2'>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>Other Personal Details</label>
                  <textarea
                    value={newUser.other_details}
                    onChange={e => setNew('other_details', e.target.value)}
                    placeholder='Enter any other personal details...'
                    rows={2}
                    className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                  />
                </div>
              </div>
              <label className='flex items-center gap-2 cursor-pointer select-none'>
                <input
                  type='checkbox'
                  checked={newUser.is_admin}
                  onChange={e => setNewUser(prev => ({ ...prev, is_admin: e.target.checked, features: e.target.checked ? emptyFeatures() : prev.features }))}
                  className='accent-blue-600 w-5 h-5'
                />
                <span className='text-blue-800 font-medium'>Admin (has access to all features)</span>
              </label>
              <div className='border-t border-blue-100' />
              <div>
                <div className='font-semibold mb-4 text-blue-800'>Feature Access by Mode</div>
                {newUser.is_admin ? (
                  <div className='text-blue-600 text-sm p-4 bg-blue-50 rounded border border-blue-200'>
                    Admin users have access to all features automatically. No need to select individual features.
                  </div>
                ) : (
                  <PermissionPicker
                    value={newUser.features}
                    onToggle={(m, k) => setNewUser(prev => ({ ...prev, features: toggleFeature(prev.features, m, k) }))}
                  />
                )}
              </div>
              <Button
                type='submit'
                disabled={loading}
                className='w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg text-base sm:text-lg py-2.5 sm:py-3'
              >
                {loading ? 'Creating Login Credentials...' : 'Create Login Credentials'}
              </Button>
            </form>
          </Card>
        )}

        <div className='flex flex-col gap-6'>
          {admins.length > 0 && (
            <div>
              <h2 className='text-xl font-bold text-gray-900 mb-4 flex items-center gap-2'>
                <Shield className='w-5 h-5 text-green-600' /> Admins ({admins.length})
              </h2>
              <div className='flex flex-col gap-4'>{admins.map(renderCard)}</div>
            </div>
          )}
          {others.length > 0 && (
            <div>
              <h2 className='text-xl font-bold text-gray-900 mb-4 flex items-center gap-2'>
                <UserIcon className='w-5 h-5 text-blue-600' /> Users ({others.length})
              </h2>
              <div className='flex flex-col gap-4'>{others.map(renderCard)}</div>
            </div>
          )}
          {deleted.length > 0 && (
            <div>
              <h2 className='text-xl font-bold text-gray-900 mb-4 flex items-center gap-2'>
                <Ban className='w-5 h-5 text-red-600' /> Deleted ({deleted.length})
              </h2>
              <div className='flex flex-col gap-4'>{deleted.map(renderCard)}</div>
            </div>
          )}
        </div>
        </>)}
      </div>

      {/* Reset password box */}
      {passwordFor && (
        <div className='fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4'>
          <div className='bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4'>
            <h3 className='text-lg font-bold text-gray-900'>Reset password of {passwordFor.username}</h3>
            <Input label={`New temporary password (min ${MIN_PASSWORD} characters)`} password type='password' value={passwordText} onChange={setPasswordText} />
            <div className='flex justify-end gap-2'>
              <Button variant='secondary' onClick={() => setPasswordFor(null)}>Cancel</Button>
              <Button onClick={submitPasswordReset}>Continue</Button>
            </div>
          </div>
        </div>
      )}

      {/* Reason box: every change is recorded in the audit log with this reason */}
      {reasonPrompt && (
        <div className='fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4'>
          <div className='bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4'>
            <h3 className='text-lg font-bold text-gray-900'>{reasonPrompt.title}</h3>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-1'>Reason *</label>
              <textarea
                value={reasonText}
                onChange={e => setReasonText(e.target.value)}
                rows={3}
                autoFocus
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                placeholder='Why is this change being made?'
              />
            </div>
            <div className='flex justify-end gap-2'>
              <Button variant='secondary' onClick={() => setReasonPrompt(null)}>Cancel</Button>
              <Button onClick={confirmReason}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
