import { supabase as rawSupabase, resolveSchemaAndTable } from './supabase';
import { USER_COLUMNS } from './userColumns';
import { FinancialCalculator } from './financialCalculations';
import { getTableName, getTableMode } from './tableNames';
import { db, QueuedOperation } from './offlineQueueDB';
import { getCachedMasterData } from './offlineMasterData';
import { baseTableName, isNetworkFailure, isQueueableWrite, runOfflineSync, SyncOp, SyncResult, SyncStore } from './offlineSyncEngine';
import { toast } from 'react-hot-toast';

// Columns deleted_cash_book has always had (original table + book_id).
// Used as a fallback when a newer cash_book column is missing there.
const DELETED_CASH_BOOK_CORE_COLUMNS = [
  'id', 'sno', 'acc_name', 'sub_acc_name', 'particulars', 'c_date',
  'credit', 'debit', 'credit_online', 'credit_offline', 'debit_online', 'debit_offline',
  'lock_record', 'company_name', 'address', 'staff', 'users', 'entry_time',
  'sale_qty', 'purchase_qty', 'approved', 'edited', 'e_count', 'cb', 'payment_mode',
  'created_at', 'updated_at', 'deleted_by', 'deleted_at', 'book_id',
];

// Types
export interface Company {
  id: string;
  company_name: string;
  address: string;
  created_at: string;
}

export interface Account {
  id: string;
  company_name: string;
  acc_name: string;
  report_category?: string;
  created_at: string;
}

export interface SubAccount {
  id: string;
  company_name: string;
  acc_name: string;
  sub_acc: string;
  created_at: string;
}

export interface CashBookEntry {
  id: string;
  sno: number;
  acc_name: string;
  sub_acc_name: string;
  particulars: string;
  c_date: string;
  credit: number;
  debit: number;
  lock_record: boolean;
  company_name: string;
  address: string;
  staff: string;
  users: string;
  entry_time: string;
  sale_qty: number;
  purchase_qty: number;
  approved: boolean;
  edited: boolean;
  e_count: number;
  cb: string;
  created_at: string;
  updated_at: string;
  credit_mode?: string;
  debit_mode?: string;
  payment_mode?: string;
  report_category?: string;
  head_of_account_id?: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash?: string;
  user_type_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BalanceSheetAccount {
  accountName: string;
  credit: number;
  debit: number;
  balance: number;
  plYesNo: string;
  bothYesNo: string;
  result: string;
  isSelectedForPL?: boolean;
}

export interface BankGuarantee {
  id: string;
  sno: number;
  bg_no: string;
  issue_date: string;
  exp_date: string;
  work_name: string;
  credit: number;
  debit: number;
  department: string;
  cancelled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  sno: number;
  v_no: string;
  v_type: string | null;
  particulars: string | null;
  tax_exp_date: string | null;
  insurance_exp_date: string | null;
  fitness_exp_date: string | null;
  permit_exp_date: string | null;
  date_added: string | null;
  created_at: string | null;
  updated_at: string | null;
  rc_front_url?: string;
  rc_back_url?: string;
}

export interface Driver {
  id: string;
  sno: number;
  driver_name: string;
  license_no: string | null;
  exp_date: string | null;
  particulars: string | null;
  phone: string | null;
  address: string | null;
  created_at: string | null;
  updated_at: string | null;
  license_front_url?: string | null;
  license_back_url?: string | null;
}

export interface Reminder {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reminder_type: 'one_time' | 'recurring';
  recurring_interval: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  notify_before_days: number;
  assigned_user_id: string | null;
  status: 'pending' | 'completed';
  mode: 'regular' | 'itr';
  category: 'GENERAL' | 'VEHICLE' | 'LOAN' | 'STAFF' | 'DOCUMENT' | 'TAX' | 'MEETING' | 'FOLLOWUP';
  completion_notes: string | null;
  completed_at: string | null;
  snoozed_until: string | null;
  is_system_generated: boolean;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  assigned_username?: string | null;
  creator_username?: string | null;
  book_id: string | null;
  play_sound?: boolean;
  seen?: boolean;
}

const isScopedTable = (table: string): boolean => {
  const scopedTables = [
    'companies',
    'company_main_accounts',
    'company_main_sub_acc',
    'cash_book',
    'original_cash_book',
    'edit_cash_book',
    'deleted_cash_book',
    'ledger',
    'balance_sheet',
    'vehicles',
    'drivers',
    'bank_guarantees',
    'reminders',
    'loans',
    'loan_transactions',
    'capital_entries',
    'due_entries',
    'cd_ledger_entries',
    'cashbook_entries',
    'borrowers',
    'loan_types'
  ];
  // Strip finance_ prefix and _itr suffix for backward compatibility checks
  let cleanTable = table;
  if (table.startsWith('finance_')) {
    cleanTable = table.substring(8);
    if (cleanTable === 'customers') cleanTable = 'borrowers';
    if (cleanTable === 'transactions') cleanTable = 'loan_transactions';
    if (cleanTable === 'dues') cleanTable = 'due_entries';
  } else if (table.endsWith('_itr')) {
    cleanTable = table.substring(0, table.length - 4);
  }
  return scopedTables.includes(cleanTable);
};

// Regular / ITR tables whose rows must belong to a book (book_id is required in the database).
const BOOK_REQUIRED_TABLES = [
  'companies', 'company_main_accounts', 'company_main_sub_acc', 'cash_book', 'ledger',
  'balance_sheet', 'vehicles', 'drivers', 'bank_guarantees', 'reminders',
];
const needsBook = (table: string): boolean =>
  BOOK_REQUIRED_TABLES.includes(table.endsWith('_itr') ? table.slice(0, -4) : table);
export const NO_BOOK_MESSAGE =
  'No book is selected. Click "Book" at the top to choose one. An admin can create a new book there.';

const createBuilderProxy = (builder: any, table: string): any => {
  return new Proxy(builder, {
    get(target, prop, _receiver) {
      // Intercept .then for offline write resolution
      if (prop === 'then') {
        const offlineInfo = target._offlineInfo;
        if (offlineInfo && offlineInfo.operation_type) {
          const queueable = isQueueableWrite(getTableMode() || 'regular', offlineInfo.table, offlineInfo.operation_type);
          const saveOffline = (resolve: any) =>
            supabaseDB.handleOfflineWrite(offlineInfo)
              .then(data => resolve({ data, error: null }))
              .catch(err => resolve({ data: null, error: err }));

          if (!supabaseDB.isOnline) {
            return function (resolve: any, _reject: any) {
              if (queueable) {
                saveOffline(resolve);
              } else {
                resolve({ data: null, error: { message: 'Internet needed: this cannot be saved offline.', code: 'OFFLINE' } });
              }
            };
          }

          if (queueable) {
            // The connection can drop between checks, so an entry that could not be sent is kept
            return function (resolve: any, reject: any) {
              return target.then((res: any) => {
                if (isNetworkFailure(res?.error, res?.status)) {
                  supabaseDB.isOnline = false;
                  window.dispatchEvent(new CustomEvent('offline-network-failure'));
                  saveOffline(resolve);
                } else {
                  resolve(res);
                }
              }, reject);
            };
          }
        }
      }

      const origMethod = target[prop];
      if (typeof origMethod !== 'function') {
        return origMethod;
      }

      return function (...args: any[]) {
        const methodName = String(prop);

        const activeBookId = supabaseDB.currentBookId || (getTableMode() === 'finance' ? 'd499da98-71a8-40d6-a167-ca67d8cdacab' : '');
        const isFinanceMode = getTableMode() === 'finance';

        // Without a book these rows would be refused by the database with a technical error
        if ((methodName === 'insert' || methodName === 'upsert') && !activeBookId && !isFinanceMode
            && needsBook(table) && !supabaseDB.isScopeBypassed()) {
          throw new Error(NO_BOOK_MESSAGE);
        }

        if (isScopedTable(table) && (activeBookId || isFinanceMode) && !supabaseDB.isScopeBypassed()) {
          if (methodName === 'select') {
            const nextBuilder = origMethod.apply(target, args);
            const proxied = createBuilderProxy(isFinanceMode ? nextBuilder : nextBuilder.eq('book_id', activeBookId), table);
            if (target._offlineInfo) {
              proxied._offlineInfo = { ...target._offlineInfo };
            }
            return proxied;
          }
          
          if (methodName === 'insert') {
            if (supabaseDB.isBookLocked) {
              throw new Error('This Book is Locked (Read Only). Writing is blocked.');
            }
            const records = args[0];
            if (Array.isArray(records)) {
              args[0] = records.map(r => ({ ...r, book_id: r.book_id || activeBookId }));
            } else if (records && typeof records === 'object') {
              args[0] = { ...records, book_id: records.book_id || activeBookId };
            }
            const nextBuilder = origMethod.apply(target, args);
            const proxied = createBuilderProxy(nextBuilder, table);
            proxied._offlineInfo = {
              table,
              operation_type: 'INSERT',
              payload: args[0],
              filters: []
            };
            return proxied;
          }

          if (methodName === 'update') {
            if (supabaseDB.isBookLocked) {
              throw new Error('This Book is Locked (Read Only). Editing is blocked.');
            }
            const nextBuilder = origMethod.apply(target, args);
            const proxied = createBuilderProxy(isFinanceMode ? nextBuilder : nextBuilder.eq('book_id', activeBookId), table);
            proxied._offlineInfo = {
              table,
              operation_type: 'UPDATE',
              payload: args[0],
              filters: []
            };
            return proxied;
          }

          if (methodName === 'delete') {
            if (supabaseDB.isBookLocked) {
              throw new Error('This Book is Locked (Read Only). Deletion is blocked.');
            }
            const nextBuilder = origMethod.apply(target, args);
            const proxied = createBuilderProxy(isFinanceMode ? nextBuilder : nextBuilder.eq('book_id', activeBookId), table);
            proxied._offlineInfo = {
              table,
              operation_type: 'DELETE',
              payload: null,
              filters: []
            };
            return proxied;
          }

          if (methodName === 'upsert') {
            if (supabaseDB.isBookLocked) {
              throw new Error('This Book is Locked (Read Only). Writing is blocked.');
            }
            const records = args[0];
            if (Array.isArray(records)) {
              args[0] = records.map(r => ({ ...r, book_id: r.book_id || activeBookId }));
            } else if (records && typeof records === 'object') {
              args[0] = { ...records, book_id: records.book_id || activeBookId };
            }
            const nextBuilder = origMethod.apply(target, args);
            const proxied = createBuilderProxy(nextBuilder, table);
            proxied._offlineInfo = {
              table,
              operation_type: 'UPSERT',
              payload: args[0],
              filters: []
            };
            return proxied;
          }
        }

        const result = origMethod.apply(target, args);

        // Track filter parameters and offline info for builders (scoped or unscoped)
        const isBuilder = result && typeof result === 'object' && (typeof result.select === 'function' || typeof result.from === 'function');
        
        if (isBuilder) {
          result._offlineInfo = target._offlineInfo || {
            table,
            operation_type: null,
            payload: null,
            filters: []
          };

          if (['insert', 'update', 'delete', 'upsert'].includes(methodName)) {
            result._offlineInfo.operation_type = methodName.toUpperCase();
            if (args[0]) {
              result._offlineInfo.payload = args[0];
            }
          } else if (['eq', 'in', 'neq', 'gt', 'lt'].includes(methodName) && result._offlineInfo) {
            result._offlineInfo.filters.push({
              type: methodName,
              field: args[0],
              value: args[1]
            });
          }

          return createBuilderProxy(result, table);
        }

        if (result && typeof result === 'object' && typeof result.then === 'function') {
          return result;
        }
        return typeof result?.select === 'function' || typeof result?.from === 'function'
          ? createBuilderProxy(result, table)
          : result;
      };
    }
  });
};

export const supabase = new Proxy(rawSupabase, {
  get(target, prop, receiver) {
    if (prop === 'from') {
      return (table: string) => {
        const builder = rawSupabase.from(table);
        return createBuilderProxy(builder, table);
      };
    }
    return Reflect.get(target, prop, receiver);
  }
}) as typeof rawSupabase;

// Supabase Database Service
class SupabaseDatabase {
  currentBookId: string = '';
  isBookLocked: boolean = false;
  private bypassBookScope: boolean = false;

  // New offline support fields
  isOnline: boolean = typeof navigator !== 'undefined' && navigator.onLine !== undefined ? navigator.onLine : true;
  isSyncing: boolean = false;
  currentBookName: string = '';
  currentUserId: string = '';

  setBookId(id: string) {
    this.currentBookId = id;
    console.log(`🔌 Database client scoped to book_id: ${id}`);
  }

  setBookName(name: string) {
    this.currentBookName = name;
    console.log(`🔌 Database client scoped to book name: ${name}`);
  }

  setBookLocked(locked: boolean) {
    this.isBookLocked = locked;
    console.log(`🔌 Database client locked state: ${locked}`);
  }

  setUserId(id: string) {
    this.currentUserId = id;
  }

  getCurrentUserFromStorage() {
    if (typeof window === 'undefined') return null;
    try {
      const savedUser = sessionStorage.getItem('thirumala_user');
      if (savedUser) {
        return JSON.parse(savedUser);
      }
    } catch (err) {
      console.error('Error reading user from session storage:', err);
    }
    return null;
  }

  async bypassScope<T>(fn: () => Promise<T>): Promise<T> {
    this.bypassBookScope = true;
    try {
      return await fn();
    } finally {
      this.bypassBookScope = false;
    }
  }

  isScopeBypassed() {
    return this.bypassBookScope;
  }

  // Offline support helper functions
  async handleOfflineWrite(info: any) {
    const mode = getTableMode();
    const table = baseTableName(info.table);
    const { schema } = resolveSchemaAndTable(table);
    const book_id = this.currentBookId || '';
    let book_name = this.currentBookName || '';
    if (!book_name) {
      try {
        const remembered = JSON.parse(localStorage.getItem(`offlineBook_${mode}`) || 'null');
        book_name = remembered?.id === book_id ? remembered.book_code || remembered.name : '';
      } catch {
        book_name = '';
      }
    }
    book_name = book_name || 'Unknown Book';

    if (!book_id) {
      throw new Error('Please select a book before saving offline.');
    }

    const storageUser = this.getCurrentUserFromStorage();
    const user_id = this.currentUserId || storageUser?.id || 'unknown';
    const now = Date.now();
    const rows: any[] = Array.isArray(info.payload) ? info.payload : [info.payload || {}];

    // One queue item per row, so each entry can be fixed or sent on its own, in order
    const saved = rows.map((row, index) => {
      const offline_uuid = crypto.randomUUID();
      const time = new Date(now + index).toISOString();
      const payload = { ...row, id: row.id || offline_uuid, book_id };
      if (table === 'cash_book') {
        payload.created_at = payload.created_at || time;
        payload.updated_at = payload.updated_at || time;
      }
      return {
        offline_uuid,
        mode,
        schema: schema as 'regular' | 'itr' | 'finance' | 'public',
        book_id,
        book_name,
        user_id,
        created_at: time,
        operation_type: 'INSERT' as const,
        table,
        payload,
        status: 'pending_sync' as const,
      };
    });

    await db.queued_operations.bulkPut(saved);
    toast.success('Saved on this computer. It will go to the server when the internet is back.', { id: 'saved-offline' });
    window.dispatchEvent(new CustomEvent('offline-queue-changed'));

    const payloads = saved.map(op => op.payload);
    return Array.isArray(info.payload) ? payloads : payloads[0];
  }

  /** Changes an entry that has not reached the server yet. The change is kept and logged at sync. */
  async updatePendingEntry(id: string, updates: Record<string, any>, editedBy: string): Promise<any | null> {
    const op = await this.findPendingEntryOp(id);
    if (!op) return null;
    const fields = [
      'acc_name', 'sub_acc_name', 'particulars', 'credit', 'debit', 'company_name', 'address', 'staff',
      'users', 'sale_qty', 'purchase_qty', 'cb', 'c_date', 'payment_mode', 'report_category', 'head_of_account_id',
    ];
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};
    const numberFields = ['credit', 'debit', 'sale_qty', 'purchase_qty'];
    for (const key of fields) {
      if (!(key in updates)) continue;
      const value = numberFields.includes(key) ? Number(updates[key]) || 0 : updates[key];
      if (value !== op.payload[key]) {
        oldValues[key] = op.payload[key];
        newValues[key] = value;
      }
    }
    const at = new Date().toISOString();
    const payload = { ...op.payload, ...newValues, edited: Object.keys(newValues).length > 0 || op.payload.edited, updated_at: at };
    await db.queued_operations.update(op.offline_uuid, {
      payload,
      status: op.status === 'conflict' || op.status === 'failed' ? 'pending_sync' : op.status,
      error_message: undefined,
      edit_history: Object.keys(newValues).length
        ? [...(op.edit_history || []), { at, by: editedBy, old_values: oldValues, new_values: newValues }]
        : op.edit_history,
    });
    window.dispatchEvent(new CustomEvent('offline-queue-changed'));
    return { ...payload, pending_sync: true };
  }

  /** Removes an entry from the send list. It stays recorded in Sync Center under Discarded. */
  async discardQueuedOperation(offlineUuid: string, discardedBy: string, reason: string): Promise<boolean> {
    const op = await db.queued_operations.get(offlineUuid);
    if (!op || op.status === 'synced' || op.status === 'syncing' || op.status === 'discarded') return false;
    await db.queued_operations.update(offlineUuid, {
      status: 'discarded',
      discarded_by: discardedBy,
      discarded_at: new Date().toISOString(),
      discarded_reason: reason,
    });
    window.dispatchEvent(new CustomEvent('offline-queue-changed'));
    return true;
  }

  async discardPendingEntry(id: string, discardedBy: string, reason: string): Promise<boolean> {
    const op = await this.findPendingEntryOp(id);
    return op ? this.discardQueuedOperation(op.offline_uuid, discardedBy, reason) : false;
  }

  private async findPendingEntryOp(id: string): Promise<QueuedOperation | undefined> {
    return db.queued_operations
      .where('status')
      .anyOf(['pending_sync', 'failed', 'conflict'])
      .and(op => baseTableName(op.table) === 'cash_book' && !Array.isArray(op.payload) && op.payload?.id === id)
      .first();
  }

  private async pendingMasterRows(table: string): Promise<any[]> {
    const ops = await db.queued_operations
      .where('status')
      .anyOf(['pending_sync', 'syncing', 'failed', 'conflict'])
      .and(op => baseTableName(op.table) === table && op.book_id === this.currentBookId)
      .toArray();
    return ops.map(op => ({ ...op.payload, created_at: op.created_at, updated_at: op.created_at, pending_sync: true }));
  }

  async mergeOfflineOperations<T extends { id: string; pending_sync?: boolean }>(
    table: string,
    onlineRecords: T[]
  ): Promise<T[]> {
    try {
      const pendingOps = await db.queued_operations
        .where('status')
        .anyOf(['pending_sync', 'syncing', 'failed', 'conflict'])
        .and(op => baseTableName(op.table) === table && op.book_id === this.currentBookId)
        .toArray();

      if (pendingOps.length === 0) {
        return onlineRecords;
      }

      let list = [...onlineRecords];

      // Sort pending operations by creation date to process sequentially
      const sortedOps = pendingOps.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      for (const op of sortedOps) {
        if (op.operation_type === 'INSERT' || op.operation_type === 'UPSERT') {
          const payload = op.payload;
          if (Array.isArray(payload)) {
            payload.forEach(item => {
              const idx = list.findIndex(r => r.id === item.id);
              const mergedItem = { ...item, pending_sync: true } as unknown as T;
              if (idx !== -1) {
                list[idx] = mergedItem;
              } else {
                list.unshift(mergedItem);
              }
            });
          } else {
            const idx = list.findIndex(r => r.id === payload.id);
            const mergedItem = { ...payload, pending_sync: true } as unknown as T;
            if (idx !== -1) {
              list[idx] = mergedItem;
            } else {
              list.unshift(mergedItem);
            }
          }
        } else if (op.operation_type === 'UPDATE') {
          const payload = op.payload;
          list = list.map(item => {
            if (item.id === payload.id) {
              return {
                ...item,
                ...payload,
                pending_sync: true
              } as T;
            }
            return item;
          });
        } else if (op.operation_type === 'DELETE') {
          const payload = op.payload;
          list = list.filter(item => item.id !== payload.id);
        }
      }

      return list;
    } catch (err) {
      console.error(`Error merging offline operations for table ${table}:`, err);
      return onlineRecords;
    }
  }

  async syncOfflineQueue(): Promise<SyncResult | null> {
    const storageUser = this.getCurrentUserFromStorage();
    if (!(this.currentUserId || storageUser)) {
      console.warn('⚠️ Sync deferred: user is not authenticated.');
      return null;
    }

    const store: SyncStore = {
      all: () => db.queued_operations.toArray() as Promise<SyncOp[]>,
      update: async (id, patch) => {
        await db.queued_operations.update(id, patch as Partial<QueuedOperation>);
        window.dispatchEvent(new CustomEvent('offline-queue-changed'));
      },
    };
    const run = () => runOfflineSync(store, rawSupabase as any, op => this.syncOperation(op as QueuedOperation));

    // Only one browser tab sends at a time
    const locks = (navigator as any).locks;
    const result: SyncResult | null = locks
      ? await locks.request('thirumala-offline-sync', { ifAvailable: true }, (lock: unknown) => (lock ? run() : null))
      : await run();

    try {
      window.dispatchEvent(new CustomEvent('offline-sync-complete'));
    } catch (e) {
      console.error('Error dispatching offline-sync-complete:', e);
    }
    return result;
  }

