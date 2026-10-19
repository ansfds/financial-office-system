import { requireSession } from '@/lib/auth';
import { apiError, ok } from '@/lib/http';
import { getPublicSiteSettings, savePublicSiteSettings } from '@/lib/public-site-settings';

export async function GET() {
  try {
    await requireSession();
    const settings = await getPublicSiteSettings({ persistDefaults: true });
    return ok({ settings });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const payload = await request.json().catch(() => ({}));
    const settings = await savePublicSiteSettings(payload);
    return ok({ settings });
  } catch (e) {
    return apiError(e);
  }
}
