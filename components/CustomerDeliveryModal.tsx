'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatMoney } from '@/lib/format';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';

type CurrencyOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

type DeliverySummaryRow = {
  currency: CurrencyOption;
  agreed: number;
  delivered: number;
  remaining: number;
};

type Props = {
  person: any;
  rows: DeliverySummaryRow[];
  currencies: CurrencyOption[];
  onClose: () => void;
  onSaved: () => void;
};

export default function CustomerDeliveryModal({ person, rows, currencies, onClose, onSaved }: Props) {
  const availableCurrencies = rows.length ? rows.map((row) => row.currency) : currencies.filter((currency) => ['USD', 'LYD'].includes(currency.code));
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    currencyId: availableCurrencies[0]?.id || '',
    paymentMethod: '',
    amount: '',
    note: '',
  });
  const selectedRow = rows.find((row) => row.currency.id === form.currencyId);
  const remaining = selectedRow?.remaining || 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!form.currencyId || Number(form.amount || 0) <= 0) return toast.error('أدخل مبلغ تسليم صحيح');
    if (remaining > 0 && Number(form.amount) > remaining) return toast.error('المبلغ أكبر من المتبقي للتسليم');

    setSaving(true);
    try {
      const response = await fetch(`/api/people/${person.id}/deliveries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currencyId: form.currencyId,
          paymentMethod: form.paymentMethod || null,
          amount: Number(form.amount),
          note: form.note || null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return toast.error(result.error || 'تعذر تسجيل التسليم');
      toast.success('تم تسجيل تسليم المبلغ');
      onSaved();
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء تسجيل التسليم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalLayer name="customer-delivery" onClose={onClose}>
      <ModalBackdrop onClick={onClose} />
      <form onSubmit={submit} className="modal-panel modal-panel--auto sheet-panel max-w-lg dark:bg-slate-950">
        <div className="modal-header flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black">تسجيل تسليم مبلغ</h2>
            <p className="mt-1 text-sm text-slate-500">{person.customerNo || ''} {person.fullName}</p>
          </div>
          <button type="button" onClick={onClose} className="modal-close text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body grid gap-4 p-5" data-modal-scroll-body>
          <select value={form.currencyId} onChange={(event) => setForm({ ...form, currencyId: event.target.value })}>
            {availableCurrencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.name}
              </option>
            ))}
          </select>
          <input type="number" min="0" step="0.000001" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="المبلغ المسلم" />
          <input value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })} placeholder="طريقة التسليم" />
          <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="ملاحظة" rows={3} />

        {selectedRow ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            المتبقي قبل التسليم: <b>{formatMoney(selectedRow.remaining, selectedRow.currency)}</b>
          </div>
        ) : null}
        </div>

        <div className="modal-footer grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-3 font-bold dark:border-slate-700">
            إلغاء
          </button>
          <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white disabled:bg-indigo-400">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            حفظ التسليم
          </button>
        </div>
      </form>
    </ModalLayer>
  );
}
