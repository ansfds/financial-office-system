import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { dailyNoteUpdateSchema } from '@/lib/daily-notes';
import { revalidatePaths } from '@/lib/revalidate';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const parsed = dailyNoteUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات المذكرة');
    const { updatedAt, ...data } = parsed.data;
    const result = await db.dailyNote.updateMany({ where: { id, updatedAt: new Date(updatedAt) }, data });
    if (!result.count) return fail('تغيرت المذكرة في نافذة أخرى أو حُذفت. افتح النسخة المحفوظة مجددًا', 409);
    revalidatePaths(['/daily-notes']);
    return ok(await db.dailyNote.findUnique({ where: { id } }));
  } catch (e) {
    return apiError(e);
  }
}
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    await db.dailyNote.deleteMany({ where: { id } });
    revalidatePaths(['/daily-notes']);
    return ok({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
