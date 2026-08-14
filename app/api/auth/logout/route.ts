import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { COOKIE, audit, unpack } from '@/lib/auth';
import { ok } from '@/lib/http';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const id = unpack(cookieStore.get(COOKIE)?.value);
  const urlReason = new URL(request.url).searchParams.get('reason')?.trim();
  const body = await request.json().catch(() => null);
  const bodyReason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const reason = bodyReason || urlReason;

  if (id) {
    await db.loginSession.updateMany({ where: { id }, data: { revokedAt: new Date() } });
  }

  await audit('LOGOUT', {
    description: reason === 'inactive' ? 'Session ended because of inactivity' : 'تسجيل الخروج',
  });
  cookieStore.delete(COOKIE);
  return ok({ success: true });
}
