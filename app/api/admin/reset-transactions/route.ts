import { requireSession } from '@/lib/auth';
import { apiError, fail } from '@/lib/http';
export async function POST() {
  try { await requireSession(); return fail('تم استبدال مسار التصفير القديم بالتصفير المحمي من الإعدادات', 410); } catch(e) { return apiError(e); }
}
