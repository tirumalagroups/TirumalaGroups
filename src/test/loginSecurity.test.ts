// Login security: the session helpers, and the login server (api/) against a fake Supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { parseSessionEnded, sessionEndMessage } from '../lib/sessionGuard';
import { isSessionEnded } from '../lib/offlineSyncEngine';

// ---------- helpers that do not need a server ----------

describe('session helpers', () => {
  it('reads the reason from a SESSION_ENDED error', () => {
    expect(parseSessionEnded('{"code":"PT401","message":"SESSION_ENDED:replaced"}')).toBe('replaced');
    expect(parseSessionEnded('SESSION_ENDED:password_reset')).toBe('password_reset');
    expect(parseSessionEnded('permission denied')).toBeNull();
  });

  it('has a message for every reason, and a default', () => {
    for (const r of ['replaced', 'admin', 'expired', 'idle', 'disabled', 'password_reset']) {
      expect(sessionEndMessage(r)).not.toBe(sessionEndMessage('logout'));
    }
    expect(sessionEndMessage('something-new')).toBe(sessionEndMessage('logout'));
  });

  it('a sync refused because the login ended is not a refusal of the entry', () => {
    expect(isSessionEnded({ code: 'PT401', message: 'SESSION_ENDED:idle' })).toBe(true);
    expect(isSessionEnded({ code: '23505', message: 'duplicate key' })).toBe(false);
  });
});

describe('next midnight, India time', async () => {
  const { nextMidnightIndia } = await import('../contexts/AuthContext');
  it('11:50 PM India time ends at 12:00 AM the same night', () => {
    expect(new Date(nextMidnightIndia(Date.parse('2026-11-09T23:50:00+05:30'))).toISOString()).toBe('2026-11-09T18:30:00.000Z');
  });
  it('12:05 AM India time ends at the next midnight', () => {
    expect(new Date(nextMidnightIndia(Date.parse('2026-11-10T00:05:00+05:30'))).toISOString()).toBe('2026-11-10T18:30:00.000Z');
  });
  it('exactly midnight starts a new day', () => {
    expect(new Date(nextMidnightIndia(Date.parse('2026-11-10T00:00:00+05:30'))).toISOString()).toBe('2026-11-10T18:30:00.000Z');
  });
});

describe('offline login ends at midnight', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  const { saveOfflineSession, readOfflineSession } = await import('../lib/offlineSession');
  it('is kept until the login end, then removed', () => {
    const login = Date.parse('2026-11-09T20:00:00+05:30');
    const end = Date.parse('2026-11-10T00:00:00+05:30');
    saveOfflineSession({ id: 'u1', username: 'A', password: 'x' }, login, end);
    const kept = readOfflineSession(end - 1000);
    expect(kept?.user.username).toBe('A');
    expect(kept?.user.password).toBeUndefined();
    expect(readOfflineSession(end + 1000)).toBeNull();
  });
});

// ---------- the login server against a fake Supabase ----------

type U = Record<string, any>;
interface Fake {
  users: U[];
  authUsers: { id: string; email: string; password: string }[];
  sessions: { id: string; authId: string }[];
  calls: string[];
  started: U[];
  failed: U[];
  ended: U[];
}
let fake: Fake;
const URL_ = 'https://fake.supabase.co';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (authId: string, sid: string) => `${b64({ alg: 'HS256' })}.${b64({ sub: authId, session_id: sid, role: 'authenticated' })}.sig`;
const res = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const userIdFromToken = (auth: string | null) => {
  const t = (auth || '').replace('Bearer ', '');
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    return p;
  } catch {
    return null;
  }
};

const fakeFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const u = new URL(req.url);
  const method = req.method;
  const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await req.clone().json().catch(() => ({})) : {};
  fake.calls.push(`${method} ${u.pathname}`);

  if (u.pathname === '/auth/v1/token') {
    const a = fake.authUsers.find(x => x.email === body.email && x.password === body.password);
    if (!a) return res({ error_code: 'invalid_credentials' }, 400);
    const sid = crypto.randomUUID();
    fake.sessions.push({ id: sid, authId: a.id });
    return res({ access_token: token(a.id, sid), refresh_token: 'r-' + sid, expires_in: 3600, token_type: 'bearer', user: { id: a.id } });
  }
  if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
    if (fake.authUsers.some(x => x.email === body.email)) return res({ code: 422, error_code: 'email_exists', msg: 'exists' }, 422);
    const a = { id: crypto.randomUUID(), email: body.email, password: body.password };
    fake.authUsers.push(a);
    return res({ id: a.id, email: a.email });
  }
  if (u.pathname.startsWith('/auth/v1/admin/users/') && method === 'PUT') {
    const a = fake.authUsers.find(x => x.id === u.pathname.split('/').pop());
    if (!a) return res({ msg: 'not found' }, 404);
    if (body.password) a.password = body.password;
    return res({ id: a.id });
  }
  if (u.pathname === '/auth/v1/logout') return res(undefined, 204);

  if (u.pathname === '/rest/v1/users' && method === 'GET') {
    const like = (u.searchParams.get('username') || '').replace(/^ilike\./, '').toLowerCase();
    const idEq = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    let rows = fake.users;
    if (like) rows = rows.filter(r => r.username.toLowerCase() === like);
    if (idEq) rows = rows.filter(r => r.id === idEq);
    const single = (req.headers.get('accept') || '').includes('vnd.pgrst.object');
    return single ? (rows[0] ? res(rows[0]) : res({ code: 'PGRST116', message: 'no rows' }, 406)) : res(rows);
  }
  if (u.pathname === '/rest/v1/users' && method === 'PATCH') {
    const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    Object.assign(fake.users.find(r => r.id === id) || {}, body);
    return res(undefined, 204);
  }
  if (u.pathname === '/rest/v1/users' && method === 'POST') {
    const row = { id: crypto.randomUUID(), ...body };
    fake.users.push(row);
    return res(row, 201);
  }
  if (u.pathname === '/rest/v1/users' && method === 'DELETE') {
    const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    fake.users = fake.users.filter(r => r.id !== id);
    return res(undefined, 204);
  }
  if (['/rest/v1/user_activities', '/rest/v1/audit_logs', '/rest/v1/password_reset_requests'].includes(u.pathname)) return res(undefined, 201);
  if (u.pathname === '/rest/v1/app_sessions') return res([{ id: 'open-1' }]);

  const rpc = u.pathname.replace('/rest/v1/rpc/', '');
  if (rpc === 'app_record_failed_login') {
    fake.failed.push(body);
    const user = fake.users.find(r => r.id === body.p_user_id);
    let locked = null;
    if (user && body.p_count) {
      user.failed_login_attempts = (user.failed_login_attempts || 0) + 1;
      if (user.failed_login_attempts >= 5) { locked = new Date(Date.now() + 15 * 60000).toISOString(); user.locked_until = locked; }
    }
    return res({ attempts: user?.failed_login_attempts || 0, locked_until: locked });
  }
  if (rpc === 'app_auth_user_id_by_email') return res(fake.authUsers.find(a => a.email === body.p_email)?.id ?? null);
  if (rpc === 'app_start_session') { fake.started.push(body); return res({ session_id: body.p_session_id }); }
  if (rpc === 'app_end_session') { fake.ended.push(body); return res(true); }
  if (rpc === 'app_me') {
    const claims = userIdFromToken(req.headers.get('authorization'));
    const user = fake.users.find(r => r.auth_user_id === claims?.sub);
    if (!user || !fake.sessions.some(s => s.id === claims?.session_id)) return res({ code: 'PT401', message: 'SESSION_ENDED:missing' }, 401);
    return res({ id: user.id, username: user.username, is_admin: !!user.admin, must_change_password: !!user.must_change_password, expires_at: '2026-11-10T18:30:00Z' });
  }
  return res({ message: `unexpected ${method} ${u.pathname}` }, 500);
};

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '49.37.1.2', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537', ...headers },
    body: JSON.stringify(body),
  });

