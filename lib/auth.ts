import { cookies, headers } from 'next/headers';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { db } from './db';
import {
  SESSION_INACTIVITY_MINUTES,
  SESSION_TOUCH_INTERVAL_MS,
  isSessionInactive,
  nextSessionExpiry,
  shouldTouchSession,
} from './session-policy';

export const COOKIE = 'fos_session';

function sessionSecret() {
  return process.env.SESSION_SECRET?.trim() || '';
}

function requireSessionSecret() {
  const secret = sessionSecret();
  if (!secret) throw new Error('SESSION_SECRET_MISSING');
  return secret;
}

const sign = (payload: string, secret = sessionSecret()) =>
  secret ? createHmac('sha256', secret).update(payload).digest('hex') : '';

export const pack = (id: string, expiresAt: Date) => {
  const secret = requireSessionSecret();
  const expires = expiresAt.getTime();
  const payload = `${id}.${expires}`;
  return `${payload}.${sign(payload, secret)}`;
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

async function clearSessionCookie() {
  try {
    (await cookies()).delete(COOKIE);
  } catch {
    // Cookie mutation is unavailable in some server-rendering contexts; route handlers still clear it.
  }
}

async function setSessionCookie(id: string, expiresAt: Date) {
  try {
    (await cookies()).set(COOKIE, pack(id, expiresAt), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  } catch {
    // Cookie mutation is unavailable in some server-rendering contexts; route handlers still refresh it.
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
  requireSessionSecret();
  const id = randomUUID();
  const meta = await clientMeta();
  const now = new Date();
  const expiresAt = nextSessionExpiry(now);

  await db.loginSession.create({
    data: {
      id,
      userId: user.id,
      username: user.username,
      lastActivityAt: now,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.ua,
    },
  });

  await setSessionCookie(id, expiresAt);

  return id;
}

type GetSessionOptions = {
  touch?: boolean;
  forceTouch?: boolean;
};

export async function getSession(options: GetSessionOptions = {}) {
  const { touch = true, forceTouch = false } = options;
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
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now) {
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

  if (isSessionInactive(session.lastActivityAt, now)) {
    await db.loginSession.update({
      where: { id },
      data: { revokedAt: now },
    });
    await clearSessionCookie();
    return null;
  }

  if (touch && shouldTouchSession(session.lastActivityAt, now, forceTouch)) {
    const expiresAt = nextSessionExpiry(now);
    const touched = await db.loginSession.update({
      where: { id },
      data: { lastActivityAt: now, expiresAt },
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
    await setSessionCookie(id, expiresAt);
    return touched;
  }

  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHORIZED');
  return session;
}

export const sessionConfig = {
  inactivityMinutes: SESSION_INACTIVITY_MINUTES,
  warningAfterMinutes: SESSION_INACTIVITY_MINUTES - 5,
  touchIntervalMs: SESSION_TOUCH_INTERVAL_MS,
};

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
