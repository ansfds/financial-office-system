import { getSession, sessionConfig } from '@/lib/auth';
import { fail, ok } from '@/lib/http';

function sessionPayload(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return null;

  return {
    authenticated: true,
    userId: session.userId,
    username: session.username,
    expiresAt: session.expiresAt,
    lastActivityAt: session.lastActivityAt,
    serverNow: new Date(),
    ...sessionConfig,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceTouch = url.searchParams.get('touch') === '1';
  const session = await getSession({ touch: true, forceTouch });
  const payload = sessionPayload(session);
  if (!payload) return fail('انتهت الجلسة. سجل الدخول من جديد.', 401);

  return ok(payload);
}

export async function POST() {
  const session = await getSession({ touch: true, forceTouch: true });
  const payload = sessionPayload(session);
  if (!payload) return fail('انتهت الجلسة. سجل الدخول من جديد.', 401);

  return ok(payload);
}
