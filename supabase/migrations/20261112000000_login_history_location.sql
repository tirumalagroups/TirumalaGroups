-- =====================================================================================
-- Login History: where each login came from (city, state, country).
--
-- The login server reads the place from what Vercel already knows about each request (its
-- x-vercel-ip-city / -country-region / -country headers) and saves it on the Login History row.
-- Nothing is sent to any outside company. Only logins after this is run get a place;
-- older rows show "-". The place is approximate (mobile data often shows the operator's city).
--
-- 1. login_history gets a "location" column.
-- 2. app_record_failed_login also returns the id of the row it wrote, so the login server can
--    add the place to failed tries too (same inputs as before, nothing else changes).
--
-- Safe to run more than once. Undo: supabase/undo/20261112000000_login_history_location_UNDO.sql
-- =====================================================================================

ALTER TABLE public.login_history ADD COLUMN IF NOT EXISTS location text;

-- Same as in part 1, plus 'login_history_id' in what it returns
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
  v_hist uuid;
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
  VALUES (p_user_id, coalesce(p_username, ''), now(), p_ip, p_browser, p_device, p_os, false, v_reason)
  RETURNING id INTO v_hist;
  RETURN jsonb_build_object('attempts', v_attempts, 'locked_until', v_locked, 'login_history_id', v_hist);
END;
$$;

-- Tell the API about the new column
NOTIFY pgrst, 'reload schema';
