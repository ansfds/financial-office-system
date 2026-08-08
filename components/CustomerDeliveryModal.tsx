'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatMoney } from '@/lib/format';

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
    setSaving(false);
    if (!response.ok) return toast.error(result.error || 'تعذر تسجيل التسليم');
    toast.success('تم تسجيل تسليم المبلغ');
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black">تسجيل تسليم مبلغ</h2>
            <p className="mt-1 text-sm text-slate-500">{person.customerNo || ''} {person.fullName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4">
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
        </div>

        {selectedRow ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            المتبقي قبل التسليم: <b>{formatMoney(selectedRow.remaining, selectedRow.currency)}</b>
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-3 font-bold dark:border-slate-700">
            إلغاء
          </button>
          <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white disabled:bg-indigo-400">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            حفظ التسليم
          </button>
        </div>
      </form>
    </div>
  );
}
