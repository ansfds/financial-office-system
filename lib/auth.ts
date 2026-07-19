import { cookies, headers } from 'next/headers';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { db } from './db';

export const COOKIE = 'fos_session';

const ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

const sign = (id: string) =>
  createHmac('sha256', process.env.SESSION_SECRET || '').update(id).digest('hex');

export const pack = (id: string) => `${id}.${sign(id)}`;

export function unpack(value?: string) {
  if (!value) return null;

  const separator = value.lastIndexOf('.');
  if (separator < 1) return null;

  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(id);

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
  } catch {
    return null;
  }
}

const sessionMinutes = () => Number(process.env.SESSION_DURATION_MINUTES || 60);

export async function clientMeta() {
  const requestHeaders = await headers();
  return {
    ip: requestHeaders.get('x-forwarded-for')?.split(',')[0] || 'unknown',
    ua: requestHeaders.get('user-agent') || 'unknown',
  };
}

export function safeCodeMatch(input: string) {
  const secret = process.env.SYSTEM_ACCESS_CODE || '';
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(secret).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createSession() {
  const id = randomUUID();
  const meta = await clientMeta();
  const expiresAt = new Date(Date.now() + sessionMinutes() * 60_000);

  await db.loginSession.create({
    data: {
      id,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.ua,
    },
  });

  (await cookies()).set(COOKIE, pack(id), {
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
  if (!id) return null;

  const session = await db.loginSession.findUnique({ where: { id } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

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

  await db.auditLog.create({
    data: {
      action,
      ip: meta.ip,
      userAgent: meta.ua,
      sessionId,
      ...data,
    },
  });
}
