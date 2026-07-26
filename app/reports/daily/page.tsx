import DailyReportActions from '@/components/DailyReportActions';
import Page from '@/components/Page';
import { summarizeCashboxByMethod } from '@/lib/cashbox-summary';
import { db } from '@/lib/db';
import { formatDate, formatDateTime, formatMoney, formatNumber, numberValue } from '@/lib/format';
import { detailedPaymentLabels, lydBreakdownMethods, usdBreakdownMethods } from '@/lib/payment-methods';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const settledStatuses = ['PARTIAL', 'SETTLED', 'COMPLETED'] as const;

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

function dayRange(dateParam?: string) {
  const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
  date.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start: date, end, key: date.toISOString().slice(0, 10) };
}

function movementTotal(movements: any[], code: string, direction: 'IN' | 'OUT') {
  return movements
    .filter((movement) => movement.currency?.code === code && movement.direction === direction)
    .reduce((sum, movement) => sum + numberValue(movement.amount), 0);
}

export default async function DailyReportPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const { start, end, key } = dayRange(params.date);
  const transactionWhere = { deletedAt: null, transactionAt: { gte: start, lte: end } };

  const [
    transactions,
    newCustomers,
    movements,
    sheinSold,
    receivedBatches,
    settledCards,
    expenses,
  ] = await Promise.all([
    db.financialTransaction.findMany({
      where: transactionWhere,
      select: {
        id: true,
        number: true,
        transactionAt: true,
        operationKind: true,
        customType: true,
        executionType: true,
        description: true,
        agreedAmount: true,
        receivedAmount: true,
        paidAmount: true,
        person: { select: { fullName: true, customerNo: true } },
        currency: { select: { code: true, name: true, symbol: true } },
        type: { select: { name: true } },
      },
      orderBy: { transactionAt: 'asc' },
      take: 500,
    }),
    db.person.count({ where: { createdAt: { gte: start, lte: end }, deletedAt: null } }),
    db.cashboxMovement.findMany({
      where: { occurredAt: { gte: start, lte: end } },
      include: {
        currency: true,
        transaction: { select: { operationKind: true, operationDetails: true, sheinPaymentMethod: true } },
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    }),
    db.sheinCardSale.aggregate({
      where: { occurredAt: { gte: start, lte: end } },
      _sum: { cardCount: true, totalAmount: true },
    }),
    db.receivedCardBatch.aggregate({
      where: { receivedAt: { gte: start, lte: end } },
      _sum: { cardCount: true },
    }),
    db.receivedCustomerCard.count({
      where: { status: { in: [...settledStatuses] }, updatedAt: { gte: start, lte: end } },
    }),
    db.financialTransaction.aggregate({
      where: { ...transactionWhere, operationKind: 'EXPENSE' },
      _sum: { paidAmount: true },
    }),
  ]);

  const summary = summarizeCashboxByMethod(movements);
  const usdIn = movementTotal(movements, 'USD', 'IN');
  const usdOut = movementTotal(movements, 'USD', 'OUT');
  const lydIn = movementTotal(movements, 'LYD', 'IN');
  const lydOut = movementTotal(movements, 'LYD', 'OUT');
  const usdtIn = movementTotal(movements, 'USDT', 'IN');
  const usdtOut = movementTotal(movements, 'USDT', 'OUT');
  const netByCurrency = ['LYD', 'USD', 'USDT']
    .map((code) => {
      const currencyMovements = movements.filter((movement) => movement.currency?.code === code);
      const symbol = currencyMovements[0]?.currency?.symbol || code;
      const net = currencyMovements.reduce((sum, movement) => {
        if (movement.direction === 'IN') return sum + numberValue(movement.amount);
        if (movement.direction === 'OUT') return sum - numberValue(movement.amount);
        return sum;
      }, 0);
      return `${formatMoney(net, symbol)}`;
    })
    .join('، ');

  return (
    <Page title="تقرير اليوم PDF">
      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">تاريخ التقرير</label>
            <input name="date" type="date" defaultValue={key} />
          </div>
          <button className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950">
            عرض التقرير
          </button>
        </form>
        <DailyReportActions />
        <Link
          href="/reports"
          className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          رجوع للتقارير
        </Link>
      </div>

      <article className="daily-report grid gap-5">
        <section className="card p-6">
          <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black">تقرير حركة يوم {formatDate(start)}</h2>
              <p className="mt-1 text-sm text-slate-500">شركة الوسيط العالمي للحوالات المالية</p>
            </div>
            <div className="text-sm font-bold text-slate-500">{formatDateTime(new Date())}</div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ReportCard title="عدد المعاملات" value={formatNumber(transactions.length)} />
            <ReportCard title="عدد الزبائن الجدد" value={formatNumber(newCustomers)} />
            <ReportCard title="إجمالي الدولار الداخل" value={formatMoney(usdIn, '$')} />
            <ReportCard title="إجمالي الدولار الخارج" value={formatMoney(usdOut, '$')} />
            <ReportCard title="إجمالي الدينار الداخل" value={formatMoney(lydIn, 'د.ل')} />
            <ReportCard title="إجمالي الدينار الخارج" value={formatMoney(lydOut, 'د.ل')} />
            <ReportCard title="إجمالي عمليات USDT" value={`${formatMoney(usdtIn, 'USDT')} / ${formatMoney(usdtOut, 'USDT')}`} />
            <ReportCard title="صافي حركة الصندوق" value={netByCurrency || '0'} />
            <ReportCard title="كروت شي إن المباعة" value={formatNumber(sheinSold._sum.cardCount || 0)} />
            <ReportCard title="البطاقات المستلمة" value={formatNumber(receivedBatches._sum.cardCount || 0)} />
            <ReportCard title="البطاقات المصفاة" value={formatNumber(settledCards)} />
            <ReportCard title="إجمالي المصروفات" value={formatMoney(expenses._sum.paidAmount || 0)} />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Breakdown title="تفصيل الدينار" methods={lydBreakdownMethods} summary={summary} symbol="د.ل" />
          <Breakdown title="تفصيل الدولار" methods={usdBreakdownMethods} summary={summary} symbol="$" />
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">قائمة مختصرة بكل معاملات اليوم</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>الرقم</th>
                  <th>الزبون</th>
                  <th>النوع</th>
                  <th>المستلم</th>
                  <th>المدفوع</th>
                  <th>الوصف</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatDateTime(transaction.transactionAt)}</td>
                    <td>{transaction.number}</td>
                    <td>
                      {transaction.person
                        ? `${transaction.person.customerNo ? `${transaction.person.customerNo} - ` : ''}${transaction.person.fullName}`
                        : '—'}
                    </td>
                    <td>{operationLabels[transaction.operationKind || ''] || transaction.type?.name || transaction.customType || '—'}</td>
                    <td>{formatMoney(transaction.receivedAmount, transaction.currency.symbol)}</td>
                    <td>{formatMoney(transaction.paidAmount, transaction.currency.symbol)}</td>
                    <td>{transaction.executionType || transaction.description || '—'}</td>
                  </tr>
                ))}
                {!transactions.length ? (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-500">
                      لا توجد معاملات في هذا اليوم
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </article>
    </Page>
  );
}

function ReportCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-xl font-black">{value}</div>
    </div>
  );
}

function Breakdown({
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
