import { getSession } from '@/lib/auth';
import { fail, ok } from '@/lib/http';

export async function GET() {
  const session = await getSession();
  if (!session) return fail('انتهت الجلسة. سجل الدخول من جديد.', 401);

  return ok({
    authenticated: true,
    userId: session.userId,
    username: session.username,
    expiresAt: session.expiresAt,
    lastActivityAt: session.lastActivityAt,
  });
}
