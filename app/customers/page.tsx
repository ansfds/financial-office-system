import Page from '@/components/Page';
import PeopleClient from '@/components/PeopleClient';
import { requireSession } from '@/lib/auth';
import { findPeopleWithCardSummaries } from '@/lib/people-card-summary';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function PeoplePage() {
  await requireSession();
  const people = await findPeopleWithCardSummaries();

  return (
    <Page title="الزبائن">
      <PeopleClient initialPeople={JSON.parse(JSON.stringify(people))} />
    </Page>
  );
}
