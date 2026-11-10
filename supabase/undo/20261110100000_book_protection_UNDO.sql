-- Undo book protection: removes the is_protected column (every book becomes deletable again,
-- under the old rules: only empty, non-default books).
ALTER TABLE regular.books DROP COLUMN IF EXISTS is_protected;
ALTER TABLE itr.books DROP COLUMN IF EXISTS is_protected;
NOTIFY pgrst, 'reload schema';
