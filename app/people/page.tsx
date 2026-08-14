import Page from '@/components/Page';
import PeopleClient from '@/components/PeopleClient';
import { db } from '@/lib/db';
import { findPeopleWithCardSummaries } from '@/lib/people-card-summary';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function PeoplePage() {
  const [people, currencies] = await Promise.all([
    findPeopleWithCardSummaries(),
    db.currency.findMany({ where: { isActive: true, code: { in: ['USD', 'LYD', 'USDT'] } }, orderBy: { code: 'asc' } }),
  ]);

  return (
    <Page title="الزبائن والبطاقات">
      <PeopleClient initialPeople={JSON.parse(JSON.stringify(people))} currencies={JSON.parse(JSON.stringify(currencies))} />
    </Page>
  );
}
