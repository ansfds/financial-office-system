import Page from '@/components/Page';
import SheinSalesReportClient from '@/components/SheinSalesReportClient';
import { summarizeCashboxByMethod } from '@/lib/cashbox-summary';
import { db } from '@/lib/db';
import { buildWalletSnapshot, walletBuckets } from '@/lib/customer-wallet';
import { formatDateTime, formatMoney, formatNumber, numberValue } from '@/lib/format';
import { detailedPaymentLabels, lydBreakdownMethods, usdBreakdownMethods } from '@/lib/payment-methods';
import Link from 'next/link';
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
  return numberValue(value);
}

function walletTotalsLabel(items: Array<{ currency: { symbol?: string | null; name?: string | null }; amount: number }>) {
  const visible = items.filter((item) => item.amount !== 0);
  return visible.length ? visible.map((item) => formatMoney(item.amount, item.currency)).join('، ') : '0';
}

function walletMethodLabel(method: string) {
  return walletBuckets.find((bucket) => bucket.paymentMethod === method)?.label || method;
}

function moneyBucketsLabel(buckets: Map<string, { amount: number; symbol: string }>) {
  const items = Array.from(buckets.values()).filter((item) => item.amount > 0);
  return items.length ? items.map((item) => formatMoney(item.amount, item.symbol)).join('، ') : '0';
}

