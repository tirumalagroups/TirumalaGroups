-- =====================================================================================
-- Deleted Records (Regular and ITR): add the 5 day-book columns that Deleted Records lacked.
--
-- Why: deleting an entry in Edit Entry first copies it into deleted_cash_book. The day book
-- (cash_book) has payment_mode and the online / offline split of credit and debit, but
-- deleted_cash_book did not, so the copy failed and the app refused to delete
-- ("Entry NOT deleted - it could not be saved to Deleted Records").
-- The app now also leaves out any missing column, so deleting works even before this is run;
-- with this file the deleted copy (and a later Restore) keeps those 5 values.
--
-- Only adds columns (same types as cash_book); changes no data. Can be run more than once.
-- Undo: supabase/undo/20261123000000_deleted_cash_book_columns_UNDO.sql
-- =====================================================================================

ALTER TABLE regular.deleted_cash_book
  ADD COLUMN IF NOT EXISTS credit_online double precision,
  ADD COLUMN IF NOT EXISTS credit_offline double precision,
  ADD COLUMN IF NOT EXISTS debit_online double precision,
  ADD COLUMN IF NOT EXISTS debit_offline double precision,
  ADD COLUMN IF NOT EXISTS payment_mode text;

ALTER TABLE itr.deleted_cash_book
  ADD COLUMN IF NOT EXISTS credit_online double precision,
  ADD COLUMN IF NOT EXISTS credit_offline double precision,
  ADD COLUMN IF NOT EXISTS debit_online double precision,
  ADD COLUMN IF NOT EXISTS debit_offline double precision,
  ADD COLUMN IF NOT EXISTS payment_mode text;

NOTIFY pgrst, 'reload schema';

-- Check (should list 5 rows for each schema):
-- SELECT table_schema, column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'deleted_cash_book' AND table_schema IN ('regular', 'itr')
--    AND column_name IN ('credit_online', 'credit_offline', 'debit_online', 'debit_offline', 'payment_mode')
--  ORDER BY 1, 2;
