import { beforeEach, describe, expect, it } from 'vitest';
import {
  isNetworkFailure,
  isQueueableWrite,
  runOfflineSync,
  SyncClient,
  SyncOp,
  SyncStore,
} from '../lib/offlineSyncEngine';

// A small server with the same rules as the real tables: ids and names are unique.
type Row = Record<string, any>;
const UNIQUE: Record<string, string[]> = {
  companies: ['book_id', 'company_name'],
  company_main_accounts: ['book_id', 'company_name', 'acc_name'],
  company_main_sub_acc: ['book_id', 'company_name', 'acc_name', 'sub_acc'],
};

const makeServer = () => {
  const tables: Record<string, Row[]> = {
    books: [{ id: 'b1', is_locked: false }, { id: 'locked', is_locked: true }],
    cash_book: [],
    edit_cash_book: [],
    companies: [],
    company_main_accounts: [],
    company_main_sub_acc: [],
  };
  const control = {
    down: false,
    dropAfterInserts: Infinity,
    lostReplyOnInsert: 0,
    refuse: null as null | { table: string; code: string; message: string },
    inserts: 0,
    auditFails: false,
  };
  const netFail = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
  const client: SyncClient = {
    schema: () => ({
      from(table: string) {
        const filters: ((r: Row) => boolean)[] = [];
        let sorted: { col: string; asc: boolean } | null = null;
        let lim = Infinity;
        let single = false;
        let insertRows: Row[] | null = null;
        const b: any = {
          select: () => b,
          eq: (c: string, v: any) => (filters.push(r => r[c] === v), b),
          in: (c: string, v: any[]) => (filters.push(r => v.includes(r[c])), b),
          order: (col: string, o: any) => ((sorted = { col, asc: o?.ascending !== false }), b),
          limit: (n: number) => ((lim = n), b),
          maybeSingle: () => ((single = true), b),
          insert: (rows: Row | Row[]) => ((insertRows = Array.isArray(rows) ? rows : [rows]), b),
          then(ok: any) {
            const run = () => {
              if (control.down) return netFail;
              const rows = tables[table];
              if (insertRows) {
                if (table === 'edit_cash_book' && control.auditFails) {
                  return { data: null, error: { message: 'audit failed', code: '42501' }, status: 403 };
                }
                if (control.refuse?.table === table) {
                  return { data: null, error: { message: control.refuse.message, code: control.refuse.code }, status: 400 };
                }
                if (control.inserts >= control.dropAfterInserts) {
                  control.down = true;
                  return netFail;
                }
                for (const r of insertRows) {
                  const dupId = r.id && rows.some(x => x.id === r.id);
                  const u = UNIQUE[table];
                  const dupName = u && rows.some(x => u.every(k => x[k] === r[k]));
                  if (dupId || dupName) return { data: null, error: { message: 'duplicate key', code: '23505' }, status: 409 };
                }
                rows.push(...insertRows);
                control.inserts += insertRows.length;
                if (control.lostReplyOnInsert > 0) {
                  control.lostReplyOnInsert -= 1;
                  return netFail; // saved on the server, but the reply never arrived
                }
                return { data: insertRows, error: null, status: 201 };
              }
              let out = rows.filter(r => filters.every(f => f(r)));
              if (sorted) {
                const { col, asc } = sorted;
                out = [...out].sort((x, y) => (asc ? x[col] - y[col] : y[col] - x[col]));
              }
              out = out.slice(0, lim === Infinity ? undefined : lim);
              return { data: single ? out[0] || null : out, error: null, status: 200 };
            };
            return Promise.resolve(run()).then(ok);
          },
        };
        return b;
      },
    }),
  };
  return { tables, control, client };
};

const makeStore = (ops: SyncOp[]): SyncStore & { ops: SyncOp[] } => ({
  ops,
  all: async () => ops.map(o => ({ ...o })),
  update: async (id, patch) => {
    Object.assign(ops.find(o => o.offline_uuid === id) as SyncOp, patch);
  },
});

