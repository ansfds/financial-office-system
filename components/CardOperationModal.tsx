'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatMoney, numberValue } from '@/lib/format';
import { defaultCardDiscountCategories } from '@/lib/customer-cards';

type Props = {
  card: any;
  operation?: any | null;
  initialType?: string;
  onClose: () => void;
  onSaved: (card: any) => void;
};

const operationTypes = [
  { value: 'GIFT_CARD', label: 'كروت' },
  { value: 'INVOICE', label: 'فاتورة' },
  { value: 'FINAL_SETTLEMENT', label: 'تصفية' },
  { value: 'REJECT', label: 'رفض' },
  { value: 'REACTIVATE', label: 'إعادة تنشيط' },
];

function currentRemaining(card: any) {
  if (card.remainingAmount !== undefined && card.remainingAmount !== null) return numberValue(card.remainingAmount);
  const base = numberValue(card.valueUsd) > 0 ? numberValue(card.valueUsd) : numberValue(card.agreedAmount);
  return Math.max(base - numberValue(card.receivedAmount), 0);
}

export default function CardOperationModal({ card, operation, initialType, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    operationType: operation?.operationType || initialType || 'GIFT_CARD',
    categoryCode: operation?.categoryCode || '100',
    quantity: String(operation?.quantity || 1),
    amount: operation?.amount ? String(operation.amount) : '',
    note: operation?.note || '',
    reason: operation?.reason || '',
  });

  const remaining = currentRemaining(card);
  const baseAmount = numberValue(card.valueUsd) > 0 ? numberValue(card.valueUsd) : numberValue(card.agreedAmount);
  const currentDeducted = Math.max(numberValue(card.totalDeducted ?? card.receivedAmount), 0);
  const projectedAmount = useMemo(() => {
    if (form.operationType === 'GIFT_CARD') {
      const category = defaultCardDiscountCategories.find((item) => item.code === form.categoryCode);
      return (category?.deductionAmount || 0) * Math.max(1, Number(form.quantity || 1));
    }
    if (form.operationType === 'FINAL_SETTLEMENT') return Number(form.amount || remaining);
    if (form.operationType === 'INVOICE') return Number(form.amount || 0);
    return 0;
  }, [form, remaining]);
  const projectedRemaining = Math.max(remaining - projectedAmount, 0);
  const currentPercent = baseAmount > 0 ? Math.min(Math.max((currentDeducted / baseAmount) * 100, 0), 100) : 0;
  const nextPercent =
    baseAmount > 0 && ['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT'].includes(form.operationType)
      ? Math.min(Math.max(((currentDeducted + projectedAmount) / baseAmount) * 100, 0), 100)
      : currentPercent;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (form.operationType === 'REJECT' && !form.reason.trim()) return toast.error('اكتب سبب الرفض');
    if (['INVOICE', 'FINAL_SETTLEMENT'].includes(form.operationType) && Number(form.amount || projectedAmount) <= 0) {
      return toast.error('أدخل مبلغًا صحيحًا');
    }
    if (['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT'].includes(form.operationType) && projectedAmount > remaining && !operation) {
      return toast.error('المبلغ أكبر من المتبقي في البطاقة');
    }

    setSaving(true);
    const response = await fetch(
      operation
        ? `/api/inventory/received-cards/${card.id}/operations/${operation.id}`
        : `/api/inventory/received-cards/${card.id}/operations`,
      {
        method: operation ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationType: form.operationType,
          categoryCode: form.operationType === 'GIFT_CARD' ? form.categoryCode : null,
          quantity: Number(form.quantity || 1),
          amount:
            form.operationType === 'FINAL_SETTLEMENT' && !form.amount
              ? undefined
              : Number(form.amount || projectedAmount || 0),
          note: form.note || null,
          reason: form.reason || null,
        }),
      },
    );
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(result.error || 'تعذر حفظ عملية البطاقة');
    toast.success(operation ? 'تم تعديل العملية وإعادة حساب الرصيد' : 'تم تسجيل عملية البطاقة');
    onSaved(result);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm md:items-center md:p-4">
      <form onSubmit={submit} className="sheet-panel flex max-h-[96dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950 md:rounded-lg">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-black">{operation ? 'تعديل عملية بطاقة' : 'إضافة عملية بطاقة'}</h2>
            <p className="mt-1 text-sm text-slate-500">المتبقي الحالي: {formatMoney(remaining, card.currency || card.batch?.currency || '$')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {operationTypes.map((type) => (
              <button
                type="button"
                key={type.value}
                onClick={() => setForm({ ...form, operationType: type.value })}
                className={`rounded-lg border px-3 py-2 text-sm font-black ${
                  form.operationType === type.value
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {type.label}
              </button>
            ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">

          {form.operationType === 'GIFT_CARD' ? (
            <>
              <select value={form.categoryCode} onChange={(event) => setForm({ ...form, categoryCode: event.target.value })}>
                {defaultCardDiscountCategories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.name} خصم {category.deductionAmount}
                  </option>
                ))}
              </select>
              <input type="number" min="1" max="1000" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} placeholder="الكمية" />
            </>
          ) : null}

          {['INVOICE', 'FINAL_SETTLEMENT'].includes(form.operationType) ? (
            <input
              type="number"
              min="0"
              step="0.000001"
              value={form.amount || (form.operationType === 'FINAL_SETTLEMENT' ? String(remaining) : '')}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              placeholder="المبلغ"
              className="md:col-span-2"
            />
          ) : null}

          {form.operationType === 'REJECT' ? (
            <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="سبب الرفض" className="md:col-span-2" />
          ) : null}

          <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="ملاحظة" rows={3} className="md:col-span-2" />
        </div>

        {['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT'].includes(form.operationType) ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <div className="mb-3 font-black text-slate-900 dark:text-white">معاينة العملية</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <span>قيمة العملية: <b className="num">{formatMoney(projectedAmount, card.currency || card.batch?.currency || '$')}</b></span>
              <span>المتبقي بعدها: <b className="num">{formatMoney(projectedRemaining, card.currency || card.batch?.currency || '$')}</b></span>
              <span>النسبة الحالية: <b className="num">{currentPercent.toFixed(currentPercent % 1 ? 1 : 0)}%</b></span>
              <span>النسبة الجديدة: <b className="num">{nextPercent.toFixed(nextPercent % 1 ? 1 : 0)}%</b></span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full rounded-full bg-orange-500 transition-all duration-300" style={{ width: `${nextPercent}%` }} />
            </div>
          </div>
        ) : null}
        </div>

        <div className="grid gap-3 border-t border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-3 font-bold dark:border-slate-700">
            إلغاء
          </button>
          <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white disabled:bg-indigo-400">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            حفظ
          </button>
        </div>
      </form>
    </div>
  );
}
