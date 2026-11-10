// Login session guard.
// The database refuses every request of a login that has ended, with the error SESSION_ENDED:<reason>.
// This file notices that error on any request and tells the app (event below), which then logs the
// person out and shows why. See supabase/migrations/20261110000000_login_security_1_setup.sql.

export const SESSION_ENDED_EVENT = 'app-session-ended';
export const LOGOUT_REASON_KEY = 'thirumala_logout_reason';

export type SessionEndReason =
  | 'replaced' | 'admin' | 'expired' | 'idle' | 'disabled' | 'password_reset' | 'logout' | 'missing' | 'login_required';

export const SESSION_END_MESSAGES: Record<string, string> = {
  replaced: 'You were logged out because your account was logged in on another device.',
  admin: 'An admin logged you out.',
  expired: 'Logins end every night at 12:00 AM. Please log in again.',
  idle: 'You were logged out after 30 minutes without use.',
  disabled: 'Your account is not active. Please contact an admin.',
  password_reset: 'Your password was reset by an admin. Log in with the new password.',
  logout: 'Please log in again.',
  missing: 'Please log in again.',
  login_required: 'Please log in again.',
};

export const sessionEndMessage = (reason?: string | null): string =>
  SESSION_END_MESSAGES[reason || ''] || SESSION_END_MESSAGES.logout;

/** The reason in a SESSION_ENDED error text, if any */
export const parseSessionEnded = (text: string | null | undefined): string | null => {
  const m = String(text || '').match(/SESSION_ENDED:([a-z_]+)/);
  return m ? m[1] : null;
};

let reported = false;

/** Tell the app its login has ended (once, until the next login). */
export const reportSessionEnded = (reason: string): void => {
  if (reported) return;
  reported = true;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: reason }));
  } catch {
    /* no window (tests) */
  }
};

/** Called after a new login so a later ending is reported again. */
export const resetSessionEndedReport = (): void => {
  reported = false;
};

/**
 * fetch for the Supabase client: answers are passed through unchanged, but a refused request
 * because the login ended is reported.
 */
export const guardedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401 || response.status === 403) {
    try {
      const reason = parseSessionEnded(await response.clone().text());
      if (reason) reportSessionEnded(reason);
    } catch {
      /* the answer could not be read; nothing to report */
    }
  }
  return response;
};
