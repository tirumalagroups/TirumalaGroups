-- =====================================================================================
-- Login security, part 2b: two gaps found in the final check. Run after part 2, before part 3.
--
-- A. Attendance (staff, salaries, records, holidays, month locks, logs): admins only.
--    The Attendance screen is already admin-only; until now the database let any logged-in user in.
-- B. Finance photos: the "finance-photos" file bucket never had upload / change / delete rules, so
--    Finance photo uploads failed there (customer photos fell back to the "driver-license" bucket;
--    the CD Ledger return signature was not saved). Now: logged-in users with Finance access.
--    Viewing photos by their link stays open, as before.
--
-- Safe to run more than once. Undo: supabase/undo/20261110200000_login_security_2b_close_gaps_UNDO.sql
-- (the part 2 undo also removes these, as all their names start with "app_").
-- =====================================================================================

-- A. Attendance: admins only
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_staff', 'attendance_salary_history', 'attendance_records',
                           'attendance_holidays', 'attendance_month_locks', 'attendance_logs'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS app_access ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS app_admin_only ON public.%I', t);
      EXECUTE format('CREATE POLICY app_admin_only ON public.%I FOR ALL TO anon, authenticated '
                     'USING ((SELECT public.app_admin_allow())) WITH CHECK ((SELECT public.app_admin_allow()))', t);
    END IF;
  END LOOP;
END $$;

-- B. finance-photos: upload, replace and delete for logged-in Finance users
-- (a delete in Supabase also needs the read rule)
DROP POLICY IF EXISTS app_finance_photos_read ON storage.objects;
DROP POLICY IF EXISTS app_finance_photos_insert ON storage.objects;
DROP POLICY IF EXISTS app_finance_photos_update ON storage.objects;
DROP POLICY IF EXISTS app_finance_photos_delete ON storage.objects;
CREATE POLICY app_finance_photos_read ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'finance-photos' AND (SELECT public.app_allow('finance')));
CREATE POLICY app_finance_photos_insert ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'finance-photos' AND (SELECT public.app_allow('finance')));
CREATE POLICY app_finance_photos_update ON storage.objects FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'finance-photos' AND (SELECT public.app_allow('finance')))
  WITH CHECK (bucket_id = 'finance-photos' AND (SELECT public.app_allow('finance')));
CREATE POLICY app_finance_photos_delete ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'finance-photos' AND (SELECT public.app_allow('finance')));

NOTIFY pgrst, 'reload schema';

-- Check: 6 attendance rules and 4 finance-photos rules
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE policyname = 'app_admin_only' OR policyname LIKE 'app_finance_photos_%'
ORDER BY 1, 2, 3;
