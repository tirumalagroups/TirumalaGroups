-- =====================================================================================
-- Login security, part 1 of 3: new tables, columns and functions.
--
-- Safe to run on the live database: it only ADDS things. Nothing the running app uses is
-- changed, and no table is locked yet (that is part 2 and part 3).
-- It can be run more than once.
--
-- What it adds:
--   app_security_settings   one row: is protection switched on (enforce), idle minutes
--   app_sessions            one row per login: device, IP, start, last activity, ends at midnight
--   password_reset_requests "Forgot password" requests for the admins
--   users.auth_user_id      link to the user's Supabase login (filled at their first new login)
--   users.locked_until      5 wrong passwords lock the account for 15 minutes
--   users.must_change_password   after a reset by an admin, or a password shorter than 8
--   login_history.session_id / end_reason   why each login ended
--   functions used by the login server, the database rules and the admin screens
--
-- Undo: supabase/undo/20261110000000_login_security_1_setup_UNDO.sql
-- =====================================================================================

-- ---------- Settings ----------
CREATE TABLE IF NOT EXISTS public.app_security_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforce boolean NOT NULL DEFAULT false,      -- false: logins are checked, but the old app (no login token) still works
  idle_minutes int NOT NULL DEFAULT 30,        -- no use for this long ends the login
  lock_after_failures int NOT NULL DEFAULT 5,
  lock_minutes int NOT NULL DEFAULT 15,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_security_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.app_security_settings ENABLE ROW LEVEL SECURITY;  -- no policies: only the functions below read it

-- ---------- Users ----------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_key ON public.users (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ---------- Login history ----------
ALTER TABLE public.login_history ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.login_history ADD COLUMN IF NOT EXISTS end_reason text;
CREATE INDEX IF NOT EXISTS login_history_login_time_idx ON public.login_history (login_time DESC);

-- ---------- Sessions ----------
CREATE TABLE IF NOT EXISTS public.app_sessions (
  id uuid PRIMARY KEY,                          -- the Supabase login session (session_id in the login token)
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL,
  username text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,              -- the next midnight, India time
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('logout', 'replaced', 'admin', 'expired', 'idle', 'disabled', 'password_reset')),
  ended_by text,
  ip_address text,
  browser text,
  os text,
  device text,
  user_agent text,
  login_history_id uuid
);
CREATE INDEX IF NOT EXISTS app_sessions_open_idx ON public.app_sessions (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS app_sessions_started_idx ON public.app_sessions (started_at DESC);
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

-- ---------- Forgot password ----------
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dismissed')),
  handled_by text,
  handled_at timestamptz
);
CREATE INDEX IF NOT EXISTS password_reset_requests_pending_idx ON public.password_reset_requests (requested_at DESC) WHERE status = 'pending';
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- ---------- Backup of the table rules, filled by part 2 so its undo can put them back exactly ----------
CREATE TABLE IF NOT EXISTS public.app_policy_backup (
  schemaname text NOT NULL,
  tablename text NOT NULL,
  policyname text NOT NULL,
  permissive text,
  roles text[],
  cmd text,
  qual text,
  with_check text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schemaname, tablename, policyname)
);
CREATE TABLE IF NOT EXISTS public.app_rls_backup (
  schemaname text NOT NULL,
  tablename text NOT NULL,
  rowsecurity boolean NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schemaname, tablename)
);
ALTER TABLE public.app_policy_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_rls_backup ENABLE ROW LEVEL SECURITY;

-- Table permissions: the app may only read sessions and reset requests (rows filtered by the rules in
-- part 2); all changes go through the functions below. Settings and backups: functions only.
REVOKE ALL ON public.app_security_settings, public.app_sessions, public.password_reset_requests,
  public.app_policy_backup, public.app_rls_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_sessions, public.password_reset_requests TO authenticated;
GRANT ALL ON public.app_security_settings, public.app_sessions, public.password_reset_requests,
  public.app_policy_backup, public.app_rls_backup TO service_role;

-- =====================================================================================
-- Functions. All run with the owner's rights (SECURITY DEFINER) and a fixed search_path.
-- =====================================================================================

-- The next midnight, India time
CREATE OR REPLACE FUNCTION public.app_next_midnight(p_from timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (((p_from AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp) AT TIME ZONE 'Asia/Kolkata';
$$;

CREATE OR REPLACE FUNCTION public.app_enforced()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT enforce FROM public.app_security_settings WHERE id = 1), false);
$$;

CREATE OR REPLACE FUNCTION public.app_idle_minutes()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT idle_minutes FROM public.app_security_settings WHERE id = 1), 30);
$$;

