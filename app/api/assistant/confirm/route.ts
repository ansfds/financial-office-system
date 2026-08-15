import { requireSession, clientMeta } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { executeAssistantConfirmation } from '@/lib/smart-assistant/core';
import { checkAssistantRateLimit } from '@/lib/smart-assistant/rate-limit';
import { assistantConfirmRequestSchema } from '@/lib/smart-assistant/schema';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const meta = await clientMeta();
    const rate = checkAssistantRateLimit(`confirm:${session.id}:${meta.ip}`, { limit: 10, windowMs: 60_000 });
    if (!rate.allowed) return fail('طلبات التأكيد كثيرة الآن. انتظر قليلًا ثم حاول من جديد.', 429);

    const parsed = assistantConfirmRequestSchema.safeParse(await request.json());
    if (!parsed.success) return fail('طلب التأكيد غير صالح.');

    const result = await executeAssistantConfirmation(parsed.data.confirmationToken, session);
    return ok({
      type: 'executed',
      message: result.message,
    });
  } catch (error) {
    if ((error as Error).message === 'INVALID_ASSISTANT_CONFIRMATION') {
      return fail('انتهت صلاحية المعاينة أو تغيرت. أعد إرسال الأمر للحصول على معاينة جديدة.', 400);
    }
    if ((error as Error).message === 'ASSISTANT_PREVIEW_STALE') {
      return fail('تغيرت البيانات منذ إنشاء المعاينة. أعد إرسال الأمر قبل التأكيد.', 409);
    }
    return apiError(error);
  }
}
