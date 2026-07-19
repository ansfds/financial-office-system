import Page from '@/components/Page';
import NewTransaction from '@/components/NewTransaction';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewTransactionPage() {
  const [people, currencies, types] = await Promise.all([
    db.person.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    }),
    db.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    db.transactionType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <Page title="إضافة معاملة">
      <NewTransaction
        initialPeople={JSON.parse(JSON.stringify(people))}
        initialCurrencies={JSON.parse(JSON.stringify(currencies))}
        initialTypes={JSON.parse(JSON.stringify(types))}
      />
    </Page>
  );
}
