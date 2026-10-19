import Page from '@/components/Page';
import CustomerHistoryClient from '@/components/CustomerHistoryClient';
import { personDetailSelect } from '@/lib/received-card-selects';
import CustomerWalletClient from '@/components/CustomerWalletClient';
import { db } from '@/lib/db';
import { buildWalletSnapshot } from '@/lib/customer-wallet';
import { currencySelect } from '@/lib/received-card-selects';
import { formatMoney } from '@/lib/format';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { getCardCounts } from '@/lib/card-queries';
import CardStatistics from '@/components/CardStatistics';
import { customerInteractionDates } from '@/lib/customer-timeline';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const categoryLabels: Record<string, string> = {
  VIP: 'عميل مميز',
  REGULAR: 'عميل عادي',
};

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const [person, currencies] = await Promise.all([
    db.person.findUnique({
      where: { id },
      select: {
        ...personDetailSelect,
        transactions: {
          where: { deletedAt: null },
          select: {
            id: true,
            number: true,
            personId: true,
            currencyId: true,
            operationKind: true,
            operationDetails: true,
            sheinPaymentMethod: true,
            agreedAmount: true,
            receivedAmount: true,
            paidAmount: true,
            status: true,
            deletedAt: true,
            transactionAt: true,
            currency: { select: currencySelect },
          },
          orderBy: { transactionAt: 'desc' },
        },
        walletSettlements: {
          where: { deletedAt: null },
          select: {
            id: true,
            personId: true,
            currencyId: true,
            paymentMethod: true,
            accountType: true,
            direction: true,
            amount: true,
            balanceBefore: true,
            balanceAfter: true,
            reason: true,
            note: true,
            movementKind: true,
            linkedSettlementId: true,
            settlementMethod: true,
            username: true,
            deletedAt: true,
            occurredAt: true,
            currency: { select: currencySelect },
          },
          orderBy: { occurredAt: 'desc' },
        },
      },
    }),
    db.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
  ]);

  if (!person || person.deletedAt || person.status !== 'ACTIVE') notFound();
  const walletSnapshot = buildWalletSnapshot(person.transactions, person.walletSettlements, currencies);
  const counts = await getCardCounts(person.id);
  const dates = customerInteractionDates(person);

  return (
    <Page title={`${person.customerNo ? `${person.customerNo} - ` : ''}${person.fullName}`}>
      <h2 className="mb-4 font-black">معلومات الزبون</h2>
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Info title="رقم العميل" value={person.customerNo || '—'} />
        <Info title="التصنيف" value={categoryLabels[person.category] || person.category} />
        <Info title="الهاتف" value={person.phone || '—'} />
        <Info title="الهاتف الثاني" value={person.phoneSecondary || '—'} />
        <Info title="تاريخ أول تعامل" value={formatDateTime(dates.first)} />
        <Info title="تاريخ آخر تعامل" value={formatDateTime(dates.last)} />
        <Info title="عدد المعاملات" value={String(person.transactions.length + person.cardBatches.length)} />
        <Info
          title="عدد البطاقات"
          value={String(person.cardBatches.reduce((n, b) => n + b.cards.length, 0))}
        />
        <Info title="العنوان" value={person.address || '—'} />
        <Info title="معلومات إضافية" value={person.externalId || '—'} />
        <Info title="ملاحظات" value={person.notes || '—'} />
      </div>

      <div className="mt-4">
        <CardStatistics counts={counts} href={`/cards/${person.id}`} title="إحصائيات البطاقات" />
      </div>
      <section className="card mt-4 p-4" data-customer-wallet>
        <h2 className="font-black">لنا وعلينا</h2>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {currencies.map((currency) => {
            const rows = walletSnapshot.rows.filter((row) => row.currency.id === currency.id);
            return (
              <span key={currency.id}>
                لنا:{' '}
                {formatMoney(
                  rows.reduce((n, row) => n + row.debt, 0),
                  currency,
                )}{' '}
                · علينا:{' '}
                {formatMoney(
                  rows.reduce((n, row) => n + row.credit, 0),
                  currency,
                )}
              </span>
            );
          })}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold">تفاصيل الحساب والحركات المالية</summary>
          <CustomerWalletClient
            personId={person.id}
            snapshot={JSON.parse(JSON.stringify(walletSnapshot))}
            settlements={JSON.parse(JSON.stringify(person.walletSettlements))}
            currencies={JSON.parse(JSON.stringify(currencies))}
          />
        </details>
      </section>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-bold">سجل معاملات الزبون</summary>
        <CustomerHistoryClient
          person={JSON.parse(JSON.stringify(person))}
          currencies={JSON.parse(JSON.stringify(currencies))}
        />
        {person.transactions.length > 0 && (
          <div className="table-wrap mt-3">
            <table>
              <thead>
                <tr>
                  <th>المعاملة</th>
                  <th>التاريخ</th>
                  <th>المتفق</th>
                </tr>
              </thead>
              <tbody>
                {person.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.number}</td>
                    <td>{formatDateTime(transaction.transactionAt)}</td>
                    <td>{formatMoney(transaction.agreedAmount, transaction.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </Page>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 font-black">{value}</div>
    </div>
  );
}
