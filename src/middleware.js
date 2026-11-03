import { jwtVerify } from 'jose';
import { NextResponse } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET
);

const LEVEL1_BLOCKED = ['/payroll', '/bonuses', '/admin'];
const PUBLIC_PATHS   = ['/login', '/api/auth', '/api/revalidate'];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  // Always allow public paths and static assets
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/lsems-logo')) {
    return NextResponse.next();
  }

  const token = req.cookies.get('lsems_session')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const level = payload.level ?? 0;

    if (level === 0) return NextResponse.redirect(new URL('/login', req.url));

    if (level === 1 && LEVEL1_BLOCKED.some(p => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/', req.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