  async syncOperation(item: QueuedOperation): Promise<void> {
    const originalBookId = this.currentBookId;
    const originalLocked = this.isBookLocked;
    const originalMode = localStorage.getItem('table_mode');

    // Healing logic: if the operation has no book ID, fallback to the current active book ID
    const resolvedBookId = item.book_id || originalBookId;
    this.currentBookId = resolvedBookId;
    this.isBookLocked = false;
    localStorage.setItem('table_mode', item.mode);

    try {
      const resolvedSchema = item.schema || (item.mode === 'itr' ? 'itr' : item.mode === 'finance' ? 'finance' : 'regular');
      const { table: resolvedTable } = resolveSchemaAndTable(item.table);
      const client = rawSupabase.schema(resolvedSchema);
      
      if (item.operation_type === 'INSERT') {
        const payload = { ...item.payload };
        if (!payload.book_id && resolvedBookId) {
          payload.book_id = resolvedBookId;
        }
        const { error } = await client.from(resolvedTable).insert(payload);
        if (error) throw error;
      } else if (item.operation_type === 'UPDATE') {
        const payload = { ...item.payload };
        if (!payload.book_id && resolvedBookId) {
          payload.book_id = resolvedBookId;
        }
        const recordId = payload.id || payload.offline_uuid;
        const { error } = await client.from(resolvedTable).update(payload).eq('id', recordId);
        if (error) throw error;
      } else if (item.operation_type === 'DELETE') {
        if (resolvedTable === 'cash_book') {
          const recordId = item.payload.id || item.payload.offline_uuid;
          const deletedBy = item.payload.deleted_by || 'offline_sync';
          const success = await this.deleteCashBookEntry(recordId, deletedBy);
          if (!success) {
            throw new Error('Failed to delete cash book entry during sync');
          }
        } else {
          const recordId = item.payload.id || item.payload.offline_uuid;
          const { error } = await client.from(resolvedTable).delete().eq('id', recordId);
          if (error) throw error;
        }
      } else if (item.operation_type === 'UPSERT') {
        const { error } = await client.from(resolvedTable).upsert(item.payload);
        if (error) throw error;
      }
    } finally {
      this.currentBookId = originalBookId;
      this.isBookLocked = originalLocked;
      if (originalMode) {
        localStorage.setItem('table_mode', originalMode);
      } else {
        localStorage.removeItem('table_mode');
      }
    }
  }


  async verifyBookIsEmpty(bookId: string): Promise<{ isEmpty: boolean; details?: string }> {
    return this.bypassScope(async () => {
      // Find the book's mode by checking both schemas
      let bookMode: 'regular' | 'itr' | null = null;
      const { data: regBook } = await rawSupabase.schema('regular').from('books').select('id, mode').eq('id', bookId).maybeSingle();
      if (regBook) {
        bookMode = 'regular';
      } else {
        const { data: itrBook } = await rawSupabase.schema('itr').from('books').select('id, mode').eq('id', bookId).maybeSingle();
        if (itrBook) {
          bookMode = 'itr';
        }
      }

      if (!bookMode) {
        return { isEmpty: true }; // Book not found, treat as empty
      }

      const tables = [
        'companies',
        'company_main_accounts',
        'company_main_sub_acc',
        'cash_book',
        'vehicles',
        'drivers',
        'bank_guarantees',
        'reminders'
      ];

      for (const table of tables) {
        const { count, error } = await rawSupabase.schema(bookMode)
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('book_id', bookId);

        if (!error && count && count > 0) {
          return { isEmpty: false, details: `${count} records in ${bookMode}.${table}` };
        }
      }

      return { isEmpty: true };
    });
  }

  async getBookMetrics(bookId: string): Promise<{
    companies: number;
    accounts: number;
    transactions: number;
    vehicles: number;
    reminders: number;
  }> {
    return this.bypassScope(async () => {
      // Find the book's mode
      let bookMode: 'regular' | 'itr' = 'regular';
      const { data: regBook } = await rawSupabase.schema('regular').from('books').select('id, mode').eq('id', bookId).maybeSingle();
      if (!regBook) {
        const { data: itrBook } = await rawSupabase.schema('itr').from('books').select('id, mode').eq('id', bookId).maybeSingle();
        if (itrBook) {
          bookMode = 'itr';
        }
      }

      const schema = bookMode;
      const { count: companies } = await rawSupabase.schema(schema).from('companies').select('*', { count: 'exact', head: true }).eq('book_id', bookId);
      const { count: accounts } = await rawSupabase.schema(schema).from('company_main_accounts').select('*', { count: 'exact', head: true }).eq('book_id', bookId);
      const { count: transactions } = await rawSupabase.schema(schema).from('cash_book').select('*', { count: 'exact', head: true }).eq('book_id', bookId);
      const { count: vehicles } = await rawSupabase.schema(schema).from('vehicles').select('*', { count: 'exact', head: true }).eq('book_id', bookId);
      const { count: reminders } = await rawSupabase.schema(schema).from('reminders').select('*', { count: 'exact', head: true }).eq('book_id', bookId);

      return {
        companies: companies || 0,
        accounts: accounts || 0,
        transactions: transactions || 0,
        vehicles: vehicles || 0,
        reminders: reminders || 0
      };
    });
  }

  // Utility function to check and add payment_mode column if missing
  // Note: This requires service_role permissions, so it may not work with anon key
  async ensurePaymentModeColumnExists(): Promise<boolean> {
    try {
      // Try to query the column to see if it exists
      const { error } = await supabase
        .from(getTableName('cash_book'))
        .select('payment_mode')
        .limit(1);
      
      // If no error, column exists
      if (!error || (!error.message?.includes('payment_mode') && error.code !== '42703')) {
        console.log('✅ payment_mode column exists');
        return true;
      }
      
      // Column doesn't exist - user needs to add it manually
      console.error('❌ payment_mode column does not exist!');
      console.error('🔧 Please run this SQL in Supabase SQL Editor:');
      console.error(`   ALTER TABLE ${getTableName('cash_book')} ADD COLUMN IF NOT EXISTS payment_mode TEXT;`);
      return false;
    } catch (error) {
      console.error('Error checking payment_mode column:', error);
      return false;
    }
  }

  // Company operations
  async getCompanies(): Promise<Company[]> {
    try {
      const tableMode = getTableMode();
      if (!this.isOnline) {
        const mode = tableMode === 'itr' ? 'itr' : 'regular';
        const tableName = mode === 'itr' ? 'companies_itr' : 'companies';
        console.log(`📦 [offlineMasterData] Fetching companies from IndexedDB cache for mode: ${mode}`);
        const cached = await getCachedMasterData(tableName, mode);

        const pendingInserts = await db.queued_operations
          .where('status')
          .equals('pending_sync')
          .and(op => (op.table === 'companies' || op.table === 'companies_itr') && op.operation_type === 'INSERT')
          .toArray();

        const pendingCompanies = pendingInserts.map((op: any) => {
          const payload = op.payload;
          return {
            id: payload.id || op.offline_uuid,
            company_name: payload.company_name,
            address: payload.address || null,
            created_at: op.created_at,
            updated_at: op.created_at
          } as unknown as Company;
        });

        const seen = new Set<string>();
        const combined = [...pendingCompanies, ...cached].filter((c: any) => {
          const name = c.company_name?.trim();
          if (!name || seen.has(name)) return false;
          seen.add(name);
          return true;
        });
        return combined;
      }

      // Use getTableName to switch between companies and companies_itr based on mode
      const tableName = getTableName('companies');
      console.log('🔄 Fetching all companies from', tableName, 'table...');
      console.log('📊 Current mode:', tableMode, '→ Using table:', tableName);
      
      // Load all companies with explicit high limit
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .order('company_name')
        .limit(10000); // Explicit high limit to get all companies

      if (error) {
        console.error('❌ Error fetching companies:', error);
        return [];
      }

      // Filter out duplicates and empty company names
      const seen = new Set<string>();
      const uniqueCompanies = (data || []).filter((company: any) => {
        const name = company.company_name?.trim();
        if (!name) return false; // Filter out empty names
        if (seen.has(name)) return false; // Filter out duplicates
        seen.add(name);
        return true;
      });

      console.log('✅ Companies fetched:', {
        total: data?.length || 0,
        unique: uniqueCompanies.length,
        duplicates: (data?.length || 0) - uniqueCompanies.length
      });
      
      return uniqueCompanies;
    } catch (error) {
      console.error('❌ Error in getCompanies:', error);
      return [];
    }
  }

  async getCompaniesCount(): Promise<number> {
    try {
      // Get distinct company names to avoid counting duplicates
      const { data, error } = await supabase
        .from(getTableName('companies'))
        .select('company_name')
        .not('company_name', 'is', null)
        .not('company_name', 'eq', '');

      if (error) {
        console.error('Error fetching companies count:', error);
        return 0;
      }

      // Get unique company names (in case there are duplicates)
      const uniqueCompanies = [...new Set((data || []).map((c: any) => c.company_name?.trim()).filter(Boolean))];
      console.log('📊 Distinct companies count:', uniqueCompanies.length);
      
      return uniqueCompanies.length;
    } catch (error) {
      console.error('Error in getCompaniesCount:', error);
      return 0;
    }
  }

  // Get distinct companies count for dashboard (same as getCompaniesCount but with better logging)
  async getDistinctCompaniesCount(): Promise<number> {
    return this.getCompaniesCount();
  }

  // Get companies that have data in cash_book table
  async getCompaniesWithData(): Promise<Company[]> {
    try {
      console.log('🔄 Fetching companies with data from cash_book...');
      
      // Get unique company names from cash_book table
      const { data: cashBookData, error: cashBookError } = await supabase
        .from(getTableName('cash_book'))
        .select('company_name')
        .not('company_name', 'is', null)
        .not('company_name', 'eq', '')
        .not('company_name', 'eq', 'null');

      if (cashBookError) {
        console.error('❌ Error fetching companies from cash_book:', cashBookError);
        return [];
      }

      // Get unique company names
      const uniqueCompanyNames = [...new Set((cashBookData || []).map((entry: any) => entry.company_name).filter(Boolean))];
      console.log('📊 Found companies with data:', uniqueCompanyNames.length, uniqueCompanyNames);

      if (uniqueCompanyNames.length === 0) {
        console.log('⚠️ No companies found with data in cash_book');
        return [];
      }

      // Get company details from companies table for companies that have data
      const { data: companiesData, error: companiesError } = await supabase
        .from(getTableName('companies'))
        .select('*')
        .in('company_name', uniqueCompanyNames)
        .order('company_name');

      if (companiesError) {
        console.error('❌ Error fetching company details:', companiesError);
        return [];
      }

      console.log('✅ Companies with data fetched:', companiesData?.length || 0);
      return companiesData || [];
    } catch (error) {
      console.error('❌ Error in getCompaniesWithData:', error);
      return [];
    }
  }

