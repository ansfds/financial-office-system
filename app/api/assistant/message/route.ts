import { requireSession, clientMeta } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { handleAssistantCommand } from '@/lib/smart-assistant/core';
import { checkAssistantRateLimit } from '@/lib/smart-assistant/rate-limit';
import { assistantMessageRequestSchema } from '@/lib/smart-assistant/schema';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const meta = await clientMeta();
    const rate = checkAssistantRateLimit(`message:${session.id}:${meta.ip}`, { limit: 18, windowMs: 60_000 });
    if (!rate.allowed) return fail('طلبات المساعد كثيرة الآن. انتظر قليلًا ثم حاول من جديد.', 429);

    const parsed = assistantMessageRequestSchema.safeParse(await request.json());
    if (!parsed.success) return fail('اكتب أمرًا واضحًا للمساعد.');

    return ok(
      await handleAssistantCommand({
        command: parsed.data.command,
        transcript: parsed.data.transcript,
        history: parsed.data.history,
        session,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
