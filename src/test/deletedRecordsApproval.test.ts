/**
 * Deleted Day Book entries in Approve Records (24 Nov 2026):
 *  - the Deleted Records part of Approve Records lists a delete on the day it was deleted
 *    (as the Deleted Records page does), not on the entry's own date
 *  - every delete starts as a request waiting for approval, also for an approved entry
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const fake = vi.hoisted(() => ({ db: null as any }));

vi.mock('../lib/supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  fake.db = createFakeSupabase();
  return {
    supabase: fake.db.client, rawSupabase: fake.db.client, default: fake.db.client,
    resolveSchemaAndTable: (t: string) => ({ schema: 'regular', table: t }), supabaseHelpers: {}
  };
});

import { supabaseDB } from '../lib/supabaseDatabase';
import { deletedOnDay, getLocalBusinessDateISO } from '../utils/dateUtils';

describe('day of a delete', () => {
  it('entry of 21 Nov deleted on 23 Nov is listed under 23 Nov', () => {
    expect(deletedOnDay({ c_date: '2026-11-21', deleted_at: '2026-11-23T08:28:03.686+00:00' })).toBe('2026-11-23');
  });

  it('uses local time: a delete at 1 AM on 24 Nov is 24 Nov, not the UTC date', () => {
    const oneAm = new Date(2026, 10, 24, 1, 0, 0).toISOString();
    expect(deletedOnDay({ c_date: '2026-11-20', deleted_at: oneAm })).toBe('2026-11-24');
    expect(deletedOnDay({ c_date: '2026-11-20', deleted_at: oneAm })).toBe(getLocalBusinessDateISO(new Date(oneAm)));
  });

  it('no delete time: falls back to the entry date', () => {
    expect(deletedOnDay({ c_date: '2026-11-21', deleted_at: null })).toBe('2026-11-21');
    expect(deletedOnDay({ c_date: '2026-11-21', deleted_at: 'not a date' })).toBe('2026-11-21');
  });
});

describe('deleting a Day Book entry', () => {
  const entry = (over: Record<string, any> = {}) => ({
    id: 'e1', sno: 556, c_date: '2026-11-21', company_name: 'THIRUMALA', acc_name: 'BANK A/C', sub_acc_name: '',
    particulars: 'TEST', credit: 0, debit: 1, staff: 'RAMESH', users: 'RAMESH', approved: 'false', ...over,
  });

  it('an approved entry: the copy waits for approval (before: it looked already approved and was hidden)', async () => {
    fake.db.seed({ cash_book: [entry({ approved: 'true' })], deleted_cash_book: [] });
    expect(await supabaseDB.deleteCashBookEntry('e1', 'RAMESH')).toBe(true);
    expect(fake.db.tables.cash_book).toHaveLength(0);
    expect(fake.db.tables.deleted_cash_book).toHaveLength(1);
    expect(fake.db.tables.deleted_cash_book[0]).toMatchObject({ id: 'e1', sno: 556, debit: 1, approved: false, deleted_by: 'RAMESH' });
  });

  it('a pending entry: same, waits for approval', async () => {
    fake.db.seed({ cash_book: [entry({ id: 'e2', sno: 618 })], deleted_cash_book: [] });
    expect(await supabaseDB.deleteCashBookEntry('e2', 'MADHAV 1')).toBe(true);
    expect(fake.db.tables.deleted_cash_book[0]).toMatchObject({ id: 'e2', approved: false });
  });
});

describe('Reject in Approve Records = undo the delete (same as Restore)', () => {
  const entry = { id: 'e3', sno: 556, c_date: '2026-11-21', company_name: 'THIRUMALA', acc_name: 'BANK A/C', particulars: 'TEST', credit: 0, debit: 1, staff: 'RAMESH', approved: 'true', book_id: 'b1' };
  beforeAll(() => supabaseDB.setBookId('b1')); // a book is always selected in the app

  it('the entry goes back in the Day Book, waiting for approval, and leaves Deleted Records', async () => {
    fake.db.seed({ cash_book: [{ ...entry }], deleted_cash_book: [] });
    await supabaseDB.deleteCashBookEntry('e3', 'RAMESH');
    expect(fake.db.tables.cash_book).toHaveLength(0);

    expect(await supabaseDB.restoreCashBookEntry('e3')).toBe(true);
    expect(fake.db.tables.deleted_cash_book).toHaveLength(0);
    expect(fake.db.tables.cash_book).toHaveLength(1);
    const back = fake.db.tables.cash_book[0];
    expect(back).toMatchObject({ id: 'e3', sno: 556, c_date: '2026-11-21', debit: 1, particulars: 'TEST', book_id: 'b1', approved: 'false' });
    expect(back).not.toHaveProperty('deleted_by');
    expect(back).not.toHaveProperty('deleted_at');
  });

  it('also when the delete had been approved: the entry comes back waiting for approval', async () => {
    fake.db.seed({ cash_book: [], deleted_cash_book: [{ ...entry, id: 'e4', approved: true, deleted_by: 'RAMESH', deleted_at: '2026-11-23T08:28:03Z' }] });
    expect(await supabaseDB.restoreCashBookEntry('e4')).toBe(true);
    expect(fake.db.tables.cash_book[0]).toMatchObject({ id: 'e4', approved: 'false' });
  });
});
