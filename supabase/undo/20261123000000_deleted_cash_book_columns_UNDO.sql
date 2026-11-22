-- Undo of 20261123000000_deleted_cash_book_columns.sql
-- Removes the 5 columns again (any values saved in them on deleted entries are lost).
-- The app keeps working without them: it leaves missing columns out when saving a deleted entry.

ALTER TABLE regular.deleted_cash_book
  DROP COLUMN IF EXISTS credit_online,
  DROP COLUMN IF EXISTS credit_offline,
  DROP COLUMN IF EXISTS debit_online,
  DROP COLUMN IF EXISTS debit_offline,
  DROP COLUMN IF EXISTS payment_mode;

ALTER TABLE itr.deleted_cash_book
  DROP COLUMN IF EXISTS credit_online,
  DROP COLUMN IF EXISTS credit_offline,
  DROP COLUMN IF EXISTS debit_online,
  DROP COLUMN IF EXISTS debit_offline,
  DROP COLUMN IF EXISTS payment_mode;

NOTIFY pgrst, 'reload schema';
