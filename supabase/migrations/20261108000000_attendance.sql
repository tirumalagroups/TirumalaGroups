-- Attendance menu (Regular, admin only).
-- Adds NEW tables only. No existing table or data is changed.
-- Safe to run more than once.

-- 1. Job holders
CREATE TABLE IF NOT EXISTS public.attendance_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sno integer NOT NULL,
  name text NOT NULL,
  relation_type text NOT NULL DEFAULT 'S/O',
  relation_name text NOT NULL DEFAULT '',
  village text NOT NULL DEFAULT '',
  salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (salary >= 0),
  joining_date date NOT NULL,
  leaving_date date,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (leaving_date IS NULL OR leaving_date >= joining_date)
);

-- 2. Salary from a given date, so a raise never changes old months
CREATE TABLE IF NOT EXISTS public.attendance_salary_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.attendance_staff(id) ON DELETE CASCADE,
  salary numeric(12,2) NOT NULL CHECK (salary >= 0),
  effective_from date NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, effective_from)
);

-- 3. One entry per person per day
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.attendance_staff(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'half_day', 'absent')),
  reason text NOT NULL DEFAULT '',
  marked_by text NOT NULL DEFAULT '',
  marked_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS attendance_records_date_idx ON public.attendance_records (attendance_date);

-- 4. Holidays (paid week off). Sundays are automatic and are not stored here.
CREATE TABLE IF NOT EXISTS public.attendance_holidays (
  holiday_date date PRIMARY KEY,
  name text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Closed months, with the final salary figures kept exactly as they were at closing
CREATE TABLE IF NOT EXISTS public.attendance_month_locks (
  month text PRIMARY KEY CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  summary jsonb NOT NULL,
  locked_by text NOT NULL DEFAULT '',
  locked_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Every change. Rows can be added and read, never changed or removed.
CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  staff_id uuid,
  staff_name text NOT NULL DEFAULT '',
  target_date text NOT NULL DEFAULT '',
  field text NOT NULL DEFAULT '',
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  changed_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_logs_created_idx ON public.attendance_logs (created_at DESC);

-- The app connects with the public key, so these rules let it read and write.
-- They work whether Supabase keeps Row Level Security on or off for new tables.
ALTER TABLE public.attendance_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_staff_app_access" ON public.attendance_staff;
CREATE POLICY "attendance_staff_app_access" ON public.attendance_staff FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.attendance_salary_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_salary_history_app_access" ON public.attendance_salary_history;
CREATE POLICY "attendance_salary_history_app_access" ON public.attendance_salary_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_records_app_access" ON public.attendance_records;
CREATE POLICY "attendance_records_app_access" ON public.attendance_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.attendance_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_holidays_app_access" ON public.attendance_holidays;
CREATE POLICY "attendance_holidays_app_access" ON public.attendance_holidays FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.attendance_month_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_month_locks_app_access" ON public.attendance_month_locks;
CREATE POLICY "attendance_month_locks_app_access" ON public.attendance_month_locks FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_staff TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_salary_history TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_holidays TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_month_locks TO anon, authenticated, service_role;

-- Logs: add and read only
REVOKE ALL ON public.attendance_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.attendance_logs TO anon, authenticated, service_role;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_logs_read" ON public.attendance_logs;
CREATE POLICY "attendance_logs_read" ON public.attendance_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "attendance_logs_add" ON public.attendance_logs;
CREATE POLICY "attendance_logs_add" ON public.attendance_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
