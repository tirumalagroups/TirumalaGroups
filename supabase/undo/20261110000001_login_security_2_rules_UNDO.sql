-- UNDO of login security part 2: puts back the table rules exactly as they were before part 2
-- (from public.app_policy_backup / public.app_rls_backup), and removes the new ones.
-- Run part 3 UNDO first if part 3 was run. Not a migration to run in order: run it by hand only if needed.

DO $$
DECLARE
  t record;
  p record;
BEGIN
  -- Remove the new rules
  FOR p IN
    SELECT pol.schemaname, pol.tablename, pol.policyname FROM pg_policies pol
      JOIN public.app_rls_backup b ON b.schemaname = pol.schemaname AND b.tablename = pol.tablename
     WHERE pol.policyname LIKE 'app\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  -- Put the old rules back
  FOR p IN SELECT * FROM public.app_policy_backup LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = p.schemaname AND tablename = p.tablename AND policyname = p.policyname) THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
        p.policyname, p.schemaname, p.tablename,
        coalesce(p.permissive, 'PERMISSIVE'), coalesce(p.cmd, 'ALL'),
        (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') FROM unnest(p.roles) r),
        CASE WHEN p.qual IS NOT NULL THEN ' USING (' || p.qual || ')' ELSE '' END,
        CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || p.with_check || ')' ELSE '' END);
    END IF;
  END LOOP;

  -- Switch rules off again where they were off
  FOR t IN SELECT * FROM public.app_rls_backup WHERE schemaname <> 'storage' LOOP
    IF to_regclass(format('%I.%I', t.schemaname, t.tablename)) IS NOT NULL THEN
      IF t.rowsecurity THEN
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
      ELSE
        EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
      END IF;
    END IF;
  END LOOP;
END $$;

-- The new tables of part 1 keep their rules switched on (they hold login data)
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

DELETE FROM public.app_policy_backup;
DELETE FROM public.app_rls_backup;

NOTIFY pgrst, 'reload schema';
