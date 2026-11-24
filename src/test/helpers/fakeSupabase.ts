/**
 * Small in-memory stand-in for the Supabase client, for finance tests that must run the
 * REAL save / recalculate / report code without touching the live database.
 * Supports what the finance code uses: select with one level of joins (and nesting),
 * eq / neq / in / like / not / gte / lte / is, order, range, limit, single, maybeSingle,
 * insert, update, delete, count + head, schema(), rpc().
 */

type Row = Record<string, any>;

const FK: Record<string, string> = { loan: 'loan_id', customer: 'customer_id', partner: 'partner_id' };

/** Split on commas that are not inside brackets */
const splitTop = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

export interface FakeDb {
  tables: Record<string, Row[]>;
  client: any;
  seed: (t: Record<string, Row[]>) => void;
  /** Number of write calls per table, for "nothing else was touched" checks */
  writes: { table: string; op: string }[];
}

export const createFakeSupabase = (): FakeDb => {
  const db: FakeDb = { tables: {}, client: null, seed: () => {}, writes: [] };
  let idCounter = 0;
  let clock = Date.UTC(2030, 0, 1);

  const table = (name: string) => {
    if (!db.tables[name]) db.tables[name] = [];
    return db.tables[name];
  };

  const applyJoins = (rows: Row[], select: string): Row[] => {
    const parts = splitTop(select || '*');
    const joins = parts
      .map(p => p.match(/^(\w+):(\w+)\((.*)\)$/))
      .filter(Boolean) as RegExpMatchArray[];
    if (joins.length === 0) return rows.map(r => ({ ...r }));
    const attach = (row: Row, js: RegExpMatchArray[]): Row => {
      const copy = { ...row };
      for (const m of js) {
        const fk = FK[m[1]] || `${m[1]}_id`;
        const target = table(m[2]).find(t => t.id === row[fk]);
        if (!target) { copy[m[1]] = null; continue; }
        const inner = splitTop(m[3]).map(p => p.match(/^(\w+):(\w+)\((.*)\)$/)).filter(Boolean) as RegExpMatchArray[];
        copy[m[1]] = attach(target, inner);
      }
      return copy;
    };
    return rows.map(r => attach(r, joins));
  };

  const makeBuilder = (name: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    let selectStr = '*';
    let wantSingle: false | 'single' | 'maybe' = false;
    let head = false;
    let wantCount = false;
    const filters: ((r: Row) => boolean)[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    let limitN: number | null = null;

    const run = () => {
      const t = table(name);
      const matched = () => t.filter(r => filters.every(f => f(r)));
      let data: any = null;
      if (op === 'insert') {
        // The real approvals table allows one row per source_id
        if (name === 'finance_transaction_reviews') {
          const incoming = Array.isArray(payload) ? payload : [payload];
          if (incoming.some((p: Row) => t.some(r => r.source_id === p.source_id))) {
            return { data: null, error: { code: '23505', message: 'duplicate key source_id' } };
          }
        }
        const rows = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => {
          clock += 1000;
          return { id: p.id || `fake-${name}-${++idCounter}`, created_at: new Date(clock).toISOString(), ...p };
        });
        t.push(...rows);
        db.writes.push({ table: name, op: 'insert' });
        data = rows.map(r => ({ ...r }));
      } else if (op === 'update') {
        const rows = matched();
        rows.forEach(r => Object.assign(r, payload));
        db.writes.push({ table: name, op: 'update' });
        data = rows.map(r => ({ ...r }));
      } else if (op === 'delete') {
        const rows = matched();
        db.tables[name] = t.filter(r => !rows.includes(r));
        db.writes.push({ table: name, op: 'delete' });
        data = rows.map(r => ({ ...r }));
      } else {
        let rows = matched();
        const count = rows.length;
        for (const o of [...orders].reverse()) {
          rows = [...rows].sort((a, b) => {
            const av = a[o.col]; const bv = b[o.col];
            if (av === bv) return 0;
            if (av === undefined || av === null) return 1;
            if (bv === undefined || bv === null) return -1;
            return (av < bv ? -1 : 1) * (o.asc ? 1 : -1);
          });
        }
        if (rangeFrom !== null) rows = rows.slice(rangeFrom, (rangeTo as number) + 1);
        if (limitN !== null) rows = rows.slice(0, limitN);
        data = head ? null : applyJoins(rows, selectStr);
        if (wantCount) return { data, error: null, count };
      }
      if (wantSingle) {
        const list = Array.isArray(data) ? data : [];
        if (list.length === 0) {
          return wantSingle === 'single'
            ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
            : { data: null, error: null };
        }
        return { data: list[0], error: null };
      }
      return { data, error: null };
    };

    const b: any = {
      select: (s?: string, opts?: any) => {
        if (s) selectStr = s;
        if (opts?.count) wantCount = true;
        if (opts?.head) head = true;
        return b;
      },
      insert: (p: any) => { op = 'insert'; payload = p; return b; },
      upsert: (p: any) => { op = 'insert'; payload = p; return b; },
      update: (p: any) => { op = 'update'; payload = p; return b; },
      delete: () => { op = 'delete'; return b; },
      eq: (c: string, v: any) => { filters.push(r => r[c] === v); return b; },
      neq: (c: string, v: any) => { filters.push(r => r[c] !== v); return b; },
      in: (c: string, v: any[]) => { filters.push(r => v.includes(r[c])); return b; },
      is: (c: string, v: any) => { filters.push(r => (r[c] ?? null) === v); return b; },
      gte: (c: string, v: any) => { filters.push(r => r[c] !== null && r[c] !== undefined && String(r[c]) >= String(v)); return b; },
      lte: (c: string, v: any) => { filters.push(r => r[c] !== null && r[c] !== undefined && String(r[c]) <= String(v)); return b; },
      // numbers compare as numbers (e.g. paid_amount > 0), anything else as text (dates)
      gt: (c: string, v: any) => {
        filters.push(r => {
          if (r[c] === null || r[c] === undefined) return false;
          return typeof v === 'number' ? Number(r[c]) > v : String(r[c]) > String(v);
        });
        return b;
      },
      lt: (c: string, v: any) => {
        filters.push(r => {
          if (r[c] === null || r[c] === undefined) return false;
          return typeof v === 'number' ? Number(r[c]) < v : String(r[c]) < String(v);
        });
        return b;
      },
      like: (c: string, v: string) => {
        const re = new RegExp('^' + v.replace(/%/g, '.*') + '$');
        filters.push(r => re.test(String(r[c] ?? '')));
        return b;
      },
      ilike: (c: string, v: string) => {
        const re = new RegExp('^' + v.replace(/%/g, '.*') + '$', 'i');
        filters.push(r => re.test(String(r[c] ?? '')));
        return b;
      },
      not: (c: string, o: string, v: any) => {
        if (o === 'like') {
          const re = new RegExp('^' + String(v).replace(/%/g, '.*') + '$');
          filters.push(r => !re.test(String(r[c] ?? '')));
        } else if (o === 'in') {
          const list = String(v).replace(/[()]/g, '').split(',');
          filters.push(r => !list.includes(String(r[c])));
        } else if (o === 'is') {
          filters.push(r => (r[c] ?? null) !== v);
        }
        return b;
      },
      or: () => b,
      order: (col: string, opts?: any) => { orders.push({ col, asc: opts?.ascending !== false }); return b; },
      range: (f: number, t: number) => { rangeFrom = f; rangeTo = t; return b; },
      limit: (n: number) => { limitN = n; return b; },
      single: () => { wantSingle = 'single'; return b; },
      maybeSingle: () => { wantSingle = 'maybe'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };

  db.client = {
    from: (t: string) => makeBuilder(t),
    schema: () => db.client,
    rpc: async () => ({ data: `RC${90000 + (++idCounter)}`, error: null }),
    storage: { from: () => ({}) },
  };

  db.seed = (t) => {
    db.tables = {};
    for (const [k, rows] of Object.entries(t)) db.tables[k] = rows.map(r => ({ ...r }));
    db.writes.length = 0;
  };

  return db;
};
