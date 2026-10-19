import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
export function canReset(username?: string | null) {
  return Boolean(
    username &&
    (process.env.RESET_ADMIN_USERNAMES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(username),
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const target = new URL(request.url);
  // Next's internal URL may use localhost even when the browser opened 127.0.0.1.
  const host = request.headers.get('host') || target.host;
  return Boolean(
    origin &&
    origin === `${target.protocol}//${host}` &&
    request.headers.get('sec-fetch-site') !== 'cross-site',
  );
}
export async function resetPasswordMatches(password: string) {
  if (process.env.RESET_PASSWORD_HASH) {
    try {
      return await argon2.verify(process.env.RESET_PASSWORD_HASH, password);
    } catch {
      return false;
    }
  }
  const secret = process.env.RESET_SYSTEM_PASSWORD;
  if (!secret) return false;
  return timingSafeEqual(
    createHash('sha256').update(password).digest(),
    createHash('sha256').update(secret).digest(),
  );
}
function signature(payload: string) {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET_MISSING');
  return createHmac('sha256', process.env.SESSION_SECRET).update(`reset:${payload}`).digest('hex');
}
export function createResetChallenge(sessionId: string) {
  const payload = Buffer.from(
    JSON.stringify({ sessionId, nonce: randomUUID(), expires: Date.now() + 300000 }),
  ).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function readResetChallenge(token: string, sessionId: string) {
  try {
    const [payload, signed, extra] = token.split('.');
    if (extra || !signed || !timingSafeEqual(Buffer.from(signed), Buffer.from(signature(payload))))
      return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.sessionId === sessionId && data.expires > Date.now() ? (data as { nonce: string }) : null;
  } catch {
    return null;
  }
}
