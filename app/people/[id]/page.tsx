import Page from '@/components/Page';
import CustomerWalletClient from '@/components/CustomerWalletClient';
import { db } from '@/lib/db';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { buildWalletSnapshot } from '@/lib/customer-wallet';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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

function transactionDetails(transaction: any) {
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
  const [person, currencies] = await Promise.all([
    db.person.findUnique({
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
        walletSettlements: {
          include: { currency: true },
          orderBy: { occurredAt: 'desc' },
        },
      },
    }),
    db.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
  ]);

  if (!person) notFound();
  const walletSnapshot = buildWalletSnapshot(person.transactions, person.walletSettlements, currencies);

  return (
    <Page title={`${person.customerNo ? `${person.customerNo} - ` : ''}${person.fullName}`}>
      <h2 className="mb-4 font-black">معلومات الزبون</h2>
      <div className="grid gap-4 md:grid-cols-4">
        <Info title="رقم العميل" value={person.customerNo || '—'} />
        <Info title="التصنيف" value={categoryLabels[person.category] || person.category} />
        <Info title="الهاتف" value={person.phone || '—'} />
        <Info title="العنوان" value={person.address || '—'} />
        <Info title="معلومات إضافية" value={person.externalId || '—'} />
        <Info title="ملاحظات" value={person.notes || '—'} />
      </div>

      <CustomerWalletClient
        personId={person.id}
        snapshot={JSON.parse(JSON.stringify(walletSnapshot))}
        settlements={JSON.parse(JSON.stringify(person.walletSettlements))}
        currencies={JSON.parse(JSON.stringify(currencies))}
      />

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
                const isReceivedCardRegistration =
                  transaction.operationKind === 'CARD_OPERATION' &&
                  (transaction.operationDetails as any)?.action === 'RECEIVE_CARD';
                const remaining = isReceivedCardRegistration
                  ? transaction.agreedAmount.mul(0)
                  : transaction.agreedAmount.sub(transaction.receivedAmount).sub(transaction.paidAmount);
                return (
                  <tr key={transaction.id}>
                    <td>{transaction.number}</td>
                    <td>{operationLabels[transaction.operationKind || ''] || transaction.type?.name || transaction.customType || '—'}</td>
                    <td>{transaction.executionType || '—'}</td>
                    <td>{transactionDetails(transaction)}</td>
                    <td>
                      {formatMoney(transaction.agreedAmount, transaction.currency)}
                    </td>
                    <td>{formatMoney(transaction.receivedAmount, transaction.currency)}</td>
                    <td>{formatMoney(transaction.paidAmount, transaction.currency)}</td>
                    <td>{formatMoney(remaining.gt(0) ? remaining : 0, transaction.currency)}</td>
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
                  {formatNumber(batch.cardCount)} بطاقات - {formatDate(batch.receivedAt)}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  المتفق عليه لكل بطاقة: {formatMoney(batch.agreedAmountPerCard, batch.currency?.symbol || '')}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  الإجمالي: {formatMoney(batch.agreedAmountPerCard.mul(batch.cardCount), batch.currency?.symbol || '')}
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
                  فئة {formatMoney(card.denomination, '$')} - {card.status}
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
