-- =====================================================================================
-- Login security, part 2 of 3: rules on every table. Run after part 1.
--
-- Every table in the regular, itr and finance schemas, and the app's tables in public, get ONE rule
-- ("app_access") that calls public.app_allow():
--   * Requests from the NEW app carry a login token, and must belong to a live session of a user
--     with access to that mode (admins: all modes). Otherwise they fail with SESSION_ENDED.
--   * Requests from the OLD app carry no login token. They are still allowed, until part 3 switches
--     protection on. So the main website keeps working while the new app is tested.
-- The old rules on these tables (most say "everyone may do everything") are saved in
-- public.app_policy_backup first, and removed: rules add up, so an open old rule would undo the new one.
--
-- Files: uploading, changing and deleting need a login (once protection is on); viewing a photo by its
-- link stays open, as agreed.
--
-- Can be run more than once. Undo: supabase/undo/20261110000001_login_security_2_rules_UNDO.sql
-- =====================================================================================

DO $$
DECLARE
  t record;
  p record;
  v_mode text;
  v_using text;
  v_check text;
  -- public tables with their own rules below
  special text[] := ARRAY['users', 'user_access', 'user_permissions', 'login_history', 'user_activities',
                          'audit_logs', 'app_sessions', 'password_reset_requests', 'features', 'user_types'];
  -- other public tables the app uses: any logged-in user
  shared text[] := ARRAY['ledger_settings', 'finance_settings', 'attendance_staff', 'attendance_salary_history',
                         'attendance_records', 'attendance_holidays', 'attendance_month_locks', 'attendance_logs',
                         'notification_settings'];
BEGIN
  FOR t IN
    SELECT c.relname AS tablename, n.nspname AS schemaname, c.relrowsecurity AS rowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND (n.nspname IN ('regular', 'itr', 'finance')
            OR (n.nspname = 'public' AND c.relname = ANY (special || shared)))
  LOOP
    -- 1. Save the table's current state and rules (only the first time, so a re-run keeps the original)
    INSERT INTO public.app_rls_backup (schemaname, tablename, rowsecurity)
    VALUES (t.schemaname, t.tablename, t.rowsecurity) ON CONFLICT DO NOTHING;
    FOR p IN SELECT * FROM pg_policies WHERE schemaname = t.schemaname AND tablename = t.tablename AND policyname NOT LIKE 'app\_%' LOOP
      INSERT INTO public.app_policy_backup (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
      VALUES (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles::text[], p.cmd, p.qual, p.with_check)
      ON CONFLICT DO NOTHING;
      EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    END LOOP;

    -- 2. Drop the new rules if this file ran before, then switch rules on for the table
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = t.schemaname AND tablename = t.tablename AND policyname LIKE 'app\_%' LOOP
      EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, t.schemaname, t.tablename);
    END LOOP;
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);

    -- 3. The new rule
    IF t.schemaname IN ('regular', 'itr', 'finance') OR t.tablename = ANY (shared) THEN
      v_mode := CASE WHEN t.schemaname = 'public' THEN 'NULL' ELSE quote_literal(t.schemaname) END;
      EXECUTE format('CREATE POLICY app_access ON %I.%I FOR ALL TO anon, authenticated USING ((SELECT public.app_allow(%s))) WITH CHECK ((SELECT public.app_allow(%s)))',
                     t.schemaname, t.tablename, v_mode, v_mode);
    END IF;
  END LOOP;
END $$;

-- ---------- The app's own tables in public ----------

-- users: any logged-in user may read the list (names for the user filters); only admins change it.
-- Password columns become unreadable in part 3.
CREATE POLICY app_read ON public.users FOR SELECT TO anon, authenticated USING ((SELECT public.app_allow(NULL)));
CREATE POLICY app_admin_insert ON public.users FOR INSERT TO anon, authenticated WITH CHECK ((SELECT public.app_admin_allow()));
CREATE POLICY app_admin_update ON public.users FOR UPDATE TO anon, authenticated USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));
CREATE POLICY app_admin_delete ON public.users FOR DELETE TO anon, authenticated USING ((SELECT public.app_admin_allow()));

-- user_types, features: anyone logged in reads; admins change
CREATE POLICY app_read ON public.user_types FOR SELECT TO anon, authenticated USING ((SELECT public.app_allow(NULL)));
CREATE POLICY app_admin_write ON public.user_types FOR ALL TO anon, authenticated USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));
CREATE POLICY app_read ON public.features FOR SELECT TO anon, authenticated USING ((SELECT public.app_allow(NULL)));
CREATE POLICY app_admin_write ON public.features FOR ALL TO anon, authenticated USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));

