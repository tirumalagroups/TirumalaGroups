// POST /api/auth/change-password  { "currentPassword": "...", "newPassword": "..." }   (logged in)
// After an admin reset (or with an old password shorter than 8) the current password is not asked:
// the person has just logged in with it.
import {
  json, configProblem, serviceClient, authEmail, passwordGrant, requireSession, readJson, MIN_PASSWORD,
} from '../_auth.js';

export async function POST(request) {
  const problem = configProblem();
  if (problem) return json({ error: problem }, 500);
  const auth = await requireSession(request);
  if (auth.response) return auth.response;
  const { me } = auth;

  const body = await readJson(request);
  const current = String(body?.currentPassword || '');
  const next = String(body?.newPassword || '');
  if (next.length < MIN_PASSWORD) return json({ error: `The new password must be at least ${MIN_PASSWORD} characters.` }, 400);
  if (next.length > 200) return json({ error: 'The new password is too long.' }, 400);
  if (current && next === current) return json({ error: 'The new password must be different from the current one.' }, 400);

  const db = serviceClient();
  try {
    const { data: user, error } = await db.from('users').select('id, username, auth_user_id, must_change_password').eq('id', me.id).single();
    if (error || !user?.auth_user_id) throw error || new Error('no login for this user');

    if (!user.must_change_password) {
      if (!current) return json({ error: 'Please enter your current password.' }, 400);
      const check = await passwordGrant(authEmail(user.id), current);
      if (!check.session) return json({ error: 'The current password is not correct.' }, 400);
      // That check made a second Supabase login; close it again at once
      await db.auth.admin.signOut(check.session.access_token, 'local').catch(() => {});
    }

    const upd = await db.auth.admin.updateUserById(user.auth_user_id, { password: next });
    if (upd.error) return json({ error: upd.error.message || 'Could not change the password.' }, 400);

    await db.from('users').update({
      must_change_password: false, last_password_change: new Date().toISOString(), password_hash: '', temp_password: null,
    }).eq('id', user.id);
    await db.from('user_activities').insert({
      user_id: user.id, username: user.username, activity_type: 'password_change', description: 'Changed own password',
    });
    return json({ ok: true });
  } catch (e) {
    console.error('[api/auth/change-password]', e?.message || e);
    return json({ error: 'Could not change the password because of a server problem.' }, 500);
  }
}

export function GET() {
  return json({ error: 'Use POST' }, 405);
}
