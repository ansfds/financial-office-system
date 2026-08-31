'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatMoney, numberValue } from '@/lib/format';
import { detailedPaymentLabels } from '@/lib/payment-methods';
import { STANDARD_CUSTOMER_CARD_VALUE_USD } from '@/lib/customer-cards';

const statusLabels: Record<string, string> = {
  RECEIVED: 'غير مصفاة',
  IN_SETTLEMENT: 'قيد التصفية',
  PARTIAL: 'مصفاة جزئيا',
  SETTLED: 'مصفاة بالكامل',
  COMPLETED: 'مصفاة بالكامل',
  CANCELLED: 'ملغاة',
};

const statusOptions = [
  { value: 'RECEIVED', label: 'غير مصفاة' },
  { value: 'PARTIAL', label: 'مصفاة جزئيا' },
  { value: 'SETTLED', label: 'مصفاة بالكامل' },
  { value: 'CANCELLED', label: 'ملغاة' },
];

const settlementMethods = ['USD_CASH', 'USD_TRANSFER', 'USD_CARD', 'LYD_CASH', 'LYD_TRANSFER', 'LYD_OFFICE_TRANSFER', 'LYD_CARD'];

const settlementStatuses = new Set(['PARTIAL', 'SETTLED', 'COMPLETED']);
const defaultOriginalCardValue = String(STANDARD_CUSTOMER_CARD_VALUE_USD);

function decimal(value: any) {
  return numberValue(value);
}

function cardBaseAmount(card: any) {
  return decimal(card.valueUsd) > 0 ? decimal(card.valueUsd) : 0;
}

function cardRemaining(card: any) {
  return Math.max(cardBaseAmount(card) - decimal(card.receivedAmount), 0);
}

function defaultMethodForCurrency(currencyCode?: string | null) {
  return currencyCode === 'LYD' ? 'LYD_CASH' : 'USD_CASH';
}

function currencyCodeForMethod(method?: string | null) {
  return method?.startsWith('LYD') ? 'LYD' : 'USD';
}

function moneyBucketsLabel(buckets: Map<string, { amount: number; symbol: string }>) {
  const items = Array.from(buckets.values()).filter((item) => item.amount > 0);
  return items.length ? items.map((item) => formatMoney(item.amount, item.symbol)).join('، ') : '0';
}