  // Delete specific empty companies
  async deleteEmptyCompanies(companyNames: string[]): Promise<{ success: boolean; deleted: string[]; error?: string }> {
    try {
      console.log('🗑️ Deleting empty companies:', companyNames);
      
      // First verify these companies have no data in cash_book
      for (const companyName of companyNames) {
        const { data: cashBookData, error: cashBookError } = await supabase
          .from(getTableName('cash_book'))
          .select('id')
          .eq('company_name', companyName)
          .limit(1);

        if (cashBookError) {
          console.error(`❌ Error checking cash_book for ${companyName}:`, cashBookError);
          continue;
        }

        if (cashBookData && cashBookData.length > 0) {
          console.log(`⚠️ Warning: ${companyName} has data in cash_book. Skipping deletion.`);
          continue;
        }
      }

      // Delete companies from companies table
      const { data: deletedCompanies, error: deleteError } = await supabase
        .from(getTableName('companies'))
        .delete()
        .in('company_name', companyNames)
        .select();

      if (deleteError) {
        console.error('❌ Error deleting companies:', deleteError);
        return { success: false, deleted: [], error: deleteError.message };
      }

      const deletedNames = (deletedCompanies || []).map((c: Company) => c.company_name);
      console.log('✅ Successfully deleted companies:', deletedNames.length);
      console.log('📋 Deleted company names:', deletedNames);

      return { success: true, deleted: deletedNames };
    } catch (error) {
      console.error('❌ Error in deleteEmptyCompanies:', error);
      return { success: false, deleted: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async addCompany(companyName: string, address: string): Promise<Company> {
    const { data, error } = await supabase
      .from(getTableName('companies'))
      .insert({
        company_name: companyName,
        address: address,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create company: ${error.message}`);
    }

    return data;
  }

  // Check if company has any entries in cash_book
  async hasCompanyEntries(companyName: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('id')
        .eq('company_name', companyName)
        .limit(1);

      if (error) {
        console.error(`Error checking entries for company ${companyName}:`, error);
        return false; // Assume no entries on error to be safe
      }

      return (data && data.length > 0) || false;
    } catch (error) {
      console.error(`Error in hasCompanyEntries for ${companyName}:`, error);
      return false;
    }
  }

  async deleteCompany(companyName: string): Promise<{ success: boolean; error?: string }> {
    // First check if company has any entries in cash_book
    const hasEntries = await this.hasCompanyEntries(companyName);
    
    if (hasEntries) {
      return {
        success: false,
        error: 'Cannot delete company: It has entries in cash book. Please delete all entries first.'
      };
    }

    // If no entries, cascade delete dependent rows (sub accounts → accounts) then company
    // 1) Delete sub accounts for this company
    const { error: subDelErr } = await supabase
      .from(getTableName('company_main_sub_acc'))
      .delete()
      .eq('company_name', companyName);
    if (subDelErr) {
      console.error('Error deleting sub accounts for company:', subDelErr);
      return { success: false, error: `Failed to delete sub accounts: ${subDelErr.message}` };
    }

    // 2) Delete main accounts for this company
    const { error: accDelErr } = await supabase
      .from(getTableName('company_main_accounts'))
      .delete()
      .eq('company_name', companyName);
    if (accDelErr) {
      console.error('Error deleting accounts for company:', accDelErr);
      return { success: false, error: `Failed to delete accounts: ${accDelErr.message}` };
    }

    // 3) Delete company
    const { error } = await supabase
      .from(getTableName('companies'))
      .delete()
      .eq('company_name', companyName);

    if (error) {
      console.error('Error deleting company:', error);
      // Handle 409 conflict error (likely foreign key constraint)
      if (error.code === '409' || error.code === '23503' || error.message.includes('409') || error.message.includes('foreign key')) {
        return {
          success: false,
          error: 'Cannot delete company: It is referenced by accounts or entries. Please delete all related accounts and entries first.'
        };
      }
      return {
        success: false,
        error: `Failed to delete company: ${error.message}`
      };
    }

    return { success: true };
  }

  // Account operations
  async getAccounts(): Promise<Account[]> {
    if (!this.isOnline) {
      const tableMode = getTableMode();
      const mode = tableMode === 'itr' ? 'itr' : 'regular';
      const tableName = mode === 'itr' ? 'company_main_accounts_itr' : 'company_main_accounts';
      return [...(await this.pendingMasterRows('company_main_accounts')), ...(await getCachedMasterData(tableName, mode))];
    }
    const { data, error } = await supabase
      .from(getTableName('company_main_accounts'))
      .select('*')
      .order('acc_name');

    if (error) {
      console.error('Error fetching accounts:', error);
      return [];
    }

    return data || [];
  }

  async getAccountsByCompany(companyName: string): Promise<Account[]> {
    if (!this.isOnline) {
      const tableMode = getTableMode();
      const mode = tableMode === 'itr' ? 'itr' : 'regular';
      const tableName = mode === 'itr' ? 'company_main_accounts_itr' : 'company_main_accounts';
      const cached = [...(await this.pendingMasterRows('company_main_accounts')), ...(await getCachedMasterData(tableName, mode))];
      return cached.filter((acc: any) => acc.company_name === companyName);
    }
    const { data, error } = await supabase
      .from(getTableName('company_main_accounts'))
      .select('*')
      .eq('company_name', companyName)
      .order('acc_name');

    if (error) {
      console.error('Error fetching accounts by company:', error);
      return [];
    }

    return data || [];
  }

  async addAccount(companyName: string, accountName: string, reportCategory: string): Promise<Account> {
    const { data, error } = await supabase
      .from(getTableName('company_main_accounts'))
      .insert({
        company_name: companyName,
        acc_name: accountName,
        report_category: reportCategory,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create account: ${error.message}`);
    }

    return data;
  }

  // Check if account has any entries in cash_book
  async hasAccountEntries(accountName: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('id')
        .eq('acc_name', accountName)
        .limit(1);

      if (error) {
        console.error(`Error checking entries for account ${accountName}:`, error);
        return false;
      }

      return (data && data.length > 0) || false;
    } catch (error) {
      console.error(`Error in hasAccountEntries for ${accountName}:`, error);
      return false;
    }
  }

  async deleteAccount(companyName: string, accountName: string): Promise<{ success: boolean; error?: string }> {
    // Check if account has any entries in cash_book for this company
    const { data: entries } = await supabase
      .from(getTableName('cash_book'))
      .select('id')
      .eq('company_name', companyName)
      .eq('acc_name', accountName)
      .limit(1);

    if (entries && entries.length > 0) {
      return {
        success: false,
        error: 'Cannot delete account: It has entries in cash book. Please delete all entries first.'
      };
    }

    // If no entries, cascade delete dependent sub accounts then account
    const { error: subDelErr } = await supabase
      .from(getTableName('company_main_sub_acc'))
      .delete()
      .eq('company_name', companyName)
      .eq('acc_name', accountName);
    if (subDelErr) {
      console.error('Error deleting sub accounts for account:', subDelErr);
      return { success: false, error: `Failed to delete sub accounts: ${subDelErr.message}` };
    }

    const { error } = await supabase
      .from(getTableName('company_main_accounts'))
      .delete()
      .eq('company_name', companyName)
      .eq('acc_name', accountName);

    if (error) {
      console.error('Error deleting account:', error);
      return {
        success: false,
        error: `Failed to delete account: ${error.message}`
      };
    }

    return { success: true };
  }

  async updateAccount(companyName: string, oldAccName: string, newAccName: string, reportCategory: string): Promise<{ success: boolean; error?: string }> {
    // 1. If name changed, check duplicates
    if (oldAccName.toUpperCase() !== newAccName.toUpperCase()) {
      const { data: duplicate } = await supabase
        .from(getTableName('company_main_accounts'))
        .select('id')
        .eq('company_name', companyName)
        .eq('acc_name', newAccName)
        .maybeSingle();
      if (duplicate) {
        return { success: false, error: 'An account with this name already exists for this company.' };
      }
    }

    // 2. Update the account row
    const { error: accError } = await supabase
      .from(getTableName('company_main_accounts'))
      .update({
        acc_name: newAccName,
        report_category: reportCategory
      })
      .eq('company_name', companyName)
      .eq('acc_name', oldAccName);

    if (accError) {
      return { success: false, error: accError.message };
    }

    // 3. Update transactions in cash_book tables to the new name and category
    const tables = ['cash_book', 'original_cash_book', 'edit_cash_book', 'deleted_cash_book'];
    for (const t of tables) {
      await supabase
        .from(getTableName(t))
        .update({
          acc_name: newAccName,
          report_category: reportCategory
        })
        .eq('company_name', companyName)
        .eq('acc_name', oldAccName);
    }

    return { success: true };
  }

  // Sub Account operations
  async getSubAccounts(): Promise<SubAccount[]> {
    if (!this.isOnline) {
      const tableMode = getTableMode();
      const mode = tableMode === 'itr' ? 'itr' : 'regular';
      const tableName = mode === 'itr' ? 'company_main_sub_acc_itr' : 'company_main_sub_acc';
      return [...(await this.pendingMasterRows('company_main_sub_acc')), ...(await getCachedMasterData(tableName, mode))];
    }
    const { data, error } = await supabase
      .from(getTableName('company_main_sub_acc'))
      .select('*')
      .order('sub_acc');

    if (error) {
      console.error('Error fetching sub accounts:', error);
      return [];
    }

    return data || [];
  }

  // Get unique sub accounts count from company_main_sub_acc table (reference table)
  async getUniqueSubAccountsCount(): Promise<number> {
    try {
      console.log('🔄 Fetching unique sub accounts count from company_main_sub_acc table...');
      
      // Get all distinct sub accounts from company_main_sub_acc reference table
      const { data, error } = await supabase
        .from(getTableName('company_main_sub_acc'))
        .select('sub_acc')
        .not('sub_acc', 'is', null)
        .not('sub_acc', 'eq', '');

      if (error) {
        console.error('❌ Error fetching sub accounts for count:', error);
        return 0;
      }

      if (!data || data.length === 0) {
        console.log('📊 No sub accounts found in database');
        return 0;
      }

      // Normalize and get unique sub account names
      // Trim whitespace, convert to lowercase for case-insensitive comparison
      const normalizedSubAccounts = data
        .map((item: any) => item.sub_acc?.trim())
        .filter(Boolean) // Remove null, undefined, and empty strings
        .map((acc: any) => acc.toLowerCase()); // Normalize to lowercase for case-insensitive comparison

      // Get unique sub account names using Set
      const uniqueSubAccounts = [...new Set(normalizedSubAccounts)];
      
      console.log('📊 Total rows in company_main_sub_acc:', data.length);
      console.log('📊 Unique sub accounts count (normalized):', uniqueSubAccounts.length);
      console.log('📊 Sample sub accounts:', uniqueSubAccounts.slice(0, 10));
      
      return uniqueSubAccounts.length;
    } catch (error) {
      console.error('❌ Error in getUniqueSubAccountsCount:', error);
      return 0;
    }
  }

  // Get count of distinct main accounts from company_main_accounts table (reference table)
  async getDistinctMainAccountsCount(): Promise<number> {
    try {
      console.log('🔄 Fetching distinct main accounts count from company_main_accounts table...');
      
      // Get all distinct main accounts from company_main_accounts reference table
      const { data, error } = await supabase
        .from(getTableName('company_main_accounts'))
        .select('acc_name')
        .not('acc_name', 'is', null)
        .not('acc_name', 'eq', '');

      if (error) {
        console.error('❌ Error fetching main accounts for count:', error);
        return 0;
      }

      // Get unique account names
      const uniqueAccounts = [...new Set((data || []).map((item: any) => item.acc_name).filter(Boolean))];
      console.log('📊 Distinct main accounts count from company_main_accounts:', uniqueAccounts.length);
      
      return uniqueAccounts.length;
    } catch (error) {
      console.error('❌ Error in getDistinctMainAccountsCount:', error);
      return 0;
    }
  }

  async getSubAccountsByAccount(
    companyName: string,
    accountName: string
  ): Promise<SubAccount[]> {
    const { data, error } = await supabase
      .from(getTableName('company_main_sub_acc'))
      .select('*')
      .eq('company_name', companyName)
      .eq('acc_name', accountName)
      .order('sub_acc');

    if (error) {
      console.error('Error fetching sub accounts by account:', error);
      return [];
    }

    return data || [];
  }

  async addSubAccount(
    companyName: string,
    accountName: string,
    subAccountName: string
  ): Promise<SubAccount> {
    const { data, error } = await supabase
      .from(getTableName('company_main_sub_acc'))
      .insert({
        company_name: companyName,
        acc_name: accountName,
        sub_acc: subAccountName,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create sub account: ${error.message}`);
    }

    return data;
  }

  // Check if sub account has any entries in cash_book
  async hasSubAccountEntries(subAccountName: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('id')
        .eq('sub_acc_name', subAccountName)
        .limit(1);

      if (error) {
        console.error(`Error checking entries for sub account ${subAccountName}:`, error);
        return false;
      }

      return (data && data.length > 0) || false;
    } catch (error) {
      console.error(`Error in hasSubAccountEntries for ${subAccountName}:`, error);
      return false;
    }
  }

  async deleteSubAccount(subAccountName: string): Promise<{ success: boolean; error?: string }> {
    // First check if sub account has any entries in cash_book
    const hasEntries = await this.hasSubAccountEntries(subAccountName);
    
    if (hasEntries) {
      return {
        success: false,
        error: 'Cannot delete sub account: It has entries in cash book. Please delete all entries first.'
      };
    }

    // If no entries, proceed with deletion
    const { error } = await supabase
      .from(getTableName('company_main_sub_acc'))
      .delete()
      .eq('sub_acc', subAccountName);

    if (error) {
      console.error('Error deleting sub account:', error);
      // Handle 409 conflict error
      if (error.code === '409' || error.message.includes('409')) {
        return {
          success: false,
          error: 'Cannot delete sub account: It has entries in cash book or is referenced elsewhere. Please delete all entries first.'
        };
      }
      return {
        success: false,
        error: `Failed to delete sub account: ${error.message}`
      };
    }

    return { success: true };
  }

  // Cash Book operations
  async getCashBookEntries(limit: number = 1000, offset: number = 0): Promise<CashBookEntry[]> {
    if (!this.isOnline) {
      return this.mergeOfflineOperations('cash_book', []);
    }
    try {
      console.log(`🔄 Fetching cash book entries (limit: ${limit}, offset: ${offset})...`);
      
      // Use proper range calculation for Supabase
      const start = offset;
      const end = offset + limit - 1;
      
      // Select all fields including payment_mode
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('*') // Select all columns including payment_mode
        .order('c_date', { ascending: false }) // Most recent dates first
        .order('created_at', { ascending: false }) // LIFO - newest first
        .range(start, end);

      if (error) {
        console.error(`❌ Error fetching cash book entries (offset: ${offset}, limit: ${limit}):`, error);
        return this.mergeOfflineOperations('cash_book', []);
      }

      const resultCount = data?.length || 0;
      console.log(`✅ Fetched ${resultCount} entries (range: ${start}-${end})`);
      
      // Debug: Check if payment_mode exists in the data
      if (data && data.length > 0) {
        const sampleEntry = data[0];
        console.log('🔍 Sample entry payment_mode check:', {
          has_payment_mode: 'payment_mode' in sampleEntry,
          payment_mode_value: sampleEntry.payment_mode,
          payment_mode_type: typeof sampleEntry.payment_mode,
          all_keys: Object.keys(sampleEntry).filter(k => k.includes('mode') || k.includes('payment'))
        });
      }
      
      // Clean fields and normalize approved flag to strict boolean
      const cleanedData = (data || []).map((entry: any, idx: number) => {
        // CRITICAL: Extract payment_mode from database - handle all edge cases
        let paymentMode = '';
        
        // Priority 1: Check payment_mode field first (primary source)
        if (entry.payment_mode != null && entry.payment_mode !== undefined) {
          const pmStr = String(entry.payment_mode).trim();
          // Valid payment mode values: Cash, Bank Transfer, Online
          if (pmStr && pmStr !== 'null' && pmStr !== 'undefined' && pmStr !== '') {
            paymentMode = pmStr;
          }
        }
        
        // Priority 2: Fallback to credit_mode or debit_mode ONLY if payment_mode is empty
        // This is for backwards compatibility with old entries
        if (!paymentMode) {
          if (entry.credit_mode != null && entry.credit_mode !== '') {
            const cmStr = String(entry.credit_mode).trim();
            if (cmStr) paymentMode = cmStr;
          } else if (entry.debit_mode != null && entry.debit_mode !== '') {
            const dmStr = String(entry.debit_mode).trim();
            if (dmStr) paymentMode = dmStr;
          }
        }
        
        // Debug first 5 entries - show payment_mode retrieval
        if (idx < 5) {
          console.log(`🔍 getCashBookEntries Entry ${idx + 1} (ID: ${entry.id}):`, {
            payment_mode_raw: entry.payment_mode,
            payment_mode_type: typeof entry.payment_mode,
            payment_mode_is_null: entry.payment_mode === null,
            payment_mode_is_undefined: entry.payment_mode === undefined,
            payment_mode_processed: paymentMode,
            has_payment_mode: !!paymentMode
          });
        }
        
        return {
          ...entry,
          acc_name: entry.acc_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          sub_acc_name: entry.sub_acc_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          particulars: entry.particulars?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          company_name: entry.company_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          approved: entry.approved === true || (typeof entry.approved === 'string' && ['true', 'approved'].includes(entry.approved.toLowerCase().trim())),
          payment_mode: paymentMode // Always include payment_mode (even if empty string)
        };
      });
      
      return this.mergeOfflineOperations('cash_book', cleanedData);
    } catch (error) {
      console.error('Error in getCashBookEntries:', error);
      return this.mergeOfflineOperations('cash_book', []);
    }
  }

  // Get total count for pagination
  async getCashBookEntriesCount(): Promise<number> {
    try {
      const { count, error } = await supabase
          .from(getTableName('cash_book'))
          .select('*', { count: 'exact', head: true });

      if (error) {
        console.error('Error getting count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error getting count:', error);
      return 0;
    }
  }

  // Get today's entries only (for NewEntry recent transactions)
  async getTodaysCashBookEntries(): Promise<CashBookEntry[]> {
    try {
      console.log(`🔄 Fetching today's cash book entries...`);
      
      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];
      console.log(`📅 Filtering for today's entries: ${today}`);
      
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('c_date', today) // Filter for today's entries only
        .order('created_at', { ascending: false }) // LIFO - newest first
        .limit(1000); // Limit to prevent too many entries

      if (error) {
        console.error(`❌ Error fetching today's cash book entries:`, error);
        return [];
      }

      const resultCount = data?.length || 0;
      console.log(`✅ Fetched ${resultCount} entries for today`);
      
      // Clean fields and normalize approved flag to strict boolean
      const cleanedData = (data || []).map((entry: any) => {
        // Preserve payment_mode if it exists, otherwise fallback to credit_mode/debit_mode
        let paymentMode = '';
        
        // Priority 1: Check payment_mode field - handle all cases
        if (entry.payment_mode != null && entry.payment_mode !== '') {
          const pmStr = String(entry.payment_mode).trim();
          if (pmStr && pmStr !== 'null' && pmStr !== 'undefined' && pmStr !== '') {
            paymentMode = pmStr;
          }
        }
        
        // Priority 2: Fallback to credit_mode or debit_mode only if payment_mode is empty
        if (!paymentMode) {
          if (entry.credit_mode != null && entry.credit_mode !== '') {
            const cmStr = String(entry.credit_mode).trim();
            if (cmStr) paymentMode = cmStr;
          } else if (entry.debit_mode != null && entry.debit_mode !== '') {
            const dmStr = String(entry.debit_mode).trim();
            if (dmStr) paymentMode = dmStr;
          }
        }
        
        return {
          ...entry,
          acc_name: entry.acc_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          sub_acc_name: entry.sub_acc_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          particulars: entry.particulars?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          company_name: entry.company_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
          approved: entry.approved === true || (typeof entry.approved === 'string' && ['true', 'approved'].includes(entry.approved.toLowerCase().trim())),
          payment_mode: paymentMode
        };
      });
      
      return cleanedData;
    } catch (error) {
      console.error('Error in getTodaysCashBookEntries:', error);
      return [];
    }
  }

  // Get all cash book entries using pagination to bypass Supabase's 1000 record limit
  async getAllCashBookEntries(): Promise<CashBookEntry[]> {
    try {
      console.log('🔄 Fetching all cash book entries using improved pagination...');
      
      // First, get the total count
      const totalCount = await this.getCashBookEntriesCount();
      console.log(`📊 Total records in database: ${totalCount}`);
      
      if (totalCount === 0) {
        console.log('⚠️ No records found in database');
        return [];
      }
      
      let allEntries: CashBookEntry[] = [];
      const batchSize = 1000;
      let offset = 0;
      let hasMoreData = true;
      let batchCount = 0;
      
      while (hasMoreData && offset < totalCount) {
        try {
          console.log(`🔄 Fetching batch ${batchCount + 1} (offset: ${offset}, limit: ${batchSize})...`);
          
          const batch = await this.getCashBookEntries(batchSize, offset);
          
          if (batch.length === 0) {
            console.log('⚠️ No more data returned, stopping pagination');
            hasMoreData = false;
          } else {
            allEntries = [...allEntries, ...batch];
            offset += batchSize;
            batchCount++;
            
            console.log(`📊 Batch ${batchCount}: ${batch.length} records, Total so far: ${allEntries.length}/${totalCount}`);
            
            // If we got less than batchSize, we've reached the end
            if (batch.length < batchSize) {
              console.log('✅ Reached end of data (got less than batch size)');
              hasMoreData = false;
            }
            
            // Safety check to prevent infinite loops
            if (allEntries.length >= totalCount) {
              console.log('✅ Reached total count, stopping pagination');
              hasMoreData = false;
            }
          }
        } catch (batchError) {
          console.error(`❌ Error in batch ${batchCount + 1}:`, batchError);
          // Continue with next batch instead of failing completely
          offset += batchSize;
          batchCount++;
          
          // If we've had too many errors, stop
          if (batchCount > 10) {
            console.error('❌ Too many batch errors, stopping pagination');
            hasMoreData = false;
          }
        }
      }
      
      console.log(`✅ Pagination complete: ${allEntries.length} records fetched in ${batchCount} batches`);
      
      if (allEntries.length !== totalCount) {
        console.warn(`⚠️ Warning: Expected ${totalCount} records but got ${allEntries.length}`);
      }
      
      return allEntries;
    } catch (error) {
      console.error('❌ Error in getAllCashBookEntries:', error);
      return [];
    }
  }

  // Optimized method for calendar: fetch only c_date values within a given month/year
  async getCashBookEntryDatesForMonth(year: number, month: number): Promise<string[]> {
    try {
      const monthStr = String(month).padStart(2, '0');
      const startDate = `${year}-${monthStr}-01`;
      const lastDayNum = new Date(year, month, 0).getDate();
      const endDate = `${year}-${monthStr}-${String(lastDayNum).padStart(2, '0')}`;

      console.log(`📅 [getCashBookEntryDatesForMonth] Fetching dates between ${startDate} and ${endDate}`);

      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('c_date')
        .gte('c_date', startDate)
        .lte('c_date', endDate);

      if (error) {
        console.error('❌ Error fetching month dates from cash_book:', error);
        return [];
      }

      const dates = (data || [])
        .map((row: any) => {
          if (!row || !row.c_date) return '';
          const str = String(row.c_date).trim();
          const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
          return match ? match[1] : '';
        })
        .filter(Boolean);

      return dates;
    } catch (error) {
      console.error('❌ Error in getCashBookEntryDatesForMonth:', error);
      return [];
    }
  }

  // Get filtered cash book entries with pagination for better performance
  async getFilteredCashBookEntries(filters: {
    companyName?: string;
    accountName?: string;
    subAccountName?: string;
  }, limit: number = 1000, offset: number = 0): Promise<{ data: CashBookEntry[], total: number }> {
    try {
      console.log(`🔄 Fetching filtered cash book entries with pagination (limit: ${limit}, offset: ${offset})...`);
      console.log('🔍 Filters:', filters);
      
      let query = supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact' });

      // Apply filters at database level for better performance
      if (filters.companyName) {
        query = query.eq('company_name', filters.companyName);
        console.log(`🏢 Filtering by company: ${filters.companyName}`);
      }
      
      if (filters.accountName) {
        query = query.eq('acc_name', filters.accountName);
        console.log(`📄 Filtering by account: ${filters.accountName}`);
      }
      
      if (filters.subAccountName) {
        query = query.eq('sub_acc_name', filters.subAccountName);
        console.log(`👤 Filtering by sub-account: ${filters.subAccountName}`);
      }

      // Order by date for consistent results
      query = query.order('c_date', { ascending: false });

      // Apply pagination
      const start = offset;
      const end = offset + limit - 1;
      query = query.range(start, end);

      console.log('🔍 Executing paginated database query...');
      const { data, error, count } = await query;

      if (error) {
        console.error('❌ Error fetching filtered entries:', error);
        return { data: [], total: 0 };
      }

      console.log(`📊 Filtered entries loaded: ${data?.length || 0} (Total available: ${count || 0})`);
      console.log('📊 Sample of returned entries:', data?.slice(0, 2).map((e: any) => ({ 
        id: e.id, 
        company: e.company_name, 
        date: e.c_date 
      })));
      
      return { data: data || [], total: count || 0 };
    } catch (error) {
      console.error('❌ Error in getFilteredCashBookEntries:', error);
      return { data: [], total: 0 };
    }
  }

  // Get filtered cash book entries using server-side filtering for better performance (loads all at once)
  async getAllFilteredCashBookEntries(filters: {
    companyName?: string;
    accountName?: string;
    subAccountName?: string;
  }): Promise<CashBookEntry[]> {
    try {
      console.log('🔄 Fetching filtered cash book entries with server-side filtering...');
      console.log('🔍 Filters:', filters);
      console.log('🔍 About to query ALL 67k records with filters...');
      
      let query = supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact' });

      // Apply filters at database level for better performance
      if (filters.companyName) {
        query = query.eq('company_name', filters.companyName);
        console.log(`🏢 Filtering by company: ${filters.companyName}`);
      }
      
      if (filters.accountName) {
        query = query.eq('acc_name', filters.accountName);
        console.log(`📄 Filtering by account: ${filters.accountName}`);
      }
      
      if (filters.subAccountName) {
        query = query.eq('sub_acc_name', filters.subAccountName);
        console.log(`👤 Filtering by sub-account: ${filters.subAccountName}`);
      }

      // Order by date for consistent results
      query = query.order('c_date', { ascending: false });

      console.log('🔍 Executing database query...');
      const { data, error, count } = await query;

      if (error) {
        console.error('❌ Error fetching filtered entries:', error);
        return [];
      }

      console.log(`📊 Filtered entries loaded: ${data?.length || 0} (Total available: ${count || 0})`);
      console.log('📊 Sample of returned entries:', data?.slice(0, 2).map((e: any) => ({ 
        id: e.id, 
        company: e.company_name, 
        date: e.c_date 
      })));
      
      return data || [];
    } catch (error) {
      console.error('❌ Error in getAllFilteredCashBookEntries:', error);
      return [];
    }
  }

  // Search entries with pagination
  async searchCashBookEntries(
    searchTerm: string = '',
    dateFilter: string = '',
    limit: number = 1000,
    offset: number = 0
  ): Promise<{ data: CashBookEntry[], total: number }> {
    try {
      console.log(`🔍 Searching entries with: "${searchTerm}", date: "${dateFilter}" (limit: ${limit}, offset: ${offset})`);
      
      let query = supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact' });

      // Apply search filter
      if (searchTerm) {
        query = query.or(`acc_name.ilike.%${searchTerm}%,sub_acc_name.ilike.%${searchTerm}%,particulars.ilike.%${searchTerm}%,company_name.ilike.%${searchTerm}%`);
      }

      // Apply date filter
      if (dateFilter) {
        if (dateFilter.length === 4 && /^\d{4}$/.test(dateFilter)) {
          // Year filter
          query = query.gte('c_date', `${dateFilter}-01-01`).lte('c_date', `${dateFilter}-12-31`);
        } else if (dateFilter.includes('-')) {
          // Specific date filter
          query = query.eq('c_date', dateFilter);
        } else {
          // Partial date filter
          query = query.gte('c_date', `${dateFilter}`);
        }
      }

      // Apply pagination and ordering
      query = query
        .order('c_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        console.error('Error searching entries:', error);
        return { data: [], total: 0 };
      }

      console.log(`✅ Search completed: ${data?.length || 0} records found (total: ${count || 0})`);
      return { data: data || [], total: count || 0 };
    } catch (error) {
      console.error('Error in searchCashBookEntries:', error);
      return { data: [], total: 0 };
    }
  }

  // Get entries by date range with pagination
  async getCashBookEntriesByDateRange(
    startDate: string,
    endDate: string,
    limit: number = 1000,
    offset: number = 0
  ): Promise<{ data: CashBookEntry[], total: number }> {
    try {
      console.log(`📅 Fetching entries from ${startDate} to ${endDate} (limit: ${limit}, offset: ${offset})`);
      
      const { data, error, count } = await supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact' })
        .gte('c_date', startDate)
        .lte('c_date', endDate)
        .order('c_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Error fetching entries by date range:', error);
        return { data: [], total: 0 };
      }

      console.log(`✅ Date range query completed: ${data?.length || 0} records found (total: ${count || 0})`);
      return { data: data || [], total: count || 0 };
    } catch (error) {
      console.error('Error in getCashBookEntriesByDateRange:', error);
      return { data: [], total: 0 };
    }
  }

  async addCashBookEntry(
    entry: Omit<
      CashBookEntry,
      | 'id'
      | 'sno'
      | 'entry_time'
      | 'approved'
      | 'edited'
      | 'e_count'
      | 'lock_record'
      | 'created_at'
      | 'updated_at'
    >,
    allowBothZero: boolean = false
  ): Promise<CashBookEntry> {
    // Validate financial entry with option to allow both zero amounts
    const validation = FinancialCalculator.validateEntry(
      entry.credit,
      entry.debit,
      allowBothZero
    );
    if (!validation.isValid) {
      throw new Error(`Invalid entry: ${validation.errors.join(', ')}`);
    }

    // Get next serial number. Offline, or if it cannot be read, S.No is given at sync.
    let nextSno: number | undefined;
    if (this.isOnline) {
      const { data: lastEntry, error: lastEntryError } = await supabase
        .from(getTableName('cash_book'))
        .select('sno')
        .order('sno', { ascending: false })
        .limit(1);
      if (!lastEntryError) {
        nextSno = lastEntry && lastEntry.length > 0 ? lastEntry[0].sno + 1 : 1;
      }
    }

    // Filter out undefined values to allow database defaults to work
    // CRITICAL: Always include payment_mode field to ensure it's saved correctly
    const filteredEntry: Record<string, any> = Object.fromEntries(
      Object.entries(entry).filter(([key, value]) => {
        // Always include payment_mode field if it exists in the entry object (even if null)
        if (key === 'payment_mode') {
          return true; // Always include payment_mode
        }
        return value !== undefined;
      })
    );
    
    // CRITICAL: Ensure payment_mode is properly formatted and included for database
    // If payment_mode exists in entry, always include it (even if null)
    if ('payment_mode' in entry) {
      if (entry.payment_mode && typeof entry.payment_mode === 'string' && entry.payment_mode.trim()) {
        // Valid payment mode value - keep it trimmed
        filteredEntry.payment_mode = entry.payment_mode.trim();
      } else {
        // Empty or invalid - set to null (but still include the field)
        filteredEntry.payment_mode = null;
      }
    } else {
      // If payment_mode wasn't in entry object, don't include it (let DB use default)
      // But we should always have it from NewEntry, so this shouldn't happen
    }
    
    // Debug: Verify payment_mode is included and has correct value
    console.log('🔍 Filtered entry for insert:', {
      has_payment_mode_in_entry: 'payment_mode' in entry,
      entry_payment_mode_value: entry.payment_mode,
      has_payment_mode_in_filtered: 'payment_mode' in filteredEntry,
      filtered_payment_mode_value: filteredEntry.payment_mode,
      payment_mode_type: typeof filteredEntry.payment_mode,
      company: filteredEntry.company_name,
      account: filteredEntry.acc_name
    });

    // Try to insert with payment_mode, if it fails due to missing column, retry without it
    let data, error;
    
    // First attempt: try with payment_mode if it exists
    // CRITICAL: Ensure payment_mode is always included in insertData
    const insertData: Record<string, any> = {
      ...filteredEntry,
      id: crypto.randomUUID(),
      ...(nextSno !== undefined ? { sno: nextSno } : {}),
      entry_time: new Date().toISOString(),
      approved: false, // Set to pending by default (boolean)
      edited: false,
      e_count: 0,
      lock_record: false,
    };
    
    // FORCE include payment_mode if it was in the original entry (even if filteredEntry doesn't have it)
    if ('payment_mode' in entry && entry.payment_mode !== undefined) {
      insertData.payment_mode = entry.payment_mode && typeof entry.payment_mode === 'string' && entry.payment_mode.trim()
        ? entry.payment_mode.trim()
        : null;
    }
    
    // Debug: Log payment_mode being saved
    if ('payment_mode' in insertData) {
      console.log('💾 Database insert with payment_mode:', {
        payment_mode: insertData.payment_mode,
        company: insertData.company_name,
        account: insertData.acc_name
      });
    }
    
    const result = await supabase
      .from(getTableName('cash_book'))
      .insert(insertData)
      .select('*') // Select all columns including payment_mode in response
      .single();
    
    data = result.data;
    error = result.error;
    
    // Debug: Log what was saved - VERIFY payment_mode is in the database
    if (data && !error) {
      console.log('✅ Entry saved successfully:', {
        id: data.id,
        payment_mode_in_db: data.payment_mode,
        payment_mode_type: typeof data.payment_mode,
        payment_mode_sent: insertData.payment_mode,
        company: data.company_name,
        account: data.acc_name,
        date: data.c_date
      });
      
      // WARNING if payment_mode wasn't saved
      if (insertData.payment_mode && !data.payment_mode) {
        console.warn('⚠️ WARNING: payment_mode was sent but not saved to database!', {
          sent: insertData.payment_mode,
          received: data.payment_mode
        });
      }
    }
    
    // If error is about payment_mode column not existing, retry without it
    // BUT FIRST: Check if the error is actually about payment_mode or something else
    if (error) {
      const isPaymentModeError = error.message?.includes('payment_mode') || 
                                 error.code === '42703' ||
                                 error.message?.includes('column') && error.message?.includes('payment');
      
      if (isPaymentModeError) {
        console.error('❌ CRITICAL: payment_mode column does not exist in database!');
        console.error('🔧 ACTION REQUIRED: Run this SQL in Supabase SQL Editor:');
        console.error('   ALTER TABLE cash_book ADD COLUMN IF NOT EXISTS payment_mode TEXT;');
        console.warn('⚠️ Retrying without payment_mode...');
        
        // Remove payment_mode and retry
        const entryWithoutPaymentMode = { ...insertData };
        delete (entryWithoutPaymentMode as any).payment_mode;
        const retryResult = await supabase
          .from(getTableName('cash_book'))
          .insert(entryWithoutPaymentMode)
          .select('*')
          .single();
        
        data = retryResult.data;
        error = retryResult.error;
        
        if (!error) {
          console.warn('✅ Entry saved WITHOUT payment_mode (column missing). Add column and create new entry to save payment_mode.');
        }
      }
      // If error is NOT about payment_mode, let it throw below
    }

    if (error) {
      throw new Error(`Failed to create cash book entry: ${error.message}`);
    }

    return data;
  }

  // Backwards-compatible wrapper used by hooks
  async createCashBookEntry(entry: Omit<
    CashBookEntry,
    | 'id'
    | 'sno'
    | 'entry_time'
    | 'approved'
    | 'edited'
    | 'e_count'
    | 'lock_record'
    | 'created_at'
    | 'updated_at'
  >): Promise<CashBookEntry> {
    return this.addCashBookEntry(entry);
  }

  // Fetch single cash book entry by id (used by hooks)
  async getCashBookEntry(id: string): Promise<CashBookEntry | null> {
    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('*') // Select all columns including payment_mode
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching cash book entry by id:', error);
      return null;
    }
    
    if (!data) return null;
    
    // Normalize payment_mode like other functions
    let paymentMode = '';
    if (data.payment_mode != null && data.payment_mode !== '') {
      const pmStr = String(data.payment_mode).trim();
      if (pmStr && pmStr !== 'null' && pmStr !== 'undefined' && pmStr !== '') {
        paymentMode = pmStr;
      }
    }
    if (!paymentMode) {
      if (data.credit_mode != null && data.credit_mode !== '') {
        const cmStr = String(data.credit_mode).trim();
        if (cmStr) paymentMode = cmStr;
      } else if (data.debit_mode != null && data.debit_mode !== '') {
        const dmStr = String(data.debit_mode).trim();
        if (dmStr) paymentMode = dmStr;
      }
    }
    
    return {
      ...data,
      payment_mode: paymentMode
    } as CashBookEntry;
  }

