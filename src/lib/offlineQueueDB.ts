import Dexie, { Table } from 'dexie';

export interface QueuedOperation {
  offline_uuid: string; // primary key
  mode: 'regular' | 'itr' | 'finance';
  schema: 'regular' | 'itr' | 'finance' | 'public';
  book_id: string;
  book_name: string;
  user_id: string;
  created_at: string;
  synced_at?: string;
  operation_type: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';
  table: string; // base table name
  payload: any; // data payload
  status: 'pending_sync' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'discarded';
  error_message?: string;
  /** Fixes made before the entry reached the server; saved to the edit log at sync */
  edit_history?: { at: string; by: string; old_values: any; new_values: any }[];
  discarded_by?: string;
  discarded_at?: string;
  discarded_reason?: string;
}

export interface OfflineMasterData {
  id: string; // primary key (e.g., "companies_regular")
  table_name: string;
  mode: 'regular' | 'itr';
  records: any[];
  last_synced_at: string;
}

class OfflineQueueDatabase extends Dexie {
  queued_operations!: Table<QueuedOperation, string>;
  offline_master_data!: Table<OfflineMasterData, string>;

  constructor() {
    super('OfflineQueueDatabase');
    this.version(3).stores({
      queued_operations: 'offline_uuid, mode, schema, book_id, user_id, status, created_at, synced_at',
      offline_master_data: 'id, table_name, mode'
    });
  }
}

export const db = new OfflineQueueDatabase();

