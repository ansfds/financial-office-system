'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';

const statusLabels: Record<string, string> = {
  RECEIVED: 'مستلمة',
  IN_SETTLEMENT: 'قيد التصفية',
  SETTLED: 'تمت التصفية',
  PARTIAL: 'جزئية',
  COMPLETED: 'مكتملة',
  CANCELLED: 'ملغاة',
};

const statusOptions = [
  { value: 'RECEIVED', label: 'مستلمة' },
  { value: 'IN_SETTLEMENT', label: 'قيد التصفية' },
  { value: 'SETTLED', label: 'تمت التصفية' },
  { value: 'CANCELLED', label: 'ملغاة' },
];

function decimal(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const defaultSettlementCurrencyId =
    settlementCurrencies.find((currency) => currency.code === 'USD')?.id || settlementCurrencies[0]?.id || '';
  const [batches, setBatches] = useState<any[]>(initialBatches);
  const [openBatchId, setOpenBatchId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [form, setForm] = useState({
    personId: '',
    currencyId: '',
    cardCount: '1',
    valueUsdPerCard: '',
    agreedAmountPerCard: '',
    commonBankName: '',
    notes: '',
  });

  async function load() {
    const response = await fetch('/api/inventory/received-cards');
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر تحميل البطاقات المستلمة');
    setBatches(data);
  }

  useEffect(() => {
    setBatches(initialBatches);
    setForm((value) => ({
      ...value,
      personId: people[0]?.id || '',
      currencyId: defaultSettlementCurrencyId,
    }));
  }, [people, defaultSettlementCurrencyId, initialBatches]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/inventory/received-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personId: form.personId,
        currencyId: form.currencyId || null,
        cardCount: Number(form.cardCount),
        valueUsdPerCard: Number(form.valueUsdPerCard || 0),
        agreedAmountPerCard: Number(form.agreedAmountPerCard),
        commonBankName: form.commonBankName || undefined,
        notes: form.notes || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر إضافة البطاقات');
    toast.success('تمت إضافة البطاقات المستلمة وتحديث الصندوق');
    setForm({
      personId: people[0]?.id || '',
      currencyId: defaultSettlementCurrencyId,
      cardCount: '1',
      valueUsdPerCard: '',
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
    const batch = batches.find((item) => item.id === batchId);
    const settlementCurrencyId = card.settlementCurrencyId || batch?.currencyId || null;
    const settlementAmount = card.settlementAmount || card.agreedAmount;

    if (card.status === 'SETTLED' && (decimal(settlementAmount) <= 0 || !settlementCurrencyId)) {
      return toast.error('تصفية البطاقة تتطلب مبلغ التصفية وعملة التصفية');
    }

    setSavingId(card.id);
    const response = await fetch(`/api/inventory/received-cards/${card.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankName: card.bankName || null,
        cardLast4: card.cardLast4 || null,
        valueUsd: decimal(card.valueUsd),
        agreedAmount: decimal(settlementAmount),
        settlementAmount: decimal(settlementAmount),
        settlementCurrencyId,
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
    toast.success('تم حفظ البطاقة وتحديث الصندوق عند الحاجة');
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="card grid gap-4 p-5 md:grid-cols-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 md:col-span-3">
          لا يتم حفظ CVV نهائيًا. استخدم آخر 4 أرقام فقط وخيار استلام بيانات التحقق.
        </div>
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
          placeholder="قيمة البطاقة بالدولار"
          value={form.valueUsdPerCard}
          onChange={(event) => setForm({ ...form, valueUsdPerCard: event.target.value })}
        />
        <input
          type="number"
          min="0"
          step="0.000001"
          placeholder="المبلغ المتفق عليه لكل بطاقة"
          value={form.agreedAmountPerCard}
          onChange={(event) => setForm({ ...form, agreedAmountPerCard: event.target.value })}
        />
        <select value={form.currencyId} onChange={(event) => setForm({ ...form, currencyId: event.target.value })}>
          <option value="">عملة التصفية</option>
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
        {batches.map((batch) => (
          <div key={batch.id} className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenBatchId(openBatchId === batch.id ? '' : batch.id)}
              className="grid w-full gap-3 p-4 text-right md:grid-cols-[1fr_auto_auto_auto]"
            >
              <div>
                <div className="font-black">
                  {batch.person?.customerNo ? `${batch.person.customerNo} - ` : ''}
                  {batch.person?.fullName}
                </div>
                <div className="text-sm text-slate-500">{batch.person?.phone || 'بدون هاتف'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">عدد البطاقات</div>
                <div className="font-black">{batch.cardCount}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">المتفق عليه لكل بطاقة</div>
                <div className="font-black">
                  {Number(batch.agreedAmountPerCard).toLocaleString('en-US')} {batch.currency?.symbol || ''}
                </div>
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
                        <th>الترتيب</th>
                        <th>المصرف</th>
                        <th>آخر 4 أرقام</th>
                        <th>قيمة البطاقة $</th>
                        <th>مبلغ التصفية</th>
                        <th>عملة التصفية</th>
                        <th>الحالة</th>
                        <th>التحقق</th>
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
                              value={card.settlementAmount?.toString() || card.agreedAmount?.toString() || ''}
                              onChange={(event) =>
                                updateCard(batch.id, card.id, { settlementAmount: event.target.value })
                              }
                            />
                          </td>
                          <td>
                            <select
                              value={card.settlementCurrencyId || batch.currencyId || ''}
                              onChange={(event) =>
                                updateCard(batch.id, card.id, { settlementCurrencyId: event.target.value })
                              }
                            >
                              <option value="">اختر</option>
                              {settlementCurrencies.map((currency) => (
                                <option key={currency.id} value={currency.id}>
                                  {currency.name}
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
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={Boolean(card.verificationReceived)}
                              onChange={(event) =>
                                updateCard(batch.id, card.id, { verificationReceived: event.target.checked })
                              }
                            />
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
        ))}
        {!batches.length ? (
          <div className="card p-6 text-center text-slate-500">لا توجد بطاقات مستلمة بعد</div>
        ) : null}
      </div>
    </div>
  );
}
