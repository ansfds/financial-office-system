import Page from '@/components/Page';
import ReceivedCardsClient from '@/components/ReceivedCardsClient';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ReceivedCardsPage() {
  const [people, currencies, batches] = await Promise.all([
    db.person.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } }),
    db.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    db.receivedCardBatch.findMany({
      include: {
        person: true,
        currency: true,
        cards: { include: { settlementCurrency: true }, orderBy: { sequence: 'asc' } },
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    }),
  ]);

  return (
    <Page title="مخزن البطاقات المستلمة">
      <ReceivedCardsClient
        people={JSON.parse(JSON.stringify(people))}
        currencies={JSON.parse(JSON.stringify(currencies))}
        initialBatches={JSON.parse(JSON.stringify(batches))}
      />
    </Page>
  );
}
