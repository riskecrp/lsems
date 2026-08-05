import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// ── Config ────────────────────────────────────────────────────
export const DISCORD_CLIENT_ID     = '1502035240799965336';
export const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
export const DISCORD_GUILD_ID      = '459438391004495891';
export const SITE_URL              = process.env.SITE_URL || 'https://ecrplsems.com';
export const REDIRECT_URI          = `${SITE_URL}/api/auth/callback`;

// Role → permission level
export const ROLE_LEVELS = {
  '737481926943834193': 3, // High Command
  '587679776542556236': 3, // Legal Faction Management
  '1039228533651816590': 3, // Consultant
  '737482405690081371': 2, // Command
  '740782964157448363': 1, // Supervisor
};

// Pages blocked for level 1
export const LEVEL1_BLOCKED = ['/payroll', '/bonuses'];

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = 'lsems_session';
const COOKIE_DAYS = 7;

// ── Session helpers ───────────────────────────────────────────
export async function createSession(payload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${COOKIE_DAYS}d`)
    .setIssuedAt()
    .sign(JWT_SECRET);
  return token;
}

export async function getSession() {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * COOKIE_DAYS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// ── Discord helpers ───────────────────────────────────────────
export async function exchangeCode(code) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
    }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Discord returned HTML (rate-limit page, Cloudflare error, etc.)
    console.error('[Auth] exchangeCode non-JSON response (HTTP', res.status, '):', text.slice(0, 300));
    return { error: 'non_json_response', status: res.status };
  }
}

export async function getDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { console.error('[Auth] getDiscordUser non-JSON (HTTP', res.status, '):', text.slice(0, 200)); return null; }
}

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Use the bot token to fetch guild member — more reliable than the guilds.members.read OAuth scope
export async function getGuildMember(userId) {
  const res = await fetch(
    `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${userId}`,
    { headers: { Authorization: `Bot ${BOT_TOKEN}` }, cache: 'no-store' }
  );
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { console.error('[Auth] getGuildMember non-JSON (HTTP', res.status, '):', text.slice(0, 200)); return null; }
}

export function resolveLevel(roles = [], roleMap = ROLE_LEVELS) {
  let best = 0;
  for (const roleId of roles) {
    const lvl = roleMap[roleId] ?? 0;
    if (lvl > best) best = lvl;
  }
  return best;
}

export function canAccess(session, pathname) {
  const level = session?.viewAs ?? session?.level ?? 0;
  if (level === 0) return false;
  if (level === 1 && LEVEL1_BLOCKED.some(p => pathname.startsWith(p))) return false;
  return true;
}
