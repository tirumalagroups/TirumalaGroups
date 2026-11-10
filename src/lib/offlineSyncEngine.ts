// Sends entries saved offline to the server. No browser storage or screen code here, so every
// rule can be tested.
//
// The rules that protect the data:
//  - Every entry has its own id, so sending it twice can never create two entries.
//  - Entries go in the order they were made.
//  - If the internet drops, the run stops and the rest wait; nothing is marked as failed.
//  - S.No is given here, at sync.
//  - An entry the server refuses is held for an admin. It is never thrown away.

export type QueueStatus = 'pending_sync' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'discarded';

export interface SyncOp {
  offline_uuid: string;
  mode: 'regular' | 'itr' | 'finance';
  schema: 'regular' | 'itr' | 'finance' | 'public';
  book_id: string;
  created_at: string;
  operation_type: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';
  table: string;
  payload: any;
  status: QueueStatus;
  error_message?: string;
  edit_history?: { at: string; by: string; old_values: any; new_values: any }[];
}

export interface SyncStore {
  all(): Promise<SyncOp[]>;
  update(id: string, patch: Partial<SyncOp> & { synced_at?: string }): Promise<void>;
}

export interface SyncClient {
  schema(name: string): { from(table: string): any };
}

export interface SyncResult {
  synced: number;
  held: number;
  failed: number;
  stoppedByNetwork: boolean;
}

export const QUEUEABLE_TABLES = ['cash_book', 'companies', 'company_main_accounts', 'company_main_sub_acc'];

export const baseTableName = (table: string): string => table.replace(/_itr$/, '');

export const isQueueableWrite = (mode: string, table: string, operation: string | null | undefined): boolean =>
  mode !== 'finance' && operation === 'INSERT' && QUEUEABLE_TABLES.includes(baseTableName(table));

/** True when a request failed because the server could not be reached, not because it refused. */
export const isNetworkFailure = (error: any, status?: number): boolean => {
  if (!error && status !== 0) return false;
  if (status === 0) return true;
  const code = error?.code;
  if (typeof code === 'string' && code.length === 5) return false;
  return /failed to fetch|networkerror|load failed|network request failed|err_internet|err_network|timed? ?out|aborted/i.test(
    String(error?.message || error?.details || error || '')
  );
};

/** The login ended (another device, admin, midnight, no use): the entry waits for the next login. */
export const isSessionEnded = (error: any): boolean =>
  error?.code === 'PT401' || /SESSION_ENDED/.test(String(error?.message || ''));

class NetworkStop extends Error {}

const MASTER_NAMES: Record<string, { fields: string[]; label: string }> = {
  companies: { fields: ['company_name'], label: 'Company' },
  company_main_accounts: { fields: ['company_name', 'acc_name'], label: 'Account' },
  company_main_sub_acc: { fields: ['company_name', 'acc_name', 'sub_acc'], label: 'Sub account' },
};

const check = <T extends { data: any; error: any; status?: number }>(res: T): T => {
  if (res.error && (isNetworkFailure(res.error, res.status) || isSessionEnded(res.error))) throw new NetworkStop();
  return res;
};

const asRows = (payload: any): any[] => (Array.isArray(payload) ? payload : [payload]);

