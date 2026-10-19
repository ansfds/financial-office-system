import { requireSession } from '@/lib/auth';
import { canReset } from '@/lib/reset-security';
import { db } from '@/lib/db';
import { apiError, fail } from '@/lib/http';
import { backupTypes } from '@/lib/system-backup';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canReset(session.username)) return fail('تنزيل النسخة متاح للمسؤول فقط', 403);
    const { id } = await params;
    const record = await db.backupRecord.findUnique({ where: { id } });
    const snapshot = await db.deletedItem.findFirst({
      where: { entityId: id, entityType: { in: backupTypes } },
    });
    if (!record || !snapshot) return fail('ملف النسخة غير متاح', 404);
    return new Response(JSON.stringify(snapshot.snapshot, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${record.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