function operationDetails(transaction: any) {
  const details = transaction.operationDetails || {};
  const symbol = transaction.currency?.symbol || '';

  if (transaction.operationKind === 'CARD_OPERATION') {
    return `${formatNumber(details.cardCount)} بطاقات × ${formatMoney(details.cardValue, symbol)} = ${formatMoney(details.cardTotal, symbol)}`;
  }

  if (transaction.operationKind === 'USDT') {
    if (details.totalUsd !== undefined) {
      const paymentLabel = details.paymentCurrencyCode === 'LYD' ? 'دينار' : 'دولار';
      const paymentTotal =
        details.paymentCurrencyCode === 'LYD'
          ? formatMoney(details.totalLyd || details.paymentTotal, symbol)
          : formatMoney(details.totalUsd, '$');

      return `${formatMoney(details.usdtAmount, 'USDT')} عبر ${
        details.network || '—'
      } - عمولة ${details.commissionPercent ?? 0}% - الدفع ${paymentLabel}: ${paymentTotal}`;
    }

    return `${formatMoney(details.usdtAmount, 'USDT')} عبر ${details.network || '—'}`;
  }

  if (transaction.operationKind === 'SHEIN_CARD_SALE') {
    return `${formatNumber(details.cardCount)} كروت - إجمالي ${formatMoney(details.totalAmount, symbol)}`;
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
    walletTransactions,
    walletSettlements,
    walletSettlementRows,
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
      include: {
        currency: true,
        transaction: { select: { operationKind: true, operationDetails: true, sheinPaymentMethod: true } },
      },
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
    db.financialTransaction.findMany({
      where: { deletedAt: null, personId: { not: null } },
      include: {
        currency: true,
        person: { select: { id: true, fullName: true, customerNo: true } },
      },
    }),
    db.customerWalletSettlement.findMany({
      include: {
        currency: true,
        person: { select: { id: true, fullName: true, customerNo: true } },
      },
    }),
    db.customerWalletSettlement.findMany({
      where: { occurredAt: { gte: fromDate, lte: toDate } },
      include: {
        currency: true,
        person: { select: { id: true, fullName: true, customerNo: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
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
  const cashboxSummary = summarizeCashboxByMethod(todayMovements);
  const walletSnapshot = buildWalletSnapshot(walletTransactions, walletSettlements, currencies);
  const walletPeople = new Map<string, { id: string; fullName: string; customerNo?: string | null }>();

  for (const transaction of walletTransactions) {
    if (transaction.person) walletPeople.set(transaction.person.id, transaction.person);
  }
  for (const settlement of walletSettlements) {
    if (settlement.person) walletPeople.set(settlement.person.id, settlement.person);
  }

  const customerWalletReports = Array.from(walletPeople.values())
    .map((person) => {
      const snapshot = buildWalletSnapshot(
        walletTransactions.filter((transaction) => transaction.personId === person.id),
        walletSettlements.filter((settlement) => settlement.personId === person.id),
        currencies,
      );
      const totalCredit = snapshot.totals.credit.reduce((sum, item) => sum + item.amount, 0);
      const totalDebt = snapshot.totals.debt.reduce((sum, item) => sum + item.amount, 0);
      return {
        person,
        snapshot,
        totalCredit,
        totalDebt,
      };
    })
    .filter((item) => item.totalCredit !== 0 || item.totalDebt !== 0)
    .sort((a, b) => b.totalCredit + b.totalDebt - (a.totalCredit + a.totalDebt))
    .slice(0, 100);

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
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/reports/daily?date=${dateInput(fromDate)}`}
            className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
          >
            تقرير اليوم PDF
          </Link>
        </div>

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

        <section className="grid gap-4 md:grid-cols-2">
          <SummaryCard title="إجمالي أرصدة الزبائن عند الشركة" value={walletTotalsLabel(walletSnapshot.totals.credit)} />
          <SummaryCard title="إجمالي الديون المطلوبة من الزبائن" value={walletTotalsLabel(walletSnapshot.totals.debt)} />
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">تقرير الأرصدة حسب العملة وطريقة الدفع</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الخانة</th>
                  <th>رصيد للزبون</th>
                  <th>دين على الزبون</th>
                </tr>
              </thead>
              <tbody>
                {walletSnapshot.rows.map((row) => (
                  <tr key={`${row.currency.id}-${row.paymentMethod}`}>
                    <td>{row.label}</td>
                    <td>{formatMoney(row.credit, row.currency)}</td>
                    <td>{formatMoney(row.debt, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">تقرير حسب الزبون</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الزبون</th>
                  <th>رصيد للزبون</th>
                  <th>دين على الزبون</th>
                </tr>
              </thead>
              <tbody>
                {customerWalletReports.map((item) => (
                  <tr key={item.person.id}>
                    <td>
                      <Link href={`/people/${item.person.id}`} className="font-bold text-indigo-600 hover:text-indigo-500">
                        {item.person.customerNo ? `${item.person.customerNo} - ` : ''}
                        {item.person.fullName}
                      </Link>
                    </td>
                    <td>{walletTotalsLabel(item.snapshot.totals.credit)}</td>
                    <td>{walletTotalsLabel(item.snapshot.totals.debt)}</td>
                  </tr>
                ))}
                {!customerWalletReports.length ? (
                  <tr>
                    <td colSpan={3} className="text-center text-slate-500">
                      لا توجد أرصدة أو ديون زبائن.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">تقرير التسويات</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الزبون</th>
                  <th>المستخدم</th>
                  <th>نوع التسوية</th>
                  <th>نوع الحساب</th>
                  <th>طريقة الدفع</th>
                  <th>المبلغ</th>
                  <th>السبب</th>
                </tr>
              </thead>
              <tbody>
                {walletSettlementRows.map((settlement) => (
                  <tr key={settlement.id}>
                    <td>{formatDateTime(settlement.occurredAt)}</td>
                    <td>{settlement.person?.fullName || '—'}</td>
                    <td>{settlement.username || 'system'}</td>
                    <td>{settlement.direction === 'ADD' ? 'إضافة' : 'خصم'}</td>
                    <td>{settlement.accountType === 'CREDIT' ? 'رصيد للزبون' : 'دين على الزبون'}</td>
                    <td>{walletMethodLabel(settlement.paymentMethod)}</td>
                    <td>{formatMoney(settlement.amount, settlement.currency)}</td>
                    <td>{settlement.reason}</td>
                  </tr>
                ))}
                {!walletSettlementRows.length ? (
                  <tr>
                    <td colSpan={8} className="text-center text-slate-500">
                      لا توجد تسويات في الفترة.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
                      {formatMoney(item.balance, item.currency)}
                    </td>
                    <td className="font-bold text-emerald-600">
                      {formatMoney(item.incoming, item.currency)}
                    </td>
                    <td className="font-bold text-red-600">
                      {formatMoney(item.outgoing, item.currency)}
                    </td>
                    <td className={item.difference >= 0 ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                      {formatMoney(item.difference, item.currency)}
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

        <section className="grid gap-5 lg:grid-cols-2">
          <MethodBreakdown title="تفصيل الدينار" methods={lydBreakdownMethods} summary={cashboxSummary} symbol="د.ل" />
          <MethodBreakdown title="تفصيل الدولار" methods={usdBreakdownMethods} summary={cashboxSummary} symbol="$" />
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
                    <td>{formatNumber(item._count)}</td>
                    <td>{formatMoney(item._sum.agreedAmount)}</td>
                    <td>{formatMoney(item._sum.receivedAmount)}</td>
                    <td>{formatMoney(item._sum.paidAmount)}</td>
                    <td>{formatMoney(item._sum.receivableAmount)}</td>
                    <td>{formatMoney(item._sum.payableAmount)}</td>
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
                    <td>{formatDateTime(transaction.transactionAt)}</td>
                    <td>{operationLabels[transaction.operationKind || ''] || transaction.type?.name || transaction.customType || '—'}</td>
                    <td>{transaction.executionType || '—'}</td>
                    <td>{operationDetails(transaction)}</td>
                    <td>{transaction.person?.fullName || '—'}</td>
                    <td>
                      {formatMoney(transaction.agreedAmount, transaction.currency.symbol)}
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
                  {formatMoney(item.denomination, '$')} - {sheinStatusLabels[item.status] || item.status}
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
      <div className="mt-2 text-2xl font-black">{typeof value === 'number' ? formatNumber(value) : value}</div>
    </div>
  );
}

function MethodBreakdown({
  title,
  methods,
  summary,
  symbol,
}: {
  title: string;
  methods: readonly string[];
  summary: Record<string, number>;
  symbol: string;
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 font-black">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {methods.map((method) => (
          <div key={method} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="text-sm text-slate-500">{detailedPaymentLabels[method as keyof typeof detailedPaymentLabels]}</div>
            <div className="mt-2 text-xl font-black">{formatMoney(summary[method] || 0, symbol)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
