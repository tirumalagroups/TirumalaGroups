-- UNDO of login security part 3: switches protection OFF again (the old app works again).
-- The rules of part 2 stay; with protection off they let the old app through.
-- This is not a migration to run in order: run it by hand only if needed.

UPDATE public.app_security_settings SET enforce = false, updated_at = now() WHERE id = 1;

GRANT ALL ON public.users TO anon, authenticated;

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'finance' AND p.prosecdef
       AND p.proname IN ('bulk_update_dues', 'get_active_loan_dues_summary', 'get_max_receipt_number', 'get_next_finance_receipt_no')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('archive.userss') IS NOT NULL AND to_regclass('public.userss') IS NULL THEN
    EXECUTE 'ALTER TABLE archive.userss SET SCHEMA public';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
