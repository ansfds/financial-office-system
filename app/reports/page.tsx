import Page from '@/components/Page';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
  RECEIVED: 'مستلمة',
  IN_SETTLEMENT: 'قيد التصفية',
  SETTLED: 'تمت التصفية',
  PARTIAL: 'جزئية',
  COMPLETED: 'مكتملة',
  CANCELLED: 'ملغاة',
};

function amount(value: any) {
  return Number(value || 0);
}

export default async function ReportsPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    transactionSummary,
    currencies,
    latestBalances,
    customerSummary,
    sheinSummary,
    receivedCardSummary,
    todayMovements,
  ] = await Promise.all([
    db.financialTransaction.groupBy({
      by: ['currencyId', 'status'],
      where: { deletedAt: null },
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
    db.receivedCustomerCard.groupBy({
      by: ['status'],
      _count: true,
    }),
    db.cashboxMovement.findMany({
      where: { occurredAt: { gte: today } },
      include: { currency: true },
      orderBy: { occurredAt: 'desc' },
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
  const receivedCards = receivedCardSummary
    .filter((item) => item.status !== 'CANCELLED')
    .reduce((sum, item) => sum + item._count, 0);
  const settledCards = receivedCardSummary
    .filter((item) => ['SETTLED', 'COMPLETED'].includes(item.status))
    .reduce((sum, item) => sum + item._count, 0);

  return (
    <Page title="التقارير">
      <div className="grid gap-5">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="الكروت المباعة" value={sheinSold} />
          <SummaryCard title="الكروت المتوفرة" value={sheinAvailable} />
          <SummaryCard title="البطاقات المستلمة" value={receivedCards} />
          <SummaryCard title="البطاقات التي تمت تصفيتها" value={settledCards} />
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">ملخص اليوم</h2>
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
            {receivedCardSummary.map((item) => (
              <div key={item.status} className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
                <span>{receivedStatusLabels[item.status] || item.status}</span>
                <b>{item._count}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}

function SummaryCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black">{value.toLocaleString('en-US')}</div>
    </div>
  );
}
