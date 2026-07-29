import argon2 from 'argon2';
import { audit, clientMeta, createSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { isAllowedUsername } from '@/lib/users';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const meta = await clientMeta();
    const since = new Date(Date.now() - Number(process.env.LOGIN_WINDOW_MINUTES || 15) * 60_000);

    const failed = await db.loginAttempt.count({
      where: {
        ip: meta.ip,
        success: false,
        attemptedAt: { gte: since },
      },
    });

    if (failed >= Number(process.env.LOGIN_MAX_ATTEMPTS || 5)) {
      return fail('تم إيقاف المحاولات مؤقتًا، حاول لاحقًا', 429);
    }

    const user = isAllowedUsername(username)
      ? await db.user.findUnique({ where: { username } })
      : null;

    const valid = Boolean(
      user?.isActive &&
        password &&
        (await argon2.verify(user.passwordHash, password).catch(() => false)),
    );

    await db.loginAttempt.create({
      data: {
        userId: user?.id,
        username: username || null,
        ip: meta.ip,
        userAgent: meta.ua,
        success: valid,
      },
    });

    if (!valid || !user) {
      return fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401);
    }

    await createSession({ id: user.id, username: user.username });
    await audit('LOGIN_SUCCESS', {
      userId: user.id,
      username: user.username,
      description: 'تسجيل دخول ناجح',
    });

    return ok({ success: true, username: user.username });
  } catch (error) {
    return apiError(error);
  }
}
