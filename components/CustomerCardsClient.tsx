'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cardState, cardStateDefinitions } from '@/lib/card-states';
import { cardStatusLabels } from '@/lib/card-display';
import { formatDate, formatMoney } from '@/lib/format';
import WithdrawalBoxes from './WithdrawalBoxes';
import FastCardEntryModal from './FastCardEntryModal';
export default function CustomerCardsClient({
  person,
  currencies,
  initialQuery = '',
  initialState = '',
}: {
  person: any;
  currencies: any[];
  initialQuery?: string;
  initialState?: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(person),
    [q, setQ] = useState(initialQuery),
    [state, setState] = useState(initialState),
    [entry, setEntry] = useState(false),
    [busy, setBusy] = useState('');
  useEffect(() => setCurrent(person), [person]);
  function update(card: any) {
    setCurrent((previous: any) => ({
      ...previous,
      cardBatches: previous.cardBatches.map((b: any) => ({
        ...b,
        cards: b.cards.map((c: any) => (c.id === card.id ? card : c)),
      })),
    }));
  }
  async function status(card: any, value: string) {
    setBusy(card.id);
    try {
      const response = await fetch(`/api/inventory/received-cards/${card.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      update(result);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove(card: any) {
    if (!confirm('حذف البطاقة من بيانات العمل وأرشفتها؟')) return;
    setBusy(card.id);
    try {
      const response = await fetch(`/api/inventory/received-cards/${card.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('تعذر حذف البطاقة');
      setCurrent((previous: any) => ({
        ...previous,
        cardBatches: previous.cardBatches.map((b: any) => ({
          ...b,
          cards: b.cards.filter((c: any) => c.id !== card.id),
        })),
      }));
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const needle = q.trim().toLowerCase();
  const ownerMatches = [current.fullName, current.phone, current.phoneSecondary].some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(needle),
  );
  const batches = current.cardBatches
    .map((b: any) => ({
      ...b,
      cards: [...b.cards]
        .sort(
          (a: any, c: any) =>
            new Date(c.createdAt).getTime() - new Date(a.createdAt).getTime() || c.sequence - a.sequence,
        )
        .filter(
          (c: any) =>
            (!state || cardState(c.status) === state) &&
            (!needle || ownerMatches || String(c.cardLast4 || '').includes(needle)),
        ),
    }))
    .filter((b: any) => b.cards.length);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm text-blue-700 dark:text-blue-300" href="/cards">
          ← جميع أصحاب البطاقات
        </Link>
        <bdi dir="ltr" className="text-sm text-slate-500">
          {person.phone || '—'}
        </bdi>
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          aria-label="البحث داخل بطاقات الزبون"
          placeholder="اسم الزبون أو الهاتف أو آخر 4 أرقام"
          className="min-w-48 flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="w-auto"
          aria-label="فلترة بطاقات الزبون"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">الكل</option>
          {cardStateDefinitions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setEntry(true)}
          className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white"
        >
          + إضافة بطاقات
        </button>
      </div>
      <div className="space-y-5">
        {batches.map((batch: any) => (
          <section key={batch.id} data-card-batch={batch.id}>
            <h2 className="mb-2 text-sm font-bold text-slate-500">
              {formatDate(batch.receivedAt)} · {batch.cards.length} بطاقات
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {batch.cards.map((card: any) => {
                const definition = cardStateDefinitions.find((s) => s.key === cardState(card.status))!;
                return (
                  <article key={card.id} data-customer-card={card.id} className="card space-y-3 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <strong dir="ltr" className="text-xl tracking-widest">
                        •••• {card.cardLast4 || '—'}
                      </strong>
                      <span
                        className={`text-xs font-bold ${definition.color}`}
                        data-card-status={definition.key}
                      >
                        {cardStatusLabels[card.status]}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <span>
                        الإجمالي: <b>{formatMoney(card.valueUsd, '$')}</b>
                      </span>
                      <span>
                        المتفق:{' '}
                        <b>
                          {formatMoney(card.agreedAmount, card.settlementCurrency || batch.currency || '$')}
                        </b>
                      </span>
                    </div>
                    <WithdrawalBoxes card={card} onSaved={update} />
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`تغيير حالة ${card.cardLast4}`}
                        disabled={busy === card.id}
                        value={
                          ['CANCELLED', 'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE'].includes(card.status)
                            ? card.status
                            : 'RECEIVED'
                        }
                        className="min-h-9 flex-1 py-1 text-xs"
                        onChange={(e) => status(card, e.target.value)}
                      >
                        <option value="RECEIVED">الحالة التلقائية</option>
                        <option value="CANCELLED">ملغية</option>
                        <option value="PAYMENT_FAILED">فشل الدفع</option>
                        <option value="INSUFFICIENT_BALANCE">رصيد غير كافي</option>
                      </select>
                      <button
                        className="px-2 text-xs text-red-700"
                        disabled={busy === card.id}
                        onClick={() => remove(card)}
                      >
                        حذف
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {!batches.length && <p className="card p-5 text-sm text-slate-500">لا توجد بطاقات مطابقة.</p>}
      </div>
      {entry && (
        <FastCardEntryModal
          people={[person]}
          selectedPerson={person}
          currencies={currencies}
          onClose={() => setEntry(false)}
          onSaved={() => {
            setEntry(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
