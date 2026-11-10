-- UNDO of login security part 1: removes the new tables, columns and functions.
-- Run the part 3 and part 2 UNDO files first if those parts were run.
-- Login History rows and Supabase login accounts created meanwhile are kept.
-- Not a migration to run in order: run it by hand only if needed.

DROP TRIGGER IF EXISTS app_users_end_sessions_on_disable ON public.users;

DROP FUNCTION IF EXISTS
  public.app_users_end_sessions_on_disable(), public.app_auth_user_id_by_email(text),
  public.request_password_reset(text), public.admin_close_reset_request(uuid, text),
  public.admin_unlock_user(uuid), public.admin_end_user_sessions(uuid), public.admin_end_session(uuid),
  public.app_require_admin(), public.app_me(), public.app_logout(), public.app_touch(boolean),
  public.app_record_failed_login(uuid, text, text, boolean, text, text, text, text),
  public.app_start_session(uuid, uuid, uuid, text, text, text, text, text),
  public.app_close_stale_sessions(), public.app_end_session(uuid, text, text),
  public.app_duration_text(numeric), public.app_session_user(), public.app_admin_allow(),
  public.app_allow(text), public.app_user_has_mode(uuid, text), public.app_user_is_admin(uuid),
  public.app_session_problem(public.app_sessions), public.app_session_row(),
  public.app_idle_minutes(), public.app_enforced(), public.app_next_midnight(timestamptz);

DROP TABLE IF EXISTS public.app_sessions;
DROP TABLE IF EXISTS public.password_reset_requests;
DROP TABLE IF EXISTS public.app_security_settings;
DROP TABLE IF EXISTS public.app_policy_backup;
DROP TABLE IF EXISTS public.app_rls_backup;

ALTER TABLE public.users DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE public.users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE public.users DROP COLUMN IF EXISTS auth_user_id;
ALTER TABLE public.login_history DROP COLUMN IF EXISTS end_reason;
ALTER TABLE public.login_history DROP COLUMN IF EXISTS session_id;

NOTIFY pgrst, 'reload schema';
