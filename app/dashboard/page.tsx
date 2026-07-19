import Link from 'next/link';
import Page from '@/components/Page';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Dashboard() {
  if (!(await getSession())) redirect('/login');

  const [people, transactions, currencies, latestBalances, sheinAvailable, receivedCards, recent] =
    await Promise.all([
      db.person.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      db.financialTransaction.count({ where: { deletedAt: null } }),
      db.currency.findMany({ where: { isActive: true } }),
      db.$queryRaw<Array<{ currencyId: string; balanceAfter: any }>>`
        SELECT DISTINCT ON ("currencyId") "currencyId", "balanceAfter"
        FROM "CashboxMovement"
        ORDER BY "currencyId", "occurredAt" DESC, "createdAt" DESC
      `,
      db.sheinCard.count({ where: { status: 'AVAILABLE' } }),
      db.receivedCustomerCard.count({ where: { status: { not: 'CANCELLED' } } }),
      db.financialTransaction.findMany({
        where: { deletedAt: null },
        include: { person: true, currency: true, type: true },
        orderBy: { transactionAt: 'desc' },
        take: 8,
      }),
    ]);

  return (
    <Page title="لوحة التحكم">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="عدد الزبائن" value={people} href="/people" />
        <Stat title="عدد المعاملات" value={transactions} href="/transactions" />
        <Stat title="عدد كروت شي إن المتوفرة" value={sheinAvailable} href="/inventory/shein-cards" />
        <Stat title="عدد البطاقات المستلمة" value={receivedCards} href="/inventory/received-cards" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {currencies.slice(0, 4).map((currency) => (
          <Stat
            key={currency.id}
            title={`رصيد ${currency.name}`}
            value={`${latestBalances.find((item) => item.currencyId === currency.id)?.balanceAfter || 0} ${currency.symbol}`}
            href={`/cashbox?currencyId=${currency.id}`}
          />
        ))}
      </div>

      <div className="card mt-6 p-5">
        <h2 className="mb-4 font-black">آخر المعاملات</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الزبون</th>
                <th>النوع</th>
                <th>المبلغ</th>
                <th>المتبقي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((transaction) => {
                const remaining = transaction.agreedAmount
                  .sub(transaction.receivedAmount)
                  .sub(transaction.paidAmount);
                return (
                  <tr key={transaction.id}>
                    <td>{transaction.number}</td>
                    <td>
                      {transaction.person ? (
                        <div>
                          <div className="font-bold">{transaction.person.fullName}</div>
                          <div className="text-xs text-slate-500">{transaction.person.customerNo || '—'}</div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{transaction.type?.name || transaction.customType || '—'}</td>
                    <td>
                      {transaction.agreedAmount.toString()} {transaction.currency.symbol}
                    </td>
                    <td>{remaining.gt(0) ? remaining.toString() : '0'}</td>
                    <td>{remaining.lte(0) ? 'مكتمل' : transaction.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}

function Stat({ title, value, href }: { title: string; value: any; href?: string }) {
  const content = (
    <div className="card h-full p-5 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black">{value}</div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
