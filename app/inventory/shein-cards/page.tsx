import Page from '@/components/Page';
import SheinCardsClient from '@/components/SheinCardsClient';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function SheinCardsPage() {
  const [people, currencies, cards] = await Promise.all([
    db.person.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    }),
    db.currency.findMany({
      where: { isActive: true, code: { in: ['LYD', 'USD'] } },
      orderBy: { code: 'asc' },
    }),
    db.sheinCard.findMany({
      select: {
        id: true,
        code: true,
        denomination: true,
        status: true,
        purchasePrice: true,
        salePrice: true,
        saleCurrencyId: true,
        saleCashboxMovementId: true,
        saleCurrency: true,
        supplier: true,
        buyerPersonId: true,
        buyer: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        soldAt: true,
        logs: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
  ]);

  return (
    <Page title="كروت شي إن">
      <SheinCardsClient
        people={JSON.parse(JSON.stringify(people))}
        currencies={JSON.parse(JSON.stringify(currencies))}
        initialCards={JSON.parse(JSON.stringify(cards))}
      />
    </Page>
  );
}
