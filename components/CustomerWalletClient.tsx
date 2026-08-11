'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Plus, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatMoney, numberValue } from '@/lib/format';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';
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
  personId?: string;
  currencyId?: string;
  paymentMethod: string;
  accountType: 'CREDIT' | 'DEBT';
  direction: 'ADD' | 'SUBTRACT';
  amount: unknown;
  balanceBefore: unknown;
  balanceAfter: unknown;
  reason: string;
  note?: string | null;
  movementKind?: string | null;
  linkedSettlementId?: string | null;
  settlementMethod?: string | null;
  username?: string | null;
  deletedAt?: string | Date | null;
  occurredAt: string | Date;
  currency: CurrencyOption;
};

type AccountAction = {
  type: 'REPAYMENT' | 'ADD_CREDIT';
  currencyId: string;
  paymentMethod: string;
  amount: string;
  reason: string;
  note: string;
  effectMode: 'OFFSET' | 'NORMAL';
};

type CurrencySummary = {
  currency: CurrencyOption;
  debt: number;
  credit: number;
  rows: WalletSnapshot['rows'];
};

function totalsLabel(items: WalletSnapshot['totals']['credit']) {
  return items.length ? items.map((item) => formatMoney(item.amount, item.currency)).join('، ') : '0';
}

function methodLabel(method: string) {
  return walletBuckets.find((bucket) => bucket.paymentMethod === method)?.label || method;
}

function settlePreview(debt: number, credit: number) {
  const net = debt - credit;
  if (net > 0) return { debt: net, credit: 0 };
  if (net < 0) return { debt: 0, credit: Math.abs(net) };
  return { debt: 0, credit: 0 };
}

function accountStatus(amount: number) {
  return amount > 0 ? 'نشط' : 'مصفّى';
}

