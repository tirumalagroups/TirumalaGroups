// Keeps a person logged in on this computer when there is no internet, even after the browser is
// closed, until their login ends: 12:00 AM India time (at most 24 hours).
// No password or password hash is ever stored here.
const KEY = 'thirumala_offline_session';
export const OFFLINE_SESSION_MS = 24 * 60 * 60 * 1000;

const SECRET_FIELDS = ['password', 'password_hash', 'temp_password'];

export const saveOfflineSession = (user: Record<string, any>, loginTime: number, expiresAt?: number): void => {
  try {
    const safe = { ...user };
    SECRET_FIELDS.forEach(f => delete safe[f]);
    const ends = Math.min(expiresAt ?? loginTime + OFFLINE_SESSION_MS, loginTime + OFFLINE_SESSION_MS);
    localStorage.setItem(KEY, JSON.stringify({ user: safe, time: loginTime, expiresAt: ends }));
  } catch (err) {
    console.error('Could not keep the offline session:', err);
  }
};

export const clearOfflineSession = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
};

export const readOfflineSession = (now: number = Date.now()): { user: any; time: number; expiresAt: number } | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!parsed?.user || typeof parsed.time !== 'number') return null;
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : parsed.time + OFFLINE_SESSION_MS;
    if (now >= expiresAt || now - parsed.time >= OFFLINE_SESSION_MS) {
      clearOfflineSession();
      return null;
    }
    return { ...parsed, expiresAt };
  } catch {
    return null;
  }
};

/** True if the server answers at all. WiFi with no internet counts as not reachable. */
export const backendReachable = async (timeoutMs = 3000): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${url}/auth/v1/health`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
