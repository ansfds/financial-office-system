import Page from '@/components/Page';
import SheinSalesReportClient from '@/components/SheinSalesReportClient';
import { db } from '@/lib/db';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const categoryLabels: Record<string, string> = {
  VIP: 'عميل مميز',
  REGULAR: 'عميل عادي',
};

const sheinStatusLabels: Record<string, string> = {
  AVAILABLE: 'متوفر',
  SOLD: 'تم البيع',
  RESERVED: 'محجوز',
  INVALID: 'غير صالح',
  CANCELLED: 'ملغي',
};

const receivedStatusLabels: Record<string, string> = {
  RECEIVED: 'غير مصفاة',
  IN_SETTLEMENT: 'قيد التصفية',
  SETTLED: 'مصفاة بالكامل',
  PARTIAL: 'مصفاة جزئيا',
  COMPLETED: 'مصفاة بالكامل',
  CANCELLED: 'ملغاة',
};

const receivedSettlementStatuses = new Set(['PARTIAL', 'SETTLED', 'COMPLETED']);

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

function amount(value: any) {
  return Number(value || 0);
}

function formatMoney(value: number, symbol = '') {
  return `${value.toLocaleString('en-US')} ${symbol}`.trim();
}

function moneyBucketsLabel(buckets: Map<string, { amount: number; symbol: string }>) {
  const items = Array.from(buckets.values()).filter((item) => item.amount > 0);
  return items.length ? items.map((item) => formatMoney(item.amount, item.symbol)).join('، ') : '0';
}

function operationDetails(transaction: any) {
  const details = transaction.operationDetails || {};
  const symbol = transaction.currency?.symbol || '';

  if (transaction.operationKind === 'CARD_OPERATION') {
    return `${amount(details.cardCount).toLocaleString('en-US')} بطاقات × ${amount(details.cardValue).toLocaleString(
      'en-US',
    )} ${symbol} = ${amount(details.cardTotal).toLocaleString('en-US')} ${symbol}`;
  }

  if (transaction.operationKind === 'USDT') {
    return `${amount(details.usdtAmount).toLocaleString('en-US')} USDT عبر ${details.network || '—'}`;
  }

  if (transaction.operationKind === 'SHEIN_CARD_SALE') {
    return `${amount(details.cardCount).toLocaleString('en-US')} كروت - إجمالي ${amount(details.totalAmount).toLocaleString(
      'en-US',
    )} ${symbol}`;
  }

  if (transaction.operationKind === 'MONEY_TRANSFER') {
    return `${details.receiverName || '—'} / ${details.destination || '—'}`;
  }

  if (transaction.operationKind === 'EXPENSE') {
    return `${details.payee || '—'} - ${details.expenseType || '—'}`;
  }

  return transaction.executionType || transaction.description || '—';
}

function dateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const params = await searchParams;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromDate = params.from ? new Date(`${params.from}T00:00:00`) : today;
  const toDate = params.to ? endOfDay(new Date(`${params.to}T00:00:00`)) : endOfDay(today);
  const transactionWhere = {
    deletedAt: null,
    transactionAt: { gte: fromDate, lte: toDate },
  };

  const [
    transactionSummary,
    currencies,
    latestBalances,
    customerSummary,
    sheinSummary,
    sheinSales,
    receivedCardRows,
    todayMovements,
    recentOperations,
  ] = await Promise.all([
    db.financialTransaction.groupBy({
      by: ['currencyId', 'status'],
      where: transactionWhere,
      _sum: {
        agreedAmount: true,
        receivedAmount: true,
        paidAmount: true,
        receivableAmount: true,
        payableAmount: true,
      },
      _count: true,
    }),
    db.currency.findMany(),
    db.$queryRaw<Array<{ currencyId: string; balanceAfter: any }>>`
      SELECT DISTINCT ON ("currencyId") "currencyId", "balanceAfter"
      FROM "CashboxMovement"
      ORDER BY "currencyId", "occurredAt" DESC, "createdAt" DESC
    `,
    db.person.groupBy({
      by: ['category'],
      where: { deletedAt: null, status: 'ACTIVE' },
      _count: true,
    }),
    db.sheinCard.groupBy({
      by: ['denomination', 'status'],
      _count: true,
    }),
    db.sheinCardSale.findMany({
      where: { occurredAt: { gte: fromDate, lte: toDate } },
      include: {
        currency: true,
        person: true,
        items: { include: { card: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    }),
    db.receivedCustomerCard.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: {
        status: true,
        valueUsd: true,
        agreedAmount: true,
        receivedAmount: true,
        settlementAmount: true,
        settlementCashboxMovementId: true,
        settlementCurrency: { select: { code: true, symbol: true } },
      },
    }),
    db.cashboxMovement.findMany({
      where: { occurredAt: { gte: fromDate, lte: toDate } },
      include: { currency: true },
      orderBy: { occurredAt: 'desc' },
    }),
    db.financialTransaction.findMany({
      where: transactionWhere,
      select: {
        id: true,
        transactionAt: true,
        operationKind: true,
        operationDetails: true,
        customType: true,
        executionType: true,
        description: true,
        agreedAmount: true,
        person: { select: { fullName: true } },
        currency: { select: { symbol: true } },
        type: { select: { name: true } },
      },
      orderBy: { transactionAt: 'desc' },
      take: 50,
    }),
  ]);

  const dailyByCurrency = currencies.map((currency) => {
    const items = todayMovements.filter((movement) => movement.currencyId === currency.id);
    const incoming = items
      .filter((movement) => movement.direction === 'IN')
      .reduce((sum, movement) => sum + amount(movement.amount), 0);
    const outgoing = items
      .filter((movement) => movement.direction === 'OUT')
      .reduce((sum, movement) => sum + amount(movement.amount), 0);

    return {
      currency,
      incoming,
      outgoing,
      difference: incoming - outgoing,
      balance: latestBalances.find((item) => item.currencyId === currency.id)?.balanceAfter || 0,
    };
  });

  const employees = Array.from(
    new Set(todayMovements.map((movement) => movement.createdBy).filter(Boolean)),
  );

  const sheinSold = sheinSummary
    .filter((item) => item.status === 'SOLD')
    .reduce((sum, item) => sum + item._count, 0);
  const sheinAvailable = sheinSummary
    .filter((item) => item.status === 'AVAILABLE')
    .reduce((sum, item) => sum + item._count, 0);
  const receivedCardStats = receivedCardRows.reduce(
    (stats, card) => {
      const baseAmount = amount(card.valueUsd) > 0 ? amount(card.valueUsd) : amount(card.agreedAmount);
      stats.totalValue += baseAmount;
      stats.totalRemaining += Math.max(baseAmount - amount(card.receivedAmount), 0);

      if (receivedSettlementStatuses.has(card.status) && card.settlementCashboxMovementId) {
        const key = card.settlementCurrency?.code || 'UNKNOWN';
        const current = stats.settledByCurrency.get(key) || {
          amount: 0,
          symbol: card.settlementCurrency?.symbol || key,
        };
        current.amount += amount(card.settlementAmount);
        stats.settledByCurrency.set(key, current);
      }

      if (card.status === 'PARTIAL') stats.partial += 1;
      else if (['SETTLED', 'COMPLETED'].includes(card.status)) stats.full += 1;
      else stats.unsettled += 1;

      stats.byStatus.set(card.status, (stats.byStatus.get(card.status) || 0) + 1);
      return stats;
    },
    {
      totalValue: 0,
      totalRemaining: 0,
      settledByCurrency: new Map<string, { amount: number; symbol: string }>(),
      unsettled: 0,
      partial: 0,
      full: 0,
      byStatus: new Map<string, number>(),
    },
  );

  return (
    <Page title="التقارير">
      <div className="grid gap-5">
        <form className="card grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">من تاريخ</label>
            <input name="from" type="date" defaultValue={dateInput(fromDate)} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">إلى تاريخ</label>
            <input name="to" type="date" defaultValue={dateInput(toDate)} />
          </div>
          <button className="self-end rounded-lg bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-500">
            عرض التقرير
          </button>
        </form>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SheinSalesReportClient soldCount={sheinSold} sales={JSON.parse(JSON.stringify(sheinSales))} />
          <SummaryCard title="الكروت المتوفرة" value={sheinAvailable} />
          <SummaryCard title="قيمة البطاقات المستلمة" value={formatMoney(receivedCardStats.totalValue, '$')} />
          <SummaryCard title="المبالغ المصفاة فعليا" value={moneyBucketsLabel(receivedCardStats.settledByCurrency)} />
          <SummaryCard title="المتبقي داخل البطاقات" value={formatMoney(receivedCardStats.totalRemaining, '$')} />
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <SummaryCard title="بطاقات غير مصفاة" value={receivedCardStats.unsettled} />
          <SummaryCard title="بطاقات مصفاة جزئيا" value={receivedCardStats.partial} />
          <SummaryCard title="بطاقات مصفاة بالكامل" value={receivedCardStats.full} />
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">ملخص الفترة</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>العملة</th>
                  <th>الرصيد الحالي</th>
                  <th>إجمالي الداخل</th>
                  <th>إجمالي الخارج</th>
                  <th>الربح أو الفرق</th>
                </tr>
              </thead>
              <tbody>
                {dailyByCurrency.map((item) => (
                  <tr key={item.currency.id}>
                    <td>{item.currency.name}</td>
                    <td>
                      {amount(item.balance).toLocaleString('en-US')} {item.currency.symbol}
                    </td>
                    <td className="font-bold text-emerald-600">
                      {item.incoming.toLocaleString('en-US')} {item.currency.symbol}
                    </td>
                    <td className="font-bold text-red-600">
                      {item.outgoing.toLocaleString('en-US')} {item.currency.symbol}
                    </td>
                    <td className={item.difference >= 0 ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                      {item.difference.toLocaleString('en-US')} {item.currency.symbol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-sm text-slate-500">
            الموظف المسؤول: {employees.length ? employees.join('، ') : 'لا توجد حركات اليوم'}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">ملخص حسب العملة والحالة</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>العملة</th>
                  <th>الحالة</th>
                  <th>العدد</th>
                  <th>المتفق عليه</th>
                  <th>المستلم</th>
                  <th>المدفوع</th>
                  <th>لنا</th>
                  <th>علينا</th>
                </tr>
              </thead>
              <tbody>
                {transactionSummary.map((item, index) => (
                  <tr key={index}>
                    <td>{currencies.find((currency) => currency.id === item.currencyId)?.name}</td>
                    <td>{item.status}</td>
                    <td>{item._count}</td>
                    <td>{item._sum.agreedAmount?.toString()}</td>
                    <td>{item._sum.receivedAmount?.toString()}</td>
                    <td>{item._sum.paidAmount?.toString()}</td>
                    <td>{item._sum.receivableAmount?.toString()}</td>
                    <td>{item._sum.payableAmount?.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">آخر العمليات</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>نوع التنفيذ</th>
                  <th>التفاصيل</th>
                  <th>الزبون</th>
                  <th>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {recentOperations.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{new Date(transaction.transactionAt).toLocaleString('en-GB')}</td>
                    <td>{operationLabels[transaction.operationKind || ''] || transaction.type?.name || transaction.customType || '—'}</td>
                    <td>{transaction.executionType || '—'}</td>
                    <td>{operationDetails(transaction)}</td>
                    <td>{transaction.person?.fullName || '—'}</td>
                    <td>
                      {amount(transaction.agreedAmount).toLocaleString('en-US')} {transaction.currency.symbol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="card p-5">
            <h2 className="mb-4 font-black">تصنيف الزبائن</h2>
            {customerSummary.map((item) => (
              <div key={item.category} className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
                <span>{categoryLabels[item.category] || item.category}</span>
                <b>{item._count}</b>
              </div>
            ))}
          </div>

          <div className="card p-5">
            <h2 className="mb-4 font-black">كروت شي إن حسب الفئة</h2>
            {sheinSummary.map((item, index) => (
              <div key={index} className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
                <span>
                  {item.denomination.toString()}$ - {sheinStatusLabels[item.status] || item.status}
                </span>
                <b>{item._count}</b>
              </div>
            ))}
          </div>

          <div className="card p-5">
            <h2 className="mb-4 font-black">البطاقات المستلمة</h2>
            {Array.from(receivedCardStats.byStatus.entries()).map(([status, count]) => (
              <div key={status} className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
                <span>{receivedStatusLabels[status] || status}</span>
                <b>{count}</b>
              </div>
            ))}
            {!receivedCardStats.byStatus.size ? <div className="text-sm text-slate-500">لا توجد بطاقات مستلمة</div> : null}
          </div>
        </section>
      </div>
    </Page>
  );
}

function SummaryCard({ title, value }: { title: string; value: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black">{typeof value === 'number' ? value.toLocaleString('en-US') : value}</div>
    </div>
  );
}
