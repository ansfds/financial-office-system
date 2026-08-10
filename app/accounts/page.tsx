import Page from '@/components/Page';
import AccountsClient from '@/components/AccountsClient';
import { db } from '@/lib/db';
import { buildWalletSnapshot } from '@/lib/customer-wallet';
import { compareCustomerCodes, sortByCustomerCode } from '@/lib/customer-code-sort';

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
      orderBy: [{ customerNo: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
  ]);

  const sortedPeople = sortByCustomerCode(people);

  const rows = sortedPeople.flatMap((person) => {
    const snapshot = buildWalletSnapshot(person.transactions, person.walletSettlements, currencies);
    return snapshot.rows.flatMap((row) => {
      const settlements = person.walletSettlements.filter(
        (settlement) => settlement.currencyId === row.currency.id && settlement.paymentMethod === row.paymentMethod,
      );
      if (row.credit === 0 && row.debt === 0 && settlements.length === 0) return [];

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

  rows.sort((left, right) => {
    const codeDiff = compareCustomerCodes(left.customerNo, right.customerNo);
    if (codeDiff !== 0) return codeDiff;
    const currencyDiff = String(left.currency.code || '').localeCompare(String(right.currency.code || ''), 'en');
    if (currencyDiff !== 0) return currencyDiff;
    return left.paymentLabel.localeCompare(right.paymentLabel, 'ar');
  });

  const settlements = sortedPeople.flatMap((person) =>
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
            sortedPeople.map((person) => ({
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
