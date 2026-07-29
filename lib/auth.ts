import { cookies, headers } from 'next/headers';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { db } from './db';

export const COOKIE = 'fos_session';

const ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

function sessionSecret() {
  return process.env.SESSION_SECRET || '';
}

const sign = (payload: string) =>
  createHmac('sha256', sessionSecret()).update(payload).digest('hex');

export const pack = (id: string, expiresAt: Date) => {
  const expires = expiresAt.getTime();
  const payload = `${id}.${expires}`;
  return `${payload}.${sign(payload)}`;
};

export function unpack(value?: string) {
  if (!value) return null;

  const parts = value.split('.');
  if (parts.length !== 3) return null;

  const [id, expires, signature] = parts;
  if (!id || !expires || !signature) return null;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const payload = `${id}.${expires}`;
  const expected = sign(payload);

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
  } catch {
    return null;
  }
}

const sessionMinutes = () => Number(process.env.SESSION_DURATION_MINUTES || 60);
const inactivityMinutes = () => Number(process.env.INACTIVITY_LOCK_MINUTES || 15);

async function clearSessionCookie() {
  try {
    (await cookies()).delete(COOKIE);
  } catch {
    // Cookie mutation is unavailable in some server-rendering contexts; route handlers still clear it.
  }
}

export async function clientMeta() {
  const requestHeaders = await headers();
  return {
    ip: requestHeaders.get('x-forwarded-for')?.split(',')[0] || 'unknown',
    ua: requestHeaders.get('user-agent') || 'unknown',
  };
}

export async function createSession(user: { id: string; username: string }) {
  const id = randomUUID();
  const meta = await clientMeta();
  const expiresAt = new Date(Date.now() + sessionMinutes() * 60_000);

  await db.loginSession.create({
    data: {
      id,
      userId: user.id,
      username: user.username,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.ua,
    },
  });

  (await cookies()).set(COOKIE, pack(id, expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return id;
}

export async function getSession() {
  const id = unpack((await cookies()).get(COOKIE)?.value);
  if (!id) {
    await clearSessionCookie();
    return null;
  }

  const session = await db.loginSession.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          isActive: true,
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    await clearSessionCookie();
    return null;
  }

  if (!session.userId || !session.username || !session.user?.isActive) {
    await db.loginSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await clearSessionCookie();
    return null;
  }

  if (Date.now() - session.lastActivityAt.getTime() > inactivityMinutes() * 60_000) {
    await db.loginSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await clearSessionCookie();
    return null;
  }

  if (Date.now() - session.lastActivityAt.getTime() > ACTIVITY_TOUCH_INTERVAL_MS) {
    await db.loginSession.update({
      where: { id },
      data: { lastActivityAt: new Date() },
    });
  }

  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHORIZED');
  return session;
}

export async function audit(action: string, data: any = {}) {
  const meta = await clientMeta();
  const sessionId = unpack((await cookies()).get(COOKIE)?.value) || undefined;
  const sessionUser = sessionId
    ? await db.loginSession.findUnique({
        where: { id: sessionId },
        select: { userId: true, username: true },
      })
    : null;

  await db.auditLog.create({
    data: {
      action,
      ip: meta.ip,
      userAgent: meta.ua,
      sessionId,
      ...data,
      userId: data.userId ?? sessionUser?.userId,
      username: data.username ?? sessionUser?.username,
    },
  });
}
