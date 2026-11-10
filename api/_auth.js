// Shared helpers for the login server (Vercel Functions). Files starting with "_" are not routes.
//
// Needs these Vercel environment variables (Project → Settings → Environment Variables):
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   already there (the app's build uses them)
//   SUPABASE_SERVICE_ROLE_KEY                   the Supabase master key. Server only: never VITE_, never in git.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
export const ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export const MIN_PASSWORD = 8;

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const configProblem = () => {
  if (!SUPABASE_URL || !ANON_KEY) return 'Login is not set up: the Supabase URL or public key is missing on the server.';
  if (!SERVICE_KEY) return 'Login is not set up: SUPABASE_SERVICE_ROLE_KEY is missing on the server.';
  return null;
};

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Full rights. Only ever used on the server. */
export const serviceClient = () => createClient(SUPABASE_URL, SERVICE_KEY, noSession);

/** Acts as the logged-in user whose token is given, so the database checks their session. */
export const userClient = (accessToken) =>
  createClient(SUPABASE_URL, ANON_KEY, { ...noSession, global: { headers: { Authorization: `Bearer ${accessToken}` } } });

/** The e-mail behind a user's Supabase login. Users never see or type it; no e-mail is ever sent. */
export const authEmail = (userId) => `${userId}@users.tirumalagroups.co`;

export const decodeJwt = (token) => {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

export const randomPassword = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
};

/** Checks a password with Supabase's login. Returns the new login (tokens) or the error. */
export const passwordGrant = async (email, password) => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body?.access_token) return { session: body };
  return { status: res.status, error: body?.error_code || body?.error || body?.msg || 'login_failed' };
};

/** Where the request came from. The IP is what Vercel saw, not what the browser claims. */
export const clientInfo = (request) => {
  const h = request.headers;
  const ip = (h.get('x-real-ip') || h.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const ua = h.get('user-agent') || '';
  let browser = 'Other';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = 'Other';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac OS';
  else if (/Linux/.test(ua)) os = 'Linux';
  const device = /iPad|Tablet/.test(ua) ? 'Tablet' : /Mobile|Android|iPhone/.test(ua) ? 'Mobile' : 'Desktop';
  return { ip, ua: ua.slice(0, 400), browser, os, device };
};

/** Why a login ended, from the database's SESSION_ENDED:<reason> error */
export const sessionEndedReason = (error) => {
  const m = String(error?.message || '').match(/SESSION_ENDED:(\w+)/);
  return m ? m[1] : null;
};

/**
 * The caller must be logged in with a live session (and an admin when asked).
 * Returns { me, token } or { response } to send back as it is.
 */
export const requireSession = async (request, { admin = false } = {}) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { response: json({ error: 'Please log in again.', reason: 'login_required' }, 401) };
  const { data, error } = await userClient(token).rpc('app_me');
  if (error || !data) {
    const reason = sessionEndedReason(error) || 'login_required';
    return { response: json({ error: 'Please log in again.', reason }, 401) };
  }
  if (admin && !data.is_admin) return { response: json({ error: 'Only an admin can do this.' }, 403) };
  return { me: data, token };
};

export const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};
