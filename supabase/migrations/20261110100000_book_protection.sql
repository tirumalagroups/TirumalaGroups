-- Book protection: a protected book cannot be deleted from Book Management until an admin
-- removes the protection (the shield button). Regular and ITR each have their own books table.
-- Safe to run more than once. Changes no existing data: every book starts unprotected.

ALTER TABLE regular.books ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;
ALTER TABLE itr.books ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;

-- Tell the API about the new column
NOTIFY pgrst, 'reload schema';

-- Check: both lines should show is_protected
SELECT table_schema, table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'books' AND column_name = 'is_protected'
ORDER BY table_schema;