export default function ReceivedCardsClient({
  people,
  currencies,
  initialBatches,
}: {
  people: any[];
  currencies: any[];
  initialBatches: any[];
}) {
  const settlementCurrencies = useMemo(
    () => currencies.filter((currency) => ['USD', 'LYD'].includes(currency.code)),
    [currencies],
  );
  const usdCurrency = settlementCurrencies.find((currency) => currency.code === 'USD');
  const defaultCurrencyId = usdCurrency?.id || settlementCurrencies[0]?.id || '';
  const [batches, setBatches] = useState<any[]>(initialBatches);
  const [openBatchId, setOpenBatchId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [form, setForm] = useState({
    personId: '',
    currencyId: '',
    cardCount: '1',
    valueUsdPerCard: defaultOriginalCardValue,
    agreedAmountPerCard: '',
    commonBankName: '',
    notes: '',
  });

  useEffect(() => {
    setBatches(initialBatches);
    setForm((value) => ({
      ...value,
      personId: people[0]?.id || '',
      currencyId: defaultCurrencyId,
    }));

    const batchId = new URLSearchParams(window.location.search).get('batchId');
    if (batchId) setOpenBatchId(batchId);
  }, [people, defaultCurrencyId, initialBatches]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/inventory/received-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personId: form.personId,
        currencyId: form.currencyId || null,
        cardCount: Number(form.cardCount),
        valueUsdPerCard: Number(form.valueUsdPerCard || defaultOriginalCardValue),
        agreedAmountPerCard: Number(form.agreedAmountPerCard),
        commonBankName: form.commonBankName || undefined,
        notes: form.notes || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر إضافة البطاقات');
    toast.success('تم تسجيل دفعة البطاقات بدون تغيير رصيد الصندوق');
    setForm({
      personId: people[0]?.id || '',
      currencyId: defaultCurrencyId,
      cardCount: '1',
      valueUsdPerCard: defaultOriginalCardValue,
      agreedAmountPerCard: '',
      commonBankName: '',
      notes: '',
    });
    setOpenBatchId(data.id);
    setBatches((items) => [data, ...items.filter((item) => item.id !== data.id)]);
  }

  function updateCard(batchId: string, cardId: string, patch: any) {
    setBatches((items) =>
      items.map((batch) =>
        batch.id === batchId
          ? {
              ...batch,
              cards: batch.cards.map((card: any) => (card.id === cardId ? { ...card, ...patch } : card)),
            }
          : batch,
      ),
    );
  }

  async function saveCard(batchId: string, card: any) {
    const shouldSettle = settlementStatuses.has(card.status);
    const method =
      card.settlementPaymentMethod ||
      defaultMethodForCurrency(card.settlementCurrency?.code || batches.find((item) => item.id === batchId)?.currency?.code);
    const settlementAmount = decimal(card.settlementAmount);
    const withdrawnAmount = decimal(card.receivedAmount);
    const baseAmount = cardBaseAmount(card);

    if (withdrawnAmount > baseAmount) return toast.error('المبلغ المسحوب لا يمكن أن يكون أكبر من قيمة البطاقة');
    if (shouldSettle && (settlementAmount <= 0 || !method)) return toast.error('تصفية البطاقة تتطلب المبلغ المسلم وطريقة الدفع');

    setSavingId(card.id);
    const response = await fetch(`/api/inventory/received-cards/${card.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankName: card.bankName || null,
        cardLast4: card.cardLast4 || null,
        valueUsd: decimal(card.valueUsd),
        agreedAmount: decimal(card.agreedAmount),
        receivedAmount: withdrawnAmount,
        settlementAmount: shouldSettle ? settlementAmount : null,
        settlementPaymentMethod: shouldSettle ? method : null,
        status: card.status || 'RECEIVED',
        verificationReceived: Boolean(card.verificationReceived),
        secureInternalNote: card.secureInternalNote || null,
        notes: card.notes || null,
      }),
    });
    const data = await response.json();
    setSavingId('');
    if (!response.ok) return toast.error(data.error || 'تعذر تعديل البطاقة');
    updateCard(batchId, card.id, data);
    if (data.cashboxWarning) toast.warning(data.cashboxWarning);
    toast.success(shouldSettle ? 'تم حفظ التصفية وتحديث الصندوق' : 'تم حفظ البطاقة بدون أثر مالي');
  }

  function batchSummary(batch: any) {
    const symbol = batch.currency?.symbol || '$';
    const perCard = formatMoney(batch.agreedAmountPerCard, symbol);
    const total = formatMoney(decimal(batch.agreedAmountPerCard) * decimal(batch.cardCount), symbol);
    return `استلام ${batch.cardCount} بطاقات، قيمة كل بطاقة ${perCard}، الإجمالي ${total} #${batch.id.slice(-4).toUpperCase()}`;
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="card grid gap-4 p-5 md:grid-cols-3">
        <select value={form.personId} onChange={(event) => setForm({ ...form, personId: event.target.value })}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.customerNo ? `${person.customerNo} - ` : ''}
              {person.fullName}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          placeholder="عدد البطاقات"
          value={form.cardCount}
          onChange={(event) => setForm({ ...form, cardCount: event.target.value })}
        />
        <input
          type="number"
          min="0"
          step="0.000001"
          placeholder="قيمة البطاقة الأصلية $"
          value={form.valueUsdPerCard}
          onChange={(event) => setForm({ ...form, valueUsdPerCard: event.target.value })}
        />
        <input
          type="number"
          min="0"
          step="0.000001"
          placeholder="قيمة البطاقة المتفق عليها"
          value={form.agreedAmountPerCard}
          onChange={(event) => setForm({ ...form, agreedAmountPerCard: event.target.value })}
        />
        <select value={form.currencyId} onChange={(event) => setForm({ ...form, currencyId: event.target.value })}>
          <option value="">عملة البطاقة</option>
          {settlementCurrencies.map((currency) => (
            <option key={currency.id} value={currency.id}>
              {currency.name}
            </option>
          ))}
        </select>
        <input
          placeholder="مصرف البطاقة"
          value={form.commonBankName}
          onChange={(event) => setForm({ ...form, commonBankName: event.target.value })}
        />
        <button className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-bold text-white">
          <Plus size={18} />
          إضافة دفعة
        </button>
        <input
          className="md:col-span-3"
          placeholder="ملاحظات"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </form>

      <div className="space-y-3">
        {batches.map((batch) => {
          const settledBuckets = batch.cards.reduce((buckets: Map<string, { amount: number; symbol: string }>, card: any) => {
            if (!settlementStatuses.has(card.status)) return buckets;
            const currencyCode = card.settlementCurrency?.code || currencyCodeForMethod(card.settlementPaymentMethod);
            const currency = settlementCurrencies.find((item) => item.code === currencyCode);
            const current = buckets.get(currencyCode) || { amount: 0, symbol: currency?.symbol || card.settlementCurrency?.symbol || '' };
            current.amount += decimal(card.settlementAmount);
            buckets.set(currencyCode, current);
            return buckets;
          }, new Map<string, { amount: number; symbol: string }>());
          const remainingTotal = batch.cards.reduce((sum: number, card: any) => sum + cardRemaining(card), 0);

          return (
            <div key={batch.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenBatchId(openBatchId === batch.id ? '' : batch.id)}
                className="grid w-full gap-3 p-4 text-right md:grid-cols-[1fr_auto_auto_auto]"
              >
                <div>
                  <div className="font-black">{batchSummary(batch)}</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {batch.person?.customerNo ? `${batch.person.customerNo} - ` : ''}
                    {batch.person?.fullName} · {formatDate(batch.receivedAt)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">المصفى فعليا</div>
                  <div className="font-black">{moneyBucketsLabel(settledBuckets)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">المتبقي داخل البطاقات</div>
                  <div className="font-black">{formatMoney(remainingTotal, '$')}</div>
                </div>
                <div className="flex items-center gap-2 font-bold text-indigo-600">
                  عرض البطاقات
                  <ChevronDown size={18} />
                </div>
              </button>

              {openBatchId === batch.id ? (
                <div className="border-t border-slate-200 p-4 dark:border-slate-800">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>رقم البطاقة</th>
                          <th>المصرف</th>
                          <th>آخر 4 أرقام</th>
                          <th>القيمة الأصلية</th>
                          <th>القيمة المتفق عليها</th>
                          <th>المسحوب من البطاقة</th>
                          <th>المسلم للزبون</th>
                          <th>المتبقي</th>
                          <th>طريقة الدفع</th>
                          <th>الحالة</th>
                          <th>التصفية</th>
                          <th>ملاحظات</th>
                          <th>حفظ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.cards.map((card: any) => (
                          <tr key={card.id}>
                            <td className="font-black">#{card.sequence}</td>
                            <td>
                              <input
                                value={card.bankName || ''}
                                onChange={(event) => updateCard(batch.id, card.id, { bankName: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                inputMode="numeric"
                                maxLength={4}
                                value={card.cardLast4 || ''}
                                onChange={(event) =>
                                  updateCard(batch.id, card.id, {
                                    cardLast4: event.target.value.replace(/\D/g, '').slice(0, 4),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={card.valueUsd?.toString() || '0'}
                                onChange={(event) => updateCard(batch.id, card.id, { valueUsd: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={card.agreedAmount?.toString() || ''}
                                onChange={(event) => updateCard(batch.id, card.id, { agreedAmount: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={card.receivedAmount?.toString() || '0'}
                                onChange={(event) => updateCard(batch.id, card.id, { receivedAmount: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={card.settlementAmount?.toString() || ''}
                                onChange={(event) => updateCard(batch.id, card.id, { settlementAmount: event.target.value })}
                              />
                            </td>
                            <td className="font-bold text-slate-700 dark:text-slate-200">
                              {formatMoney(cardRemaining(card), '$')}
                            </td>
                            <td>
                              <select
                                value={card.settlementPaymentMethod || defaultMethodForCurrency(card.settlementCurrency?.code || batch.currency?.code)}
                                onChange={(event) =>
                                  updateCard(batch.id, card.id, { settlementPaymentMethod: event.target.value })
                                }
                              >
                                {settlementMethods.map((value) => (
                                  <option key={value} value={value}>
                                    {detailedPaymentLabels[value as keyof typeof detailedPaymentLabels]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                value={card.status}
                                onChange={(event) => updateCard(batch.id, card.id, { status: event.target.value })}
                              >
                                {statusOptions.map((status) => (
                                  <option key={status.value} value={status.value}>
                                    {status.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                                {statusLabels[card.status] || card.status}
                              </span>
                            </td>
                            <td>
                              <input
                                value={card.notes || ''}
                                onChange={(event) => updateCard(batch.id, card.id, { notes: event.target.value })}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => saveCard(batch.id, card)}
                                disabled={savingId === card.id}
                                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-indigo-400"
                              >
                                {savingId === card.id ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                                {savingId === card.id ? 'جار...' : 'حفظ'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {!batches.length ? <div className="card p-6 text-center text-slate-500">لا توجد بطاقات مستلمة بعد</div> : null}
      </div>
    </div>
  );
}
