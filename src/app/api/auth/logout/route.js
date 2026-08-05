import { NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/auth';

export async function GET() {
  const res = NextResponse.redirect(new URL('/login', SITE_URL));
  res.cookies.set('lsems_session', '', { maxAge: 0, path: '/' });
  return res;
}
