import { clientMeta, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { resetOperationalData, lockOperationalTables } from '@/lib/system-backup';
import {
  canReset,
  sameOrigin,
  resetPasswordMatches,
  createResetChallenge,
  readResetChallenge,
} from '@/lib/reset-security';
import { z } from 'zod';
export const runtime = 'nodejs';
const schema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('verify'), resetPassword: z.string().min(1).max(500) }),
  z.object({
    step: z.literal('confirm'),
    challenge: z.string().max(2000),
    confirmationText: z.literal('تصفير'),
  }),
]);
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canReset(session.username)) return fail('هذه العملية متاحة لمسؤول التصفير فقط', 403);
    if (!sameOrigin(request)) return fail('مصدر الطلب غير مسموح', 403);
    if (!process.env.RESET_PASSWORD_HASH && !process.env.RESET_SYSTEM_PASSWORD)
      return fail('لم يتم إعداد كلمة مرور التصفير', 503);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من كلمة المرور وعبارة التأكيد');
    const meta = await clientMeta();
    const input = parsed.data;
    if (input.step === 'verify') {
      const verified = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(782342)`;
        const attempts = await tx.auditLog.count({
          where: {
            action: 'RESET_PASSWORD_CHECK',
            createdAt: { gte: new Date(Date.now() - 900000) },
            OR: [{ userId: session.userId }, { ip: meta.ip }],
          },
        });
        if (attempts >= 5) return 'limited';
        const valid = await resetPasswordMatches(input.resetPassword);
        await tx.auditLog.create({
          data: {
            action: 'RESET_PASSWORD_CHECK',
            entityType: 'System',
            userId: session.userId,
            username: session.username,
            ip: meta.ip,
          },
        });
        return valid ? 'valid' : 'invalid';
      });
      if (verified === 'limited') return fail('محاولات كثيرة. حاول بعد 15 دقيقة', 429);
      if (verified !== 'valid') return fail('كلمة مرور التصفير غير صحيحة', 403);
      return ok({ challenge: createResetChallenge(session.id) });
    }
    const challenge = readResetChallenge(input.challenge, session.id);
    if (!challenge) return fail('انتهت صلاحية التأكيد. تحقق من كلمة المرور مجددًا', 403);
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(782343)`;
        if (await tx.auditLog.findFirst({ where: { action: 'SYSTEM_RESET', entityId: challenge.nonce } }))
          throw new Error('RESET_ALREADY_USED');
        await lockOperationalTables(tx);
        const result = await resetOperationalData(tx);
        await tx.auditLog.create({
          data: {
            action: 'SYSTEM_RESET',
            entityType: 'System',
            entityId: challenge.nonce,
            userId: session.userId,
            username: session.username,
            sessionId: session.id,
            ip: meta.ip,
            newValue: result,
            description: 'تصفير بيانات العمل بعد حفظ نسخة احتياطية كاملة',
          },
        });
        return result;
      },
      { timeout: 120000 },
    );
    revalidateFinancePaths(['/trash', '/daily-notes', '/accounts']);
    return ok(result);
  } catch (error) {
    if ((error as Error).message === 'RESET_ALREADY_USED') return fail('تم استخدام هذا التأكيد مسبقًا', 409);
    return apiError(error);
  }
}