-- The session in the caller's login token, if it belongs to the caller
CREATE OR REPLACE FUNCTION public.app_session_row()
RETURNS public.app_sessions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sid uuid;
  v_uid uuid := auth.uid();
  s public.app_sessions;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  BEGIN
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.app_sessions WHERE id = v_sid AND auth_user_id = v_uid;
  RETURN s;
END;
$$;

-- Why a session can no longer be used, or NULL when it is fine
CREATE OR REPLACE FUNCTION public.app_session_problem(s public.app_sessions)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_active boolean;
BEGIN
  IF s.id IS NULL THEN RETURN 'missing'; END IF;
  IF s.ended_at IS NOT NULL THEN RETURN coalesce(s.end_reason, 'logout'); END IF;
  IF s.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF s.last_seen_at < now() - make_interval(mins => public.app_idle_minutes()) THEN RETURN 'idle'; END IF;
  SELECT (coalesce(u.is_active, true) AND coalesce(u.status, 'Active') = 'Active') INTO v_active
    FROM public.users u WHERE u.id = s.user_id;
  IF NOT coalesce(v_active, false) THEN RETURN 'disabled'; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_user_is_admin(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u JOIN public.user_types t ON t.id = u.user_type_id
    WHERE u.id = p_user_id AND t.user_type = 'Admin'
  );
$$;

-- May this user see data of this mode? Admins see everything.
CREATE OR REPLACE FUNCTION public.app_user_has_mode(p_user_id uuid, p_mode text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_mode IS NULL THEN true
    WHEN public.app_user_is_admin(p_user_id) THEN true
    WHEN p_mode = 'finance' THEN EXISTS (SELECT 1 FROM public.user_permissions p WHERE p.user_id = p_user_id)
    WHEN p_mode = 'itr' THEN EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = p_user_id AND a.mode = 'itr')
    ELSE EXISTS (SELECT 1 FROM public.user_access a WHERE a.user_id = p_user_id AND coalesce(a.mode, 'regular') = 'regular')
  END;
$$;