let n = 0;
const op = (table: string, payload: any, over: Partial<SyncOp> = {}): SyncOp => {
  n += 1;
  return {
    offline_uuid: `op${n}`,
    mode: 'regular',
    schema: 'regular',
    book_id: 'b1',
    created_at: `2026-11-09T10:00:${String(n).padStart(2, '0')}.000Z`,
    operation_type: 'INSERT',
    table,
    payload,
    status: 'pending_sync',
    ...over,
  };
};
const entry = (id: string, over: Row = {}) =>
  op('cash_book', { id, book_id: 'b1', company_name: 'C', acc_name: 'A', credit: 100, debit: 0, ...over });

let server: ReturnType<typeof makeServer>;
beforeEach(() => {
  n = 0;
  server = makeServer();
});
const statuses = (s: { ops: SyncOp[] }) => s.ops.map(o => o.status);

describe('nothing lost, nothing counted twice', () => {
  it('sends every entry once, with its amounts unchanged', async () => {
    const store = makeStore([entry('e1', { credit: 1500.5 }), entry('e2', { credit: 0, debit: 250.25 })]);
    const r = await runOfflineSync(store, server.client);
    expect(r.synced).toBe(2);
    expect(statuses(store)).toEqual(['synced', 'synced']);
    expect(server.tables.cash_book.map(x => [x.id, x.credit, x.debit])).toEqual([
      ['e1', 1500.5, 0],
      ['e2', 0, 250.25],
    ]);
  });

  it('running the sync again sends nothing twice', async () => {
    const store = makeStore([entry('e1'), entry('e2')]);
    await runOfflineSync(store, server.client);
    const second = await runOfflineSync(store, server.client);
    expect(second.synced).toBe(0);
    expect(server.tables.cash_book).toHaveLength(2);
  });

  it('an entry saved on the server whose reply was lost is not sent again', async () => {
    const store = makeStore([entry('e1')]);
    server.control.lostReplyOnInsert = 1;
    const first = await runOfflineSync(store, server.client);
    expect(first.stoppedByNetwork).toBe(true);
    expect(store.ops[0].status).toBe('pending_sync');
    expect(server.tables.cash_book).toHaveLength(1);
    server.control.down = false;
    const second = await runOfflineSync(store, server.client);
    expect(second.synced).toBe(1);
    expect(server.tables.cash_book).toHaveLength(1);
  });

  it('an entry left "syncing" by a closed browser is recovered, without a duplicate', async () => {
    server.tables.cash_book.push({ id: 'e1', sno: 7, book_id: 'b1' });
    const store = makeStore([entry('e1'), entry('e2')]);
    store.ops[0].status = 'syncing';
    store.ops[1].status = 'syncing';
    const r = await runOfflineSync(store, server.client);
    expect(r.synced).toBe(2);
    expect(server.tables.cash_book.map(x => x.id).sort()).toEqual(['e1', 'e2']);
  });

  it('stops when the internet drops, and finishes later in the same order', async () => {
    const store = makeStore([entry('e1'), entry('e2'), entry('e3')]);
    server.control.dropAfterInserts = 1;
    const first = await runOfflineSync(store, server.client);
    expect(first.stoppedByNetwork).toBe(true);
    expect(first.failed + first.held).toBe(0);
    expect(statuses(store)).toEqual(['synced', 'pending_sync', 'pending_sync']);
    server.control.down = false;
    server.control.dropAfterInserts = Infinity;
    await runOfflineSync(store, server.client);
    expect(server.tables.cash_book.map(x => x.id)).toEqual(['e1', 'e2', 'e3']);
    expect(server.tables.cash_book.map(x => x.sno)).toEqual([1, 2, 3]);
  });

  it('with no internet at all nothing changes', async () => {
    const store = makeStore([entry('e1')]);
    server.control.down = true;
    const r = await runOfflineSync(store, server.client);
    expect(r.stoppedByNetwork).toBe(true);
    expect(store.ops[0].status).toBe('pending_sync');
  });

  it('sends a dual entry saved as a list', async () => {
    const pair = op('cash_book', [
      { id: 'd1', book_id: 'b1', credit: 500, debit: 0 },
      { id: 'd2', book_id: 'b1', credit: 0, debit: 500 },
    ]);
    const store = makeStore([pair]);
    await runOfflineSync(store, server.client);
    expect(server.tables.cash_book.map(x => [x.id, x.credit, x.debit, x.sno])).toEqual([
      ['d1', 500, 0, 1],
      ['d2', 0, 500, 2],
    ]);
  });

  it('goes in the order entries were made, whatever order they are stored in', async () => {
    const a = entry('first');
    const b = entry('second');
    const store = makeStore([b, a]);
    await runOfflineSync(store, server.client);
    expect(server.tables.cash_book.map(x => x.id)).toEqual(['first', 'second']);
  });
});

