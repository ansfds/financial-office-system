import { requireSession } from '@/lib/auth';
import { apiError, ok } from '@/lib/http';
import { findCardOwners } from '@/lib/card-queries';
import { parseCardState } from '@/lib/card-states';
export async function GET(request: Request) {
  try {
    await requireSession();
    const query = new URL(request.url).searchParams;
    const rawPage = Number(query.get('page'));
    return ok(
      await findCardOwners({
        q: (query.get('q') || '').trim().slice(0, 200),
        state: parseCardState(query.get('status')),
        page: Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1,
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