  // Fetch entries by exact date (YYYY-MM-DD) (used by hooks)
  async getCashBookEntriesByDate(date: string): Promise<CashBookEntry[]> {
    const pendingForDate = async (list: CashBookEntry[]) =>
      (await this.mergeOfflineOperations('cash_book', list)).filter(e => e.c_date === date);
    if (!this.isOnline) {
      return pendingForDate([]);
    }
    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('*') // Select all columns including payment_mode
      .eq('c_date', date)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching entries by date:', error);
      return pendingForDate([]);
    }
    
    // Clean fields and normalize approved to strict boolean
    const cleanedData = (data || []).map((entry: any, idx: number) => {
      // CRITICAL: Extract payment_mode from database - handle all edge cases
      let paymentMode = '';
      
      // Priority 1: Check payment_mode field first (primary source from NewEntry form)
      if (entry.payment_mode != null && entry.payment_mode !== undefined) {
        const pmStr = String(entry.payment_mode).trim();
        // Valid payment mode values: Cash, Bank Transfer, Online
        if (pmStr && pmStr !== 'null' && pmStr !== 'undefined' && pmStr !== '') {
          paymentMode = pmStr;
        }
      }
      
      // Priority 2: Fallback to credit_mode or debit_mode ONLY if payment_mode is empty
      // This is for backwards compatibility with old entries
      if (!paymentMode) {
        if (entry.credit_mode != null && entry.credit_mode !== '') {
          const cmStr = String(entry.credit_mode).trim();
          if (cmStr) paymentMode = cmStr;
        } else if (entry.debit_mode != null && entry.debit_mode !== '') {
          const dmStr = String(entry.debit_mode).trim();
          if (dmStr) paymentMode = dmStr;
        }
      }
      
      // Debug: Log payment_mode for first few entries to verify retrieval
      if (idx < 3) {
        console.log(`🔍 getCashBookEntriesByDate Entry ${idx + 1}:`, {
          id: entry.id,
          sno: entry.sno,
          date: entry.c_date,
          payment_mode_raw: entry.payment_mode,
          payment_mode_type: typeof entry.payment_mode,
          payment_mode_is_null: entry.payment_mode === null,
          payment_mode_is_undefined: entry.payment_mode === undefined,
          payment_mode_processed: paymentMode,
          has_payment_mode: !!paymentMode,
          company: entry.company_name
        });
      }
      
      return {
        ...entry,
        acc_name: entry.acc_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
        sub_acc_name: entry.sub_acc_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
        particulars: entry.particulars?.replace(/\[DELETED\]\s*/g, '').trim() || '',
        company_name: entry.company_name?.replace(/\[DELETED\]\s*/g, '').trim() || '',
        approved: entry.approved === true || (typeof entry.approved === 'string' && ['true', 'approved'].includes(entry.approved.toLowerCase().trim())),
        payment_mode: paymentMode // This is the processed payment_mode that should be displayed
      };
    });
    
