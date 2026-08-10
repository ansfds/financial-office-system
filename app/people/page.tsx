import Page from '@/components/Page';
import PeopleClient from '@/components/PeopleClient';
import { sortByCustomerCode } from '@/lib/customer-code-sort';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function PeoplePage() {
  const [people, currencies] = await Promise.all([
    db.person.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      include: {
        cardBatches: {
          include: {
            currency: true,
            cards: {
              where: { deletedAt: null },
              include: {
                settlementCurrency: true,
                operations: { where: { deletedAt: null }, orderBy: { occurredAt: 'desc' }, take: 20 },
                stageLogs: { orderBy: { createdAt: 'desc' }, take: 8 },
              },
              orderBy: { sequence: 'asc' },
            },
          },
          orderBy: { receivedAt: 'desc' },
        },
        cardDeliveries: {
          where: { deletedAt: null },
          include: { currency: true },
          orderBy: { occurredAt: 'desc' },
        },
      },
      orderBy: [{ customerNo: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    }),
    db.currency.findMany({ where: { isActive: true, code: { in: ['USD', 'LYD', 'USDT'] } }, orderBy: { code: 'asc' } }),
  ]);

  return (
    <Page title="الزبائن والبطاقات">
      <PeopleClient initialPeople={JSON.parse(JSON.stringify(sortByCustomerCode(people)))} currencies={JSON.parse(JSON.stringify(currencies))} />
    </Page>
  );
}
