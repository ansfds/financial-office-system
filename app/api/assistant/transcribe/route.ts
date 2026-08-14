import OpenAI, { toFile } from 'openai';
import { requireSession, clientMeta } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { checkAssistantRateLimit } from '@/lib/smart-assistant/rate-limit';

export const runtime = 'nodejs';

const maxAudioBytes = 8 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const meta = await clientMeta();
    const rate = checkAssistantRateLimit(`transcribe:${session.id}:${meta.ip}`, { limit: 8, windowMs: 60_000 });
    if (!rate.allowed) return fail('طلبات التسجيل الصوتي كثيرة الآن. انتظر قليلًا ثم حاول من جديد.', 429);

    if (!process.env.OPENAI_API_KEY?.trim()) {
      return fail('تحويل الصوت يحتاج إضافة OPENAI_API_KEY في Vercel.', 503);
    }

    const formData = await request.formData();
    const audio = formData.get('audio');
    if (!(audio instanceof File)) return fail('لم يصل ملف صوت صالح.');
    if (audio.size <= 0 || audio.size > maxAudioBytes) return fail('حجم التسجيل غير صالح.');

    const bytes = Buffer.from(await audio.arrayBuffer());
    const client = new OpenAI();
    const transcription = await client.audio.transcriptions.create({
      file: await toFile(bytes, audio.name || 'assistant-command.webm', { type: audio.type || 'audio/webm' }),
      model: process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-transcribe',
      language: 'ar',
      prompt: 'أوامر مالية عربية ولهجة ليبية داخل منظومة زبائن وبطاقات ولنا وعلينا.',
    });

    return ok({
      text: transcription.text || '',
    });
  } catch (error) {
    return apiError(error);
  }
}