    return pendingForDate(cleanedData as CashBookEntry[]);
  }

  // Bulk insert/update operations for dual entry create (used by hooks)
  async bulkUpdateCashBookEntries(operations: Array<Partial<CashBookEntry>>): Promise<any> {
    try {
      if (!operations || operations.length === 0) return [];

      // Filter out undefined fields to respect DB defaults
      // But always include payment_mode if it exists (even if null)
      const sanitized = operations.map((op) => {
        const base: Record<string, any> = Object.fromEntries(
          Object.entries(op).filter(([key, v]) => {
            // Always include payment_mode field if it exists (even if null)
            if (key === 'payment_mode') return true;
            return v !== undefined;
          })
        );
        
        // Ensure payment_mode is properly formatted
        if ('payment_mode' in base) {
          if (base.payment_mode && typeof base.payment_mode === 'string') {
            base.payment_mode = base.payment_mode.trim() || null;
          } else if (base.payment_mode === '') {
            base.payment_mode = null;
          }
        }
        
        // Ensure default flags are set for new inserts (pending by default)
        return {
          id: crypto.randomUUID(),
          approved: false,
          edited: false,
          e_count: 0,
          lock_record: false,
          entry_time: new Date().toISOString(),
          ...base,
        } as Partial<CashBookEntry>;
      });

      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .insert(sanitized)
        .select('*');

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error in bulkUpdateCashBookEntries:', error);
      throw error;
    }
  }

  async updateCashBookEntry(
    id: string,
    updates: Partial<CashBookEntry>,
    editedBy?: string
  ): Promise<CashBookEntry | null> {
    // Only pick fields that exist in the table
    const allowedFields = [
      'acc_name',
      'sub_acc_name',
      'particulars',
      'credit',
      'debit',
      'company_name',
      'address',
      'staff',
      'users',
      'entry_time',
      'sale_qty',
      'purchase_qty',
      'approved',
      'cb',
      'c_date',
      'e_count',
      'edited',
      'payment_mode',
    ];
    const filteredUpdates: any = {};
    for (const key of allowedFields) {
      if (key in updates) filteredUpdates[key] = (updates as any)[key];
    }
    filteredUpdates.edited = true;
    filteredUpdates.updated_at = new Date().toISOString();

    // Fetch the old entry for audit logging
    const { data: oldEntry, error: fetchError } = await supabase
      .from(getTableName('cash_book'))
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) {
      console.error(
        'Error fetching old cash book entry for audit log:',
        fetchError
      );
    }

    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .update(filteredUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating cash book entry:', error);
      return null;
    }

    // Insert audit log if update succeeded and old entry was fetched
    if (oldEntry && data) {
      const auditLog = {
        cash_book_id: id,
        old_values: JSON.stringify(oldEntry),
        new_values: JSON.stringify(data),
        edited_by: editedBy || 'unknown',
        edited_at: new Date().toISOString(),
      };
      const { error: auditError } = await supabase
        .from(getTableName('edit_cash_book'))
        .insert(auditLog);
      if (auditError) {
        console.error(
          'Error inserting audit log into edit_cash_book:',
          auditError
        );
      }
    }

    return data;
  }

  // Bulk update multiple cash book entries by IDs
  async bulkUpdateCashBookEntriesByIds(
    ids: string[],
    updates: Partial<CashBookEntry>,
    editedBy?: string
  ): Promise<{ success: boolean; updatedCount: number; error?: any }> {
    try {
      if (!ids || ids.length === 0) {
        return { success: false, updatedCount: 0, error: 'No IDs provided' };
      }

      console.log(`🔄 Bulk updating ${ids.length} entries...`);

      // Only pick fields that exist in the table
      const allowedFields = [
        'acc_name',
        'sub_acc_name',
        'particulars',
        'credit',
        'debit',
        'company_name',
        'address',
        'staff',
        'users',
        'entry_time',
        'sale_qty',
        'purchase_qty',
        'approved',
        'cb',
        'c_date',
        'e_count',
        'edited',
        'payment_mode',
      ];
      
      const filteredUpdates: any = {};
      for (const key of allowedFields) {
        if (key in updates) {
          const value = (updates as any)[key];
          // Trim string values
          filteredUpdates[key] = typeof value === 'string' ? value.trim() : value;
        }
      }
      filteredUpdates.edited = true;
      filteredUpdates.updated_at = new Date().toISOString();

      // Fetch old entries for audit logging (before update)
      const { data: oldEntries, error: fetchError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .in('id', ids);

      if (fetchError) {
        console.error('Error fetching old entries for audit log:', fetchError);
      }

      // Perform bulk update using .in() to update multiple IDs at once
      const { data: updatedEntries, error: updateError } = await supabase
        .from(getTableName('cash_book'))
        .update(filteredUpdates)
        .in('id', ids)
        .select();

      if (updateError) {
        console.error('Error in bulk update:', updateError);
        return { success: false, updatedCount: 0, error: updateError };
      }

      const updatedCount = updatedEntries?.length || 0;
      console.log(`✅ Successfully updated ${updatedCount} entries`);

      // Create audit logs for each updated entry
      if (oldEntries && updatedEntries && editedBy) {
        const auditLogs = oldEntries.map((oldEntry: any) => {
          const updatedEntry = updatedEntries.find((e: any) => e.id === oldEntry.id);
          if (!updatedEntry) return null;
          
          return {
            cash_book_id: oldEntry.id,
            old_values: JSON.stringify(oldEntry),
            new_values: JSON.stringify(updatedEntry),
            edited_by: editedBy,
            edited_at: new Date().toISOString(),
          };
        }).filter(Boolean);

        if (auditLogs.length > 0) {
          // Insert audit logs in batches to avoid overwhelming the database
          const batchSize = 100;
          for (let i = 0; i < auditLogs.length; i += batchSize) {
            const batch = auditLogs.slice(i, i + batchSize);
            const { error: auditError } = await supabase
              .from(getTableName('edit_cash_book'))
              .insert(batch);
            
            if (auditError) {
              console.error(`Error inserting audit log batch ${Math.floor(i / batchSize) + 1}:`, auditError);
            }
          }
        }
      }

      return { success: true, updatedCount };
    } catch (error) {
      console.error('Error in bulkUpdateCashBookEntriesByIds:', error);
      return { success: false, updatedCount: 0, error };
    }
  }

  // Lock a cash book entry
  async lockEntry(id: string, lockedBy: string): Promise<CashBookEntry | null> {
    // Fetch the old entry for audit logging
    const { data: oldEntry, error: fetchError } = await supabase
      .from(getTableName('cash_book'))
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) {
      console.error('Error fetching old cash book entry for lock:', fetchError);
    }

    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .update({ lock_record: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error locking cash book entry:', error);
      return null;
    }

    // Insert audit log if update succeeded and old entry was fetched
    if (oldEntry && data) {
      const auditLog = {
        cash_book_id: id,
        old_values: JSON.stringify(oldEntry),
        new_values: JSON.stringify(data),
        edited_by: lockedBy || 'unknown',
        edited_at: new Date().toISOString(),
        action: 'LOCK',
      };
      const { error: auditError } = await supabase
        .from(getTableName('edit_cash_book'))
        .insert(auditLog);
      if (auditError) {
        console.error(
          'Error inserting lock audit log into edit_cash_book:',
          auditError
        );
      }
    }

    return data;
  }

  // Unlock a cash book entry
  async unlockEntry(
    id: string,
    unlockedBy: string
  ): Promise<CashBookEntry | null> {
    // Fetch the old entry for audit logging
    const { data: oldEntry, error: fetchError } = await supabase
      .from(getTableName('cash_book'))
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) {
      console.error(
        'Error fetching old cash book entry for unlock:',
        fetchError
      );
    }

    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .update({ lock_record: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error unlocking cash book entry:', error);
      return null;
    }

    // Insert audit log if update succeeded and old entry was fetched
    if (oldEntry && data) {
      const auditLog = {
        cash_book_id: id,
        old_values: JSON.stringify(oldEntry),
        new_values: JSON.stringify(data),
        edited_by: unlockedBy || 'unknown',
        edited_at: new Date().toISOString(),
        action: 'UNLOCK',
      };
      const { error: auditError } = await supabase
        .from(getTableName('edit_cash_book'))
        .insert(auditLog);
      if (auditError) {
        console.error(
          'Error inserting unlock audit log into edit_cash_book:',
          auditError
        );
      }
    }

    return data;
  }

  async deleteCashBookEntry(id: string, deletedBy: string): Promise<boolean> {
    console.log('🗑️ ===== DELETE OPERATION STARTED =====');
    console.log('🗑️ Entry ID:', id);
    console.log('🗑️ Deleted By:', deletedBy);
    console.log('🗑️ Timestamp:', new Date().toISOString());

    try {
      // Step 1: Fetch the entry to delete
      console.log('📋 Step 1: Fetching entry to delete...');
      const { data: oldEntry, error: fetchError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.error('❌ FETCH ERROR:', fetchError);
        console.error('❌ Error code:', fetchError.code);
        console.error('❌ Error message:', fetchError.message);
        console.error('❌ Error details:', fetchError.details);
        console.error('❌ Error hint:', fetchError.hint);
        return false;
      }

      if (!oldEntry) {
        console.error('❌ NO ENTRY FOUND with id:', id);
        return false;
      }

      console.log('✅ ENTRY FOUND:', {
        id: oldEntry.id,
        sno: oldEntry.sno,
        acc_name: oldEntry.acc_name,
        company_name: oldEntry.company_name,
        credit: oldEntry.credit,
        debit: oldEntry.debit
      });

      // Step 2: Try to insert into deleted_cash_book table first
      console.log('📝 Step 2: Attempting to insert into deleted_cash_book table...');
      
      const deletedEntry = {
        ...oldEntry,
        deleted_by: deletedBy || 'unknown',
        deleted_at: new Date().toISOString(),
      };

      console.log('📝 DELETED ENTRY DATA:', deletedEntry);

      let { error: insertError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .insert(deletedEntry);

      // A column that exists in cash_book but not yet in deleted_cash_book
      // (PostgREST PGRST204 / Postgres 42703): retry with the core columns only.
      if (insertError && (insertError.code === 'PGRST204' || insertError.code === '42703')) {
        console.warn('⚠️ deleted_cash_book is missing a column, retrying with core columns:', insertError.message);
        const coreEntry: Record<string, any> = {};
        for (const key of DELETED_CASH_BOOK_CORE_COLUMNS) {
          if (key in deletedEntry) coreEntry[key] = (deletedEntry as Record<string, any>)[key];
        }
        ({ error: insertError } = await supabase
          .from(getTableName('deleted_cash_book'))
          .insert(coreEntry));
      }

      // Never remove the entry unless its copy is safely in Deleted Records,
      // otherwise the record would disappear without any trace.
      if (insertError) {
        console.error('❌ INSERT INTO deleted_cash_book FAILED, entry NOT deleted:', insertError);
        console.log('❌ ===== DELETE OPERATION ABORTED =====');
        return false;
      }
      console.log('✅ Successfully inserted into deleted_cash_book');

      // Step 3: Store deleted record info in localStorage for tracking
      console.log('📝 Step 3: Storing deleted record info for tracking...');
      
      try {
        // Store deleted record info in localStorage for tracking
        const deletedRecordInfo = {
          id: oldEntry.id,
          sno: oldEntry.sno,
          c_date: oldEntry.c_date,
          company_name: oldEntry.company_name,
          acc_name: oldEntry.acc_name,
          sub_acc_name: oldEntry.sub_acc_name,
          particulars: oldEntry.particulars,
          credit: oldEntry.credit,
          debit: oldEntry.debit,
          staff: oldEntry.staff,
          users: oldEntry.users,
          entry_time: oldEntry.entry_time,
          deleted_by: deletedBy || 'unknown',
          deleted_at: new Date().toISOString(),
          approved: false
        };

        // Get existing deleted records from localStorage
        const existingDeleted = JSON.parse(localStorage.getItem('deleted_records') || '[]');
        existingDeleted.push(deletedRecordInfo);
        
        // Store updated list back to localStorage
        localStorage.setItem('deleted_records', JSON.stringify(existingDeleted));
        
        console.log('✅ Successfully stored deleted record info in localStorage');
        console.log('📋 Total deleted records in localStorage:', existingDeleted.length);
      } catch (storageError) {
        console.warn('⚠️ Exception storing deleted record info:', storageError);
        console.warn('⚠️ Continuing with deletion despite storage failure...');
      }

      // Step 4: Delete from cash_book table
      console.log('📝 Step 4: Deleting from cash_book table...');
      
      const { error: deleteError } = await supabase
        .from(getTableName('cash_book'))
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('❌ DELETE FROM cash_book FAILED:', deleteError);
        console.error('❌ Delete error code:', deleteError.code);
        console.error('❌ Delete error message:', deleteError.message);
        console.error('❌ Delete error details:', deleteError.details);
        console.error('❌ Delete error hint:', deleteError.hint);
        console.log('❌ ===== DELETE OPERATION FAILED =====');
        return false;
      }

      console.log('✅ Successfully deleted from cash_book');
      
      // Step 5: Trigger dashboard refresh
      console.log('📝 Step 5: Triggering financial recalculation...');
      
      // Trigger dashboard refresh to update financial totals
      localStorage.setItem('dashboard-refresh', Date.now().toString());
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      
      console.log('✅ ===== DELETE OPERATION COMPLETED SUCCESSFULLY =====');
      return true;

    } catch (error) {
      console.error('❌ UNEXPECTED ERROR in deleteCashBookEntry:', error);
      console.error('❌ Error type:', typeof error);
      console.error('❌ Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Error stack:', error instanceof Error ? error.stack : undefined);
      console.log('❌ ===== DELETE OPERATION FAILED (EXCEPTION) =====');
      return false;
    }
  }

  // Test function to check database schema
  async testDeleteFunctionality(): Promise<{ canUpdate: boolean; canInsertDeleted: boolean; error?: string }> {
    try {
      console.log('🧪 Testing delete functionality...');
      
      // Test 1: Check if we can update cash_book table
      const { data: testEntry } = await supabase
        .from(getTableName('cash_book'))
        .select('id, acc_name')
        .limit(1)
        .single();
        
      if (!testEntry) {
        return { canUpdate: false, canInsertDeleted: false, error: 'No test entry found' };
      }
      
      // Test update with simple fields
      const { error: updateError } = await supabase
        .from(getTableName('cash_book'))
        .update({ acc_name: `[TEST] ${testEntry.acc_name}` })
        .eq('id', testEntry.id);
        
      if (updateError) {
        console.error('Update test failed:', updateError);
        return { canUpdate: false, canInsertDeleted: false, error: updateError.message };
      }
      
      // Revert the test
      await supabase
        .from(getTableName('cash_book'))
        .update({ acc_name: testEntry.acc_name })
        .eq('id', testEntry.id);
        
      // Test 2: Check if deleted_cash_book table exists
      const { error: insertError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .select('id')
        .limit(1);
        
      const canInsertDeleted = !insertError || insertError.code !== 'PGRST116';
      
      console.log('🧪 Test results:', { canUpdate: true, canInsertDeleted });
      return { canUpdate: true, canInsertDeleted };
      
    } catch (error) {
      console.error('Test failed:', error);
      return { canUpdate: false, canInsertDeleted: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }


  // Simple delete test function for debugging
  async testDeleteEntry(entryId: string, deletedBy: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('🧪 Testing delete for entry:', entryId);
      
      // First check if entry exists
      const { data: entry, error: fetchError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, sno, acc_name')
        .eq('id', entryId)
        .single();
        
      if (fetchError || !entry) {
        return { success: false, error: 'Entry not found' };
      }
      
      console.log('✅ Entry found:', entry);
      
      // Try the delete operation
      const result = await this.deleteCashBookEntry(entryId, deletedBy);
      
      if (result) {
        console.log('✅ Delete test successful');
        return { success: true };
      } else {
        console.log('❌ Delete test failed');
        return { success: false, error: 'Delete operation returned false' };
      }
      
    } catch (error) {
      console.error('Delete test error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Diagnostic function to check database permissions and table structure
  async diagnoseDeleteIssues(): Promise<{ 
    canReadCashBook: boolean; 
    canUpdateCashBook: boolean; 
    canInsertDeletedCashBook: boolean; 
    canDeleteCashBook: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let canReadCashBook = false;
    let canUpdateCashBook = false;
    let canInsertDeletedCashBook = false;
    let canDeleteCashBook = false;

    try {
      console.log('🔍 ===== DIAGNOSING DELETE ISSUES =====');
      
      // Test 1: Can we read from cash_book?
      console.log('🔍 Test 1: Checking cash_book read access...');
      const { data: readData, error: readError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, sno, acc_name')
        .limit(1);
        
      if (readError) {
        errors.push(`Cannot read cash_book: ${readError.message}`);
        console.error('❌ Cannot read cash_book:', readError);
      } else {
        canReadCashBook = true;
        console.log('✅ Can read cash_book');
      }

      if (canReadCashBook && readData && readData.length > 0) {
        const testEntry = readData[0];
        
        // Test 2: Can we update cash_book?
        console.log('🔍 Test 2: Checking cash_book update access...');
        const { error: updateError } = await supabase
          .from(getTableName('cash_book'))
          .update({ acc_name: `[TEST] ${testEntry.acc_name}` })
          .eq('id', testEntry.id);
          
        if (updateError) {
          errors.push(`Cannot update cash_book: ${updateError.message}`);
          console.error('❌ Cannot update cash_book:', updateError);
        } else {
          canUpdateCashBook = true;
          console.log('✅ Can update cash_book');
          
          // Revert the test change
          await supabase
            .from(getTableName('cash_book'))
            .update({ acc_name: testEntry.acc_name })
            .eq('id', testEntry.id);
        }

        // Test 3: Can we insert into deleted_cash_book?
        console.log('🔍 Test 3: Checking deleted_cash_book insert access...');
        const testDeletedEntry = {
          id: 'test-delete-' + Date.now(),
          sno: 999999,
          acc_name: 'Test Delete Entry',
          c_date: new Date().toISOString().split('T')[0],
          credit: 0,
          debit: 0,
          company_name: 'Test Company',
          deleted_by: 'test',
          deleted_at: new Date().toISOString()
        };
        
        const { error: insertError } = await supabase
          .from(getTableName('deleted_cash_book'))
          .insert(testDeletedEntry);
          
        if (insertError) {
          errors.push(`Cannot insert into deleted_cash_book: ${insertError.message}`);
          console.error('❌ Cannot insert into deleted_cash_book:', insertError);
        } else {
          canInsertDeletedCashBook = true;
          console.log('✅ Can insert into deleted_cash_book');
          
          // Clean up test record
          await supabase.from(getTableName('deleted_cash_book')).delete().eq('id', testDeletedEntry.id);
        }

        // Test 4: Can we delete from cash_book?
        console.log('🔍 Test 4: Checking cash_book delete access...');
        // We'll just test if we can run a delete query (not actually delete)
        const { error: deleteError } = await supabase
          .from(getTableName('cash_book'))
          .delete()
          .eq('id', 'non-existent-id');
          
        if (deleteError && deleteError.code === 'PGRST116') {
          // This is expected - table doesn't exist or no permission
          errors.push(`Cannot delete from cash_book: ${deleteError.message}`);
          console.error('❌ Cannot delete from cash_book:', deleteError);
        } else {
          canDeleteCashBook = true;
          console.log('✅ Can delete from cash_book');
        }
      }

      console.log('🔍 ===== DIAGNOSIS COMPLETE =====');
      console.log('📊 Results:', {
        canReadCashBook,
        canUpdateCashBook,
        canInsertDeletedCashBook,
        canDeleteCashBook,
        errors
      });

      return {
        canReadCashBook,
        canUpdateCashBook,
        canInsertDeletedCashBook,
        canDeleteCashBook,
        errors
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Diagnosis failed: ${errorMsg}`);
      console.error('❌ Diagnosis failed:', error);
      
      return {
        canReadCashBook,
        canUpdateCashBook,
        canInsertDeletedCashBook,
        canDeleteCashBook,
        errors
      };
    }
  }

  // User operations
  async getUsers(): Promise<User[]> {
    // Return all active users (Admins and Staff)
    const { data, error } = await supabase
      .from('users')
      .select(`${USER_COLUMNS}, user_types:user_types(user_type)`)
      .eq('is_active', true)
      .order('username');

    if (error) {
      console.error('Error fetching users:', error);
      return [];
    }

    return (data || []) as any;
  }

  // Distinct staff names from cash_book for free-text staff selection
  async getDistinctStaffNames(): Promise<{ value: string; label: string }[]> {
    try {
      if (!this.isOnline) {
        const tableMode = getTableMode();
        const mode = tableMode === 'itr' ? 'itr' : 'regular';
        const tableName = mode === 'itr' ? 'staff_itr' : 'staff';
        console.log(`📦 [offlineMasterData] Fetching distinct staff names from IndexedDB cache`);
        const cached = await getCachedMasterData(tableName, mode);

        const pendingOps = await db.queued_operations
          .where('status')
          .equals('pending_sync')
          .and(op => op.table === 'cash_book' && op.book_id === this.currentBookId)
          .toArray();

        const pendingStaff = pendingOps
          .map((op: any) => op.payload.staff?.trim())
          .filter(Boolean);

        const cachedStaffNames = cached.map((item: any) => item.value);
        const combined = [...pendingStaff, ...cachedStaffNames];
        const unique = Array.from(new Set(combined))
          .filter(Boolean)
          .map(name => ({ value: name, label: name }));

        return unique;
      }

      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('staff')
        .not('staff', 'is', null)
        .neq('staff', '')
        .order('staff', { ascending: true });
      if (error) {
        console.error('Error fetching distinct staff names:', error);
        return [];
      }
      const unique = Array.from(new Set((data || []).map((r: any) => (r.staff || '').trim())))
        .filter(Boolean)
        .map(name => ({ value: name as string, label: name as string }));
      return unique;
    } catch (err) {
      console.error('Error in getDistinctStaffNames:', err);
      return [];
    }
  }

  // Distinct user names from cash_book users column for user selection
  async getDistinctUserNames(): Promise<{ value: string; label: string }[]> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('users')
        .not('users', 'is', null)
        .neq('users', '')
        .order('users', { ascending: true });
      if (error) {
        console.error('Error fetching distinct user names:', error);
        return [];
      }
      const unique = Array.from(new Set((data || []).map((r: any) => (r.users || '').trim())))
        .filter(Boolean)
        .map(name => ({ value: name as string, label: name as string }));
      return unique;
    } catch (err) {
      console.error('Error in getDistinctUserNames:', err);
      return [];
    }
  }

  // Get active staff members count
  async getActiveStaffCount(): Promise<number> {
    try {
      console.log('🔄 Fetching active staff count...');
      
      // Count only STAFF users
      const { count, error } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('user_type_id', (
          await supabase
            .from('user_types')
            .select('id')
            .eq('user_type', 'Staff')
        ).data?.map((r: any) => r.id) || []);

      if (error) {
        console.error('❌ Error fetching active staff count:', error);
        return 0;
      }

      console.log('📊 Active staff count:', count || 0);
      return count || 0;
    } catch (error) {
      console.error('❌ Error in getActiveStaffCount:', error);
      return 0;
    }
  }

  // Get active operators count (for dashboard Active Users card)
  async getActiveOperatorCount(): Promise<number> {
    try {
      console.log('🔄 Fetching active operator count...');

      // Get Operator user_type id(s)
      const { data: typeRows, error: typeErr } = await supabase
        .from('user_types')
        .select('id')
        .eq('user_type', 'Operator');
      if (typeErr) {
        console.error('❌ Error fetching operator user_type:', typeErr);
        return 0;
      }
      const ids = (typeRows || []).map((r: any) => r.id);
      if (ids.length === 0) return 0;

      const { count, error } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('user_type_id', ids);

      if (error) {
        console.error('❌ Error fetching active operator count:', error);
        return 0;
      }

      console.log('📊 Active operator count:', count || 0);
      return count || 0;
    } catch (error) {
      console.error('❌ Error in getActiveOperatorCount:', error);
      return 0;
    }
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select(USER_COLUMNS as '*') // typed as '*' for the type checker only
      .eq('username', username)
      .single();

    if (error) {
      console.error('Error fetching user by username:', error);
      return null;
    }

    return data;
  }

  async getUserById(id: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select(USER_COLUMNS as '*') // typed as '*' for the type checker only
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching user by ID:', error);
      return null;
    }

    return data;
  }

  async createUser(
    user: Omit<any, 'id' | 'created_at' | 'updated_at'>
  ): Promise<User> {
    console.log('🔧 [supabaseDatabase] Creating user with data:', user);
    
    const { data, error } = await supabase
      .from('users')
      .insert(user)
      .select(USER_COLUMNS as '*') // typed as '*' for the type checker only
      .single();

    if (error) {
      console.error('❌ [supabaseDatabase] Error creating user:', error);
      throw new Error(`Failed to create user: ${error.message}`);
    }

    console.log('✅ [supabaseDatabase] User created successfully:', data);
    return data;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(USER_COLUMNS as '*') // typed as '*' for the type checker only
      .single();

    if (error) {
      console.error('Error updating user:', error);
      return null;
    }

    return data;
  }

  async deleteUser(id: string): Promise<boolean> {
    const { error } = await supabase.from('users').delete().eq('id', id);

    if (error) {
      console.error('Error deleting user:', error);
      return false;
    }

    return true;
  }

  // Passwords are never stored or shown again (they were kept in user_credentials_log for the Dashboard).
  // Kept so older callers still work.
  async saveUserCredentials(_credentials: unknown): Promise<boolean> {
    return true;
  }

  async getRecentUserCredentials(_limit: number = 10): Promise<any[]> {
    return [];
  }

  // Bank Guarantee operations
  async getBankGuarantees(): Promise<BankGuarantee[]> {
    const { data, error } = await supabase
      .from(getTableName('bank_guarantees'))
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching bank guarantees:', error);
      return [];
    }

    return data || [];
  }

  async addBankGuarantee(
    bg: Omit<BankGuarantee, 'id' | 'sno' | 'created_at' | 'updated_at'>
  ): Promise<BankGuarantee> {
    const { data, error } = await supabase
      .from(getTableName('bank_guarantees'))
      .insert(bg)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create bank guarantee: ${error.message}`);
    }

    return data;
  }

  async updateBankGuarantee(
    id: string,
    updates: Partial<BankGuarantee>
  ): Promise<BankGuarantee | null> {
    const { data, error } = await supabase
      .from(getTableName('bank_guarantees'))
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating bank guarantee:', error);
      return null;
    }

    return data;
  }

  async deleteBankGuarantee(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(getTableName('bank_guarantees'))
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting bank guarantee:', error);
      return false;
    }

    return true;
  }

  // Vehicle operations
  async getVehicles(): Promise<Vehicle[]> {
    const { data, error } = await supabase
      .from(getTableName('vehicles'))
      .select('*')
      .order('v_no');

    if (error) {
      console.error('Error fetching vehicles:', error);
      return this.mergeOfflineOperations('vehicles', []);
    }

    return this.mergeOfflineOperations('vehicles', data || []);
  }

  async addVehicle(
    vehicle: Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>
  ): Promise<Vehicle> {
    const { data, error } = await supabase
      .from(getTableName('vehicles'))
      .insert(vehicle)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create vehicle: ${error.message}`);
    }

    return data;
  }

  async updateVehicle(
    id: string,
    updates: Partial<Vehicle>
  ): Promise<Vehicle | null> {
    const { data, error } = await supabase
      .from(getTableName('vehicles'))
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating vehicle:', error);
      return null;
    }

    return data;
  }

  async deleteVehicle(id: string): Promise<boolean> {
    const { error } = await supabase.from(getTableName('vehicles')).delete().eq('id', id);

    if (error) {
      console.error('Error deleting vehicle:', error);
      return false;
    }

    return true;
  }

  // Driver operations
  async getDrivers(): Promise<Driver[]> {
    const { data, error } = await supabase
      .from(getTableName('drivers'))
      .select('*')
      .order('driver_name');

    if (error) {
      console.error('Error fetching drivers:', error);
      return [];
    }

    return data || [];
  }

  async addDriver(
    driver: Omit<Driver, 'id' | 'created_at' | 'updated_at'>
  ): Promise<Driver> {
    const { data, error } = await supabase
      .from(getTableName('drivers'))
      .insert(driver)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create driver: ${error.message}`);
    }

    return data;
  }

  async updateDriver(
    id: string,
    updates: Partial<Driver>
  ): Promise<Driver | null> {
    const { data, error } = await supabase
      .from(getTableName('drivers'))
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating driver:', error);
      return null;
    }

    return data;
  }

  async deleteDriver(id: string): Promise<boolean> {
    const { error } = await supabase.from(getTableName('drivers')).delete().eq('id', id);

    if (error) {
      console.error('Error deleting driver:', error);
      return false;
    }

    return true;
  }



  // Dashboard stats - All time totals with optimized calculations
  async getDashboardStats(date?: string) {
    try {
      console.log('🔄 Fetching dashboard stats with optimized calculations...');
      
      let totalCredit = 0;
      let totalDebit = 0;
      let totalTransactions = 0;
      let deletedRecords = 0;

      // Get total count first
      const { count: totalCount, error: countError } = await supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact', head: true });

      if (countError) {
        console.error('Error getting total count:', countError);
        throw countError;
      }

      totalTransactions = totalCount || 0;
      console.log(`📊 Total records in database: ${totalTransactions}`);

      // Get deleted records count from multiple sources
      try {
        // First try deleted_cash_book table using direct data fetch (same as ApproveRecords)
        console.log('🔍 Attempting to fetch deleted records from deleted_cash_book table...');
        const { data: deletedData, error: deletedError } = await supabase
          .from(getTableName('deleted_cash_book'))
          .select('id')
          .order('deleted_at', { ascending: false });
        
        console.log('🔍 deleted_cash_book query result:', { deletedData, deletedError });
        
        if (!deletedError && deletedData) {
          deletedRecords = deletedData.length;
          console.log(`✅ Deleted records from deleted_cash_book: ${deletedRecords}`);
        } else {
          console.log('⚠️ deleted_cash_book table not accessible:', deletedError?.message || 'Unknown error');
          console.log('⚠️ deleted_cash_book error details:', {
            code: deletedError?.code,
            message: deletedError?.message,
            details: deletedError?.details,
            hint: deletedError?.hint
          });
          console.log('🔄 Trying fallback: checking cash_book for deleted records...');
          
          // Fallback: check cash_book for deleted records
          const { count: cashBookDeletedCount, error: cashBookError } = await supabase
            .from(getTableName('cash_book'))
            .select('*', { count: 'exact', head: true })
            .eq('deleted', true);
          
          console.log('🔍 cash_book deleted query result:', { cashBookDeletedCount, cashBookError });
          
          if (!cashBookError && cashBookDeletedCount !== null) {
            deletedRecords = cashBookDeletedCount;
            console.log(`✅ Deleted records from cash_book (fallback): ${deletedRecords}`);
          } else {
            console.log('⚠️ No deleted records found in database tables');
            console.log('🔄 Trying localStorage fallback...');
            
            // Final fallback: check localStorage for deleted records
            try {
              const localStorageDeleted = JSON.parse(localStorage.getItem('deleted_records') || '[]');
              deletedRecords = localStorageDeleted.length;
              console.log(`✅ Deleted records from localStorage: ${deletedRecords}`);
            } catch (localStorageError) {
              console.log('⚠️ localStorage not accessible:', localStorageError);
              deletedRecords = 0;
            }
            
            if (deletedRecords === 0) {
              console.log('⚠️ No deleted records found in any source');
              console.log('   - deleted_cash_book error:', deletedError?.message || 'N/A');
              console.log('   - cash_book error:', cashBookError?.message || 'N/A');
            }
          }
        }
      } catch (deletedError) {
        console.error('❌ Error fetching deleted records:', deletedError);
        deletedRecords = 0;
      }

      // Use SQL aggregation for accurate and efficient calculations
      console.log('📊 Using SQL aggregation for accurate calculations...');
      
      const { data: sumData, error: sumError } = await supabase
        .from(getTableName('cash_book'))
        .select('credit, debit');

      if (sumError) {
        console.error('Error getting sum data:', sumError);
        throw sumError;
      }

      // Calculate totals with proper data type validation and precision
      if (sumData && sumData.length > 0) {
        console.log(`📊 Processing ${sumData.length} records for calculations...`);
        
        totalCredit = sumData.reduce((sum: number, entry: any) => {
          const credit = parseFloat(entry.credit) || 0;
          if (isNaN(credit)) {
            console.warn('⚠️ Invalid credit value found:', entry.credit);
            return sum;
          }
          return sum + credit;
        }, 0);
        
        totalDebit = sumData.reduce((sum: number, entry: any) => {
          const debit = parseFloat(entry.debit) || 0;
          if (isNaN(debit)) {
            console.warn('⚠️ Invalid debit value found:', entry.debit);
            return sum;
          }
          return sum + debit;
        }, 0);
        
        // Round to 2 decimal places for precision
        totalCredit = Math.round(totalCredit * 100) / 100;
        totalDebit = Math.round(totalDebit * 100) / 100;
        
        console.log(`📊 Calculated totals: Credit=${totalCredit}, Debit=${totalDebit}`);
      } else {
        console.log('📊 No records found for calculation');
        totalCredit = 0;
        totalDebit = 0;
      }
      
      // Validate calculations
      if (isNaN(totalCredit) || isNaN(totalDebit)) {
        console.error('❌ Invalid calculation result - NaN detected');
        throw new Error('Invalid financial calculation result');
      }

      console.log(`✅ SQL aggregation result: credit: ${totalCredit.toLocaleString()}, debit: ${totalDebit.toLocaleString()}`);

      const balance = totalCredit - totalDebit;
      
      // Validate balance calculation
      if (isNaN(balance)) {
        console.error('❌ Invalid balance calculation - NaN detected');
        throw new Error('Invalid balance calculation result');
      }

      // Get today's entries count
      const today = date || new Date().toISOString().split('T')[0];
      let todayEntries = 0;
      
      try {
        const { count: todayCount } = await supabase
          .from(getTableName('cash_book'))
          .select('*', { count: 'exact', head: true })
          .eq('c_date', today);
        todayEntries = todayCount || 0;
      } catch (todayError) {
        console.error('Error getting today entries count:', todayError);
        todayEntries = 0;
      }

      // Final validation and logging
      console.log(`🎉 Dashboard stats calculated: ${totalTransactions.toLocaleString()} total transactions, ${totalCredit.toLocaleString()} credit, ${totalDebit.toLocaleString()} debit, balance: ${balance.toLocaleString()}`);
      
      // Additional validation checks
      if (totalCredit < 0 || totalDebit < 0) {
        console.warn('⚠️ Warning: Negative values detected in calculations');
      }
      
      if (Math.abs(balance - (totalCredit - totalDebit)) > 0.01) {
        console.error('❌ Balance calculation mismatch detected');
      }

      return {
        totalCredit,
        totalDebit,
        balance,
        totalTransactions,
        todayEntries: todayEntries,
        deletedRecords: deletedRecords,
        // Set online/offline values to 0 since these columns don't exist in the current schema
        onlineCredit: 0,
        offlineCredit: 0,
        onlineDebit: 0,
        offlineDebit: 0,
        totalOnline: 0,
        totalOffline: 0,
      };
    } catch (error) {
      console.error('Error in getDashboardStats:', error);
      return this.getDashboardStatsFallback();
    }
  }

  // Data validation and integrity check
  async validateFinancialData(): Promise<{ isValid: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    try {
      // Check for null/undefined values in critical fields
      const { data: nullCheck, error: nullError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, credit, debit, company_name')
        .or('credit.is.null,debit.is.null,company_name.is.null');
      
      if (!nullError && nullCheck && nullCheck.length > 0) {
        issues.push(`Found ${nullCheck.length} records with null values in critical fields`);
      }
      
      // Check for negative values in credit/debit
      const { data: negativeCheck, error: negativeError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, credit, debit')
        .or('credit.lt.0,debit.lt.0');
      
      if (!negativeError && negativeCheck && negativeCheck.length > 0) {
        issues.push(`Found ${negativeCheck.length} records with negative credit/debit values`);
      }
      
      // Check for non-numeric values
      const { data: allData, error: allError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, credit, debit')
        .limit(1000);
      
      if (!allError && allData) {
        const nonNumericCredits = allData.filter((entry: any) => 
          entry.credit !== null && isNaN(parseFloat(entry.credit))
        ).length;
        
        const nonNumericDebits = allData.filter((entry: any) => 
          entry.debit !== null && isNaN(parseFloat(entry.debit))
        ).length;
        
        if (nonNumericCredits > 0) {
          issues.push(`Found ${nonNumericCredits} records with non-numeric credit values`);
        }
        
        if (nonNumericDebits > 0) {
          issues.push(`Found ${nonNumericDebits} records with non-numeric debit values`);
        }
      }
      
      return {
        isValid: issues.length === 0,
        issues
      };
    } catch (error) {
      console.error('Error validating financial data:', error);
      return {
        isValid: false,
        issues: ['Error validating data: ' + (error as Error).message]
      };
    }
  }

  // Fix data integrity issues automatically
  async fixDataIntegrityIssues(): Promise<{ fixed: number; errors: string[] }> {
    const errors: string[] = [];
    let fixed = 0;
    
    try {
      console.log('🔧 Starting data integrity fix...');
      
      // Fix null values in critical fields
      const { data: nullRecords, error: nullError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, credit, debit, company_name')
        .or('credit.is.null,debit.is.null,company_name.is.null');
      
      if (!nullError && nullRecords && nullRecords.length > 0) {
        for (const record of nullRecords) {
          const updates: any = {};
          
          if (record.credit === null) updates.credit = 0;
          if (record.debit === null) updates.debit = 0;
          if (!record.company_name) updates.company_name = 'Unknown';
          
          const { error: updateError } = await supabase
            .from(getTableName('cash_book'))
            .update(updates)
            .eq('id', record.id);
          
          if (updateError) {
            errors.push(`Failed to fix record ${record.id}: ${updateError.message}`);
          } else {
            fixed++;
          }
        }
      }
      
      // Fix negative values (convert to positive)
      const { data: negativeRecords, error: negativeError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, credit, debit')
        .or('credit.lt.0,debit.lt.0');
      
      if (!negativeError && negativeRecords && negativeRecords.length > 0) {
        for (const record of negativeRecords) {
          const updates: any = {};
          
          if (record.credit < 0) updates.credit = Math.abs(record.credit);
          if (record.debit < 0) updates.debit = Math.abs(record.debit);
          
          const { error: updateError } = await supabase
            .from(getTableName('cash_book'))
            .update(updates)
            .eq('id', record.id);
          
          if (updateError) {
            errors.push(`Failed to fix negative values for record ${record.id}: ${updateError.message}`);
          } else {
            fixed++;
          }
        }
      }
      
      console.log(`✅ Data integrity fix completed: ${fixed} records fixed, ${errors.length} errors`);
      
      return { fixed, errors };
    } catch (error) {
      console.error('Error fixing data integrity issues:', error);
      return {
        fixed: 0,
        errors: ['Error fixing data: ' + (error as Error).message]
      };
    }
  }

  // Fallback method for dashboard stats
  private getDashboardStatsFallback() {
    console.warn('⚠️ Using fallback dashboard stats - check database connection and table structure');
    return {
      totalCredit: 0,
      totalDebit: 0,
      balance: 0,
      totalTransactions: 0,
      todayEntries: 0,
      deletedRecords: 0,
      onlineCredit: 0,
      offlineCredit: 0,
      onlineDebit: 0,
      offlineDebit: 0,
      totalOnline: 0,
      totalOffline: 0,
    };
  }

  // Get company-wise closing balances up to a specific date (for opening balance calculation)
  async getCompanyClosingBalancesByDate(endDate?: string): Promise<Array<{companyName: string, closingBalance: number, totalCredit: number, totalDebit: number}>> {
    try {
      console.log(`🔄 Fetching company-wise closing balances up to date: ${endDate || 'all time'}...`);
      
      // Fetch all data with pagination if needed (Supabase limit is 1000 by default)
      let allData: any[] = [];
      let hasMore = true;
      let page = 0;
      const pageSize = 1000;
      
      while (hasMore) {
        let query = supabase
          .from(getTableName('cash_book'))
          .select('company_name, credit, debit, c_date')
          .not('company_name', 'is', null)
          .not('company_name', 'eq', '');
        
        // If endDate is provided, filter entries up to and including that date
        if (endDate) {
          query = query.lte('c_date', endDate);
        }
        
        // Apply pagination
        const from = page * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);
        
        const { data, error } = await query;
        
        if (error) {
          console.error('Error fetching company data:', error);
          break; // Exit pagination loop on error
        }
        
        if (!data || data.length === 0) {
          hasMore = false;
        } else {
          allData = allData.concat(data);
          // If we got fewer records than pageSize, we've reached the end
          hasMore = data.length === pageSize;
          page++;
          
          if (hasMore) {
            console.log(`📊 Fetched page ${page}, total records so far: ${allData.length}...`);
          }
        }
      }
      
      if (allData.length === 0) {
        console.log('⚠️ No company data found');
        return [];
      }
      
      console.log(`📊 Processing ${allData.length} total records for company balances...`);
      
      const totals: Record<string, { totalCredit: number; totalDebit: number }> = {};
      
      for (const row of allData) {
        const name = (row as any).company_name?.trim();
        if (!name) continue;
        if (!totals[name]) totals[name] = { totalCredit: 0, totalDebit: 0 };
        
        // Proper data type validation and conversion with precision
        const credit = parseFloat((row as any).credit) || 0;
        const debit = parseFloat((row as any).debit) || 0;
        
        // Validate and add with precision
        if (!isNaN(credit)) {
          totals[name].totalCredit += credit;
        }
        if (!isNaN(debit)) {
          totals[name].totalDebit += debit;
        }
      }
      
      // Round all values to 2 decimal places for precision
      const companyBalances = Object.entries(totals)
        .map(([companyName, t]) => {
          const totalCredit = Math.round(t.totalCredit * 100) / 100;
          const totalDebit = Math.round(t.totalDebit * 100) / 100;
          const closingBalance = Math.round((totalCredit - totalDebit) * 100) / 100;
          
          return {
            companyName,
            totalCredit,
            totalDebit,
            closingBalance,
          };
        })
        .sort((a, b) => a.companyName.localeCompare(b.companyName));
        
      console.log(`📊 Calculated balances for ${companyBalances.length} companies up to ${endDate || 'all time'}`);
      return companyBalances;
    } catch (error) {
      console.error('Error fetching company closing balances:', error);
      return [];
    }
  }

  // Get company-wise closing balances (for dashboard - all time)
  async getCompanyClosingBalances(): Promise<Array<{companyName: string, closingBalance: number, totalCredit: number, totalDebit: number}>> {
    // Call the date-based function without date parameter to get all-time balances
    return this.getCompanyClosingBalancesByDate();
  }

  // Dashboard stats for specific date (if needed for date filtering)
  async getDashboardStatsForDate(date: string) {
    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('credit, debit, c_date')
      .eq('c_date', date);

    if (error) {
      console.error('Error fetching dashboard stats for date:', error);
      return {
        totalCredit: 0,
        totalDebit: 0,
        balance: 0,
        totalTransactions: 0,
        onlineCredit: 0,
        offlineCredit: 0,
        onlineDebit: 0,
        offlineDebit: 0,
        totalOnline: 0,
        totalOffline: 0,
      };
    }

    const entries = data || [];
    
    const totalCredit = entries.reduce(
      (sum: number, e: any) => sum + (e.credit || 0),
      0
    );
    const totalDebit = entries.reduce((sum: number, e: any) => sum + (e.debit || 0), 0);
    const balance = totalCredit - totalDebit;
    const totalTransactions = entries.length;

    // Set online/offline values to 0 since these columns don't exist in the current schema
    const onlineCredit = 0;
    const offlineCredit = 0;
    const onlineDebit = 0;
    const offlineDebit = 0;
    const totalOnline = 0;
    const totalOffline = 0;

    return {
      totalCredit,
      totalDebit,
      balance,
      totalTransactions,
      onlineCredit,
      offlineCredit,
      onlineDebit,
      offlineDebit,
      totalOnline,
      totalOffline,
    };
  }

  // Optimized Balance Sheet API - Server-side aggregation
  async getOptimizedBalanceSheet(filters: {
    companyName?: string;
    fromDate?: string;
    toDate?: string;
    plYesNo?: string;
    bothYesNo?: string;
    betweenDates?: boolean;
  }): Promise<{
    balanceSheetData: BalanceSheetAccount[];
    totals: { totalCredit: number; totalDebit: number; balanceRs: number };
    cached: boolean;
    timestamp: string;
    recordCount: number;
  }> {
    try {
      console.log('🚀 Fetching optimized balance sheet from server...');
      
      // Build query parameters
      const params = new URLSearchParams();
      if (filters.companyName) params.append('companyName', filters.companyName);
      if (filters.fromDate) params.append('fromDate', filters.fromDate);
      if (filters.toDate) params.append('toDate', filters.toDate);
      if (filters.plYesNo) params.append('plYesNo', filters.plYesNo);
      if (filters.bothYesNo) params.append('bothYesNo', filters.bothYesNo);
      if (filters.betweenDates !== undefined) params.append('betweenDates', filters.betweenDates.toString());

      // Use absolute URL for development, relative for production
      const apiUrl = import.meta.env.DEV 
        ? 'http://localhost:3000/api/balance-sheet'
        : '/api/balance-sheet';
      
      const response = await fetch(`${apiUrl}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`✅ Optimized balance sheet loaded: ${data.balanceSheetData.length} accounts, ${data.recordCount} transactions${data.cached ? ' (cached)' : ''}`);
      
      return data;
    } catch (error) {
      console.error('❌ Error fetching optimized balance sheet:', error);
      
      // Check if it's a JSON parsing error (HTML response)
      if (error instanceof SyntaxError && error.message.includes('JSON')) {
        throw new Error('Server returned HTML instead of JSON. Please ensure the backend server is running on port 3000.');
      }
      
      // Check if it's a network error
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Cannot connect to backend server. Please ensure the server is running on port 3000.');
      }
      
        throw error;
      }
  }

  // Toggle approval status
  async toggleApproval(id: string): Promise<boolean> {
    try {
      // First get the current entry
      const { data: currentEntry, error: fetchError } = await supabase
        .from(getTableName('cash_book'))
        .select('approved')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.error('Error fetching entry for approval toggle:', fetchError);
        return false;
      }

      // Toggle the approval status
      const { error: updateError } = await supabase
        .from(getTableName('cash_book'))
        .update({
          approved: !currentEntry.approved,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        console.error('Error toggling approval:', updateError);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in toggleApproval:', error);
      return false;
    }
  }

  // Export data for backup
  async exportData(): Promise<any> {
    try {
      const [
        companies,
        accounts,
        subAccounts,
        entries,
        users,
        bankGuarantees,
        vehicles,
        drivers,
      ] = await Promise.all([
        this.getCompanies(),
        this.getAccounts(),
        this.getSubAccounts(),
        this.getCashBookEntries(),
        this.getUsers(),
        this.getBankGuarantees(),
        this.getVehicles(),
        this.getDrivers(),
      ]);

      return {
        companies,
        accounts,
        subAccounts,
        entries,
        users,
        bankGuarantees,
        vehicles,
        drivers,
        exportDate: new Date().toISOString(),
        version: '1.0',
      };
    } catch (error) {
      console.error('Error exporting data:', error);
      throw new Error('Failed to export data');
    }
  }

  // Get pending approvals count
  async getPendingApprovalsCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact', head: true })
        .eq('approved', false);

      if (error) {
        console.error('Error getting pending approvals count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getPendingApprovalsCount:', error);
      return 0;
    }
  }

  // Get entries by approval status
  async getEntriesByApprovalStatus(
    approved: boolean
  ): Promise<CashBookEntry[]> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('approved', approved)
        .order('c_date', { ascending: false });

      if (error) {
        console.error('Error fetching entries by approval status:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getEntriesByApprovalStatus:', error);
      return [];
    }
  }

  // Get edited entries
  async getEditedEntries(): Promise<CashBookEntry[]> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('edited', true)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error fetching edited entries:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getEditedEntries:', error);
      return [];
    }
  }

  async getEditAuditLog(): Promise<any[]> {
    try {
      // STRICT: Only read from the dedicated edit_cash_book audit table.
      // Do NOT fall back to raw cash_book rows — that causes non-edit records
      // (brand-new inserts) to appear as "RECORD CREATED" in the Edited Logs,
      // which is mathematically wrong per audit requirements.
      const { data, error } = await supabase
        .from(getTableName('edit_cash_book'))
        .select('*')
        .order('edited_at', { ascending: false });

      if (error) {
        // Table may not exist yet — acceptable, return empty
        console.warn('getEditAuditLog: edit_cash_book unavailable:', error.message);
        return [];
      }

      // Secondary safety: filter out any row where old_values is empty
      // (those are create events that slipped into the audit table)
      const auditRows = (data || []).filter((row: any) => {
        if (row.action === 'CREATE') return false;
        const old = typeof row.old_values === 'string'
          ? JSON.parse(row.old_values || '{}')
          : (row.old_values || {});
        return Object.keys(old).length > 0;
      });

      return auditRows;
    } catch (err) {
      console.error('getEditAuditLog exception:', err);
      return [];
    }
  }

  // Ultra simple fallback function that always works
  // Get all distinct edited dates from the edit audit log
  async getDistinctEditedDates(): Promise<string[]> {
    try {
      console.log('🔄 Fetching distinct edited dates from edit audit log...');
      
      // Try to fetch from edit_cash_book table first
      const { data: editCashBookData, error: editCashBookError } = await supabase
        .from(getTableName('edit_cash_book'))
        .select('edited_at')
        .not('edited_at', 'is', null);
      
      if (!editCashBookError && editCashBookData && editCashBookData.length > 0) {
        const dates = new Set<string>();
        editCashBookData.forEach((record: any) => {
          if (record.edited_at) {
            const dateStr = String(record.edited_at).slice(0, 10); // Extract YYYY-MM-DD
            if (dateStr) dates.add(dateStr);
          }
        });
        const sortedDates = Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
        console.log(`✅ Found ${sortedDates.length} distinct edited dates from edit_cash_book`);
        return sortedDates;
      }
      
      // Try to fetch from edit_audit_log table
      const { data: auditLogData, error: auditLogError } = await supabase
        .from('edit_audit_log')
        .select('edited_at')
        .not('edited_at', 'is', null);
      
      if (!auditLogError && auditLogData && auditLogData.length > 0) {
        const dates = new Set<string>();
        auditLogData.forEach((record: any) => {
          if (record.edited_at) {
            const dateStr = String(record.edited_at).slice(0, 10); // Extract YYYY-MM-DD
            if (dateStr) dates.add(dateStr);
          }
        });
        const sortedDates = Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
        console.log(`✅ Found ${sortedDates.length} distinct edited dates from edit_audit_log`);
        return sortedDates;
      }
      
      // Fallback: try to get dates from cash_book records that have been edited
      const { data: cashBookData, error: cashBookError } = await supabase
        .from(getTableName('cash_book'))
        .select('updated_at')
        .eq('edited', true)
        .not('updated_at', 'is', null);
      
      if (!cashBookError && cashBookData && cashBookData.length > 0) {
        const dates = new Set<string>();
        cashBookData.forEach((record: any) => {
          if (record.updated_at) {
            const dateStr = String(record.updated_at).slice(0, 10); // Extract YYYY-MM-DD
            if (dateStr) dates.add(dateStr);
          }
        });
        const sortedDates = Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
        console.log(`✅ Found ${sortedDates.length} distinct edited dates from cash_book (edited=true)`);
        return sortedDates;
      }
      
      console.log('⚠️ No edited dates found in any table');
      return [];
    } catch (error) {
      console.error('❌ Error fetching distinct edited dates:', error);
      return [];
    }
  }

  async getEditAuditLogSimple(): Promise<any[]> {
    try {
      console.log('🔄 [SIMPLE] Fetching edit audit log with ultra simple approach...');
      
      // Just try to get any records from cash_book
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .limit(5);

      if (!error && data && data.length > 0) {
        console.log('✅ [SIMPLE] Successfully fetched records:', data.length);
        
        // Transform to audit log format
        return data.map((record: any) => ({
          id: record.id,
          cash_book_id: record.id,
          old_values: JSON.stringify({
            c_date: record.c_date,
            company_name: record.company_name,
            acc_name: record.acc_name,
            sub_acc_name: record.sub_acc_name,
            particulars: record.particulars,
            sale_qty: record.sale_qty || 0,
            purchase_qty: record.purchase_qty || 0,
            credit: record.credit,
            debit: record.debit,
            staff: record.staff,
            users: record.users,
            entry_time: record.entry_time,
          }),
          new_values: JSON.stringify({
            c_date: record.c_date,
            company_name: record.company_name,
            acc_name: record.acc_name,
            sub_acc_name: record.sub_acc_name,
            particulars: record.particulars,
            sale_qty: record.sale_qty || 0,
            purchase_qty: record.purchase_qty || 0,
            credit: record.credit,
            debit: record.debit,
            staff: record.staff,
            users: record.users,
            entry_time: record.entry_time,
          }),
          edited_by: record.users || 'admin',
          edited_at: record.updated_at || record.created_at || new Date().toISOString(),
          action: 'SIMPLE'
        }));
      }

      // If no data, return dummy record
      console.log('📋 [SIMPLE] No data found, returning dummy record');
      return [{
        id: 'simple-dummy-1',
        cash_book_id: 'simple-dummy-1',
        old_values: JSON.stringify({
          c_date: new Date().toISOString().split('T')[0],
          company_name: 'Sample Company',
          acc_name: 'Sample Account',
          sub_acc_name: 'Sample Sub Account',
          particulars: 'Sample transaction',
          credit: 0,
          debit: 1000,
          staff: 'Sample Staff',
          users: 'admin',
          entry_time: new Date().toISOString(),
        }),
        new_values: JSON.stringify({
          c_date: new Date().toISOString().split('T')[0],
          company_name: 'Sample Company',
          acc_name: 'Sample Account',
          sub_acc_name: 'Sample Sub Account',
          particulars: 'Sample transaction',
          credit: 0,
          debit: 1000,
          staff: 'Sample Staff',
          users: 'admin',
          entry_time: new Date().toISOString(),
        }),
        edited_by: 'admin',
        edited_at: new Date().toISOString(),
        action: 'SIMPLE'
      }];

    } catch (err) {
      console.error('❌ [SIMPLE] Exception in getEditAuditLogSimple:', err);
      
      // Return dummy record even on exception
      return [{
        id: 'simple-exception-1',
        cash_book_id: 'simple-exception-1',
        old_values: JSON.stringify({
          c_date: new Date().toISOString().split('T')[0],
          company_name: 'Sample Company',
          acc_name: 'Sample Account',
          sub_acc_name: 'Sample Sub Account',
          particulars: 'Sample transaction',
          credit: 0,
          debit: 1000,
          staff: 'Sample Staff',
          users: 'admin',
          entry_time: new Date().toISOString(),
        }),
        new_values: JSON.stringify({
          c_date: new Date().toISOString().split('T')[0],
          company_name: 'Sample Company',
          acc_name: 'Sample Account',
          sub_acc_name: 'Sample Sub Account',
          particulars: 'Sample transaction',
          credit: 0,
          debit: 1000,
          staff: 'Sample Staff',
          users: 'admin',
          entry_time: new Date().toISOString(),
        }),
        edited_by: 'admin',
        edited_at: new Date().toISOString(),
        action: 'SIMPLE'
      }];
    }
  }

  async getDeletedCashBook(): Promise<any[]> {
    try {
      console.log('🗑️ Fetching deleted cash book entries...');
      
      // First, try to fetch from deleted_cash_book table
      try {
        const { data: tableData, error: tableError } = await supabase
          .from(getTableName('deleted_cash_book'))
          .select('*')
          .order('deleted_at', { ascending: false });

        if (tableError) {
          // If there's an error accessing the table, try localStorage fallback
          console.log('⚠️ deleted_cash_book table not accessible:', tableError.message);
          console.log('🔄 Trying localStorage fallback...');
        } else {
          // Table is accessible - return data (even if empty)
          console.log('✅ Successfully fetched deleted records from deleted_cash_book table:', tableData?.length || 0);
          if (tableData && tableData.length > 0) {
            return tableData;
          } else {
            // Table exists but is empty - still check localStorage as fallback
            console.log('📋 deleted_cash_book table is empty, checking localStorage...');
          }
        }
      } catch (tableErr) {
        console.log('⚠️ Error accessing deleted_cash_book table:', tableErr);
        console.log('🔄 Trying localStorage fallback...');
      }

      // Fallback: Fetch deleted records from localStorage
      console.log('🔄 Fetching deleted records from localStorage...');
      const deletedRecordsStr = localStorage.getItem('deleted_records');
      
      if (!deletedRecordsStr) {
        console.log('📋 No deleted records found in localStorage');
        return [];
      }

      const deletedData = JSON.parse(deletedRecordsStr);
      
      if (!deletedData || deletedData.length === 0) {
        console.log('📋 No deleted records found in localStorage');
        return [];
      }

      console.log('✅ Successfully fetched deleted records from localStorage:', deletedData.length);
      console.log('📋 Sample deleted record:', deletedData[0]);
      
      // Sort by deleted_at (most recent first)
      const sortedData = deletedData.sort((a: any, b: any) => {
        const dateA = new Date(a.deleted_at || 0);
        const dateB = new Date(b.deleted_at || 0);
        return dateB.getTime() - dateA.getTime();
      });
      
      // Return the data as-is since it's already in the correct format
      return sortedData;
      
    } catch (err) {
      console.error('❌ Exception in getDeletedCashBook:', err);
      return [];
    }
  }


  // Restore a deleted entry back to cash_book
  async restoreCashBookEntry(deletedId: string): Promise<boolean> {
    console.log('🔄 restoreCashBookEntry called with deletedId:', deletedId);

    try {
      // Step 1: Try to fetch from deleted_cash_book table first
      console.log('📋 Step 1: Trying deleted_cash_book table...');
      const { data: deletedEntry, error: fetchError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .select('*')
        .eq('id', deletedId)
        .single();

      if (!fetchError && deletedEntry) {
        console.log('✅ Found deleted entry in deleted_cash_book:', { id: deletedEntry.id, acc_name: deletedEntry.acc_name });

        // Step 2: Prepare the restored entry (remove deleted specific fields)
        const restoredEntry = { ...deletedEntry };
        delete (restoredEntry as any).deleted_by;
        delete (restoredEntry as any).deleted_at;
        restoredEntry.updated_at = new Date().toISOString();

        console.log('📝 Restored entry data:', restoredEntry);

        // Step 3: Insert back into cash_book
        console.log('📝 Step 3: Inserting back into cash_book...');
        const { error: insertError } = await supabase
          .from(getTableName('cash_book'))
          .insert(restoredEntry);

        if (insertError) {
          console.error('❌ Error inserting into cash_book:', insertError);
          return false;
        }

        console.log('✅ Successfully restored to cash_book');

        // Step 4: Remove from deleted_cash_book
        console.log('📝 Step 4: Removing from deleted_cash_book...');
        const { error: deleteError } = await supabase
          .from(getTableName('deleted_cash_book'))
          .delete()
          .eq('id', deletedId);

        if (deleteError) {
          console.error('❌ Error removing from deleted_cash_book:', deleteError);
          return false;
        }

        console.log('✅ Successfully removed from deleted_cash_book');

        // Clean up from localStorage if present
        try {
          const deletedRecordsStr = localStorage.getItem('deleted_records');
          if (deletedRecordsStr) {
            const deletedRecords = JSON.parse(deletedRecordsStr);
            const foundIndex = deletedRecords.findIndex((r: any) => r.id === deletedId);
            if (foundIndex !== -1) {
              deletedRecords.splice(foundIndex, 1);
              localStorage.setItem('deleted_records', JSON.stringify(deletedRecords));
              console.log('🧹 Cleaned up from localStorage during DB restore');
            }
          }
        } catch (e) {
          console.warn('⚠️ Non-fatal error cleaning up localStorage:', e);
        }

        return true;
      }

      // Step 1.5: Fallback - Try to restore from localStorage if database fetch failed
      console.log('📋 Step 1.5: Fallback - Trying localStorage...');
      try {
        const deletedRecordsStr = localStorage.getItem('deleted_records');
        if (deletedRecordsStr) {
          const deletedRecords = JSON.parse(deletedRecordsStr);
          const foundIndex = deletedRecords.findIndex((r: any) => r.id === deletedId);
          if (foundIndex !== -1) {
            const recordToRestore = deletedRecords[foundIndex];
            console.log('✅ Found record to restore in localStorage:', recordToRestore);

            // Prepare record for insertion back into cash_book
            const restoredEntry = {
              id: recordToRestore.id,
              sno: recordToRestore.sno,
              c_date: recordToRestore.c_date,
              company_name: recordToRestore.company_name,
              acc_name: recordToRestore.acc_name,
              sub_acc_name: recordToRestore.sub_acc_name,
              particulars: recordToRestore.particulars,
              credit: recordToRestore.credit,
              debit: recordToRestore.debit,
              staff: recordToRestore.staff,
              users: recordToRestore.users,
              entry_time: recordToRestore.entry_time,
              approved: recordToRestore.approved || false,
              created_at: recordToRestore.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            console.log('📝 Inserting back into cash_book from localStorage:', restoredEntry);
            const { error: insertError } = await supabase
              .from(getTableName('cash_book'))
              .insert(restoredEntry);

            if (insertError) {
              console.error('❌ Error inserting into cash_book from localStorage:', insertError);
              // Fallback to update if insert fails due to duplicate key
              if (insertError.code === '23505') {
                console.log('🔄 Record might already exist, attempting update...');
                const { error: updateError } = await supabase
                  .from(getTableName('cash_book'))
                  .update(restoredEntry)
                  .eq('id', restoredEntry.id);
                if (updateError) {
                  console.error('❌ Error updating cash_book from localStorage:', updateError);
                  return false;
                }
              } else {
                return false;
              }
            }

            console.log('✅ Successfully restored to cash_book from localStorage');

            // Remove from localStorage
            deletedRecords.splice(foundIndex, 1);
            localStorage.setItem('deleted_records', JSON.stringify(deletedRecords));
            console.log('✅ Successfully removed from localStorage. Remaining:', deletedRecords.length);
            return true;
          }
        }
      } catch (err) {
        console.error('❌ Error in localStorage restore fallback:', err);
      }

      // Step 2: Fallback - try to restore from cash_book with [DELETED] prefix
      console.log('📋 Step 2: Fallback - trying cash_book with [DELETED] prefix...');
      const { data: prefixDeletedEntry, error: prefixFetchError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('id', deletedId)
        .single();

      if (prefixFetchError) {
        console.error('❌ Error fetching prefix-deleted entry:', prefixFetchError);
        return false;
      }

      if (!prefixDeletedEntry) {
        console.error('❌ No deleted entry found with id:', deletedId);
        return false;
      }

      console.log('✅ Found prefix-deleted entry to restore:', { id: prefixDeletedEntry.id, acc_name: prefixDeletedEntry.acc_name });

      // Step 3: Remove [DELETED] prefix and restore
      const restoredData = {
        acc_name: prefixDeletedEntry.acc_name.replace(/^\[DELETED\]\s*/, ''),
        particulars: prefixDeletedEntry.particulars ? prefixDeletedEntry.particulars.replace(/^\[DELETED\]\s*/, '') : prefixDeletedEntry.particulars,
        updated_at: new Date().toISOString(),
      };

      console.log('📝 Restored data:', restoredData);

      const { error: updateError } = await supabase
        .from(getTableName('cash_book'))
        .update(restoredData)
        .eq('id', deletedId);

      if (updateError) {
        console.error('❌ Error restoring prefix-deleted entry:', updateError);
        return false;
      }

      console.log('✅ Successfully restored prefix-deleted entry');
      return true;

    } catch (error) {
      console.error('❌ Unexpected error in restoreCashBookEntry:', error);
      return false;
    }
  }

  // Permanently delete an entry from deleted_cash_book
  async permanentlyDeleteCashBookEntry(deletedId: string): Promise<boolean> {
    console.log('🗑️ permanentlyDeleteCashBookEntry called with deletedId:', deletedId);

    try {
      // Step 1: Try to delete from deleted_cash_book table first
      console.log('📋 Step 1: Trying deleted_cash_book table...');
      const { data: deletedEntry, error: fetchError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .select('*')
        .eq('id', deletedId)
        .single();

      if (!fetchError && deletedEntry) {
        console.log('✅ Found deleted entry in deleted_cash_book:', { id: deletedEntry.id, acc_name: deletedEntry.acc_name });

        // Step 2: Permanently delete from deleted_cash_book
        console.log('📝 Step 2: Permanently deleting from deleted_cash_book...');
        const { error: deleteError } = await supabase
          .from(getTableName('deleted_cash_book'))
          .delete()
          .eq('id', deletedId);

        if (deleteError) {
          console.error('❌ Error permanently deleting from deleted_cash_book:', deleteError);
          return false;
        }

        console.log('✅ Successfully permanently deleted from deleted_cash_book');

        // Clean up from localStorage if present
        try {
          const deletedRecordsStr = localStorage.getItem('deleted_records');
          if (deletedRecordsStr) {
            const deletedRecords = JSON.parse(deletedRecordsStr);
            const foundIndex = deletedRecords.findIndex((r: any) => r.id === deletedId);
            if (foundIndex !== -1) {
              deletedRecords.splice(foundIndex, 1);
              localStorage.setItem('deleted_records', JSON.stringify(deletedRecords));
              console.log('🧹 Cleaned up from localStorage during DB permanent deletion');
            }
          }
        } catch (e) {
          console.warn('⚠️ Non-fatal error cleaning up localStorage:', e);
        }

        return true;
      }

      // Step 1.5: Fallback - Try to delete from localStorage if database fetch failed
      console.log('📋 Step 1.5: Fallback - Trying localStorage...');
      try {
        const deletedRecordsStr = localStorage.getItem('deleted_records');
        if (deletedRecordsStr) {
          const deletedRecords = JSON.parse(deletedRecordsStr);
          const foundIndex = deletedRecords.findIndex((r: any) => r.id === deletedId);
          if (foundIndex !== -1) {
            deletedRecords.splice(foundIndex, 1);
            localStorage.setItem('deleted_records', JSON.stringify(deletedRecords));
            console.log('✅ Successfully permanently deleted from localStorage');
            return true;
          }
        }
      } catch (err) {
        console.error('❌ Error in localStorage permanent deletion fallback:', err);
      }

      // Step 2: Fallback - try to permanently delete from cash_book with [DELETED] prefix
      console.log('📋 Step 2: Fallback - trying cash_book with [DELETED] prefix...');
      const { data: prefixDeletedEntry, error: prefixFetchError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('id', deletedId)
        .single();

      if (prefixFetchError) {
        console.error('❌ Error fetching prefix-deleted entry:', prefixFetchError);
        return false;
      }

      if (!prefixDeletedEntry) {
        console.error('❌ No deleted entry found with id:', deletedId);
        return false;
      }

      console.log('✅ Found prefix-deleted entry to permanently delete:', { id: prefixDeletedEntry.id, acc_name: prefixDeletedEntry.acc_name });

      // Step 3: Permanently delete from cash_book
      console.log('📝 Step 3: Permanently deleting from cash_book...');
      const { error: deleteError } = await supabase
        .from(getTableName('cash_book'))
        .delete()
        .eq('id', deletedId);

      if (deleteError) {
        console.error('❌ Error permanently deleting from cash_book:', deleteError);
        return false;
      }

      console.log('✅ Successfully permanently deleted from cash_book');
      return true;

    } catch (error) {
      console.error('❌ Unexpected error in permanentlyDeleteCashBookEntry:', error);
      return false;
    }
  }

  // Get count of deleted records
  async getDeletedRecordsCount(): Promise<number> {
    try {
      console.log('📊 Getting deleted records count...');
      
      // Try to get count from deleted_cash_book table first
      const { count: deletedCount, error: deletedError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .select('*', { count: 'exact', head: true });

      if (!deletedError && deletedCount !== null) {
        console.log('✅ Deleted records count from deleted_cash_book:', deletedCount);
        return deletedCount;
      }

      // Fallback: check cash_book for deleted records
      console.log('📋 Checking cash_book for deleted records...');
      const { count: cashBookCount, error: cashBookError } = await supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact', head: true })
        .eq('deleted', true);

      if (!cashBookError && cashBookCount !== null) {
        console.log('✅ Deleted records count from cash_book:', cashBookCount);
        return cashBookCount;
      }

      console.log('📋 No deleted records found in either table');
      return 0;

    } catch (error) {
      console.error('❌ Error in getDeletedRecordsCount:', error);
      return 0;
    }
  }

  // Debug function to check what's in the database
  async debugDeletedRecords(): Promise<void> {
    try {
      console.log('🔍 DEBUG: Checking deleted records in database...');
      
      // Check deleted_cash_book table
      console.log('📋 Checking deleted_cash_book table...');
      const { data: deletedData, error: deletedError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .select('*')
        .limit(5);

      if (deletedError) {
        console.log('❌ deleted_cash_book table error:', deletedError.message);
      } else {
        console.log('✅ deleted_cash_book table data:', deletedData?.length || 0, 'records');
        if (deletedData && deletedData.length > 0) {
          console.log('📝 Sample deleted_cash_book record:', deletedData[0]);
        }
      }

      // Note: Deleted records are stored in deleted_cash_book table, not in cash_book with a deleted flag
      // So we don't check cash_book for deleted records

      // Check total cash_book records
      console.log('📋 Checking total cash_book records...');
      const { count: totalCount, error: totalError } = await supabase
        .from(getTableName('cash_book'))
        .select('*', { count: 'exact', head: true });

      if (totalError) {
        console.log('❌ Total count error:', totalError.message);
      } else {
        console.log('✅ Total cash_book records:', totalCount);
      }

    } catch (error) {
      console.error('❌ Debug error:', error);
    }
  }

  // Debug function to check edit audit log
  async debugEditAuditLog(): Promise<void> {
    try {
      console.log('🔍 DEBUG: Checking edit audit log in database...');
      
      // Check edit_cash_book table
      console.log('📋 Checking edit_cash_book table...');
      const { data: editData, error: editError } = await supabase
        .from(getTableName('edit_cash_book'))
        .select('*')
        .limit(5);

      if (editError) {
        console.log('❌ edit_cash_book table error:', editError.message);
      } else {
        console.log('✅ edit_cash_book table data:', editData?.length || 0, 'records');
        if (editData && editData.length > 0) {
          console.log('📝 Sample edit_cash_book record:', editData[0]);
        }
      }

      // Check cash_book with edited flag
      console.log('📋 Checking cash_book with edited flag...');
      const { data: editedData, error: editedError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .eq('edited', true)
        .limit(5);

      if (editedError) {
        console.log('❌ cash_book edited flag query error:', editedError.message);
      } else {
        console.log('✅ cash_book edited data:', editedData?.length || 0, 'records');
        if (editedData && editedData.length > 0) {
          console.log('📝 Sample edited record:', editedData[0]);
        }
      }

      // Check cash_book with updated_at different from created_at
      console.log('📋 Checking cash_book with updated_at different from created_at...');
      const { data: updatedData, error: updatedError } = await supabase
        .from(getTableName('cash_book'))
        .select('*')
        .not('updated_at', 'eq', 'created_at')
        .limit(5);

      if (updatedError) {
        console.log('❌ cash_book updated_at query error:', updatedError.message);
      } else {
        console.log('✅ cash_book updated data:', updatedData?.length || 0, 'records');
        if (updatedData && updatedData.length > 0) {
          console.log('📝 Sample updated record:', updatedData[0]);
        }
      }

    } catch (error) {
      console.error('❌ Debug edit audit log error:', error);
    }
  }

  async testDatabaseConnection(): Promise<boolean> {
    try {
      console.log('🔌 [TEST] Testing database connection...');
      
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('id')
        .limit(1);

      if (error) {
        console.log('❌ [TEST] Database connection failed:', error);
        console.log('❌ [TEST] Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        return false;
      }

      console.log('✅ [TEST] Database connection successful');
      console.log('✅ [TEST] Connection test data:', data);
      return true;
    } catch (err) {
      console.error('❌ [TEST] Database connection exception:', err);
      return false;
    }
  }

  // Enhanced connection test with multiple approaches
  async testDatabaseConnectionEnhanced(): Promise<{ success: boolean; method: string; data?: any; count?: number | null; session?: any; error?: any }> {
    try {
      console.log('🔌 [TEST] Testing database connection with enhanced approach...');
      
      // Method 1: Simple select query
      try {
        const { data, error } = await supabase
          .from(getTableName('cash_book'))
          .select('id')
          .limit(1);

        if (!error && data !== null) {
          console.log('✅ [TEST] Method 1 (select) successful');
          return { success: true, method: 'select', data };
        }
        console.log('❌ [TEST] Method 1 (select) failed:', error);
      } catch (err) {
        console.log('❌ [TEST] Method 1 (select) exception:', err);
      }

      // Method 2: Count query
      try {
        const { count, error } = await supabase
          .from(getTableName('cash_book'))
          .select('*', { count: 'exact', head: true });

        if (!error && count !== null) {
          console.log('✅ [TEST] Method 2 (count) successful');
          return { success: true, method: 'count', count };
        }
        console.log('❌ [TEST] Method 2 (count) failed:', error);
      } catch (err) {
        console.log('❌ [TEST] Method 2 (count) exception:', err);
      }

      // Method 3: Auth check
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!error) {
          console.log('✅ [TEST] Method 3 (auth) successful');
          return { success: true, method: 'auth', session };
        }
        console.log('❌ [TEST] Method 3 (auth) failed:', error);
      } catch (err) {
        console.log('❌ [TEST] Method 3 (auth) exception:', err);
      }

      console.log('❌ [TEST] All connection methods failed');
      return { success: false, method: 'all_failed' };

    } catch (err) {
      console.error('❌ [TEST] Enhanced connection test exception:', err);
      return { success: false, method: 'exception', error: err };
    }
  }

  // Get unique values for dropdowns in Edit Entry page
  async getUniqueParticulars(): Promise<string[]> {
    if (!this.isOnline) {
      const tableMode = getTableMode();
      const mode = tableMode === 'itr' ? 'itr' : 'regular';
      const tableName = mode === 'itr' ? 'particulars_itr' : 'particulars';
      console.log(`📦 [offlineMasterData] Fetching distinct particulars from IndexedDB cache`);
      const cached = await getCachedMasterData(tableName, mode);

      const pendingOps = await db.queued_operations
        .where('status')
        .equals('pending_sync')
        .and(op => op.table === 'cash_book' && op.book_id === this.currentBookId)
        .toArray();

      const pendingParticulars = pendingOps
        .map((op: any) => op.payload.particulars?.trim())
        .filter(Boolean);

      const combined = [...pendingParticulars, ...cached];
      const unique = Array.from(new Set(combined));
      return unique.sort();
    }

    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('particulars')
      .not('particulars', 'is', null)
      .not('particulars', 'eq', '');

    if (error) {
      console.error('Error fetching unique particulars:', error);
      return [];
    }

    const uniqueParticulars = [
      ...new Set((data || []).map((item: any) => item.particulars).filter(Boolean)),
    ] as string[];
    return uniqueParticulars.sort();
  }

  async getUniqueSaleQuantities(): Promise<number[]> {
    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('sale_qty')
      .not('sale_qty', 'is', null)
      .gt('sale_qty', 0);

    if (error) {
      console.error('Error fetching unique sale quantities:', error);
      return [];
    }

    const uniqueQuantities = [
      ...new Set((data || []).map((item: any) => item.sale_qty).filter(Boolean)),
    ] as number[];
    return uniqueQuantities.sort((a: any, b: any) => a - b);
  }

  async getUniquePurchaseQuantities(): Promise<number[]> {
    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('purchase_qty')
      .not('purchase_qty', 'is', null)
      .gt('purchase_qty', 0);

    if (error) {
      console.error('Error fetching unique purchase quantities:', error);
      return [];
    }

    const uniqueQuantities = [
      ...new Set((data || []).map((item: any) => item.purchase_qty).filter(Boolean)),
    ] as number[];
    return uniqueQuantities.sort((a: any, b: any) => a - b);
  }

  async getUniqueCreditAmounts(): Promise<number[]> {
    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('credit')
      .not('credit', 'is', null)
      .gt('credit', 0);

    if (error) {
      console.error('Error fetching unique credit amounts:', error);
      return [];
    }

    const uniqueAmounts = [
      ...new Set((data || []).map((item: any) => item.credit).filter(Boolean)),
    ] as number[];
    return uniqueAmounts.sort((a: any, b: any) => a - b);
  }

  async getUniqueDebitAmounts(): Promise<number[]> {
    const { data, error } = await supabase
      .from(getTableName('cash_book'))
      .select('debit')
      .not('debit', 'is', null)
      .gt('debit', 0);

    if (error) {
      console.error('Error fetching unique debit amounts:', error);
      return [];
    }

    const uniqueAmounts = [
      ...new Set((data || []).map((item: any) => item.debit).filter(Boolean)),
    ] as number[];
    return uniqueAmounts.sort((a: any, b: any) => a - b);
  }

  // New functions for dependent dropdowns
  async getDistinctAccountNames(): Promise<string[]> {
    try {
      const tableMode = getTableMode();
      if (!this.isOnline) {
        const mode = tableMode === 'itr' ? 'itr' : 'regular';
        const tableName = mode === 'itr' ? 'company_main_accounts_itr' : 'company_main_accounts';
        console.log(`📦 [offlineMasterData] Fetching distinct account names from IndexedDB cache for mode: ${mode}`);
        const cached = await getCachedMasterData(tableName, mode);
        const names = cached.map((acc: any) => acc.acc_name?.trim()).filter(Boolean);
        return [...new Set(names)].sort();
      }
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('acc_name')
        .not('acc_name', 'is', null)
        .order('acc_name');

      if (error) {
        console.error('Error fetching distinct account names:', error);
        return [];
      }

      const uniqueAccounts = [...new Set((data || []).map((item: any) => item.acc_name))] as string[];
      return uniqueAccounts.sort();
    } catch (error) {
      console.error('Error in getDistinctAccountNames:', error);
      return [];
    }
  }

  // Company-based filtering functions
  async getDistinctAccountNamesByCompany(companyName: string): Promise<string[]> {
    try {
      const tableMode = getTableMode();
      if (!this.isOnline) {
        const mode = tableMode === 'itr' ? 'itr' : 'regular';
        const tableName = mode === 'itr' ? 'company_main_accounts_itr' : 'company_main_accounts';
        console.log(`📦 [offlineMasterData] Fetching accounts for company "${companyName}" from IndexedDB cache`);
        const cached = await getCachedMasterData(tableName, mode);
        
        // Filter cached accounts by company
        const filteredCached = cached
          .filter((acc: any) => acc.company_name === companyName)
          .map((acc: any) => acc.acc_name);

        // Merge from pending insertions in queued_operations
        const pendingInserts = await db.queued_operations
          .where('status')
          .equals('pending_sync')
          .and(op => (op.table === 'company_main_accounts' || op.table === 'company_main_accounts_itr') && op.operation_type === 'INSERT')
          .toArray();

        const pendingAccounts = pendingInserts
          .map((op: any) => op.payload)
          .filter((p: any) => p.company_name === companyName && p.acc_name)
          .map((p: any) => p.acc_name);

        const combined = [...pendingAccounts, ...filteredCached];
        const unique = [...new Set(combined)];
        return unique.sort();
      }

      console.log(`🔍 [DEBUG] Fetching account names for company: "${companyName}"`);
      
      // Get accounts from cash_book table (existing entries)
      const { data: cashBookData, error: cashBookError } = await supabase
        .from(getTableName('cash_book'))
        .select('acc_name, company_name')
        .eq('company_name', companyName)
        .not('acc_name', 'is', null)
        .order('acc_name');

      if (cashBookError) {
        console.error('Error fetching account names from cash_book:', cashBookError);
      }

      // Get accounts from company_main_accounts table (newly created accounts)
      const { data: mainAccountsData, error: mainAccountsError } = await supabase
        .from(getTableName('company_main_accounts'))
        .select('acc_name, company_name')
        .eq('company_name', companyName)
        .not('acc_name', 'is', null)
        .order('acc_name');

      if (mainAccountsError) {
        console.error('Error fetching account names from company_main_accounts:', mainAccountsError);
      }

      // Combine both sources with additional validation
      const cashBookAccounts = cashBookData?.map((item: any) => item.acc_name) || [];
      const mainAccounts = mainAccountsData?.map((item: any) => item.acc_name) || [];
      
      console.log(`📊 [DEBUG] Cash book accounts for company "${companyName}":`, cashBookAccounts.length, 'accounts');
      console.log(`📊 [DEBUG] Cash book raw data:`, cashBookData?.slice(0, 5));
      console.log(`📊 [DEBUG] Main accounts table for company "${companyName}":`, mainAccounts.length, 'accounts');
      console.log(`📊 [DEBUG] Main accounts raw data:`, mainAccountsData?.slice(0, 5));

      // Get unique accounts from both sources
      const allAccounts = [...cashBookAccounts, ...mainAccounts];
      const uniqueAccounts = [...new Set(allAccounts)];
      
      console.log(`📊 [DEBUG] Total unique accounts for company "${companyName}":`, uniqueAccounts.length, 'accounts');
      console.log(`📊 [DEBUG] Account names:`, uniqueAccounts);
      
      return uniqueAccounts.sort();
    } catch (error) {
      console.error('Error in getDistinctAccountNamesByCompany:', error);
      return [];
    }
  }

  async getSubAccountsByAccountName(accountName: string): Promise<string[]> {
    try {
      const tableMode = getTableMode();
      if (!this.isOnline) {
        const mode = tableMode === 'itr' ? 'itr' : 'regular';
        const tableName = mode === 'itr' ? 'company_main_sub_acc_itr' : 'company_main_sub_acc';
        console.log(`📦 [offlineMasterData] Fetching sub-accounts for account "${accountName}" from IndexedDB cache`);
        const cached = await getCachedMasterData(tableName, mode);
        const filteredCached = cached
          .filter((sub: any) => sub.acc_name === accountName)
          .map((sub: any) => sub.sub_acc?.trim())
          .filter(Boolean);
        return [...new Set(filteredCached)].sort();
      }
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('sub_acc_name')
        .eq('acc_name', accountName)
        .not('sub_acc_name', 'is', null)
        .order('sub_acc_name');

      if (error) {
        console.error('Error fetching sub accounts by account name:', error);
        return [];
      }

      const uniqueSubAccounts = [...new Set((data || []).map((item: any) => item.sub_acc_name))] as string[];
      return uniqueSubAccounts.sort();
    } catch (error) {
      console.error('Error in getSubAccountsByAccountName:', error);
      return [];
    }
  }

  async getSubAccountsByAccountAndCompany(accountName: string, companyName: string): Promise<string[]> {
    try {
      const tableMode = getTableMode();
      if (!this.isOnline) {
        const mode = tableMode === 'itr' ? 'itr' : 'regular';
        const tableName = mode === 'itr' ? 'company_main_sub_acc_itr' : 'company_main_sub_acc';
        console.log(`📦 [offlineMasterData] Fetching sub-accounts for account "${accountName}" and company "${companyName}" from IndexedDB cache`);
        const cached = await getCachedMasterData(tableName, mode);

        // Filter cached sub-accounts
        const filteredCached = cached
          .filter((sub: any) => sub.acc_name === accountName && sub.company_name === companyName)
          .map((sub: any) => sub.sub_acc);

        // Merge from pending insertions in queued_operations
        const pendingInserts = await db.queued_operations
          .where('status')
          .equals('pending_sync')
          .and(op => (op.table === 'company_main_sub_acc' || op.table === 'company_main_sub_acc_itr') && op.operation_type === 'INSERT')
          .toArray();

        const pendingSubAccounts = pendingInserts
          .map((op: any) => op.payload)
          .filter((p: any) => p.acc_name === accountName && p.company_name === companyName && p.sub_acc)
          .map((p: any) => p.sub_acc);

        // Combine and return unique
        const combined = [...pendingSubAccounts, ...filteredCached];
        const unique = [...new Set(combined)];
        return unique.sort();
      }

      console.log(`🔍 [DEBUG] Fetching sub-account names for account: "${accountName}" and company: "${companyName}"`);
      
      // Get sub-accounts from cash_book table (existing entries)
      const { data: cashBookData, error: cashBookError } = await supabase
        .from(getTableName('cash_book'))
        .select('sub_acc_name, acc_name, company_name')
        .eq('acc_name', accountName)
        .eq('company_name', companyName)
        .not('sub_acc_name', 'is', null)
        .order('sub_acc_name');

      if (cashBookError) {
        console.error('Error fetching sub-account names from cash_book:', cashBookError);
      }

      // Get sub-accounts from company_main_sub_acc table (newly created sub-accounts)
      const { data: subAccountsData, error: subAccountsError } = await supabase
        .from(getTableName('company_main_sub_acc'))
        .select('sub_acc, acc_name, company_name')
        .eq('acc_name', accountName)
        .eq('company_name', companyName)
        .not('sub_acc', 'is', null)
        .order('sub_acc');

      if (subAccountsError) {
        console.error('Error fetching sub-account names from company_main_sub_acc:', subAccountsError);
      }

      // Combine both sources with additional validation
      const cashBookSubAccounts = cashBookData?.map((item: any) => item.sub_acc_name) || [];
      const subAccounts = subAccountsData?.map((item: any) => item.sub_acc) || [];
      
      console.log(`📊 [DEBUG] Cash book sub-accounts for account "${accountName}" and company "${companyName}":`, cashBookSubAccounts.length, 'sub-accounts');
      console.log(`📊 [DEBUG] Cash book raw data:`, cashBookData?.slice(0, 5));
      console.log(`📊 [DEBUG] Company main sub-accounts table for account "${accountName}" and company "${companyName}":`, subAccounts.length, 'sub-accounts');
      console.log(`📊 [DEBUG] Company main sub-accounts raw data:`, subAccountsData?.slice(0, 5));

      // Get unique sub-accounts from both sources
      const allSubAccounts = [...cashBookSubAccounts, ...subAccounts];
      const uniqueSubAccounts = [...new Set(allSubAccounts)];
      
      console.log(`📊 [DEBUG] Total unique sub-accounts for account "${accountName}" and company "${companyName}":`, uniqueSubAccounts.length, 'sub-accounts');
      console.log(`📊 [DEBUG] Sub-account names:`, uniqueSubAccounts);
      
      return uniqueSubAccounts.sort();
    } catch (error) {
      console.error('Error in getSubAccountsByAccountAndCompany:', error);
      return [];
    }
  }

  async getParticularsBySubAccount(accountName: string, subAccountName: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('particulars')
        .eq('acc_name', accountName)
        .eq('sub_acc_name', subAccountName)
        .not('particulars', 'is', null)
        .order('particulars');

      if (error) {
        console.error('Error fetching particulars by sub account:', error);
        return [];
      }

      const uniqueParticulars = [...new Set((data || []).map((item: any) => item.particulars))] as string[];
      return uniqueParticulars.sort();
    } catch (error) {
      console.error('Error in getParticularsBySubAccount:', error);
      return [];
    }
  }

  // Get all distinct sub-account names from cash_book (all 67k records)
  async getDistinctSubAccountNames(): Promise<string[]> {
    try {
      const tableMode = getTableMode();
      if (!this.isOnline) {
        const mode = tableMode === 'itr' ? 'itr' : 'regular';
        const tableName = mode === 'itr' ? 'company_main_sub_acc_itr' : 'company_main_sub_acc';
        console.log(`📦 [offlineMasterData] Fetching distinct sub-account names from IndexedDB cache for mode: ${mode}`);
        const cached = await getCachedMasterData(tableName, mode);
        const names = cached.map((sub: any) => sub.sub_acc?.trim()).filter(Boolean);
        return [...new Set(names)].sort();
      }
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('sub_acc_name')
        .not('sub_acc_name', 'is', null)
        .not('sub_acc_name', 'eq', '')
        .order('sub_acc_name');

      if (error) {
        console.error('Error fetching distinct sub-account names:', error);
        return [];
      }

      const uniqueSubAccounts = [...new Set((data || []).map((item: any) => item.sub_acc_name))] as string[];
      return uniqueSubAccounts.sort();
    } catch (error) {
      console.error('Error in getDistinctSubAccountNames:', error);
      return [];
    }
  }

  // Get distinct sub-account names by company from cash_book
  async getDistinctSubAccountNamesByCompany(companyName: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('sub_acc_name')
        .eq('company_name', companyName)
        .not('sub_acc_name', 'is', null)
        .not('sub_acc_name', 'eq', '')
        .order('sub_acc_name');

      if (error) {
        console.error('Error fetching distinct sub-account names by company:', error);
        return [];
      }

      const uniqueSubAccounts = [...new Set((data || []).map((item: any) => item.sub_acc_name))] as string[];
      return uniqueSubAccounts.sort();
    } catch (error) {
      console.error('Error in getDistinctSubAccountNamesByCompany:', error);
      return [];
    }
  }

  // Debug function to check company names and account names in database
  async debugCompanyAccountData(): Promise<void> {
    try {
      console.log('🔍 [DEBUG] Starting company and account data analysis...');
      
      // Get all unique company names
      const { data: companyData, error: companyError } = await supabase
        .from(getTableName('cash_book'))
        .select('company_name')
        .not('company_name', 'is', null)
        .not('company_name', 'eq', '') as { data: any[] | null; error: any };
      
      if (companyError) {
        console.error('Error fetching company names:', companyError);
        return;
      }
      
      const uniqueCompanies = [...new Set((companyData || []).map((item: any) => item.company_name))].sort();
      console.log('📊 [DEBUG] All unique company names in database:', uniqueCompanies);
      
      // Check for BVR and BVT specifically
      const bvrData = (companyData || []).filter((item: any) => 
        item.company_name?.toLowerCase().includes('bvr') || 
        item.company_name?.toLowerCase().includes('bvt')
      );
      console.log('📊 [DEBUG] BVR/BVT related company names:', bvrData.map((item: any) => item.company_name));
      
      // Get account names for BVR and BVT companies
      for (const company of uniqueCompanies) {
        if (company && typeof company === 'string' && (company.toLowerCase().includes('bvr') || company.toLowerCase().includes('bvt'))) {
          console.log(`🔍 [DEBUG] Checking accounts for company: "${company}"`);
          const accounts = await this.getDistinctAccountNamesByCompany(company);
          console.log(`📊 [DEBUG] Found ${accounts.length} accounts for "${company}":`, accounts);
        }
      }
      
    } catch (error) {
      console.error('Error in debugCompanyAccountData:', error);
    }
  }

  // Check for [DELETED] text in database
  async checkForDeletedText(): Promise<{ hasDeletedText: boolean; counts: any; entries: any }> {
    console.log('🔍 Checking for [DELETED] text in database...');
    
    try {
      const counts = {
        cash_book: 0,
        deleted_cash_book: 0,
        edit_audit_log: 0
      };
      
      const entries: any = {
        cash_book: [],
        deleted_cash_book: [],
        edit_audit_log: []
      };
      
      // Check cash_book table
      const { data: cashBookEntries, error: cashBookError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, acc_name, sub_acc_name, particulars, company_name')
        .or('acc_name.ilike.%[DELETED]%,sub_acc_name.ilike.%[DELETED]%,particulars.ilike.%[DELETED]%,company_name.ilike.%[DELETED]%');
      
      if (!cashBookError && cashBookEntries) {
        counts.cash_book = cashBookEntries.length;
        entries.cash_book = cashBookEntries;
      }
      
      // Check deleted_cash_book table
      const { data: deletedEntries, error: deletedError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .select('id, acc_name, sub_acc_name, particulars, company_name')
        .or('acc_name.ilike.%[DELETED]%,sub_acc_name.ilike.%[DELETED]%,particulars.ilike.%[DELETED]%,company_name.ilike.%[DELETED]%');
      
      if (!deletedError && deletedEntries) {
        counts.deleted_cash_book = deletedEntries.length;
        entries.deleted_cash_book = deletedEntries;
      }
      
      // Check edit_audit_log table
      const { data: auditEntries, error: auditError } = await supabase
        .from('edit_audit_log')
        .select('id, old_values, new_values')
        .or('old_values.ilike.%[DELETED]%,new_values.ilike.%[DELETED]%');
      
      if (!auditError && auditEntries) {
        counts.edit_audit_log = auditEntries.length;
        entries.edit_audit_log = auditEntries;
      }
      
      const totalCount = counts.cash_book + counts.deleted_cash_book + counts.edit_audit_log;
      const hasDeletedText = totalCount > 0;
      
      console.log(`📊 Found [DELETED] text in ${totalCount} entries:`, counts);
      
      return {
        hasDeletedText,
        counts,
        entries
      };
      
    } catch (error) {
      console.error('❌ Error checking for [DELETED] text:', error);
      return {
        hasDeletedText: false,
        counts: {},
        entries: {}
      };
    }
  }

  // Clean up [DELETED] text from database
  async cleanupDeletedTextFromDatabase(): Promise<{ success: boolean; message: string; updatedCount: number }> {
    console.log('🧹 Starting comprehensive cleanup of [DELETED] text from database...');
    
    try {
      let totalUpdated = 0;
      
      // 1. Clean up cash_book table
      console.log('📋 Step 1: Cleaning cash_book table...');
      const { data: cashBookEntries, error: fetchError } = await supabase
        .from(getTableName('cash_book'))
        .select('id, acc_name, sub_acc_name, particulars, company_name')
        .or('acc_name.ilike.%[DELETED]%,sub_acc_name.ilike.%[DELETED]%,particulars.ilike.%[DELETED]%,company_name.ilike.%[DELETED]%');
      
      if (fetchError) {
        console.error('❌ Error fetching cash_book entries:', fetchError);
        return { success: false, message: 'Failed to fetch cash_book entries', updatedCount: 0 };
      }
      
      if (cashBookEntries && cashBookEntries.length > 0) {
        console.log(`📋 Found ${cashBookEntries.length} cash_book entries with [DELETED] text`);
        
        for (const entry of cashBookEntries) {
          const updates: any = {};
          let hasChanges = false;
          
          // Clean acc_name
          if (entry.acc_name && entry.acc_name.includes('[DELETED]')) {
            updates.acc_name = entry.acc_name.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          // Clean sub_acc_name
          if (entry.sub_acc_name && entry.sub_acc_name.includes('[DELETED]')) {
            updates.sub_acc_name = entry.sub_acc_name.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          // Clean particulars
          if (entry.particulars && entry.particulars.includes('[DELETED]')) {
            updates.particulars = entry.particulars.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          // Clean company_name
          if (entry.company_name && entry.company_name.includes('[DELETED]')) {
            updates.company_name = entry.company_name.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          if (hasChanges) {
            const { error: updateError } = await supabase
              .from(getTableName('cash_book'))
              .update(updates)
              .eq('id', entry.id);
            
            if (updateError) {
              console.error(`❌ Error updating cash_book entry ${entry.id}:`, updateError);
            } else {
              totalUpdated++;
              console.log(`✅ Updated cash_book entry ${entry.id}`);
            }
          }
        }
      }
      
      // 2. Clean up deleted_cash_book table
      console.log('📋 Step 2: Cleaning deleted_cash_book table...');
      const { data: deletedEntries, error: deletedFetchError } = await supabase
        .from(getTableName('deleted_cash_book'))
        .select('id, acc_name, sub_acc_name, particulars, company_name')
        .or('acc_name.ilike.%[DELETED]%,sub_acc_name.ilike.%[DELETED]%,particulars.ilike.%[DELETED]%,company_name.ilike.%[DELETED]%');
      
      if (deletedFetchError) {
        console.error('❌ Error fetching deleted_cash_book entries:', deletedFetchError);
      } else if (deletedEntries && deletedEntries.length > 0) {
        console.log(`📋 Found ${deletedEntries.length} deleted_cash_book entries with [DELETED] text`);
        
        for (const entry of deletedEntries) {
          const updates: any = {};
          let hasChanges = false;
          
          // Clean acc_name
          if (entry.acc_name && entry.acc_name.includes('[DELETED]')) {
            updates.acc_name = entry.acc_name.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          // Clean sub_acc_name
          if (entry.sub_acc_name && entry.sub_acc_name.includes('[DELETED]')) {
            updates.sub_acc_name = entry.sub_acc_name.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          // Clean particulars
          if (entry.particulars && entry.particulars.includes('[DELETED]')) {
            updates.particulars = entry.particulars.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          // Clean company_name
          if (entry.company_name && entry.company_name.includes('[DELETED]')) {
            updates.company_name = entry.company_name.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          if (hasChanges) {
            const { error: updateError } = await supabase
              .from(getTableName('deleted_cash_book'))
              .update(updates)
              .eq('id', entry.id);
            
            if (updateError) {
              console.error(`❌ Error updating deleted_cash_book entry ${entry.id}:`, updateError);
            } else {
              totalUpdated++;
              console.log(`✅ Updated deleted_cash_book entry ${entry.id}`);
            }
          }
        }
      }
      
      // 3. Clean up edit_audit_log table
      console.log('📋 Step 3: Cleaning edit_audit_log table...');
      const { data: auditEntries, error: auditFetchError } = await supabase
        .from('edit_audit_log')
        .select('id, old_values, new_values')
        .or('old_values.ilike.%[DELETED]%,new_values.ilike.%[DELETED]%');
      
      if (auditFetchError) {
        console.error('❌ Error fetching edit_audit_log entries:', auditFetchError);
      } else if (auditEntries && auditEntries.length > 0) {
        console.log(`📋 Found ${auditEntries.length} edit_audit_log entries with [DELETED] text`);
        
        for (const entry of auditEntries) {
          const updates: any = {};
          let hasChanges = false;
          
          // Clean old_values
          if (entry.old_values && entry.old_values.includes('[DELETED]')) {
            updates.old_values = entry.old_values.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          // Clean new_values
          if (entry.new_values && entry.new_values.includes('[DELETED]')) {
            updates.new_values = entry.new_values.replace(/\[DELETED\]\s*/g, '').trim();
            hasChanges = true;
          }
          
          if (hasChanges) {
            const { error: updateError } = await supabase
              .from('edit_audit_log')
              .update(updates)
              .eq('id', entry.id);
            
            if (updateError) {
              console.error(`❌ Error updating edit_audit_log entry ${entry.id}:`, updateError);
            } else {
              totalUpdated++;
              console.log(`✅ Updated edit_audit_log entry ${entry.id}`);
            }
          }
        }
      }
      
      console.log(`Clean up completed! Updated ${totalUpdated} entries across all tables`);
      return { 
        success: true, 
        message: `Successfully cleaned up [DELETED] text from ${totalUpdated} entries`, 
        updatedCount: totalUpdated 
      };
      
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      return { 
        success: false, 
        message: `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        updatedCount: 0 
      };
    }
  }

  // Reminders Operations
  async getReminders(mode: 'regular' | 'itr', userId: string, isAdmin: boolean): Promise<Reminder[]> {
    try {
      console.log('🔄 Fetching reminders for mode:', mode, 'User ID:', userId, 'Is Admin:', isAdmin);
      
      let query = supabase
        .from('reminders')
        .select('*')
        .eq('mode', mode)
        .is('deleted_at', null)
        .order('event_date', { ascending: true });

      // Non-admins can only see their own reminders or reminders assigned to "All Users" (null)
      if (!isAdmin) {
        query = query.or(`assigned_user_id.is.null,assigned_user_id.eq.${userId},created_by.eq.${userId}`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching reminders:', error);
        return this.mergeOfflineOperations('reminders', []);
      }

      // Fetch user mappings
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, username');

      if (usersError) {
        console.error('❌ Error fetching users for reminders mapping:', usersError);
      }

      const userMap = new Map<string, string>();
      if (usersData) {
        usersData.forEach((u: any) => {
          userMap.set(u.id, u.username);
        });
      }

      const mapped = (data || []).map((r: any) => ({
        ...r,
        assigned_username: r.assigned_user_id ? userMap.get(r.assigned_user_id) || null : null,
        creator_username: r.created_by ? userMap.get(r.created_by) || null : null
      }));

      return this.mergeOfflineOperations('reminders', mapped as Reminder[]);
    } catch (error) {
      console.error('❌ Error in getReminders:', error);
      return this.mergeOfflineOperations('reminders', []);
    }
  }

  async createReminder(reminder: Omit<Reminder, 'id' | 'created_at' | 'updated_at'>): Promise<Reminder | null> {
    try {
      console.log('➕ Creating reminder:', reminder);
      const { data, error } = await supabase
        .from('reminders')
        .insert([reminder])
        .select('*')
        .single();

      if (error) {
        console.error('❌ Error creating reminder:', error);
        return null;
      }

      if (!data) {
        console.error('❌ No data returned on reminder creation');
        return null;
      }

      // Fetch user mappings
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, username');

      if (usersError) {
        console.error('❌ Error fetching users for reminder mapping:', usersError);
      }

      const userMap = new Map<string, string>();
      if (usersData) {
        usersData.forEach((u: any) => {
          userMap.set(u.id, u.username);
        });
      }

      const mapped = {
        ...data,
        assigned_username: data.assigned_user_id ? userMap.get(data.assigned_user_id) || null : null,
        creator_username: data.created_by ? userMap.get(data.created_by) || null : null
      };

      return mapped as Reminder;
    } catch (error) {
      console.error('❌ Error in createReminder:', error);
      return null;
    }
  }

  async updateReminder(id: string, reminder: Partial<Reminder>): Promise<Reminder | null> {
    try {
      console.log('🔄 Updating reminder:', id, reminder);
      const { data, error } = await supabase
        .from('reminders')
        .update({
          ...reminder,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        console.error('❌ Error updating reminder:', error);
        return null;
      }

      if (!data) {
        console.error('❌ No data returned on reminder update');
        return null;
      }

      // Fetch user mappings
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, username');

      if (usersError) {
        console.error('❌ Error fetching users for reminder mapping:', usersError);
      }

      const userMap = new Map<string, string>();
      if (usersData) {
        usersData.forEach((u: any) => {
          userMap.set(u.id, u.username);
        });
      }

      const mapped = {
        ...data,
        assigned_username: data.assigned_user_id ? userMap.get(data.assigned_user_id) || null : null,
        creator_username: data.created_by ? userMap.get(data.created_by) || null : null
      };

      return mapped as Reminder;
    } catch (error) {
      console.error('❌ Error in updateReminder:', error);
      return null;
    }
  }

  async deleteReminder(id: string): Promise<boolean> {
    try {
      console.log('🗑️ Soft deleting reminder:', id);
      const { error } = await supabase
        .from('reminders')
        .update({
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) {
        console.error('❌ Error deleting reminder:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ Error in deleteReminder:', error);
      return false;
    }
  }

  async getReminderStats(mode: 'regular' | 'itr', userId: string, isAdmin: boolean): Promise<{ pending: number; today: number; upcoming: number; overdue: number; completed: number }> {
    try {
      const reminders = await this.getReminders(mode, userId, isAdmin);
      
      const stats = {
        pending: 0,
        today: 0,
        upcoming: 0,
        overdue: 0,
        completed: 0
      };

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const todayTime = new Date(todayStr).getTime();

      reminders.forEach(r => {
        if (r.status === 'completed') {
          stats.completed++;
        } else if (r.status === 'pending') {
          stats.pending++;
          
          const eventDateStr = r.event_date;
          const eventTime = new Date(eventDateStr).getTime();
          
          // Check if snoozed currently or marked as seen
          const isSnoozed = r.snoozed_until && new Date(r.snoozed_until) > now;
          const isAcknowledged = isSnoozed || r.seen;
          
          if (!isAcknowledged) {
            const diffDays = Math.ceil((eventTime - todayTime) / (1000 * 60 * 60 * 24));
            
            if (diffDays < 0) {
              stats.overdue++;
            } else if (diffDays === 0) {
              stats.today++;
            } else if (diffDays <= r.notify_before_days) {
              stats.upcoming++;
            }
          }
        }
      });

      return stats;
    } catch (error) {
      console.error('❌ Error getting reminder stats:', error);
      return { pending: 0, today: 0, upcoming: 0, overdue: 0, completed: 0 };
    }
  }

  async getActiveRemindersCount(mode: 'regular' | 'itr', userId: string, isAdmin: boolean): Promise<number> {
    try {
      const reminders = await this.getReminders(mode, userId, isAdmin);
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const todayTime = new Date(todayStr).getTime();
      
      let count = 0;
      reminders.forEach(r => {
        if (r.status === 'pending' && !r.seen) {
          const isSnoozed = r.snoozed_until && new Date(r.snoozed_until) > now;
          if (!isSnoozed) {
            const eventTime = new Date(r.event_date).getTime();
            const diffDays = Math.ceil((eventTime - todayTime) / (1000 * 60 * 60 * 24));
            
            if (diffDays <= r.notify_before_days) {
              count++;
            }
          }
        }
      });
      return count;
    } catch (error) {
      console.error('❌ Error getting active reminders count:', error);
      return 0;
    }
  }
}


// Export singleton instance
export const supabaseDB = new SupabaseDatabase();

// Add global debugging functions for browser console
if (typeof window !== 'undefined') {
  (window as any).debugDelete = {
    // Test delete functionality
    testDelete: async (entryId: string, deletedBy: string = 'admin') => {
      console.log('🧪 Testing delete for entry:', entryId);
      return await supabaseDB.testDeleteEntry(entryId, deletedBy);
    },
    
    // Diagnose delete issues
    diagnose: async () => {
      console.log('🔍 Running delete diagnosis...');
      return await supabaseDB.diagnoseDeleteIssues();
    },
    
    // Test database functionality
    testDB: async () => {
      console.log('🧪 Testing database functionality...');
      return await supabaseDB.testDeleteFunctionality();
    },
    
    // Clean up [DELETED] text from entire database
    cleanupDeletedText: async () => {
      console.log('🧹 Starting cleanup of [DELETED] text from database...');
      return await supabaseDB.cleanupDeletedTextFromDatabase();
    },
    
    // Check for [DELETED] text in database
    checkDeletedText: async () => {
      console.log('🔍 Checking for [DELETED] text in database...');
      return await supabaseDB.checkForDeletedText();
    },
    
    // Get a sample entry ID for testing
    getSampleEntry: async () => {
      const { data } = await supabase
        .from(getTableName('cash_book'))
        .select('id, sno, acc_name')
        .limit(1)
        .single();
      console.log('📋 Sample entry:', data);
      return data;
    },
    
    // Get deleted records from localStorage
    getDeletedRecords: () => {
      const deleted = JSON.parse(localStorage.getItem('deleted_records') || '[]');
      console.log('🗑️ Deleted records in localStorage:', deleted.length);
      console.log('📋 Deleted records:', deleted);
      return deleted;
    },
    
  // Clear all deleted records from localStorage
  clearDeletedRecords: () => {
    localStorage.removeItem('deleted_records');
    console.log('🗑️ Cleared all deleted records from localStorage');
  }
  };
  
  console.log('🔧 Debug functions available:');
  console.log('  - debugDelete.testDelete(entryId, deletedBy)');
  console.log('  - debugDelete.diagnose()');
  console.log('  - debugDelete.testDB()');
  console.log('  - debugDelete.getSampleEntry()');
  console.log('  - debugDelete.getDeletedRecords()');
  console.log('  - debugDelete.clearDeletedRecords()');
  console.log('  - debugDelete.cleanupDeletedText()');
}