function effectLabel(value?: string | null) {
  if (value === 'OFFSET' || value === 'AUTO_OFFSET') return 'خصم من الإجمالي';
  return 'إضافة عادية';
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
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<AccountAction | null>(null);

  const currencySummaries = useMemo(() => {
    const byCurrency = new Map<string, CurrencySummary>();

    for (const row of snapshot.rows) {
      if (row.debt === 0 && row.credit === 0) continue;
      const currency = currencies.find((item) => item.id === row.currency.id) || (row.currency as CurrencyOption);
      const current =
        byCurrency.get(currency.id) ||
        ({
          currency,
          debt: 0,
          credit: 0,
          rows: [],
        } satisfies CurrencySummary);

      current.debt += row.debt;
      current.credit += row.credit;
      current.rows.push(row);
      byCurrency.set(currency.id, current);
    }

    if (!byCurrency.size && currencies[0]) {
      byCurrency.set(currencies[0].id, { currency: currencies[0], debt: 0, credit: 0, rows: [] });
    }

    return Array.from(byCurrency.values());
  }, [currencies, snapshot.rows]);

  const selectedSummary = useMemo(() => {
    if (!action) return null;

    const existing = currencySummaries.find((summary) => summary.currency.id === action.currencyId);
    if (existing) return existing;

    const currency = currencies.find((item) => item.id === action.currencyId);
    return currency ? { currency, debt: 0, credit: 0, rows: [] } : null;
  }, [action, currencies, currencySummaries]);

  const paymentOptions = useMemo(() => {
    const currency = action ? currencies.find((item) => item.id === action.currencyId) : null;
    const allOptions = walletBuckets.filter((bucket) => bucket.currencyCode === currency?.code);
    if (action?.type !== 'REPAYMENT' || !selectedSummary) return allOptions;

    const debtMethods = new Set(selectedSummary.rows.filter((row) => row.debt > 0).map((row) => row.paymentMethod));
    const debtOptions = allOptions.filter((option) => debtMethods.has(option.paymentMethod));
    return debtOptions.length ? debtOptions : allOptions;
  }, [action, currencies, selectedSummary]);

  const preview = useMemo(() => {
    if (!action || !selectedSummary) return null;

    const amount = numberValue(action.amount);
    if (amount <= 0) {
      return {
        valid: false,
        message: 'أدخل قيمة أكبر من الصفر',
        debtBefore: selectedSummary.debt,
        creditBefore: selectedSummary.credit,
        debtAfter: selectedSummary.debt,
        creditAfter: selectedSummary.credit,
        amount,
      };
    }

    let debtAfter = selectedSummary.debt;
    let creditAfter = selectedSummary.credit;

    if (action.type === 'REPAYMENT') {
      debtAfter -= amount;
      if (debtAfter < 0) {
        return {
          valid: false,
          message: 'لا يمكن تسجيل سداد أكبر من رصيد «لنا» من هذه الواجهة',
          debtBefore: selectedSummary.debt,
          creditBefore: selectedSummary.credit,
          debtAfter: selectedSummary.debt,
          creditAfter: selectedSummary.credit,
          amount,
        };
      }
    } else {
      creditAfter += amount;
    }

    if (action.effectMode === 'OFFSET') {
      const settled = settlePreview(debtAfter, creditAfter);
      debtAfter = settled.debt;
      creditAfter = settled.credit;
    }

    return {
      valid: true,
      message: '',
      debtBefore: selectedSummary.debt,
      creditBefore: selectedSummary.credit,
      debtAfter,
      creditAfter,
      amount,
    };
  }, [action, selectedSummary]);

  function openAction(type: AccountAction['type'], currencyId: string) {
    const currency = currencies.find((item) => item.id === currencyId);
    const summary = currencySummaries.find((item) => item.currency.id === currencyId);
    const debtMethod = type === 'REPAYMENT' ? summary?.rows.find((row) => row.debt > 0)?.paymentMethod : null;
    const firstMethod = walletBuckets.find((bucket) => bucket.paymentMethod === debtMethod) ||
      walletBuckets.find((bucket) => bucket.currencyCode === currency?.code);

    setAction({
      type,
      currencyId,
      paymentMethod: firstMethod?.paymentMethod || '',
      amount: '',
      reason: type === 'REPAYMENT' ? 'تم السداد' : '',
      note: '',
      effectMode: 'OFFSET',
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !preview?.valid || !selectedSummary) {
      toast.error(preview?.message || 'احسب المعاينة قبل الحفظ');
      return;
    }
    if (!action.paymentMethod) return toast.error('اختر طريقة السداد');
    if (action.type === 'ADD_CREDIT' && !action.reason.trim()) return toast.error('اكتب سبب الدين');

    setSaving(true);
    try {
      const response = await fetch(`/api/people/${personId}/wallet-settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: action.type === 'REPAYMENT' ? 'SUBTRACT' : 'ADD',
          accountType: action.type === 'REPAYMENT' ? 'DEBT' : 'CREDIT',
          currencyId: action.currencyId,
          paymentMethod: action.paymentMethod,
          amount: action.amount,
          reason: action.type === 'REPAYMENT' ? 'تم السداد' : action.reason,
          note: action.note || null,
          movementKind: action.type === 'REPAYMENT' ? 'REPAYMENT' : 'ADJUSTMENT',
          settlementMethod: action.paymentMethod,
          effectMode: action.effectMode,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(payload.error || 'تعذرت إضافة الحركة');
        return;
      }

      toast.success(
        `تم الحفظ. لنا الآن ${formatMoney(preview.debtAfter, selectedSummary.currency)}، وعلينا ${formatMoney(
          preview.creditAfter,
          selectedSummary.currency,
        )}`,
      );
      setAction(null);
      router.refresh();
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء حفظ الحركة');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 grid gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-black">حساب الزبون</h2>
          <p className="mt-1 text-sm text-slate-500">
            لنا: {totalsLabel(snapshot.totals.debt)} · علينا: {totalsLabel(snapshot.totals.credit)}
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {currencySummaries.map((summary) => (
          <section key={summary.currency.id} className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-black">{summary.currency.name}</h3>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                {summary.currency.code}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <AccountSide
                title="لنا"
                amount={summary.debt}
                currency={summary.currency}
                status={accountStatus(summary.debt)}
                tone="green"
                actionLabel="تم السداد"
                icon={<CheckCircle2 size={18} />}
                onAction={() => openAction('REPAYMENT', summary.currency.id)}
              />
              <AccountSide
                title="علينا"
                amount={summary.credit}
                currency={summary.currency}
                status={accountStatus(summary.credit)}
                tone="red"
                actionLabel="إضافة"
                icon={<Plus size={18} />}
                onAction={() => openAction('ADD_CREDIT', summary.currency.id)}
              />
            </div>
          </section>
        ))}
      </div>

      <div className="card p-5">
        <h3 className="mb-4 font-black">تفصيل الحساب حسب العملة وطريقة الدفع</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الخانة</th>
                <th>لنا</th>
                <th>علينا</th>
                <th>الصافي</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows
                .filter((row) => row.debt !== 0 || row.credit !== 0)
                .map((row) => {
                  const net = row.debt - row.credit;
                  return (
                    <tr key={`${row.currency.id}-${row.paymentMethod}`}>
                      <td>{row.label}</td>
                      <td className={row.debt > 0 ? 'font-bold text-emerald-600' : ''}>
                        {formatMoney(row.debt, row.currency)}
                      </td>
                      <td className={row.credit > 0 ? 'font-bold text-red-600' : ''}>
                        {formatMoney(row.credit, row.currency)}
                      </td>
                      <td className={net > 0 ? 'font-black text-emerald-600' : net < 0 ? 'font-black text-red-600' : ''}>
                        {net > 0
                          ? `لنا عند الزبون ${formatMoney(net, row.currency)}`
                          : net < 0
                            ? `علينا للزبون ${formatMoney(Math.abs(net), row.currency)}`
                            : 'الحساب مصفّى'}
                      </td>
                    </tr>
                  );
                })}
              {!snapshot.rows.some((row) => row.debt !== 0 || row.credit !== 0) ? (
                <tr>
                  <td colSpan={4} className="text-center text-slate-500">
                    لا توجد أرصدة مفتوحة.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 font-black">سجل العمليات</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المستخدم</th>
                <th>نوع العملية</th>
                <th>طريقة التأثير</th>
                <th>الحساب</th>
                <th>الخانة</th>
                <th>المبلغ</th>
                <th>قبل</th>
                <th>بعد</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {settlements.filter((settlement) => !settlement.deletedAt).map((settlement) => (
                <tr key={settlement.id}>
                  <td>{formatDateTime(settlement.occurredAt)}</td>
                  <td>{settlement.username || 'system'}</td>
                  <td>
                    {settlement.movementKind === 'REPAYMENT'
                      ? 'سداد'
                      : settlement.movementKind === 'AUTO_OFFSET'
                        ? 'تسوية تلقائية'
                        : settlement.accountType === 'CREDIT'
                          ? 'إضافة دين علينا'
                          : walletSettlementDirectionLabels[settlement.direction]}
                  </td>
                  <td>{effectLabel(settlement.movementKind === 'AUTO_OFFSET' ? 'AUTO_OFFSET' : settlement.settlementMethod)}</td>
                  <td>{walletAccountLabels[settlement.accountType]}</td>
                  <td>{methodLabel(settlement.paymentMethod)}</td>
                  <td>{formatMoney(settlement.amount, settlement.currency)}</td>
                  <td>{formatMoney(settlement.balanceBefore, settlement.currency)}</td>
                  <td>{formatMoney(settlement.balanceAfter, settlement.currency)}</td>
                  <td>{settlement.note || settlement.reason}</td>
                </tr>
              ))}
              {!settlements.length ? (
                <tr>
                  <td colSpan={10} className="text-center text-slate-500">
                    لا توجد عمليات.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {action && selectedSummary ? (
        <ModalLayer name="customer-wallet-action" onClose={() => setAction(null)}>
          <ModalBackdrop onClick={() => setAction(null)} />
          <form onSubmit={submit} className="modal-panel sheet-panel max-w-2xl dark:bg-slate-900">
            <div className="modal-header flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black">{action.type === 'REPAYMENT' ? 'تم السداد' : 'إضافة مبلغ علينا'}</h3>
                <p className="mt-1 text-sm text-slate-500">{selectedSummary.currency.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setAction(null)}
                className="modal-close text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق النافذة"
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body grid gap-4 p-5 sm:grid-cols-2" data-modal-scroll-body>
              <Field label={action.type === 'REPAYMENT' ? 'القيمة التي سددها الزبون' : 'القيمة'}>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={action.amount}
                  onChange={(event) => setAction({ ...action, amount: event.target.value })}
                  placeholder="القيمة"
                />
              </Field>
              <Field label="العملة">
                <input value={selectedSummary.currency.name} disabled />
              </Field>
              <Field label={action.type === 'REPAYMENT' ? 'طريقة السداد' : 'طريقة الدفع'}>
                <select
                  value={action.paymentMethod}
                  onChange={(event) => setAction({ ...action, paymentMethod: event.target.value })}
                >
                  {paymentOptions.map((option) => (
                    <option key={option.paymentMethod} value={option.paymentMethod}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              {action.type === 'ADD_CREDIT' ? (
                <Field label="سبب الدين">
                  <input
                    value={action.reason}
                    onChange={(event) => setAction({ ...action, reason: event.target.value })}
                    placeholder="سبب الدين"
                  />
                </Field>
              ) : null}
              <Field label="طريقة تأثير العملية" className={action.type === 'ADD_CREDIT' ? 'sm:col-span-2' : ''}>
                <select
                  value={action.effectMode}
                  onChange={(event) => setAction({ ...action, effectMode: event.target.value as AccountAction['effectMode'] })}
                >
                  <option value="OFFSET">خصم القيمة من الإجمالي</option>
                  <option value="NORMAL">إضافة عادية</option>
                </select>
              </Field>
              <Field label="ملاحظة" className="sm:col-span-2">
                <textarea
                  value={action.note}
                  onChange={(event) => setAction({ ...action, note: event.target.value })}
                  placeholder="ملاحظة"
                  rows={3}
                />
              </Field>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950 sm:col-span-2">
              <div className="mb-3 font-black">معاينة الأرصدة قبل الحفظ</div>
              {preview ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <span>لنا قبل العملية: <b>{formatMoney(preview.debtBefore, selectedSummary.currency)}</b></span>
                  <span>علينا قبل العملية: <b>{formatMoney(preview.creditBefore, selectedSummary.currency)}</b></span>
                  <span>قيمة العملية: <b>{formatMoney(preview.amount, selectedSummary.currency)}</b></span>
                  <span>نوع العملية: <b>{action.type === 'REPAYMENT' ? 'سداد' : 'إضافة دين علينا'}</b></span>
                  <span>طريقة التأثير: <b>{effectLabel(action.effectMode)}</b></span>
                  <span>لنا بعد العملية: <b>{formatMoney(preview.debtAfter, selectedSummary.currency)}</b></span>
                  <span>علينا بعد العملية: <b>{formatMoney(preview.creditAfter, selectedSummary.currency)}</b></span>
                  {!preview.valid ? <span className="font-bold text-red-600 sm:col-span-2">{preview.message}</span> : null}
                </div>
              ) : null}
            </div>
            </div>

            <div className="modal-footer grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setAction(null)}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                disabled={saving || !preview?.valid}
                className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400"
              >
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                {saving ? 'جار الحفظ...' : 'حفظ'}
              </button>
            </div>
          </form>
        </ModalLayer>
      ) : null}
    </section>
  );
}

function AccountSide({
  title,
  amount,
  currency,
  status,
  tone,
  actionLabel,
  icon,
  onAction,
}: {
  title: string;
  amount: number;
  currency: CurrencyOption;
  status: string;
  tone: 'green' | 'red';
  actionLabel: string;
  icon: ReactNode;
  onAction: () => void;
}) {
  const color = tone === 'green' ? 'text-emerald-600' : 'text-red-600';
  const buttonColor = tone === 'green' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-500';

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className={`mt-2 text-2xl font-black ${color}`}>{formatMoney(amount, currency)}</div>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          {status}
        </span>
      </div>
      <div className="mt-4 text-sm text-slate-500">العملة: {currency.name}</div>
      <button
        type="button"
        onClick={onAction}
        className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-bold text-white ${buttonColor}`}
      >
        {icon}
        {actionLabel}
      </button>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={className}>
      <span className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
      {children}
    </label>
  );
}