describe('S.No is given at sync', () => {
  it('continues from the last number in that book', async () => {
    server.tables.cash_book.push(
      { id: 'old', sno: 41, book_id: 'b1' },
      { id: 'other', sno: 999, book_id: 'another' }
    );
    const store = makeStore([entry('e1'), entry('e2')]);
    await runOfflineSync(store, server.client);
    expect(server.tables.cash_book.filter(x => x.book_id === 'b1').map(x => x.sno)).toEqual([41, 42, 43]);
  });

  it('starts at 1 in an empty book', async () => {
    const store = makeStore([entry('e1')]);
    await runOfflineSync(store, server.client);
    expect(server.tables.cash_book[0].sno).toBe(1);
  });
});

describe('held for an admin, never thrown away', () => {
  it('holds an entry for a locked book', async () => {
    const store = makeStore([entry('e1', { book_id: 'locked' })]);
    store.ops[0].book_id = 'locked';
    const r = await runOfflineSync(store, server.client);
    expect(r.held).toBe(1);
    expect(store.ops[0].status).toBe('conflict');
    expect(store.ops[0].error_message).toMatch(/locked/i);
    expect(server.tables.cash_book).toHaveLength(0);
  });

  it('a held entry does not block the ones after it', async () => {
    const held = entry('e1', { book_id: 'locked' });
    held.book_id = 'locked';
    const store = makeStore([held, entry('e2')]);
    await runOfflineSync(store, server.client);
    expect(statuses(store)).toEqual(['conflict', 'synced']);
  });

  it('a held entry is not retried by itself', async () => {
    const held = entry('e1', { book_id: 'locked' });
    held.book_id = 'locked';
    const store = makeStore([held]);
    await runOfflineSync(store, server.client);
    server.tables.books[1].is_locked = false;
    await runOfflineSync(store, server.client);
    expect(store.ops[0].status).toBe('conflict');
    store.ops[0].status = 'pending_sync'; // admin pressed Try Again after unlocking
    await runOfflineSync(store, server.client);
    expect(store.ops[0].status).toBe('synced');
    expect(server.tables.cash_book).toHaveLength(1);
  });

  it('holds when the book no longer exists', async () => {
    const lost = entry('e1');
    lost.book_id = 'gone';
    const store = makeStore([lost]);
    await runOfflineSync(store, server.client);
    expect(store.ops[0].status).toBe('conflict');
  });

  it('holds when the server refuses, with the reason', async () => {
    server.control.refuse = { table: 'cash_book', code: '23514', message: 'bad value' };
    const store = makeStore([entry('e1')]);
    const r = await runOfflineSync(store, server.client);
    expect(r.held).toBe(1);
    expect(store.ops[0].error_message).toContain('bad value');
  });
});

