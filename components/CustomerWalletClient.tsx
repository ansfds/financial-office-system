'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatMoney } from '@/lib/format';
import {
  walletAccountLabels,
  walletBuckets,
  walletSettlementDirectionLabels,
  type WalletSnapshot,
} from '@/lib/customer-wallet';

type CurrencyOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

type Settlement = {
  id: string;
  paymentMethod: string;
  accountType: 'CREDIT' | 'DEBT';
  direction: 'ADD' | 'SUBTRACT';
  amount: unknown;
  balanceBefore: unknown;
  balanceAfter: unknown;
  reason: string;
  note?: string | null;
  username?: string | null;
  occurredAt: string | Date;
  currency: CurrencyOption;
};

function totalsLabel(items: WalletSnapshot['totals']['credit']) {
  return items.length ? items.map((item) => formatMoney(item.amount, item.currency)).join('، ') : '0';
}

function methodLabel(method: string) {
  return walletBuckets.find((bucket) => bucket.paymentMethod === method)?.label || method;
}

export default function CustomerWalletClient({
  personId,
  snapshot,
  settlements,
  currencies,
}: {
  personId: string;
  snapshot: WalletSnapshot;
  settlements: Settlement[];
  currencies: CurrencyOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    direction: 'ADD',
    accountType: 'CREDIT',
    currencyId: currencies[0]?.id || '',
    paymentMethod: '',
    amount: '',
    reason: '',
    note: '',
  });

  const selectedCurrency = currencies.find((currency) => currency.id === form.currencyId);
  const paymentOptions = useMemo(
    () => walletBuckets.filter((bucket) => bucket.currencyCode === selectedCurrency?.code),
    [selectedCurrency?.code],
  );
  const selectedPaymentMethod = form.paymentMethod || paymentOptions[0]?.paymentMethod || '';

  function openSettlement() {
    const firstCurrency = currencies[0];
    const firstMethod = walletBuckets.find((bucket) => bucket.currencyCode === firstCurrency?.code);
    setForm({
      direction: 'ADD',
      accountType: 'CREDIT',
      currencyId: firstCurrency?.id || '',
      paymentMethod: firstMethod?.paymentMethod || '',
      amount: '',
      reason: '',
      note: '',
    });
    setOpen(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.currencyId || !selectedPaymentMethod || !form.amount || !form.reason.trim()) {
      toast.error('أكمل بيانات التسوية');
      return;
    }

    setSaving(true);
    const response = await fetch(`/api/people/${personId}/wallet-settlements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: form.direction,
        accountType: form.accountType,
        currencyId: form.currencyId,
        paymentMethod: selectedPaymentMethod,
        amount: form.amount,
        reason: form.reason,
        note: form.note || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      toast.error(payload.error || 'تعذرت إضافة التسوية');
      return;
    }

    toast.success('تمت إضافة التسوية');
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="mt-6 grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black">حساب الزبون</h2>
        </div>
        <button
          type="button"
          onClick={openSettlement}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500"
        >
          <Plus size={18} />
          تسوية رصيد
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="text-sm text-slate-500">إجمالي الرصيد الذي للزبون</div>
          <div className="mt-2 text-2xl font-black text-emerald-600">{totalsLabel(snapshot.totals.credit)}</div>
        </div>
        <div className="card p-5">
          <div className="text-sm text-slate-500">إجمالي الدين على الزبون</div>
          <div className="mt-2 text-2xl font-black text-red-600">{totalsLabel(snapshot.totals.debt)}</div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 font-black">تفصيل الأرصدة حسب العملة وطريقة الدفع</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الخانة</th>
                <th>رصيد للزبون</th>
                <th>دين على الزبون</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row) => (
                <tr key={`${row.currency.id}-${row.paymentMethod}`}>
                  <td>{row.label}</td>
                  <td className={row.credit > 0 ? 'font-bold text-emerald-600' : ''}>
                    {formatMoney(row.credit, row.currency)}
                  </td>
                  <td className={row.debt > 0 ? 'font-bold text-red-600' : ''}>
                    {formatMoney(row.debt, row.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 font-black">سجل التسويات</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المستخدم</th>
                <th>نوع التسوية</th>
                <th>نوع الحساب</th>
                <th>الخانة</th>
                <th>المبلغ</th>
                <th>قبل</th>
                <th>بعد</th>
                <th>السبب</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((settlement) => (
                <tr key={settlement.id}>
                  <td>{formatDateTime(settlement.occurredAt)}</td>
                  <td>{settlement.username || 'system'}</td>
                  <td>{walletSettlementDirectionLabels[settlement.direction]}</td>
                  <td>{walletAccountLabels[settlement.accountType]}</td>
                  <td>{methodLabel(settlement.paymentMethod)}</td>
                  <td>{formatMoney(settlement.amount, settlement.currency)}</td>
                  <td>{formatMoney(settlement.balanceBefore, settlement.currency)}</td>
                  <td>{formatMoney(settlement.balanceAfter, settlement.currency)}</td>
                  <td>{settlement.reason}</td>
                  <td>{settlement.note || '-'}</td>
                </tr>
              ))}
              {!settlements.length ? (
                <tr>
                  <td colSpan={10} className="text-center text-slate-500">
                    لا توجد تسويات.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={submit} className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-black">تسوية رصيد</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق نافذة التسوية"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}>
                <option value="ADD">إضافة</option>
                <option value="SUBTRACT">خصم</option>
              </select>
              <select value={form.accountType} onChange={(event) => setForm({ ...form, accountType: event.target.value })}>
                <option value="CREDIT">رصيد للزبون</option>
                <option value="DEBT">دين على الزبون</option>
              </select>
              <select
                value={form.currencyId}
                onChange={(event) => {
                  const currency = currencies.find((item) => item.id === event.target.value);
                  const method = walletBuckets.find((bucket) => bucket.currencyCode === currency?.code);
                  setForm({ ...form, currencyId: event.target.value, paymentMethod: method?.paymentMethod || '' });
                }}
              >
                {currencies.map((currency) => (
                  <option key={currency.id} value={currency.id}>
                    {currency.name}
                  </option>
                ))}
              </select>
              <select
                value={selectedPaymentMethod}
                onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}
              >
                {paymentOptions.map((option) => (
                  <option key={option.paymentMethod} value={option.paymentMethod}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                placeholder="المبلغ"
              />
              <input
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                placeholder="السبب"
              />
              <textarea
                className="sm:col-span-2"
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                placeholder="ملاحظة"
                rows={3}
              />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400"
              >
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                {saving ? 'جار الحفظ...' : 'حفظ التسوية'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
