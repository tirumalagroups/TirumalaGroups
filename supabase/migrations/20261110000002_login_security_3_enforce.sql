-- =====================================================================================
-- Login security, part 3 of 3: switch protection ON.
--
-- Run ONLY when BOTH websites (test link and tirumalagroups.co) run the new app, and the new
-- login has been tested. From this moment:
--   * nothing can be read or changed without logging in through the new app
--   * the old app version stops working (everyone logs in once more)
--   * password columns can no longer be read through the app
--   * the old "userss" list is moved out of reach (kept in the "archive" schema, not deleted)
--
-- Undo (switches protection off again at once): supabase/undo/20261110000002_login_security_3_enforce_UNDO.sql
-- =====================================================================================

UPDATE public.app_security_settings SET enforce = true, updated_at = now() WHERE id = 1;

-- Plain-text temporary passwords are no longer kept
UPDATE public.users SET temp_password = NULL WHERE temp_password IS NOT NULL;

-- users: logged-in users may read every column except the password ones; admins may change the
-- details, but not passwords or login counters (those go through the login server).
-- New users are created by the login server, not directly.
DO $$
DECLARE
  v_read text;
  v_write text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_read
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name NOT IN ('password_hash', 'temp_password');
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_write
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name NOT IN ('id', 'password_hash', 'temp_password', 'auth_user_id', 'failed_login_attempts',
                             'locked_until', 'must_change_password', 'login_count', 'last_login',
                             'last_password_change', 'created_at');
  EXECUTE 'REVOKE ALL ON public.users FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.users TO authenticated', v_read);
  EXECUTE format('GRANT UPDATE (%s) ON public.users TO authenticated', v_write);
END $$;

-- The 4 Finance functions with full rights: logged-in users only
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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;

-- The old July 2025 user list: out of the app's reach, not deleted
CREATE SCHEMA IF NOT EXISTS archive;
REVOKE ALL ON SCHEMA archive FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF to_regclass('public.userss') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.userss SET SCHEMA archive';
  END IF;
END $$;

-- End any session that already ran out, so the admin list starts clean
SELECT public.app_close_stale_sessions();

NOTIFY pgrst, 'reload schema';
