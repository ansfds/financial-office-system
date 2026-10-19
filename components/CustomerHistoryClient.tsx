'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import CenteredDialog from './CenteredDialog';
import FastCardEntryModal from './FastCardEntryModal';
import CardOperationModal from './CardOperationModal';
import CustomerDeliveryModal from './CustomerDeliveryModal';
import { cardStatusLabels, cardEntryStatuses, cardMoneyGroups } from '@/lib/card-display';
import { cardOperationTypeLabels, isCardDeductionOperation } from '@/lib/customer-cards';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import WithdrawalBoxes from './WithdrawalBoxes';
export default function CustomerHistoryClient({ person, currencies }: { person: any; currencies: any[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(''),
    [add, setAdd] = useState(false),
    [delivery, setDelivery] = useState(false);
  const [action, setAction] = useState<{ card: any; operation?: any; initialType?: string } | null>(null);
  const [busy, setBusy] = useState('');
  const batches = person.cardBatches || [];
  const selected = batches.find((b: any) => b.id === selectedId);
  const deliveryRows = currencies
    .filter((c) => ['USD', 'LYD'].includes(c.code))
    .map((currency) => {
      const agreed = batches
        .flatMap((b: any) => b.cards.map((c: any) => ({ ...c, batch: b })))
        .filter(
          (c: any) =>
            c.status !== 'CANCELLED' && (c.settlementCurrencyId || c.batch.currencyId) === currency.id,
        )
        .reduce((n: number, c: any) => n + Number(c.agreedAmount), 0);
      const delivered = (person.cardDeliveries || [])
        .filter((d: any) => d.currencyId === currency.id)
        .reduce((n: number, d: any) => n + Number(d.amount), 0);
      return { currency, agreed, delivered, remaining: Math.max(agreed - delivered, 0) };
    });
  useEffect(() => {
    if (action) {
      const card = batches.flatMap((b: any) => b.cards).find((c: any) => c.id === action.card.id);
      if (!card) setAction(null);
    }
  }, [person]); // eslint-disable-line react-hooks/exhaustive-deps
  function refreshed() {
    setAction(null);
    setAdd(false);
    setDelivery(false);
    router.refresh();
  }
  async function removeOperation(card: any, operation: any) {
    if (!confirm('حذف السحبة وإعادة حساب البطاقة؟')) return;
    setBusy(operation.id);
    try {
      const response = await fetch(`/api/inventory/received-cards/${card.id}/operations/${operation.id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      refreshed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function setStatus(card: any, status: string) {
    if (status === card.status) return;
    if (status === 'SETTLED') {
      setAction({
        card: { ...card, batch: selected, currency: currencies.find((c) => c.code === 'USD') },
        initialType: 'FINAL_SETTLEMENT',
      });
      return;
    }
    setBusy(card.id);
    try {
      const response = await fetch(`/api/inventory/received-cards/${card.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      refreshed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="card mt-5 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-black">البطاقات — سجل المعاملات</h2>
        <div className="flex gap-3">
          <button onClick={() => setDelivery(true)} className="text-sm font-bold">
            تسليم للزبون
          </button>
          <button
            onClick={() => setAdd(true)}
            className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white"
          >
            + إضافة معاملة بطاقات
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {batches.map((batch: any) => {
          const cards = batch.cards || [];
          const groups = cardMoneyGroups(cards.map((c: any) => ({ ...c, batch })));
          const statuses = [...new Set(cards.map((c: any) => cardStatusLabels[c.status]))].join('، ');
          return (
            <button
              key={batch.id}
              onClick={() => setSelectedId(batch.id)}
              className="w-full rounded-lg border border-slate-200 p-3 text-right hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <strong>
                  {formatDate(batch.receivedAt)} · {cards.length} بطاقات
                </strong>
                <span className="text-slate-500">
                  {batch.entryTransaction?.notes === 'بيانات سابقة' ? 'بيانات سابقة · ' : ''}
                  {statuses}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span>
                  الإجمالي:{' '}
                  {formatMoney(
                    cards.reduce((n: number, c: any) => n + Number(c.valueUsd), 0),
                    '$',
                  )}
                </span>
                <span>
                  المسحوب:{' '}
                  {formatMoney(
                    cards.reduce((n: number, c: any) => n + Number(c.totalDeducted ?? c.receivedAmount), 0),
                    '$',
                  )}
                </span>
                {groups.map((g) => (
                  <span key={g.code}>المتفق: {formatMoney(g.agreed, g.code)}</span>
                ))}
              </div>
            </button>
          );
        })}
        {!batches.length && <p className="text-sm text-slate-500">لا توجد معاملات بطاقات.</p>}
      </div>
      {selected && (
        <CenteredDialog
          name="customer-cards"
          title={`معاملة ${formatDate(selected.receivedAt)} — ${selected.cards.length} بطاقات`}
          onClose={() => setSelectedId('')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {selected.cards.map((card: any) => {
              const operations = (card.operations || []).filter((o: any) => !o.deletedAt);
              const withdrawals = operations.filter((o: any) => isCardDeductionOperation(o.operationType));
              const currency = card.settlementCurrency || selected.currency;
              return (
                <article
                  key={card.id}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong dir="ltr" className="text-xl tracking-widest">
                      •••• {card.cardLast4 || '—'}
                    </strong>
                    <span className="text-xs font-bold">{cardStatusLabels[card.status]}</span>
                  </div>
                  <dl className="my-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      الإجمالي: <b>{formatMoney(card.valueUsd, '$')}</b>
                    </div>
                    <div>
                      المتفق: <b>{formatMoney(card.agreedAmount, currency || '$')}</b>
                    </div>
                    <div>
                      عمليات الخصم: <b>{withdrawals.length}</b>
                    </div>
                    <div>
                      تم سحب: <b>{formatMoney(card.totalDeducted ?? card.receivedAmount, '$')}</b>
                    </div>
                    <div>
                      المتبقي: <b>{formatMoney(card.remainingAmount, '$')}</b>
                    </div>
                  </dl>
                  <WithdrawalBoxes card={card} onSaved={() => router.refresh()} />
                  <label className="text-xs">
                    حالة البطاقة
                    <select
                      aria-label={`حالة ${card.cardLast4}`}
                      disabled={Boolean(busy)}
                      value={['COMPLETED'].includes(card.status) ? 'SETTLED' : card.status}
                      onChange={(e) => setStatus(card, e.target.value)}
                    >
                      {[...new Set([...cardEntryStatuses, card.status])].map((s) => (
                        <option key={s} value={s}>
                          {cardStatusLabels[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-2 flex justify-between gap-2 text-xs">
                    <button
                      className="font-bold text-blue-700"
                      onClick={() =>
                        setAction({
                          card: {
                            ...card,
                            batch: selected,
                            currency: currencies.find((c) => c.code === 'USD'),
                          },
                        })
                      }
                    >
                      + سحبة / عملية
                    </button>
                    <button
                      className="text-red-700"
                      disabled={Boolean(busy)}
                      onClick={async () => {
                        if (!confirm('حذف هذه البطاقة وأرشفة بياناتها؟')) return;
                        setBusy(card.id);
                        try {
                          const r = await fetch(`/api/inventory/received-cards/${card.id}`, {
                            method: 'DELETE',
                          });
                          if (!r.ok) throw new Error('تعذر حذف البطاقة');
                          refreshed();
                        } catch (e) {
                          toast.error((e as Error).message);
                        } finally {
                          setBusy('');
                        }
                      }}
                    >
                      حذف البطاقة
                    </button>
                  </div>
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer">السحبات والعمليات ({operations.length})</summary>
                    <div className="mt-2 space-y-2">
                      {operations.map((o: any) => (
                        <div key={o.id} className="rounded bg-slate-50 p-2 dark:bg-slate-800">
                          <div>
                            {(cardOperationTypeLabels as Record<string, string>)[o.operationType]} —{' '}
                            {formatMoney(o.amount, '$')}
                          </div>
                          <div className="text-slate-500">{formatDateTime(o.occurredAt)}</div>
                          <div className="mt-1 flex gap-3">
                            <button
                              onClick={() =>
                                setAction({
                                  card: {
                                    ...card,
                                    batch: selected,
                                    currency: currencies.find((c) => c.code === 'USD'),
                                  },
                                  operation: o,
                                })
                              }
                            >
                              تعديل
                            </button>
                            <button
                              disabled={Boolean(busy)}
                              onClick={() => removeOperation(card, o)}
                              className="text-red-700"
                            >
                              حذف
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        </CenteredDialog>
      )}
      {add && (
        <FastCardEntryModal
          people={[person]}
          selectedPerson={person}
          currencies={currencies}
          onClose={() => setAdd(false)}
          onSaved={refreshed}
        />
      )}
      {action && (
        <CardOperationModal
          card={action.card}
          operation={action.operation}
          onClose={() => setAction(null)}
          onSaved={refreshed}
          initialType={action.initialType || (action.card.status === 'CANCELLED' ? 'REACTIVATE' : 'INVOICE')}
        />
      )}
      {delivery && (
        <CustomerDeliveryModal
          person={person}
          rows={deliveryRows}
          currencies={currencies}
          onClose={() => setDelivery(false)}
          onSaved={refreshed}
        />
      )}
    </section>
  );
}
