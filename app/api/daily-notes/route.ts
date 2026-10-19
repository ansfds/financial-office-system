import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { dailyNoteSchema } from '@/lib/daily-notes';
import { revalidatePaths } from '@/lib/revalidate';
export async function GET() {
  try {
    await requireSession();
    return ok(await db.dailyNote.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const parsed = dailyNoteSchema.safeParse(await request.json());
    if (!parsed.success) return fail('أدخل عنوانًا ونصًا صالحين');
    const note = await db.dailyNote.create({
      data: { ...parsed.data, createdBy: session.username || session.userId || 'system' },
    });
    revalidatePaths(['/daily-notes']);
    return ok(note, 201);
  } catch (e) {
    return apiError(e);
  }
}