-- user_access (Regular / ITR menus), user_permissions (Finance menus): a user reads their own; admins all
CREATE POLICY app_read ON public.user_access FOR SELECT TO anon, authenticated
  USING (user_id = (SELECT public.app_session_user()) OR (SELECT public.app_admin_allow()));
CREATE POLICY app_admin_write ON public.user_access FOR ALL TO anon, authenticated
  USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));
CREATE POLICY app_read ON public.user_permissions FOR SELECT TO anon, authenticated
  USING (user_id = (SELECT public.app_session_user()) OR (SELECT public.app_admin_allow()));
CREATE POLICY app_admin_write ON public.user_permissions FOR ALL TO anon, authenticated
  USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));

-- Login History: admins read. The new app never writes it directly (the login server and the
-- session functions do); the old app still writes it until protection is on.
CREATE POLICY app_admin_all ON public.login_history FOR ALL TO anon, authenticated
  USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));

-- Activity and audit logs: anyone logged in may add; admins read and change
CREATE POLICY app_add ON public.user_activities FOR INSERT TO anon, authenticated WITH CHECK ((SELECT public.app_allow(NULL)));
CREATE POLICY app_admin_all ON public.user_activities FOR ALL TO anon, authenticated
  USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));
CREATE POLICY app_add ON public.audit_logs FOR INSERT TO anon, authenticated WITH CHECK ((SELECT public.app_allow(NULL)));
CREATE POLICY app_admin_all ON public.audit_logs FOR ALL TO anon, authenticated
  USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()));

-- Sessions: a user sees their own; admins see all. Changes only through the functions.
CREATE POLICY app_read ON public.app_sessions FOR SELECT TO authenticated
  USING (user_id = (SELECT public.app_session_user()) OR (SELECT public.app_admin_allow()));

-- Forgot-password requests: admins read. Added only through request_password_reset().
CREATE POLICY app_read ON public.password_reset_requests FOR SELECT TO authenticated
  USING ((SELECT public.app_admin_allow()));

-- ---------- Files ----------
-- Viewing stays exactly as it is (photos open by their link). Each rule for uploading, changing or
-- deleting is saved, then made again with the same bucket limits plus the login check, so nothing
-- becomes allowed that was not allowed before.
DO $$
DECLARE
  p record;
  n int := 0;
  v_roles text;
  v_check text := '(SELECT public.app_allow(NULL))';
BEGIN
  INSERT INTO public.app_rls_backup (schemaname, tablename, rowsecurity)
  SELECT 'storage', 'objects', c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects'
  ON CONFLICT DO NOTHING;

  -- On a re-run: remove the rules this file made, and work from the saved originals
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'app\_%' LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
  FOR p IN SELECT * FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
              AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND policyname NOT LIKE 'app\_%' LOOP
    INSERT INTO public.app_policy_backup (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
    VALUES (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles::text[], p.cmd, p.qual, p.with_check)
    ON CONFLICT DO NOTHING;
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;

  FOR p IN SELECT * FROM public.app_policy_backup
            WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
            ORDER BY policyname LOOP
    n := n + 1;
    v_roles := (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') FROM unnest(p.roles) r);
    IF p.cmd = 'ALL' THEN
      -- A rule for everything also allowed viewing: keep the viewing part as it was
      EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR SELECT TO %s USING (%s)',
        'app_view_' || n, p.permissive, v_roles, coalesce(p.qual, 'true'));
      EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR INSERT TO %s WITH CHECK ((%s) AND %s)',
        'app_insert_' || n, p.permissive, v_roles, coalesce(p.with_check, p.qual, 'true'), v_check);
      EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR UPDATE TO %s USING ((%s) AND %s) WITH CHECK ((%s) AND %s)',
        'app_update_' || n, p.permissive, v_roles, coalesce(p.qual, 'true'), v_check, coalesce(p.with_check, p.qual, 'true'), v_check);
      EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR DELETE TO %s USING ((%s) AND %s)',
        'app_delete_' || n, p.permissive, v_roles, coalesce(p.qual, 'true'), v_check);
    ELSIF p.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR INSERT TO %s WITH CHECK ((%s) AND %s)',
        'app_insert_' || n, p.permissive, v_roles, coalesce(p.with_check, 'true'), v_check);
    ELSIF p.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR UPDATE TO %s USING ((%s) AND %s) WITH CHECK ((%s) AND %s)',
        'app_update_' || n, p.permissive, v_roles, coalesce(p.qual, 'true'), v_check, coalesce(p.with_check, p.qual, 'true'), v_check);
    ELSE
      EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR DELETE TO %s USING ((%s) AND %s)',
        'app_delete_' || n, p.permissive, v_roles, coalesce(p.qual, 'true'), v_check);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