export async function runOfflineSync(
  store: SyncStore,
  client: SyncClient,
  legacy?: (op: SyncOp) => Promise<void>
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, held: 0, failed: 0, stoppedByNetwork: false };
  const everything = await store.all();

  // Anything left "syncing" by a browser closed mid-way goes back in line. Its id makes this safe.
  for (const op of everything.filter(o => o.status === 'syncing')) {
    await store.update(op.offline_uuid, { status: 'pending_sync' });
    op.status = 'pending_sync';
  }

  const queue = everything
    .filter(o => o.status === 'pending_sync' || o.status === 'failed')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const books = new Map<string, { is_locked: boolean } | null>();
  const nextSno = new Map<string, number>();

  const getBook = async (op: SyncOp) => {
    const key = `${op.schema}:${op.book_id}`;
    if (!books.has(key)) {
      const res = check(
        await client.schema(op.schema).from('books').select('id, is_locked').eq('id', op.book_id).maybeSingle()
      );
      if (res.error) throw new Error(res.error.message);
      books.set(key, res.data || null);
    }
    return books.get(key);
  };

  const takeSno = async (op: SyncOp) => {
    const key = `${op.schema}:${op.book_id}`;
    if (!nextSno.has(key)) {
      const res = check(
        await client
          .schema(op.schema)
          .from('cash_book')
          .select('sno')
          .eq('book_id', op.book_id)
          .order('sno', { ascending: false, nullsFirst: false })
          .limit(1)
      );
      if (res.error) throw new Error(res.error.message);
      nextSno.set(key, (Number(res.data?.[0]?.sno) || 0) + 1);
    }
    const sno = nextSno.get(key) as number;
    nextSno.set(key, sno + 1);
    return sno;
  };

  const hold = async (op: SyncOp, message: string) => {
    await store.update(op.offline_uuid, { status: 'conflict', error_message: message });
    result.held += 1;
  };

  const markSynced = async (op: SyncOp, note?: string) => {
    await store.update(op.offline_uuid, {
      status: 'synced',
      synced_at: new Date().toISOString(),
      error_message: note,
    });
    result.synced += 1;
  };

  const sendEntry = async (op: SyncOp) => {
    const rows = asRows(op.payload);
    const ids = rows.map(r => r.id);
    const from = () => client.schema(op.schema).from('cash_book');

    const existing = check(await from().select('id').in('id', ids));
    if (existing.error) throw new Error(existing.error.message);
    const alreadyThere = new Set((existing.data || []).map((r: any) => r.id));
    const toSend = rows.filter(r => !alreadyThere.has(r.id));

    const ready: any[] = [];
    for (const row of toSend) {
      const next = { ...row };
      delete next.pending_sync;
      if (next.head_of_account_id) {
        // The account may have been held at sync as a duplicate, so use the server's copy
        const accounts = () => client.schema(op.schema).from('company_main_accounts');
        const byId = check(await accounts().select('id').eq('id', next.head_of_account_id).maybeSingle());
        if (!byId.data) {
          const byName = check(
            await accounts()
              .select('id')
              .eq('book_id', op.book_id)
              .eq('company_name', next.company_name)
              .eq('acc_name', next.acc_name)
              .limit(1)
          );
          next.head_of_account_id = byName.data?.[0]?.id || null;
        }
      }
      if (next.sno === undefined || next.sno === null) next.sno = await takeSno(op);
      ready.push(next);
    }

    if (ready.length > 0) {
      const inserted = await from().insert(ready);
      if (inserted.error) {
        if (isNetworkFailure(inserted.error, inserted.status)) throw new NetworkStop();
        if (inserted.error.code === '23505') {
          const again = check(await from().select('id').in('id', ids));
          if ((again.data || []).length === ids.length) return markSynced(op);
        }
        const err: any = new Error(inserted.error.message);
        err.code = inserted.error.code;
        throw err;
      }
    }

    let note: string | undefined;
    if (op.edit_history?.length) {
      const audit = await client
        .schema(op.schema)
        .from('edit_cash_book')
        .insert(
          op.edit_history.map(h => ({
            cash_book_id: rows[0].id,
            book_id: op.book_id,
            old_values: JSON.stringify(h.old_values),
            new_values: JSON.stringify(h.new_values),
            edited_by: h.by,
            edited_at: h.at,
          }))
        );
      if (audit.error) {
        if (isNetworkFailure(audit.error, audit.status)) throw new NetworkStop();
        note = `Entry saved, but its offline edit history could not be saved: ${audit.error.message}`;
      }
    }
    await markSynced(op, note);
  };

  const sendMaster = async (op: SyncOp, table: string) => {
    const { fields, label } = MASTER_NAMES[table];
    const row = { ...asRows(op.payload)[0] };
    const from = () => client.schema(op.schema).from(table);

    const sameId = check(await from().select('id').eq('id', row.id).maybeSingle());
    if (sameId.data) return markSynced(op);

    let query = from().select('id').eq('book_id', op.book_id);
    for (const f of fields) query = query.eq(f, row[f]);
    const sameName = check(await query.limit(1));
    const name = fields.map(f => row[f]).join(' / ');
    if ((sameName.data || []).length > 0) {
      return hold(op, `${label} "${name}" already exists on the server. Entries using it are not affected. An admin can discard this.`);
    }

    const inserted = await from().insert(row);
    if (inserted.error) {
      if (isNetworkFailure(inserted.error, inserted.status)) throw new NetworkStop();
      if (inserted.error.code === '23505') {
        return hold(op, `${label} "${name}" already exists on the server. Entries using it are not affected. An admin can discard this.`);
      }
      const err: any = new Error(inserted.error.message);
      err.code = inserted.error.code;
      throw err;
    }
    await markSynced(op);
  };

  for (const op of queue) {
    await store.update(op.offline_uuid, { status: 'syncing' });
    try {
      const table = baseTableName(op.table);
      const isOurs = op.operation_type === 'INSERT' && QUEUEABLE_TABLES.includes(table);
      if (!isOurs) {
        if (!legacy) throw new Error('This item cannot be sent');
        await legacy(op);
        await markSynced(op);
        continue;
      }

      const book = await getBook(op);
      if (!book) {
        await hold(op, 'The book for this entry was not found on the server. An admin needs to decide.');
        continue;
      }
      if (book.is_locked) {
        await hold(op, 'This book was locked before the entry could sync. An admin can unlock it and try again, or discard the entry.');
        continue;
      }

      if (table === 'cash_book') await sendEntry(op);
      else await sendMaster(op, table);
    } catch (err: any) {
      if (err instanceof NetworkStop || isNetworkFailure(err) || isSessionEnded(err)) {
        await store.update(op.offline_uuid, { status: 'pending_sync' });
        result.stoppedByNetwork = true;
        break;
      }
      const isRefusal = typeof err?.code === 'string' && err.code.length === 5;
      if (isRefusal) {
        await hold(op, `The server refused this: ${err.message}`);
      } else {
        await store.update(op.offline_uuid, { status: 'failed', error_message: err?.message || String(err) });
        result.failed += 1;
      }
    }
  }

  return result;
}
