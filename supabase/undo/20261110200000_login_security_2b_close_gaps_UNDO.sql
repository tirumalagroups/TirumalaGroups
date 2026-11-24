-- Undo part 2b: attendance goes back to "any logged-in user", finance-photos loses its upload rules.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_staff', 'attendance_salary_history', 'attendance_records',
                           'attendance_holidays', 'attendance_month_locks', 'attendance_logs'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS app_admin_only ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS app_access ON public.%I', t);
      EXECUTE format('CREATE POLICY app_access ON public.%I FOR ALL TO anon, authenticated '
                     'USING ((SELECT public.app_allow(NULL))) WITH CHECK ((SELECT public.app_allow(NULL)))', t);
    END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS app_finance_photos_read ON storage.objects;
DROP POLICY IF EXISTS app_finance_photos_insert ON storage.objects;
DROP POLICY IF EXISTS app_finance_photos_update ON storage.objects;
DROP POLICY IF EXISTS app_finance_photos_delete ON storage.objects;
NOTIFY pgrst, 'reload schema';