describe('login server', () => {
  let login: (r: Request) => Promise<Response>;
  let changePassword: (r: Request) => Promise<Response>;
  let adminUsers: (r: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    process.env.VITE_SUPABASE_URL = URL_;
    process.env.VITE_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    vi.stubGlobal('fetch', fakeFetch);
    const hash = await bcrypt.hash('longpassword1', 4);
    const shortHash = await bcrypt.hash('abc123', 4);
    fake = {
      users: [
        { id: 'u-rama', username: 'rama', password_hash: hash, status: 'Active', is_active: true },
        { id: 'u-short', username: 'VIVEK BUKKA', password_hash: shortHash, status: 'Active', is_active: true },
        { id: 'u-plain', username: 'admin', password_hash: 'admin@123', status: 'Active', is_active: true },
        { id: 'u-off', username: 'gone', password_hash: hash, status: 'Disabled', is_active: false },
        { id: 'u-admin', username: 'RAMESH', password_hash: hash, status: 'Active', is_active: true, admin: true },
      ],
      authUsers: [], sessions: [], calls: [], started: [], failed: [], ended: [],
    };
    // @ts-expect-error -- the route is plain JavaScript
    login = (await import('../../api/auth/login.js')).POST;
    // @ts-expect-error -- the route is plain JavaScript
    changePassword = (await import('../../api/auth/change-password.js')).POST;
    // @ts-expect-error -- the route is plain JavaScript
    adminUsers = (await import('../../api/admin/users.js')).POST;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('first login with an old password moves the user to the new login and starts a session', async () => {
    const r = await login(post('/api/auth/login', { username: 'RAMA', password: 'longpassword1' }));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.session.access_token).toBeTruthy();
    expect(body.me.username).toBe('rama');
    const rama = fake.users.find(x => x.id === 'u-rama')!;
    expect(rama.auth_user_id).toBe(fake.authUsers[0].id);
    expect(rama.password_hash).toBe('');              // old hash removed
    expect(fake.authUsers[0].email).toBe('u-rama@users.tirumalagroups.co');
    expect(fake.started[0]).toMatchObject({ p_user_id: 'u-rama', p_ip: '49.37.1.2', p_browser: 'Chrome', p_os: 'Windows' });
  });

  it('second login uses the new login (old hash no longer needed)', async () => {
    await login(post('/api/auth/login', { username: 'rama', password: 'longpassword1' }));
    const r = await login(post('/api/auth/login', { username: 'rama', password: 'longpassword1' }));
    expect(r.status).toBe(200);
    expect(fake.authUsers).toHaveLength(1);
    expect(fake.started).toHaveLength(2);
  });

  it('a wrong password is refused and counted; the 5th locks the account', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await login(post('/api/auth/login', { username: 'rama', password: 'wrong' }));
      expect(r.status).toBe(401);
    }
    const fifth = await login(post('/api/auth/login', { username: 'rama', password: 'wrong' }));
    expect(fifth.status).toBe(423);
    const locked = await login(post('/api/auth/login', { username: 'rama', password: 'longpassword1' }));
    expect(locked.status).toBe(423);
    expect((await locked.json()).error).toMatch(/locked/i);
    expect(fake.started).toHaveLength(0);
  });

  it('an unknown username gets the same answer as a wrong password', async () => {
    const r = await login(post('/api/auth/login', { username: 'nobody', password: 'x' }));
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe('Invalid username or password');
    expect(fake.failed[0]).toMatchObject({ p_user_id: null, p_count: false });
  });

  it('a disabled account is refused', async () => {
    const r = await login(post('/api/auth/login', { username: 'gone', password: 'longpassword1' }));
    expect(r.status).toBe(403);
    expect(fake.started).toHaveLength(0);
  });

  it('a password stored as plain text is never accepted', async () => {
    const r = await login(post('/api/auth/login', { username: 'admin', password: 'admin@123' }));
    expect(r.status).toBe(401);
    expect(fake.authUsers).toHaveLength(0);
  });

  it('an old password shorter than 8 works once more, then must be changed', async () => {
    const r = await login(post('/api/auth/login', { username: 'vivek bukka', password: 'abc123' }));
    expect(r.status).toBe(200);
    const vivek = fake.users.find(x => x.id === 'u-short')!;
    expect(vivek.must_change_password).toBe(true);
    expect(fake.authUsers[0].password).not.toBe('abc123');   // the short one is not given to the new login
    // Closing the browser before changing it: the short password still works (old hash kept until changed)
    const again = await login(post('/api/auth/login', { username: 'VIVEK BUKKA', password: 'abc123' }));
    expect(again.status).toBe(200);
    // Change it: no current password asked, since it must be changed
    const tok = (await again.json()).session.access_token;
    const ch = await changePassword(post('/api/auth/change-password', { newPassword: 'NewPassword9' }, { authorization: `Bearer ${tok}` }));
    expect(ch.status).toBe(200);
    expect(vivek.must_change_password).toBe(false);
    expect(vivek.password_hash).toBe('');
    expect(fake.authUsers[0].password).toBe('NewPassword9');
    const old = await login(post('/api/auth/login', { username: 'VIVEK BUKKA', password: 'abc123' }));
    expect(old.status).toBe(401);
  });

  it('changing a password needs the current one, and at least 8 characters', async () => {
    const tok = (await (await login(post('/api/auth/login', { username: 'rama', password: 'longpassword1' }))).json()).session.access_token;
    const auth = { authorization: `Bearer ${tok}` };
    expect((await changePassword(post('/x', { currentPassword: 'longpassword1', newPassword: 'short' }, auth))).status).toBe(400);
    expect((await changePassword(post('/x', { currentPassword: 'wrongwrong', newPassword: 'Another123' }, auth))).status).toBe(400);
    expect((await changePassword(post('/x', { currentPassword: 'longpassword1', newPassword: 'Another123' }, auth))).status).toBe(200);
    expect(fake.authUsers[0].password).toBe('Another123');
  });

  it('the change-password server refuses without a live login', async () => {
    const r = await changePassword(post('/x', { newPassword: 'Another123' }));
    expect(r.status).toBe(401);
  });

  it('only an admin can create users or reset passwords', async () => {
    const ramaTok = (await (await login(post('/api/auth/login', { username: 'rama', password: 'longpassword1' }))).json()).session.access_token;
    const r = await adminUsers(post('/api/admin/users', { action: 'create', user: { username: 'new1', user_type_id: 't' }, password: 'Password12' }, { authorization: `Bearer ${ramaTok}` }));
    expect(r.status).toBe(403);
  });

  it('admin creates a user (no password in the users table) and resets a password', async () => {
    const adminTok = (await (await login(post('/api/auth/login', { username: 'RAMESH', password: 'longpassword1' }))).json()).session.access_token;
    const auth = { authorization: `Bearer ${adminTok}` };
    const short = await adminUsers(post('/x', { action: 'create', user: { username: 'new1', user_type_id: 't' }, password: 'short' }, auth));
    expect(short.status).toBe(400);
    const dup = await adminUsers(post('/x', { action: 'create', user: { username: 'RAMA', user_type_id: 't' }, password: 'Password12' }, auth));
    expect(dup.status).toBe(409);
    const ok = await adminUsers(post('/x', { action: 'create', user: { username: 'new1', user_type_id: 't', password_hash: 'sneaky' }, password: 'Password12' }, auth));
    expect(ok.status).toBe(200);
    const created = fake.users.find(x => x.username === 'new1')!;
    expect(created.password_hash).toBe('');
    expect(created.auth_user_id).toBeTruthy();
    const loginNew = await login(post('/api/auth/login', { username: 'new1', password: 'Password12' }));
    expect(loginNew.status).toBe(200);

    const reset = await adminUsers(post('/x', { action: 'reset_password', user_id: 'u-rama', password: 'TempPass88' }, auth));
    expect(reset.status).toBe(200);
    const rama = fake.users.find(x => x.id === 'u-rama')!;
    expect(rama.must_change_password).toBe(true);
    expect(rama.temp_password).toBeNull();
    expect(fake.ended[0]).toMatchObject({ p_reason: 'password_reset' });
    const withTemp = await login(post('/api/auth/login', { username: 'rama', password: 'TempPass88' }));
    expect(withTemp.status).toBe(200);
    expect((await withTemp.json()).me.must_change_password).toBe(true);
  });
});
