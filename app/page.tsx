import PublicHomeClient from '@/components/PublicHomeClient';
import { getPublicSiteSettings } from '@/lib/public-site-settings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function Home() {
  const settings = await getPublicSiteSettings({ persistDefaults: true });

  return <PublicHomeClient settings={settings} />;
}
