import Page from '@/components/Page';
import PeopleClient from '@/components/PeopleClient';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PeoplePage() {
  const people = await db.person.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <Page title="الزبائن">
      <PeopleClient initialPeople={JSON.parse(JSON.stringify(people))} />
    </Page>
  );
}
