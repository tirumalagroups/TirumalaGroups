// POST /api/auth/login  { "username": "...", "password": "..." }
//   -> { session: { access_token, refresh_token, ... }, me: { id, username, is_admin, must_change_password, expires_at, ... } }
//
// The password is checked here, on the server, never in the browser:
//   * a locked or disabled account is refused; 5 wrong passwords lock it for 15 minutes
//   * existing users move to the new login the first time they log in, with the same password
//     (checked once against the old stored hash); a password shorter than 8 must be changed at once
//   * one login per user: any other login of this user ends
//   * Login History gets the IP Vercel saw, the browser, the device and the place (city, state, country)
import bcrypt from 'bcryptjs';
import {
  json, configProblem, serviceClient, userClient, authEmail, decodeJwt, randomPassword,
  passwordGrant, clientInfo, readJson, MIN_PASSWORD,
} from '../_auth.js';

const WRONG = 'Invalid username or password';

/** Adds the place to the Login History row. Never stops a login: before the location SQL is run
 *  (no "location" column yet) this just does nothing. */
const saveLocation = async (db, historyId, location) => {
  if (!historyId || !location) return;
  try {
    const { error } = await db.from('login_history').update({ location }).eq('id', historyId);
    if (error) console.warn('[api/auth/login] location not saved:', error.message);
  } catch (e) {
    console.warn('[api/auth/login] location not saved:', e?.message || e);
  }
};

const fail = async (db, info, user, username, reason, count, message, status = 401) => {
  const { data } = await db.rpc('app_record_failed_login', {
    p_user_id: user?.id ?? null, p_username: user?.username ?? username, p_reason: reason, p_count: count,
    p_ip: info.ip, p_browser: info.browser, p_os: info.os, p_device: info.device,
  });
  await saveLocation(db, data?.login_history_id, info.location);
  if (data?.locked_until) {
    return json({ error: 'Too many wrong passwords. The account is locked for 15 minutes, or until an admin unlocks it.', locked: true }, 423);
  }
  return json({ error: message }, status);
};

const isBcrypt = (hash) => /^\$2[aby]\$\d\d\$/.test(String(hash || ''));

/** Creates the user's Supabase login, or resets its password if it already exists. Returns its id. */
const ensureAuthUser = async (db, user, password) => {
  const email = authEmail(user.id);
  const created = await db.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { app_user_id: user.id },
  });
  let authId = created.data?.user?.id;
  if (!authId) {
    const { data: existing } = await db.rpc('app_auth_user_id_by_email', { p_email: email });
    if (!existing) throw new Error(`could not create login: ${created.error?.message || 'unknown'}`);
    const upd = await db.auth.admin.updateUserById(existing, { password });
    if (upd.error) throw new Error(`could not update login: ${upd.error.message}`);
    authId = existing;
  }
  return authId;
};

export async function POST(request) {
  const problem = configProblem();
  if (problem) return json({ error: problem }, 500);

  const body = await readJson(request);
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username || !password) return json({ error: 'Username and password are required' }, 400);
  if (username.length > 60 || password.length > 200) return json({ error: WRONG }, 401);

  const db = serviceClient();
  const info = clientInfo(request);

  try {
    // Usernames are matched without regard to capitals, exactly as before. ("_" or "%" in a name only
    // widen this search; the exact comparison below decides.)
    const { data: rows, error: findErr } = await db
      .from('users')
      .select('id, username, password_hash, auth_user_id, status, is_active, locked_until, must_change_password')
      .ilike('username', username);
    if (findErr) throw findErr;
    const user = (rows || []).find((u) => String(u.username).toLowerCase() === username.toLowerCase());

    if (!user) return fail(db, info, null, username, 'Unknown username', false, WRONG);
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.max(1, Math.ceil((new Date(user.locked_until) - new Date()) / 60000));
      return fail(db, info, user, username, 'Account locked', false,
        `The account is locked after too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask an admin to unlock it.`, 423);
    }
    if (user.is_active === false || (user.status && user.status !== 'Active')) {
      return fail(db, info, user, username, `Account ${String(user.status || 'disabled').toLowerCase()}`, false,
        'This account is not active. Please contact an admin.', 403);
    }

    let grant = null;
    let authId = user.auth_user_id;
    const legacyOk = async () => isBcrypt(user.password_hash) && bcrypt.compare(password, user.password_hash);

    if (authId) {
      grant = await passwordGrant(authEmail(user.id), password);
      if (grant.status === 429) return json({ error: 'Too many tries from this network. Please wait a few minutes.' }, 429);
      // A short old password that was never changed: still accepted once more, then it must be changed
      if (!grant.session && user.must_change_password && (await legacyOk())) {
        const temp = randomPassword();
        authId = await ensureAuthUser(db, user, temp);
        grant = await passwordGrant(authEmail(user.id), temp);
      }
      if (!grant.session) return fail(db, info, user, username, 'Invalid password', true, WRONG);
    } else {
      // First login since the change: check the old stored password once, then create the new login
      if (!(await legacyOk())) {
        return fail(db, info, user, username, isBcrypt(user.password_hash) ? 'Invalid password' : 'Password must be reset by an admin', true, WRONG);
      }
      const short = password.length < MIN_PASSWORD;
      const authPassword = short ? randomPassword() : password;
      authId = await ensureAuthUser(db, user, authPassword);
      const upd = await db.from('users').update({
        auth_user_id: authId,
        must_change_password: short || Boolean(user.must_change_password),
        // the old hash is no longer needed once the new login has the password
        ...(short ? {} : { password_hash: '' }),
      }).eq('id', user.id);
      if (upd.error) throw upd.error;
      grant = await passwordGrant(authEmail(user.id), authPassword);
      if (!grant.session) throw new Error(`new login did not work: ${grant.error}`);
    }

    const token = grant.session.access_token;
    const claims = decodeJwt(token);
    if (!claims?.session_id) throw new Error('login token has no session id');
    const { data: started, error: startErr } = await db.rpc('app_start_session', {
      p_user_id: user.id, p_auth_user_id: authId, p_session_id: claims.session_id,
      p_ip: info.ip, p_browser: info.browser, p_os: info.os, p_device: info.device, p_user_agent: info.ua,
    });
    if (startErr) throw startErr;
    await saveLocation(db, started?.login_history_id, info.location);

    const { data: me, error: meErr } = await userClient(token).rpc('app_me');
    if (meErr) throw meErr;
    return json({ session: grant.session, me });
  } catch (e) {
    console.error('[api/auth/login]', e?.message || e);
    return json({ error: 'Login failed because of a server problem. Please try again.' }, 500);
  }
}

export function GET() {
  return json({ error: 'Use POST' }, 405);
}