describe('new companies and accounts made offline', () => {
  it('sends a new company, then the entry that uses it', async () => {
    const store = makeStore([
      op('companies', { id: 'c1', book_id: 'b1', company_name: 'NEW CO' }),
      op('company_main_accounts', { id: 'a1', book_id: 'b1', company_name: 'NEW CO', acc_name: 'NEW ACC' }),
      entry('e1', { company_name: 'NEW CO', acc_name: 'NEW ACC', head_of_account_id: 'a1' }),
    ]);
    await runOfflineSync(store, server.client);
    expect(statuses(store)).toEqual(['synced', 'synced', 'synced']);
    expect(server.tables.cash_book[0].head_of_account_id).toBe('a1');
  });

  it('holds a name that already exists, and does not create a second one', async () => {
    server.tables.companies.push({ id: 'server', book_id: 'b1', company_name: 'SAME' });
    const store = makeStore([op('companies', { id: 'c1', book_id: 'b1', company_name: 'SAME' })]);
    await runOfflineSync(store, server.client);
    expect(store.ops[0].status).toBe('conflict');
    expect(store.ops[0].error_message).toMatch(/already exists/);
    expect(server.tables.companies).toHaveLength(1);
  });

  it('an entry whose new account was a duplicate still saves, linked to the server account', async () => {
    server.tables.company_main_accounts.push({ id: 'server-acc', book_id: 'b1', company_name: 'C', acc_name: 'A' });
    const store = makeStore([
      op('company_main_accounts', { id: 'mine', book_id: 'b1', company_name: 'C', acc_name: 'A' }),
      entry('e1', { head_of_account_id: 'mine' }),
    ]);
    await runOfflineSync(store, server.client);
    expect(statuses(store)).toEqual(['conflict', 'synced']);
    expect(server.tables.cash_book[0].head_of_account_id).toBe('server-acc');
  });

  it('the same name in another book is fine', async () => {
    server.tables.companies.push({ id: 'x', book_id: 'another', company_name: 'SAME' });
    const store = makeStore([op('companies', { id: 'c1', book_id: 'b1', company_name: 'SAME' })]);
    await runOfflineSync(store, server.client);
    expect(store.ops[0].status).toBe('synced');
  });

  it('a company whose reply was lost is not held as a duplicate of itself', async () => {
    const store = makeStore([op('companies', { id: 'c1', book_id: 'b1', company_name: 'X' })]);
    server.control.lostReplyOnInsert = 1;
    await runOfflineSync(store, server.client);
    server.control.down = false;
    await runOfflineSync(store, server.client);
    expect(store.ops[0].status).toBe('synced');
    expect(server.tables.companies).toHaveLength(1);
  });
});

describe('fixes made offline are recorded', () => {
  const history = [{ at: '2026-11-09T10:05:00.000Z', by: 'RAMESH', old_values: { credit: 100 }, new_values: { credit: 150 } }];

  it('saves the edit history with the entry', async () => {
    const store = makeStore([entry('e1', { credit: 150 })]);
    store.ops[0].edit_history = history;
    await runOfflineSync(store, server.client);
    expect(server.tables.cash_book[0].credit).toBe(150);
    expect(server.tables.edit_cash_book).toHaveLength(1);
    expect(server.tables.edit_cash_book[0]).toMatchObject({ cash_book_id: 'e1', edited_by: 'RAMESH', book_id: 'b1' });
    expect(JSON.parse(server.tables.edit_cash_book[0].old_values)).toEqual({ credit: 100 });
  });

  it('keeps the entry and says so if the history cannot be saved', async () => {
    server.control.auditFails = true;
    const store = makeStore([entry('e1')]);
    store.ops[0].edit_history = history;
    await runOfflineSync(store, server.client);
    expect(store.ops[0].status).toBe('synced');
    expect(store.ops[0].error_message).toMatch(/edit history/);
  });
});

describe('what can be saved offline', () => {
  it('only new entries and masters in Regular and ITR', () => {
    expect(isQueueableWrite('regular', 'cash_book', 'INSERT')).toBe(true);
    expect(isQueueableWrite('itr', 'cash_book_itr', 'INSERT')).toBe(true);
    expect(isQueueableWrite('itr', 'company_main_sub_acc', 'INSERT')).toBe(true);
    expect(isQueueableWrite('finance', 'cash_book', 'INSERT')).toBe(false);
    expect(isQueueableWrite('regular', 'cash_book', 'UPDATE')).toBe(false);
    expect(isQueueableWrite('regular', 'cash_book', 'DELETE')).toBe(false);
    expect(isQueueableWrite('regular', 'edit_cash_book', 'INSERT')).toBe(false);
    expect(isQueueableWrite('regular', 'vehicles', 'INSERT')).toBe(false);
  });
});

describe('telling a lost connection from a refusal', () => {
  it('reads the errors correctly', () => {
    expect(isNetworkFailure({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true);
    expect(isNetworkFailure({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true);
    expect(isNetworkFailure(null, 0)).toBe(true);
    expect(isNetworkFailure({ message: 'duplicate key', code: '23505' })).toBe(false);
    expect(isNetworkFailure({ message: 'fetch failed: timed out', code: '57014' })).toBe(false);
    expect(isNetworkFailure(null, 200)).toBe(false);
  });
});
