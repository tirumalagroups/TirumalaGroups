-- Undo the Login History location: the column goes (with the places saved in it) and
-- app_record_failed_login returns what it returned before. The app keeps working either way.
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
ALTER TABLE public.login_history DROP COLUMN IF EXISTS location;
NOTIFY pgrst, 'reload schema';