-- The check every table rule uses (part 2).
--  * A request with a login token must belong to a live session, else it fails with SESSION_ENDED:<reason>
--    (HTTP 401) and the app logs the person out with that reason.
--  * A request without a login token (the old app) is allowed until protection is switched on (part 3).
--  * p_mode limits Regular / ITR / Finance data to users with access to that mode; NULL = any logged-in user.
CREATE OR REPLACE FUNCTION public.app_allow(p_mode text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.app_sessions;
  v_problem text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF public.app_enforced() THEN
      RAISE EXCEPTION 'SESSION_ENDED:login_required' USING ERRCODE = 'PT401';
    END IF;
    RETURN true;
  END IF;
  s := public.app_session_row();
  v_problem := public.app_session_problem(s);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'SESSION_ENDED:%', v_problem USING ERRCODE = 'PT401';
  END IF;
  RETURN public.app_user_has_mode(s.user_id, p_mode);
END;
$$;

-- Admin-only rules: a live admin session, or the old app until protection is switched on
CREATE OR REPLACE FUNCTION public.app_admin_allow()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_allow(NULL) THEN RETURN false; END IF;
  IF auth.uid() IS NULL THEN RETURN true; END IF;   -- old app, protection not on yet (app_allow raised otherwise)
  RETURN public.app_user_is_admin((public.app_session_row()).user_id);
END;
$$;

-- The app user of the caller's live session (NULL when none)
CREATE OR REPLACE FUNCTION public.app_session_user()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.app_sessions := public.app_session_row();
BEGIN
  IF public.app_session_problem(s) IS NOT NULL THEN RETURN NULL; END IF;
  RETURN s.user_id;
END;
$$;

-- "12m 5s" / "2h 3m", the same style as the existing Login History
CREATE OR REPLACE FUNCTION public.app_duration_text(p_seconds numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_seconds IS NULL OR p_seconds < 0 THEN NULL
    WHEN p_seconds >= 3600 THEN floor(p_seconds / 3600)::int || 'h ' || floor(mod(p_seconds, 3600) / 60)::int || 'm'
    WHEN p_seconds >= 60 THEN floor(p_seconds / 60)::int || 'm ' || floor(mod(p_seconds, 60))::int || 's'
    ELSE floor(p_seconds)::int || 's'
  END;
$$;

-- Ends one session: the session row, its Login History row, and the Supabase login behind it
CREATE OR REPLACE FUNCTION public.app_end_session(p_session_id uuid, p_reason text, p_by text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.app_sessions;
  v_end timestamptz;
BEGIN
  SELECT * INTO s FROM public.app_sessions WHERE id = p_session_id AND ended_at IS NULL FOR UPDATE;
  IF s.id IS NULL THEN RETURN false; END IF;
  -- An expired or idle session ended when it ran out, not when it was noticed
  v_end := CASE
    WHEN p_reason = 'expired' THEN least(now(), s.expires_at)
    WHEN p_reason = 'idle' THEN least(now(), s.last_seen_at + make_interval(mins => public.app_idle_minutes()))
    ELSE now()
  END;
  UPDATE public.app_sessions SET ended_at = v_end, end_reason = p_reason, ended_by = p_by WHERE id = s.id;
  IF s.login_history_id IS NOT NULL THEN
    UPDATE public.login_history
       SET logout_time = v_end,
           session_duration = public.app_duration_text(extract(epoch FROM v_end - s.started_at)),
           end_reason = p_reason
     WHERE id = s.login_history_id;
  END IF;
  -- Stop the Supabase login from being renewed. The session check above already blocks it either way.
  BEGIN
    DELETE FROM auth.sessions WHERE id = s.id;
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RETURN true;
END;
$$;

-- Marks sessions that ran out (midnight or idle) as ended, so lists and history are right
CREATE OR REPLACE FUNCTION public.app_close_stale_sessions()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT id, CASE WHEN expires_at <= now() THEN 'expired' ELSE 'idle' END AS reason
      FROM public.app_sessions
     WHERE ended_at IS NULL
       AND (expires_at <= now() OR last_seen_at < now() - make_interval(mins => public.app_idle_minutes()))
  LOOP
    PERFORM public.app_end_session(r.id, r.reason, 'system');
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Called by the login server after a correct password: one login per user, so any other login
-- of this user ends ("replaced"). Records Login History and returns when this login ends.
CREATE OR REPLACE FUNCTION public.app_start_session(
  p_user_id uuid, p_auth_user_id uuid, p_session_id uuid,
  p_ip text DEFAULT NULL, p_browser text DEFAULT NULL, p_os text DEFAULT NULL,
  p_device text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u public.users;
  r record;
  v_hist uuid;
  v_expires timestamptz := public.app_next_midnight(now());
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'unknown user'; END IF;
  PERFORM public.app_close_stale_sessions();
  FOR r IN SELECT id FROM public.app_sessions WHERE user_id = p_user_id AND ended_at IS NULL AND id <> p_session_id LOOP
    PERFORM public.app_end_session(r.id, 'replaced', 'system');
  END LOOP;
  INSERT INTO public.login_history (user_id, username, login_time, ip_address, browser, device, os, success, session_id)
  VALUES (u.id, u.username, now(), p_ip, p_browser, p_device, p_os, true, p_session_id)
  RETURNING id INTO v_hist;
  INSERT INTO public.app_sessions (id, user_id, auth_user_id, username, expires_at, ip_address, browser, os, device, user_agent, login_history_id)
  VALUES (p_session_id, u.id, p_auth_user_id, u.username, v_expires, p_ip, p_browser, p_os, p_device, left(p_user_agent, 400), v_hist)
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.users
     SET last_login = now(), login_count = coalesce(login_count, 0) + 1,
         failed_login_attempts = 0, locked_until = NULL,
         auth_user_id = coalesce(auth_user_id, p_auth_user_id)
   WHERE id = u.id;
  RETURN jsonb_build_object('session_id', p_session_id, 'expires_at', v_expires, 'login_history_id', v_hist,
                            'idle_minutes', public.app_idle_minutes());
END;
$$;

-- Called by the login server after a failed try. A wrong password counts towards the lock.
CREATE OR REPLACE FUNCTION public.app_record_failed_login(
  p_user_id uuid, p_username text, p_reason text, p_count boolean,
  p_ip text DEFAULT NULL, p_browser text DEFAULT NULL, p_os text DEFAULT NULL, p_device text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_attempts int := 0;
  v_locked timestamptz;
  v_after int;
  v_minutes int;
  v_reason text := p_reason;
BEGIN
  SELECT lock_after_failures, lock_minutes INTO v_after, v_minutes FROM public.app_security_settings WHERE id = 1;
  IF p_user_id IS NOT NULL AND p_count THEN
    UPDATE public.users SET failed_login_attempts = coalesce(failed_login_attempts, 0) + 1
     WHERE id = p_user_id RETURNING failed_login_attempts INTO v_attempts;
    IF v_attempts >= coalesce(v_after, 5) THEN
      v_locked := now() + make_interval(mins => coalesce(v_minutes, 15));
      UPDATE public.users SET locked_until = v_locked, failed_login_attempts = 0 WHERE id = p_user_id;
      v_reason := 'Account locked: too many wrong passwords';
    END IF;
  END IF;
  INSERT INTO public.login_history (user_id, username, login_time, ip_address, browser, device, os, success, failure_reason)
  VALUES (p_user_id, coalesce(p_username, ''), now(), p_ip, p_browser, p_device, p_os, false, v_reason);
  RETURN jsonb_build_object('attempts', v_attempts, 'locked_until', v_locked);
END;
$$;

-- The app calls this while someone is using it (p_active = true moves "last activity"), and to check
-- whether its login is still live. Returns why it ended, if it did.
CREATE OR REPLACE FUNCTION public.app_touch(p_active boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.app_sessions := public.app_session_row();
  v_problem text := public.app_session_problem(s);
  v_must boolean;
BEGIN
  IF v_problem IS NOT NULL THEN
    IF s.id IS NOT NULL AND s.ended_at IS NULL AND v_problem IN ('expired', 'idle', 'disabled') THEN
      PERFORM public.app_end_session(s.id, v_problem, 'system');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_problem);
  END IF;
  IF p_active THEN
    UPDATE public.app_sessions SET last_seen_at = now() WHERE id = s.id;
  END IF;
  SELECT must_change_password INTO v_must FROM public.users WHERE id = s.user_id;
  RETURN jsonb_build_object('ok', true, 'expires_at', s.expires_at, 'idle_minutes', public.app_idle_minutes(),
                            'must_change_password', coalesce(v_must, false), 'now', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.app_logout()
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.app_sessions := public.app_session_row();
BEGIN
  IF s.id IS NULL THEN RETURN false; END IF;
  RETURN public.app_end_session(s.id, 'logout', s.username);
END;
$$;

-- Who is logged in on this session: what the app needs after a page reload
CREATE OR REPLACE FUNCTION public.app_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.app_sessions := public.app_session_row();
  v_problem text := public.app_session_problem(s);
  u public.users;
BEGIN
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'SESSION_ENDED:%', v_problem USING ERRCODE = 'PT401';
  END IF;
  SELECT * INTO u FROM public.users WHERE id = s.user_id;
  RETURN jsonb_build_object(
    'id', u.id, 'username', u.username, 'full_name', u.full_name, 'mode', u.mode,
    'is_admin', public.app_user_is_admin(u.id),
    'must_change_password', coalesce(u.must_change_password, false),
    'session_id', s.id, 'expires_at', s.expires_at, 'started_at', s.started_at,
    'idle_minutes', public.app_idle_minutes());
END;
$$;

-- ---------- Admin actions ----------
CREATE OR REPLACE FUNCTION public.app_require_admin()
RETURNS public.app_sessions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.app_sessions := public.app_session_row();
  v_problem text := public.app_session_problem(s);
BEGIN
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'SESSION_ENDED:%', v_problem USING ERRCODE = 'PT401';
  END IF;
  IF NOT public.app_user_is_admin(s.user_id) THEN
    RAISE EXCEPTION 'Only an admin can do this' USING ERRCODE = 'PT403';
  END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_end_session(p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me public.app_sessions := public.app_require_admin();
BEGIN
  RETURN public.app_end_session(p_session_id, 'admin', me.username);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_end_user_sessions(p_user_id uuid)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me public.app_sessions := public.app_require_admin();
  r record;
  n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.app_sessions WHERE user_id = p_user_id AND ended_at IS NULL LOOP
    IF public.app_end_session(r.id, 'admin', me.username) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unlock_user(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me public.app_sessions := public.app_require_admin();
BEGIN
  UPDATE public.users
     SET locked_until = NULL, failed_login_attempts = 0,
         status = CASE WHEN status = 'Locked' THEN 'Active' ELSE status END,
         is_active = CASE WHEN status = 'Locked' THEN true ELSE is_active END
   WHERE id = p_user_id;
  INSERT INTO public.audit_logs (changed_by, target_user_id, target_username, field, old_value, new_value, reason)
  SELECT me.username, u.id, u.username, 'lock', 'Locked', 'Unlocked', 'Unlocked by admin' FROM public.users u WHERE u.id = p_user_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_close_reset_request(p_request_id uuid, p_status text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me public.app_sessions := public.app_require_admin();
BEGIN
  IF p_status NOT IN ('done', 'dismissed') THEN RAISE EXCEPTION 'bad status'; END IF;
  UPDATE public.password_reset_requests
     SET status = p_status, handled_by = me.username, handled_at = now()
   WHERE id = p_request_id AND status = 'pending';
  RETURN FOUND;
END;
$$;

-- "Forgot password" from the login page. Anyone may ask; the answer never says whether the
-- username exists. At most one open request per username, and a limit per hour overall.
CREATE OR REPLACE FUNCTION public.request_password_reset(p_username text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := left(btrim(coalesce(p_username, '')), 60);
  v_user uuid;
BEGIN
  IF v_name = '' THEN RETURN true; END IF;
  IF (SELECT count(*) FROM public.password_reset_requests WHERE requested_at > now() - interval '1 hour') >= 30 THEN
    RETURN true;
  END IF;
  SELECT id INTO v_user FROM public.users WHERE lower(username) = lower(v_name) LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.password_reset_requests
              WHERE status = 'pending' AND lower(username) = lower(v_name)) THEN
    RETURN true;
  END IF;
  INSERT INTO public.password_reset_requests (user_id, username) VALUES (v_user, v_name);
  RETURN true;
END;
$$;

-- Used by the login server when it moves an existing user to the new login
CREATE OR REPLACE FUNCTION public.app_auth_user_id_by_email(p_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

-- A user who is disabled, deleted or locked by an admin is logged out at once
CREATE OR REPLACE FUNCTION public.app_users_end_sessions_on_disable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  IF (coalesce(NEW.is_active, true) = false OR coalesce(NEW.status, 'Active') <> 'Active')
     AND (coalesce(OLD.is_active, true) = true AND coalesce(OLD.status, 'Active') = 'Active') THEN
    FOR r IN SELECT id FROM public.app_sessions WHERE user_id = NEW.id AND ended_at IS NULL LOOP
      PERFORM public.app_end_session(r.id, 'disabled', 'system');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS app_users_end_sessions_on_disable ON public.users;
CREATE TRIGGER app_users_end_sessions_on_disable
  AFTER UPDATE OF status, is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.app_users_end_sessions_on_disable();

-- ---------- Who may run what ----------
REVOKE ALL ON FUNCTION
  public.app_enforced(), public.app_idle_minutes(), public.app_session_row(),
  public.app_session_problem(public.app_sessions), public.app_user_is_admin(uuid),
  public.app_user_has_mode(uuid, text), public.app_allow(text), public.app_admin_allow(),
  public.app_session_user(), public.app_end_session(uuid, text, text), public.app_close_stale_sessions(),
  public.app_start_session(uuid, uuid, uuid, text, text, text, text, text),
  public.app_record_failed_login(uuid, text, text, boolean, text, text, text, text),
  public.app_touch(boolean), public.app_logout(), public.app_me(), public.app_require_admin(),
  public.admin_end_session(uuid), public.admin_end_user_sessions(uuid), public.admin_unlock_user(uuid),
  public.admin_close_reset_request(uuid, text), public.request_password_reset(text),
  public.app_auth_user_id_by_email(text), public.app_users_end_sessions_on_disable()
FROM PUBLIC, anon, authenticated;

-- Used inside the table rules, so every caller needs them
GRANT EXECUTE ON FUNCTION public.app_allow(text), public.app_admin_allow(), public.app_session_user()
  TO anon, authenticated;
-- The app, once logged in
GRANT EXECUTE ON FUNCTION public.app_touch(boolean), public.app_logout(), public.app_me(),
  public.admin_end_session(uuid), public.admin_end_user_sessions(uuid), public.admin_unlock_user(uuid),
  public.admin_close_reset_request(uuid, text)
  TO authenticated;
-- The login page
GRANT EXECUTE ON FUNCTION public.request_password_reset(text) TO anon, authenticated;
-- The login server only (it uses the service key)
GRANT EXECUTE ON FUNCTION public.app_start_session(uuid, uuid, uuid, text, text, text, text, text),
  public.app_record_failed_login(uuid, text, text, boolean, text, text, text, text),
  public.app_auth_user_id_by_email(text), public.app_close_stale_sessions(),
  public.app_end_session(uuid, text, text)
  TO service_role;

-- Tell the API about the new tables and functions
NOTIFY pgrst, 'reload schema';
