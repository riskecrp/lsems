import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST(req) {
  const session = await getSession();
  if (!session || session.level < 2) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const { viewAs } = await req.json();
  const level = parseInt(viewAs);
  const res = NextResponse.json({ ok: true });
  if (!level || level === session.level) {
    res.cookies.set('lsems_viewas', '', { maxAge: 0, path: '/' });
  } else {
    res.cookies.set('lsems_viewas', String(Math.min(level, session.level)), {
      httpOnly: false, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    });
  }
  return res;
}
