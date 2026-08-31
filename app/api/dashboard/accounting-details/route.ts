import { requireSession } from '@/lib/auth';
import { getDashboardAccountingDetails, parseDashboardAccountingDetailKind, parseDashboardAccountingPeriod } from '@/lib/dashboard-accounting';
import { apiError, ok } from '@/lib/http';

export async function GET(request: Request) {
  try {
    await requireSession();
    const url = new URL(request.url);
    const period = parseDashboardAccountingPeriod(url.searchParams.get('period'));
    const kind = parseDashboardAccountingDetailKind(url.searchParams.get('kind'));

    return ok(await getDashboardAccountingDetails(period, kind));
  } catch (error) {
    return apiError(error);
  }
}
