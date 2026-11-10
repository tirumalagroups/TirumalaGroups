// With no book selected, Regular / ITR writes stop with a clear message before anything is sent.
import { afterEach, describe, expect, it } from 'vitest';
import { supabase, supabaseDB, NO_BOOK_MESSAGE } from '../lib/supabaseDatabase';

describe('no book selected', () => {
  afterEach(() => {
    supabaseDB.setBookId('');
    localStorage.removeItem('table_mode');
  });

  it.each(['companies', 'company_main_accounts', 'company_main_sub_acc', 'cash_book', 'reminders', 'vehicles'])(
    'adding to %s in Regular says to choose a book',
    (table) => {
      localStorage.setItem('table_mode', 'regular');
      supabaseDB.setBookId('');
      expect(() => supabase.from(table).insert({ company_name: 'X' })).toThrow(NO_BOOK_MESSAGE);
      expect(() => supabase.from(table).upsert({ company_name: 'X' })).toThrow(NO_BOOK_MESSAGE);
    },
  );

  it('also applies in ITR', () => {
    localStorage.setItem('table_mode', 'itr');
    supabaseDB.setBookId('');
    expect(() => supabase.from('companies').insert({ company_name: 'X' })).toThrow(NO_BOOK_MESSAGE);
  });

  it('does not block creating a book, reading, or adding once a book is chosen', () => {
    localStorage.setItem('table_mode', 'regular');
    supabaseDB.setBookId('');
    expect(() => supabase.from('books').insert({ name: 'FY 2026-27' })).not.toThrow();
    expect(() => supabase.from('companies').select('*')).not.toThrow();
    supabaseDB.setBookId('00000000-0000-0000-0000-000000000001');
    expect(() => supabase.from('companies').insert({ company_name: 'X' })).not.toThrow();
  });

  it('does not touch Finance', () => {
    localStorage.setItem('table_mode', 'finance');
    supabaseDB.setBookId('');
    expect(() => supabase.from('loans').insert({ amount: 1 })).not.toThrow();
  });
});
