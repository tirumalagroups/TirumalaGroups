// Calls to the app's own server (/api/...), sent with the person's login so the server knows who asks.
import { rawSupabase } from './supabase';
import { parseSessionEnded, reportSessionEnded } from './sessionGuard';

export const loginToken = async (): Promise<string | null> => {
  try {
    const { data } = await rawSupabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
};

export const apiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const token = await loginToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    try {
      const body = await response.clone().json();
      const reason = body?.reason || parseSessionEnded(body?.error);
      if (reason && reason !== 'login_required') reportSessionEnded(reason);
    } catch {
      /* not JSON */
    }
  }
  return response;
};

/** POST JSON to the server; returns the answer, or throws with the server's message. */
export const apiPost = async <T = any>(path: string, body: unknown): Promise<T> => {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Server error (HTTP ${response.status})`);
  return data as T;
};
