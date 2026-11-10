// POST /api/admin/users   (admins only)
//   { "action": "create", "user": { username, user_type_id, email, full_name, ... }, "password": "..." }
//       -> { user: { ...new row } }
//   { "action": "reset_password", "user_id": "...", "password": "..." }
//       -> { ok: true }   The person must change it at their next login; any login of theirs ends now.
// Passwords never go into the users table; they are kept only by Supabase's login.
import {
  json, configProblem, serviceClient, authEmail, requireSession, readJson, MIN_PASSWORD,
} from '../_auth.js';

const ALLOWED_FIELDS = ['username', 'user_type_id', 'email', 'full_name', 'phone', 'address', 'aadhaar_number',
  'date_of_birth', 'other_details', 'branch', 'employee_id', 'designation', 'created_by', 'mode'];

const ensureAuthUser = async (db, userId, password) => {
  const email = authEmail(userId);
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { app_user_id: userId } });
  if (created.data?.user?.id) return created.data.user.id;
  const { data: existing } = await db.rpc('app_auth_user_id_by_email', { p_email: email });
  if (!existing) throw new Error(created.error?.message || 'could not create the login');
  const upd = await db.auth.admin.updateUserById(existing, { password });
  if (upd.error) throw new Error(upd.error.message);
  return existing;
};

const checkPassword = (password) => {
  if (password.length < MIN_PASSWORD) return `The password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return 'The password is too long.';
  return null;
};

const audit = (db, by, user, field, oldValue, newValue, reason) =>
  db.from('audit_logs').insert({
    changed_by: by, target_user_id: user.id, target_username: user.username, field,
    old_value: oldValue, new_value: newValue, reason,
  });

async function createUser(db, me, body) {
  const password = String(body?.password || '');
  const bad = checkPassword(password);
  if (bad) return json({ error: bad }, 400);
  const input = body?.user || {};
  const row = {};
  for (const k of ALLOWED_FIELDS) if (input[k] !== undefined) row[k] = input[k];
  row.username = String(row.username || '').trim();
  if (!row.username || !row.user_type_id) return json({ error: 'Username and user type are required.' }, 400);
  if (!row.email) row.email = `${row.username}@thirumala.com`;

  const { data: same } = await db.from('users').select('id, username').ilike('username', row.username);
  if ((same || []).some((u) => u.username.toLowerCase() === row.username.toLowerCase())) {
    return json({ error: 'This username already exists.' }, 409);
  }

  Object.assign(row, { password_hash: '', status: 'Active', is_active: true, must_change_password: false });
  // If this database lacks an optional column, save the user without it (as the screen did before)
  const REQUIRED = ['username', 'password_hash', 'user_type_id', 'email', 'status', 'is_active', 'must_change_password'];
  let created = null;
  for (let attempt = 0; attempt < 12 && !created; attempt++) {
    const { data, error } = await db.from('users').insert(row).select().single();
    if (!error) { created = data; break; }
    const missing = Object.keys(row).find((k) => !REQUIRED.includes(k) && (error.message || '').includes(`'${k}'`));
    if (!missing || !['PGRST204', '42703'].includes(error.code || '')) throw error;
    delete row[missing];
  }
  if (!created?.id) throw new Error('User was not created');

  try {
    const authId = await ensureAuthUser(db, created.id, password);
    await db.from('users').update({ auth_user_id: authId, last_password_change: new Date().toISOString() }).eq('id', created.id);
  } catch (e) {
    // Without a login the user is of no use: remove the half-made row again
    await db.from('users').delete().eq('id', created.id);
    throw e;
  }
  delete created.password_hash;
  delete created.temp_password;
  return json({ user: created });
}

async function resetPassword(db, me, body) {
  const password = String(body?.password || '');
  const bad = checkPassword(password);
  if (bad) return json({ error: bad }, 400);
  const { data: user, error } = await db.from('users').select('id, username, auth_user_id').eq('id', String(body?.user_id || '')).single();
  if (error || !user) return json({ error: 'User not found.' }, 404);

  const authId = await ensureAuthUser(db, user.id, password);
  const upd = await db.from('users').update({
    auth_user_id: authId, must_change_password: true, password_hash: '', temp_password: null,
    failed_login_attempts: 0, locked_until: null, last_password_change: new Date().toISOString(),
  }).eq('id', user.id);
  if (upd.error) throw upd.error;

  // Any login of this person ends now
  const { data: open } = await db.from('app_sessions').select('id').eq('user_id', user.id).is('ended_at', null);
  for (const s of open || []) {
    await db.rpc('app_end_session', { p_session_id: s.id, p_reason: 'password_reset', p_by: me.username });
  }
  // Their "Forgot password" requests are answered
  await db.from('password_reset_requests')
    .update({ status: 'done', handled_by: me.username, handled_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('status', 'pending');
  await audit(db, me.username, user, 'password', 'HIDDEN', 'TEMPORARY_SET', String(body?.reason || 'Password reset by admin'));
  return json({ ok: true });
}

export async function POST(request) {
  const problem = configProblem();
  if (problem) return json({ error: problem }, 500);
  const auth = await requireSession(request, { admin: true });
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const db = serviceClient();
  try {
    if (body?.action === 'create') return await createUser(db, auth.me, body);
    if (body?.action === 'reset_password') return await resetPassword(db, auth.me, body);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[api/admin/users]', body?.action, e?.message || e);
    return json({ error: e?.message || 'Server problem' }, 500);
  }
}

export function GET() {
  return json({ error: 'Use POST' }, 405);
}
