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

function clearSessionCookie(response: NextResponse) {
  response.cookies.set('fos_session', '', {
    expires: new Date(0),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return response;
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

  const cookieValue = request.cookies.get('fos_session')?.value;
  const authenticated = await validSessionCookie(cookieValue);

  if (pathname === '/login') {
    if (!cookieValue || authenticated) return NextResponse.next();
    return clearSessionCookie(NextResponse.next());
  }

  if (!authenticated) {
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json(
        { error: 'انتهت الجلسة أو غير مصرح بالدخول. سجل الدخول من جديد.' },
        {
          status: 401,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          },
        },
      );
      return clearSessionCookie(response);
    }
    return clearSessionCookie(NextResponse.redirect(new URL('/login', request.url)));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};
