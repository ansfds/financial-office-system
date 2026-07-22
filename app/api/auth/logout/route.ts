import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { COOKIE, audit, unpack } from '@/lib/auth';
import { ok } from '@/lib/http';

export async function POST() {
  const cookieStore = await cookies();
  const id = unpack(cookieStore.get(COOKIE)?.value);

  if (id) {
    await db.loginSession.updateMany({ where: { id }, data: { revokedAt: new Date() } });
  }

  await audit('LOGOUT', { description: 'تسجيل الخروج' });
  cookieStore.delete(COOKIE);
  return ok({ success: true });
}
