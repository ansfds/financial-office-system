import Page from '@/components/Page';
import PeopleClient from '@/components/PeopleClient';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function PeoplePage() {
  const people = await db.person.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      customerNo: true,
      fullName: true,
      phone: true,
      address: true,
      externalId: true,
      notes: true,
      category: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <Page title="الزبائن">
      <PeopleClient initialPeople={JSON.parse(JSON.stringify(people))} />
    </Page>
  );
}
