import Page from '@/components/Page';
import InstantRegistrationClient from '@/components/InstantRegistrationClient';
import { instantRegistrationHistory } from '@/lib/instant-registration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function InstantRegistrationPage() {
  const history = await instantRegistrationHistory();

  return (
    <Page title="التسجيل الفوري">
      <InstantRegistrationClient initialHistory={JSON.parse(JSON.stringify(history))} />
    </Page>
  );
}
