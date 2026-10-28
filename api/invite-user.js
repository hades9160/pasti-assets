// Vercel serverless function: an administrator invites a new user.
// Runs on the server because inviting needs the Supabase service-role key,
// which must never reach the browser.
import { createClient } from '@supabase/supabase-js';

const ROLES = ['viewer', 'editor', 'admin'];
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function POST(request) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return json(500, { error: 'Invitations are not set up yet: add SUPABASE_SERVICE_ROLE_KEY in Vercel (see README).' });
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Who is asking? Must be an active administrator.
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Please sign in again.' });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json(401, { error: 'Please sign in again.' });
  const { data: profile } = await admin.from('profiles').select('role, is_active').eq('user_id', caller.user.id).maybeSingle();
  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    return json(403, { error: 'Only an administrator can invite users.' });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid request.' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const fullName = String(body.full_name || '').trim().slice(0, 120);
  const role = String(body.role || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(400, { error: 'Enter a valid email address.' });
  if (!fullName) return json(400, { error: 'Enter the full name.' });
  if (!ROLES.includes(role)) return json(400, { error: 'Choose a role.' });

  // The link in the email may only point back to this same site.
  let redirectTo;
  try {
    const target = new URL(String(body.redirect_to || ''));
    if (target.origin !== new URL(request.url).origin) throw new Error('other origin');
    redirectTo = target.toString();
  } catch {
    return json(400, { error: 'Invalid redirect address.' });
  }

  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo });
  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    return json(exists ? 409 : 502, { error: exists ? 'That email already has an account. Set its role in the list instead.' : `Supabase could not send the invitation: ${error.message}` });
  }

  // The profile row is created by the on_auth_user_created trigger.
  const { error: roleErr } = await admin.from('profiles').update({ role, full_name: fullName }).eq('user_id', invited.user.id);
  if (roleErr) return json(500, { error: 'Invitation sent, but the role could not be saved. Set it in the user list.' });
  return json(200, { ok: true });
}
