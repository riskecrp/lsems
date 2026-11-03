import { NextResponse } from 'next/server';
import {
  exchangeCode, getDiscordUser, getGuildMember,
  resolveLevel, createSession, setSessionCookie, SITE_URL, ROLE_LEVELS,
} from '@/lib/auth';
import Database from 'better-sqlite3';
const DB_PATH = '/opt/lsems/data/lsems.db';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(new URL('/login?error=denied', SITE_URL));
  }

  // The state must match the one /api/auth/login set in this browser
  const state = searchParams.get('state');
  const saved = req.cookies.get('lsems_oauth_state')?.value;
  if (!state || !saved || state !== saved) {
    console.error('[Auth] OAuth state mismatch');
    return NextResponse.redirect(new URL('/login?error=state', SITE_URL));
  }

  try {
    const tokens = await exchangeCode(code);
    console.log('[Auth] token keys:', Object.keys(tokens));
    if (!tokens.access_token) {
      console.error('[Auth] no access_token:', JSON.stringify(tokens));
      return NextResponse.redirect(new URL('/login?error=token', SITE_URL));
    }

    const user = await getDiscordUser(tokens.access_token);
    if (!user?.id) {
      console.error('[Auth] getDiscordUser failed:', JSON.stringify(user));
      return NextResponse.redirect(new URL('/login?error=server', SITE_URL));
    }
    // Site owners (env, comma-separated Discord IDs) get full access without
    // being in the guild at all — skip the member/role checks entirely.
    const ownerIds = (process.env.OWNER_DISCORD_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    let level;
    if (ownerIds.includes(user.id)) {
      level = 5;
      console.log('[Auth] owner login:', user.id, user.username);
    } else {
      const member = await getGuildMember(user.id);
      console.log('[Auth] user:', user?.id, user?.username);
      console.log('[Auth] member code:', member?.code, 'roles:', member?.roles?.length);

      if (!member || member.code === 10004 || !member.roles) {
        console.error('[Auth] guild fail:', JSON.stringify(member));
        return NextResponse.redirect(new URL('/login?error=guild', SITE_URL));
      }

      // Read permission_roles from DB so Admin-configured levels are respected
      let effectiveRoles = { ...ROLE_LEVELS };
      try {
        const db2 = new Database(DB_PATH);
        const row = db2.prepare("SELECT value FROM app_settings WHERE key = 'permission_roles'").get();
        if (row) effectiveRoles = { ...effectiveRoles, ...JSON.parse(row.value) };
        db2.close();
      } catch {}

      level = resolveLevel(member.roles, effectiveRoles);
      console.log('[Auth] resolved level:', level, 'from roles:', member.roles);
      if (level === 0) {
        return NextResponse.redirect(new URL('/login?error=role', SITE_URL));
      }
    }

    const displayName = user.global_name || user.username;
    const session = await createSession({
      userId:      user.id,
      username:    user.username,
      displayName,
      avatar:      user.avatar,
      level,
    });

    // Audit login
    try {
      const db = new Database(DB_PATH);
      db.prepare('INSERT INTO audit_log (timestamp, username, user_id, action, details) VALUES (?,?,?,?,?)')
        .run(new Date().toLocaleString('en-US'), displayName, user.id, 'Login', `Level ${level}`);
      db.close();
    } catch {}

    const res = NextResponse.redirect(new URL('/', SITE_URL));
    res.cookies.set('lsems_session', session, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    });
    res.cookies.set('lsems_oauth_state', '', { maxAge: 0, path: '/api/auth' });
    return res;

  } catch (e) {
    console.error('[Auth callback]', e.message);
    return NextResponse.redirect(new URL('/login?error=server', SITE_URL));
  }
}
