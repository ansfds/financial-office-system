import Page from '@/components/Page';
import CustomerWalletClient from '@/components/CustomerWalletClient';
import { db } from '@/lib/db';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { buildWalletSnapshot } from '@/lib/customer-wallet';
import { currencySelect, personBasicSelect } from '@/lib/received-card-selects';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const categoryLabels: Record<string, string> = {
  VIP: 'عميل مميز',
  REGULAR: 'عميل عادي',
};

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [person, currencies] = await Promise.all([
    db.person.findUnique({
      where: { id },
      select: {
        ...personBasicSelect,
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
            currency: { select: currencySelect },
          },
          orderBy: { transactionAt: 'desc' },
        },
        cardBatches: {
          select: {
            id: true,
            receivedAt: true,
            agreedAmountPerCard: true,
            currency: { select: currencySelect },
            cards: {
              where: { deletedAt: null },
              select: {
                id: true,
                publicCode: true,
                sequence: true,
                cardLast4: true,
                status: true,
                receivedAmount: true,
                valueUsd: true,
                agreedAmount: true,
                remainingAmount: true,
              },
              orderBy: { sequence: 'asc' },
            },
          },
          orderBy: { receivedAt: 'desc' },
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
        <h2 className="mb-4 font-black">البطاقات</h2>
        <div className="space-y-3">
          {person.cardBatches.map((batch) => (
            <div key={batch.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="font-bold">
                {formatNumber(batch.cards.length)} بطاقات - {formatDate(batch.receivedAt)}
              </div>
              <div className="mt-2 text-sm text-slate-500">
                المتفق عليه لكل بطاقة: {formatMoney(batch.agreedAmountPerCard, batch.currency?.symbol || '')}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {batch.cards.map((card) => (
                  <div key={card.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                    <div className="font-black">{card.publicCode || `#C${String(card.sequence).padStart(4, '0')}`}</div>
                    <div className="mt-1 text-slate-500">آخر 4 أرقام: {card.cardLast4 || '—'}</div>
                    <div className="mt-1 text-slate-500">الحالة: {card.status}</div>
                    <div className="mt-1 text-slate-500">المسحوب: {formatMoney(card.receivedAmount, batch.currency?.symbol || '')}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!person.cardBatches.length ? <div className="text-sm text-slate-500">لا توجد بطاقات.</div> : null}
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
