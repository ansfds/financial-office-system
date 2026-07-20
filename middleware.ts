import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_FILE = /\.(.*)$/;

async function validSessionCookie(value: string | undefined) {
  if (!value) return false;

  const parts = value.split('.');
  if (parts.length !== 3) return false;

  const [id, expires, signature] = parts;
  if (!id || !expires || !signature) return false;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const secret = process.env.SESSION_SECRET || '';
  if (!secret) return false;

  const payload = `${id}.${expires}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const out = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(out))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return signature === expected;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/favicon.ico' ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const authenticated = await validSessionCookie(request.cookies.get('fos_session')?.value);

  if (pathname === '/login') {
    return authenticated ? NextResponse.redirect(new URL('/dashboard', request.url)) : NextResponse.next();
  }

  if (!authenticated) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};
