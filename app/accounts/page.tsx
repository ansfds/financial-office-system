import Page from '@/components/Page';
import AccountsClient from '@/components/AccountsClient';
import { db } from '@/lib/db';
import { buildWalletSnapshot } from '@/lib/customer-wallet';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function AccountsPage() {
  const [people, currencies] = await Promise.all([
    db.person.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      include: {
        transactions: {
          where: { deletedAt: null },
          include: { currency: true },
        },
        walletSettlements: {
          where: { deletedAt: null },
          include: { currency: true },
          orderBy: { occurredAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
  ]);

  const rows = people.flatMap((person) => {
    const snapshot = buildWalletSnapshot(person.transactions, person.walletSettlements, currencies);
    return snapshot.rows
      .filter((row) => row.credit !== 0 || row.debt !== 0)
      .map((row) => {
        const settlements = person.walletSettlements.filter(
          (settlement) => settlement.currencyId === row.currency.id && settlement.paymentMethod === row.paymentMethod,
        );
        const lastMovement = settlements[0]?.occurredAt || person.updatedAt;

        return {
          personId: person.id,
          customerNo: person.customerNo,
          fullName: person.fullName,
          phone: person.phone,
          currency: row.currency,
          paymentMethod: row.paymentMethod,
          paymentLabel: row.label,
          ourAmount: row.debt,
          theirAmount: row.credit,
          net: row.debt - row.credit,
          lastMovement,
        };
      });
  });

  rows.sort((left, right) => new Date(right.lastMovement).getTime() - new Date(left.lastMovement).getTime());

  const settlements = people.flatMap((person) =>
    person.walletSettlements.map((settlement) => ({
      ...settlement,
      person: {
        id: person.id,
        customerNo: person.customerNo,
        fullName: person.fullName,
      },
    })),
  );

  return (
    <Page title="لنا وعلينا">
      <AccountsClient
        rows={JSON.parse(JSON.stringify(rows))}
        people={JSON.parse(
          JSON.stringify(
            people.map((person) => ({
              id: person.id,
              customerNo: person.customerNo,
              fullName: person.fullName,
            })),
          ),
        )}
        currencies={JSON.parse(JSON.stringify(currencies))}
        settlements={JSON.parse(JSON.stringify(settlements))}
      />
    </Page>
  );
}
