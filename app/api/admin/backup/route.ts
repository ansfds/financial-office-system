import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, ok } from '@/lib/http';
import { createSystemBackup } from '@/lib/system-backup';
export const runtime = 'nodejs';
export async function POST() {
  try {
    await requireSession();
    const result = await db.$transaction((tx) => createSystemBackup(tx), {
      isolationLevel: 'RepeatableRead',
      timeout: 120000,
    });
    return ok({ id: result.record.id, filename: result.record.filename, status: result.record.status });
  } catch (e) {
    return apiError(e);
  }
}
