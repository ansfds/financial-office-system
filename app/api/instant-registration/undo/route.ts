import { requireSession } from '@/lib/auth';
import { undoInstantRegistration } from '@/lib/instant-registration';
import { apiError, fail, ok } from '@/lib/http';
import { z } from 'zod';

const undoSchema = z.object({
  fingerprint: z.string().trim().min(8),
});

function undoError(error: Error) {
  if (error.message === 'INSTANT_EXECUTION_NOT_FOUND') return fail('لم يتم العثور على عملية تسجيل فوري بهذا المرجع.', 404);
  if (error.message === 'INSTANT_ALREADY_UNDONE') return fail('تم التراجع عن هذه العملية مسبقًا.', 409);
  if (error.message === 'NEGATIVE_WALLET_BALANCE') return fail('لا يمكن التراجع لأن رصيدًا لاحقًا سيصبح بالسالب.');
  return null;
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const parsed = undoSchema.safeParse(await request.json());
    if (!parsed.success) return fail('مرجع التراجع غير صحيح.');
    return ok(await undoInstantRegistration(parsed.data.fingerprint, session));
  } catch (error) {
    const handled = undoError(error as Error);
    if (handled) return handled;
    return apiError(error);
  }
}
