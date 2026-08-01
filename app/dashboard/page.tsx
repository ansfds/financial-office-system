import Link from 'next/link';
import Page from '@/components/Page';
import { getSession } from '@/lib/auth';
import { lydBreakdown, sumMethods, summarizeCashboxByMethod } from '@/lib/cashbox-summary';
import { db } from '@/lib/db';
import { formatMoney, formatNumber } from '@/lib/format';
import { detailedPaymentLabels, lydBreakdownMethods } from '@/lib/payment-methods';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const operationLabels: Record<string, string> = {
  MANUAL: 'نوع يدوي',
  USDT: 'USDT',
  CARD_OPERATION: 'عمليات بطاقة',
  CASHBOX_MOVEMENT: 'حركة صندوق',
  CURRENCY_CONVERSION: 'صرف / تحويل عملة',
  MONEY_TRANSFER: 'حوالة مالية',
  SHEIN_CARD_SALE: 'كروت شي إن',
  EXPENSE: 'مصروف / دفع فاتورة',
};

export default async function Dashboard() {
  if (!(await getSession())) redirect('/login');

  const [
    people,
    transactions,
    currencies,
    latestBalances,
    cashboxMovements,
    sheinAvailable,
    sheinPending,
    receivedCards,
    recent,
  ] =
    await Promise.all([
      db.person.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      db.financialTransaction.count({ where: { deletedAt: null } }),
      db.currency.findMany({ where: { isActive: true } }),
      db.$queryRaw<Array<{ currencyId: string; balanceAfter: any }>>`
        SELECT DISTINCT ON ("currencyId") "currencyId", "balanceAfter"
        FROM "CashboxMovement"
        ORDER BY "currencyId", "occurredAt" DESC, "createdAt" DESC
      `,
      db.cashboxMovement.findMany({
        include: {
          currency: true,
          transaction: { select: { operationKind: true, operationDetails: true, sheinPaymentMethod: true } },
        },
      }),
      db.sheinCard.count({ where: { status: 'AVAILABLE' } }),
      db.transactionExecutionItem.count({
        where: {
          status: { not: 'COMPLETED' },
          transaction: { operationKind: 'SHEIN_CARD_SALE', deletedAt: null, executionStatus: 'PENDING' },
        },
      }),
      db.receivedCustomerCard.count({ where: { status: { not: 'CANCELLED' } } }),
      db.financialTransaction.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          number: true,
          operationKind: true,
          operationDetails: true,
          customType: true,
          agreedAmount: true,
          receivedAmount: true,
          paidAmount: true,
          status: true,
          person: { select: { fullName: true, customerNo: true } },
          currency: { select: { symbol: true } },
          type: { select: { name: true } },
        },
        orderBy: { transactionAt: 'desc' },
        take: 8,
      }),
    ]);
  const cashboxSummary = summarizeCashboxByMethod(cashboxMovements);
  const sheinInventoryDifference = sheinAvailable - sheinPending;

  return (
    <Page title="لوحة التحكم">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="عدد الزبائن" value={formatNumber(people)} href="/people" />
        <Stat title="عدد المعاملات" value={formatNumber(transactions)} href="/transactions" />
        <Stat title="عدد كروت شي إن المتوفرة" value={formatNumber(sheinAvailable)} href="/inventory/shein-cards" />
        <Stat title="عدد البطاقات المستلمة" value={formatNumber(receivedCards)} href="/inventory/received-cards" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat title="كروت شي إن المتوفرة" value={formatNumber(sheinAvailable)} href="/inventory/shein-cards" />
        <Stat title="طلبات شي إن في الانتظار" value={formatNumber(sheinPending)} href="/transactions?executionStatus=PENDING" />
        <Stat title="فرق كروت شي إن" value={formatNumber(sheinInventoryDifference)} href="/transactions?executionStatus=PENDING" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {currencies.slice(0, 4).map((currency) => {
          const latestBalance = latestBalances.find((item) => item.currencyId === currency.id)?.balanceAfter || 0;
          const balance = currency.code === 'LYD' ? sumMethods(cashboxSummary, lydBreakdownMethods) : latestBalance;

          if (currency.code === 'LYD') {
            return (
              <BalanceDetailsStat
                key={currency.id}
                title={`رصيد ${currency.name}`}
                value={formatMoney(balance, currency)}
                href={`/cashbox?currencyId=${currency.id}`}
                breakdown={lydBreakdown(cashboxSummary)}
                symbol={currency.symbol}
              />
            );
          }

          return (
            <Stat
              key={currency.id}
              title={`رصيد ${currency.name}`}
              value={formatMoney(latestBalance, currency)}
              href={`/cashbox?currencyId=${currency.id}`}
            />
          );
        })}
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
                const isReceivedCardRegistration =
                  transaction.operationKind === 'CARD_OPERATION' &&
                  (transaction.operationDetails as any)?.action === 'RECEIVE_CARD';
                const remaining = isReceivedCardRegistration
                  ? transaction.agreedAmount.mul(0)
                  : transaction.agreedAmount.sub(transaction.receivedAmount).sub(transaction.paidAmount);
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
                    <td>{operationLabels[transaction.operationKind || ''] || transaction.type?.name || transaction.customType || '—'}</td>
                    <td>
                      {formatMoney(transaction.agreedAmount, transaction.currency)}
                    </td>
                    <td>{formatMoney(remaining.gt(0) ? remaining : 0, transaction.currency)}</td>
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

function Stat({ title, value, href }: { title: string; value: ReactNode; href?: string }) {
  const content = (
    <div className="card h-full p-5 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black">{value}</div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function BalanceDetailsStat({
  title,
  value,
  href,
  breakdown,
  symbol,
}: {
  title: string;
  value: ReactNode;
  href: string;
  breakdown: Array<{ method: string; amount: number }>;
  symbol: string;
}) {
  return (
    <details className="card h-full p-5 hover:-translate-y-0.5 hover:shadow-lg">
      <summary className="cursor-pointer list-none">
        <div className="text-sm text-slate-500">{title}</div>
        <div className="mt-2 text-2xl font-black">{value}</div>
      </summary>
      <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
        {breakdown.map((item) => (
          <div key={item.method} className="flex items-center justify-between gap-3">
            <span className="text-slate-500">{detailedPaymentLabels[item.method as keyof typeof detailedPaymentLabels]}</span>
            <b>{formatMoney(item.amount, symbol)}</b>
          </div>
        ))}
        <Link href={href} className="mt-2 text-sm font-bold text-indigo-600 hover:text-indigo-500">
          فتح الصندوق
        </Link>
      </div>
    </details>
  );
}
