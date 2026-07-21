import Page from '@/components/Page';
import { db } from '@/lib/db';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const categoryLabels: Record<string, string> = {
  VIP: 'عميل مميز',
  REGULAR: 'عميل عادي',
};

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

function numberValue(value: any) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function transactionDetails(transaction: any) {
  const details = transaction.operationDetails || {};
  const symbol = transaction.currency?.symbol || '';

  if (transaction.operationKind === 'CARD_OPERATION') {
    return `${numberValue(details.cardCount).toLocaleString('en-US')} بطاقات × ${numberValue(details.cardValue).toLocaleString(
      'en-US',
    )} ${symbol} = ${numberValue(details.cardTotal).toLocaleString('en-US')} ${symbol}`;
  }

  if (transaction.operationKind === 'USDT') {
    return `${numberValue(details.usdtAmount).toLocaleString('en-US')} USDT عبر ${details.network || '—'}`;
  }

  if (transaction.operationKind === 'MONEY_TRANSFER') {
    return `${details.receiverName || '—'} / ${details.destination || '—'}`;
  }

  if (transaction.operationKind === 'EXPENSE') {
    return `${details.payee || '—'} - ${details.expenseType || '—'}`;
  }

  return transaction.executionType || transaction.description || '—';
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await db.person.findUnique({
    where: { id },
    include: {
      transactions: {
        where: { deletedAt: null },
        include: { currency: true, type: true },
        orderBy: { transactionAt: 'desc' },
      },
      cardBatches: {
        include: { cards: { orderBy: { sequence: 'asc' } }, currency: true },
        orderBy: { receivedAt: 'desc' },
      },
      sheinSales: {
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  if (!person) notFound();

  return (
    <Page title={`${person.customerNo ? `${person.customerNo} - ` : ''}${person.fullName}`}>
      <div className="grid gap-4 md:grid-cols-4">
        <Info title="رقم العميل" value={person.customerNo || '—'} />
        <Info title="التصنيف" value={categoryLabels[person.category] || person.category} />
        <Info title="الهاتف" value={person.phone || '—'} />
        <Info title="العنوان" value={person.address || '—'} />
        <Info title="معلومات إضافية" value={person.externalId || '—'} />
        <Info title="ملاحظات" value={person.notes || '—'} />
      </div>

      <div className="card mt-6 p-5">
        <h2 className="mb-4 font-black">المعاملات</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>النوع</th>
                <th>نوع التنفيذ</th>
                <th>التفاصيل</th>
                <th>المتفق عليه</th>
                <th>المستلم</th>
                <th>المدفوع</th>
                <th>المتبقي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {person.transactions.map((transaction) => {
                const remaining = transaction.agreedAmount
                  .sub(transaction.receivedAmount)
                  .sub(transaction.paidAmount);
                return (
                  <tr key={transaction.id}>
                    <td>{transaction.number}</td>
                    <td>{operationLabels[transaction.operationKind || ''] || transaction.type?.name || transaction.customType || '—'}</td>
                    <td>{transaction.executionType || '—'}</td>
                    <td>{transactionDetails(transaction)}</td>
                    <td>
                      {transaction.agreedAmount.toString()} {transaction.currency.symbol}
                    </td>
                    <td>{transaction.receivedAmount.toString()}</td>
                    <td>{transaction.paidAmount.toString()}</td>
                    <td>{remaining.gt(0) ? remaining.toString() : '0'}</td>
                    <td>{remaining.lte(0) ? 'مكتمل' : transaction.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 font-black">البطاقات المستلمة</h2>
          <div className="space-y-3">
            {person.cardBatches.map((batch) => (
              <div key={batch.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="font-bold">
                  {batch.cardCount} بطاقات - {new Date(batch.receivedAt).toLocaleDateString('en-GB')}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  المتفق عليه لكل بطاقة: {batch.agreedAmountPerCard.toString()} {batch.currency?.symbol || ''}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  الإجمالي: {batch.agreedAmountPerCard.mul(batch.cardCount).toString()} {batch.currency?.symbol || ''}
                </div>
              </div>
            ))}
            {!person.cardBatches.length ? <div className="text-sm text-slate-500">لا توجد بطاقات مستلمة.</div> : null}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 font-black">كروت شي إن المباعة</h2>
          <div className="space-y-3">
            {person.sheinSales.map((card) => (
              <div key={card.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="font-bold">{card.code}</div>
                <div className="mt-2 text-sm text-slate-500">
                  فئة {card.denomination.toString()} - {card.status}
                </div>
              </div>
            ))}
            {!person.sheinSales.length ? <div className="text-sm text-slate-500">لا توجد كروت شي إن مرتبطة.</div> : null}
          </div>
        </div>
      </div>
    </Page>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 font-black">{value}</div>
    </div>
  );
}
