import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { DISCORD_CLIENT_ID, REDIRECT_URI } from '@/lib/auth';

export function GET() {
  const state  = randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    client_id:    DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  const res = NextResponse.redirect(`https://discord.com/api/oauth2/authorize?${params}`, 302);
  // Checked in /api/auth/callback so a login can only finish in the browser that started it
  res.cookies.set('lsems_oauth_state', state, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth', maxAge: 10 * 60,
  });
  return res;
}
