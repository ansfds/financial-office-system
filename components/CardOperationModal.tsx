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
  const projectedAmount = useMemo(() => {
    if (form.operationType === 'GIFT_CARD') {
      const category = defaultCardDiscountCategories.find((item) => item.code === form.categoryCode);
      return (category?.deductionAmount || 0) * Math.max(1, Number(form.quantity || 1));
    }
    if (form.operationType === 'FINAL_SETTLEMENT') return Number(form.amount || remaining);
    if (form.operationType === 'INVOICE') return Number(form.amount || 0);
    return 0;
  }, [form, remaining]);

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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4">
      <form onSubmit={submit} className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black">{operation ? 'تعديل عملية بطاقة' : 'إضافة عملية بطاقة'}</h2>
            <p className="mt-1 text-sm text-slate-500">المتبقي الحالي: {formatMoney(remaining, card.currency || card.batch?.currency || '$')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <select value={form.operationType} onChange={(event) => setForm({ ...form, operationType: event.target.value })}>
            {operationTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

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
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            قيمة العملية المتوقعة: <b>{formatMoney(projectedAmount, card.currency || card.batch?.currency || '$')}</b>
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
