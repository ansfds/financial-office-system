'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Edit3, Eye, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatMoney } from '@/lib/format';
import { walletBuckets, walletSettlementDirectionLabels } from '@/lib/customer-wallet';

type CurrencyOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

type AccountRow = {
  personId: string;
  customerNo?: string | null;
  fullName: string;
  phone?: string | null;
  currency: CurrencyOption;
  paymentMethod: string;
  paymentLabel: string;
  ourAmount: number;
  theirAmount: number;
  net: number;
  lastMovement: string | Date;
};

type Settlement = {
  id: string;
  personId: string;
  currencyId: string;
  paymentMethod: string;
  accountType: 'CREDIT' | 'DEBT';
  direction: 'ADD' | 'SUBTRACT';
  amount: unknown;
  balanceBefore: unknown;
  balanceAfter: unknown;
  reason: string;
  note?: string | null;
  movementKind?: string | null;
  settlementMethod?: string | null;
  username?: string | null;
  occurredAt: string | Date;
  currency: CurrencyOption;
  person: {
    id: string;
    customerNo?: string | null;
    fullName: string;
  };
};

type MovementForm = {
  personId: string;
  accountType: string;
  direction: string;
  currencyId: string;
  paymentMethod: string;
  amount: string;
  reason: string;
  note: string;
  movementKind: string;
  settlementMethod: string;
  effectMode: 'OFFSET' | 'NORMAL';
};

const emptyForm: MovementForm = {
  personId: '',
  accountType: 'DEBT',
  direction: 'ADD',
  currencyId: '',
  paymentMethod: '',
  amount: '',
  reason: '',
  note: '',
  movementKind: 'ADJUSTMENT',
  settlementMethod: '',
  effectMode: 'OFFSET',
};

function netLabel(row: AccountRow) {
  if (row.net > 0) return `لنا عند الزبون ${formatMoney(row.net, row.currency)}`;
  if (row.net < 0) return `علينا للزبون ${formatMoney(Math.abs(row.net), row.currency)}`;
  return 'الحساب مصفّى';
}

function movementEffectLabel(settlement: Pick<Settlement, 'movementKind' | 'settlementMethod'>) {
  if (settlement.movementKind === 'AUTO_OFFSET' || settlement.settlementMethod === 'OFFSET') return 'خصم من الإجمالي';
  return 'إضافة عادية';
}

function paymentOptions(currencies: CurrencyOption[], currencyId: string) {
  const currency = currencies.find((item) => item.id === currencyId);
  return walletBuckets.filter((bucket) => bucket.currencyCode === currency?.code);
}

function accountTotals(rows: AccountRow[], form: MovementForm) {
  return rows
    .filter((row) => row.personId === form.personId && row.currency.id === form.currencyId)
    .reduce(
      (total, row) => ({
        ourAmount: total.ourAmount + row.ourAmount,
        theirAmount: total.theirAmount + row.theirAmount,
      }),
      { ourAmount: 0, theirAmount: 0 },
    );
}

function previewMovement(rows: AccountRow[], form: MovementForm) {
  const totals = accountTotals(rows, form);
  const amount = Number(form.amount || 0);
  let ourAfter = totals.ourAmount;
  let theirAfter = totals.theirAmount;

  if (amount <= 0) {
    return { valid: false, message: 'أدخل قيمة أكبر من الصفر', amount, ...totals, ourAfter, theirAfter };
  }

  if (form.accountType === 'DEBT') {
    ourAfter = form.direction === 'ADD' ? ourAfter + amount : ourAfter - amount;
  } else {
    theirAfter = form.direction === 'ADD' ? theirAfter + amount : theirAfter - amount;
  }

  if (ourAfter < 0 || theirAfter < 0) {
    return { valid: false, message: 'لا يمكن أن يصبح الرصيد بالسالب', amount, ...totals, ourAfter: totals.ourAmount, theirAfter: totals.theirAmount };
  }

  if (form.effectMode === 'OFFSET') {
    const net = ourAfter - theirAfter;
    ourAfter = net > 0 ? net : 0;
    theirAfter = net < 0 ? Math.abs(net) : 0;
  }

  return { valid: true, message: '', amount, ...totals, ourAfter, theirAfter };
}

export default function AccountsClient({
  rows,
  people,
  currencies,
  settlements,
}: {
  rows: AccountRow[];
  people: Array<{ id: string; customerNo?: string | null; fullName: string }>;
  currencies: CurrencyOption[];
  settlements: Settlement[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [openForm, setOpenForm] = useState(false);
  const [selectedRow, setSelectedRow] = useState<AccountRow | null>(null);
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MovementForm>({
    ...emptyForm,
    personId: people[0]?.id || '',
    currencyId: currencies[0]?.id || '',
    paymentMethod: paymentOptions(currencies, currencies[0]?.id || '')[0]?.paymentMethod || '',
  });

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.customerNo, row.fullName, row.phone, row.currency.name, row.currency.code, row.paymentLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [q, rows]);

  const selectedSettlements = selectedRow
    ? settlements.filter(
        (settlement) =>
          settlement.personId === selectedRow.personId &&
          settlement.currencyId === selectedRow.currency.id &&
          settlement.paymentMethod === selectedRow.paymentMethod,
      )
    : [];

  function resetForm(row?: AccountRow | null) {
    const currencyId = row?.currency.id || currencies[0]?.id || '';
    const options = paymentOptions(currencies, currencyId);
    setForm({
      ...emptyForm,
      personId: row?.personId || people[0]?.id || '',
      currencyId,
      paymentMethod: row?.paymentMethod || options[0]?.paymentMethod || '',
    });
  }

  function openAdd(row?: AccountRow) {
    resetForm(row);
    setOpenForm(true);
  }

  function openRepayment(row: AccountRow) {
    const isOurAccount = row.net >= 0;
    const amount = Math.abs(row.net || (isOurAccount ? row.ourAmount : row.theirAmount));
    setForm({
      ...emptyForm,
      personId: row.personId,
      accountType: isOurAccount ? 'DEBT' : 'CREDIT',
      direction: 'SUBTRACT',
      currencyId: row.currency.id,
      paymentMethod: row.paymentMethod,
      amount: amount ? String(amount) : '',
      reason: isOurAccount ? 'تم سداد مبلغ لنا' : 'تم سداد مبلغ علينا',
      note: '',
      movementKind: 'REPAYMENT',
      settlementMethod: row.paymentLabel,
      effectMode: 'OFFSET',
    });
    setOpenForm(true);
  }

  function openCreditAdd(row: AccountRow) {
    setForm({
      ...emptyForm,
      personId: row.personId,
      accountType: 'CREDIT',
      direction: 'ADD',
      currencyId: row.currency.id,
      paymentMethod: row.paymentMethod,
      reason: '',
      movementKind: 'ADJUSTMENT',
      settlementMethod: row.paymentLabel,
      effectMode: 'OFFSET',
    });
    setOpenForm(true);
  }

  function selectCurrency(currencyId: string) {
    const options = paymentOptions(currencies, currencyId);
    setForm({ ...form, currencyId, paymentMethod: options[0]?.paymentMethod || '' });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.personId || !form.currencyId || !form.paymentMethod || !form.amount || !form.reason.trim()) {
      toast.error('أكمل بيانات الحركة المالية');
      return;
    }
    const preview = previewMovement(rows, form);
    if (!preview.valid) {
      toast.error(preview.message || 'احسب المعاينة بشكل صحيح قبل الحفظ');
      return;
    }

    setSaving(true);
    const response = await fetch(`/api/people/${form.personId}/wallet-settlements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(result.error || 'تعذر حفظ الحركة');

    toast.success('تم حفظ الحركة المالية');
    setOpenForm(false);
    router.refresh();
  }

  function openEdit(settlement: Settlement) {
    setEditing(settlement);
    setForm({
      personId: settlement.personId,
      accountType: settlement.accountType,
      direction: settlement.direction,
      currencyId: settlement.currencyId,
      paymentMethod: settlement.paymentMethod,
      amount: String(settlement.amount),
      reason: settlement.reason,
      note: settlement.note || '',
      movementKind: settlement.movementKind === 'REPAYMENT' ? 'REPAYMENT' : 'ADJUSTMENT',
      settlementMethod: settlement.settlementMethod || '',
      effectMode: settlement.settlementMethod === 'OFFSET' ? 'OFFSET' : 'NORMAL',
    });
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;

    setSaving(true);
    const response = await fetch(`/api/people/${editing.personId}/wallet-settlements/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(result.error || 'تعذر تعديل الحركة');

    toast.success('تم تعديل الحركة وإعادة حساب الرصيد');
    setEditing(null);
    router.refresh();
  }

  async function deleteSettlement(settlement: Settlement) {
    if (!window.confirm('هل تريد حذف هذه الحركة منطقيًا وإعادة حساب الرصيد؟')) return;
    const response = await fetch(`/api/people/${settlement.personId}/wallet-settlements/${settlement.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'حذف من صفحة لنا وعلينا' }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(result.error || 'تعذر حذف الحركة');
    toast.success('تم حذف الحركة منطقيًا');
    router.refresh();
  }

  return (
    <>
      <div className="sticky top-2 z-20 mb-5 grid gap-3 rounded-lg bg-white/92 p-2 shadow-sm backdrop-blur dark:bg-[#0d1d33]/92 md:static md:grid-cols-[1fr_auto] md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-0">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            className="pr-10"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="بحث باسم الزبون أو رقمه أو العملة"
          />
        </div>
        <button
          type="button"
          onClick={() => openAdd()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 font-bold text-white"
        >
          <Plus size={18} />
          إضافة حركة
        </button>
      </div>

      <section className="grid grid-cols-3 gap-2 md:gap-4">
        <Summary title="إجمالي الحسابات" value={rows.length} />
        <Summary title="حسابات لنا" value={rows.filter((row) => row.net > 0).length} tone="green" />
        <Summary title="حسابات علينا" value={rows.filter((row) => row.net < 0).length} tone="red" />
      </section>

      <div className="table-wrap mt-5 hidden md:block">
        <table>
          <thead>
            <tr>
              <th>رقم الزبون</th>
              <th>الاسم</th>
              <th>لنا</th>
              <th>علينا</th>
              <th>الصافي</th>
              <th>العملة</th>
              <th>آخر حركة</th>
              <th>تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={`${row.personId}-${row.currency.id}-${row.paymentMethod}`}>
                <td className="font-bold text-slate-500">{row.customerNo || '—'}</td>
                <td>
                  <div className="font-bold">{row.fullName}</div>
                  <div className="text-xs text-slate-500">{row.paymentLabel}</div>
                </td>
                <td className="font-black text-emerald-600">{formatMoney(row.ourAmount, row.currency)}</td>
                <td className="font-black text-red-600">{formatMoney(row.theirAmount, row.currency)}</td>
                <td className={row.net > 0 ? 'font-black text-emerald-600' : row.net < 0 ? 'font-black text-red-600' : ''}>
                  {netLabel(row)}
                </td>
                <td>{row.currency.name}</td>
                <td>{formatDateTime(row.lastMovement)}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRow(row)}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <Eye size={16} />
                      تفاصيل الحساب
                    </button>
                    <button
                      type="button"
                      onClick={() => openAdd(row)}
                      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"
                    >
                      <Plus size={16} />
                      إضافة
                    </button>
                    <button
                      type="button"
                      onClick={() => openRepayment(row)}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
                    >
                      <Plus size={16} />
                      تم السداد
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filteredRows.length ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  لا توجد حسابات مطابقة.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="stagger-list mt-5 grid gap-3 md:hidden">
        {filteredRows.map((row, index) => (
          <article
            key={`${row.personId}-${row.currency.id}-${row.paymentMethod}`}
            style={{ '--stagger': index } as CSSProperties}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-500">{row.customerNo || '—'}</div>
                <h2 className="mt-1 truncate font-black">{row.fullName}</h2>
                <div className="mt-1 text-xs text-slate-500">{row.paymentLabel} · {row.currency.name}</div>
              </div>
              <span className={row.net > 0 ? 'text-sm font-black text-emerald-600' : row.net < 0 ? 'text-sm font-black text-red-600' : 'text-sm font-bold text-slate-500'}>
                {row.net > 0 ? 'لنا' : row.net < 0 ? 'علينا' : 'مصفّى'}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                <div className="text-xs">لنا</div>
                <div className="mt-1 font-black">{formatMoney(row.ourAmount, row.currency)}</div>
              </div>
              <div className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-950 dark:text-red-200">
                <div className="text-xs">علينا</div>
                <div className="mt-1 font-black">{formatMoney(row.theirAmount, row.currency)}</div>
              </div>
            </div>
            <div className="mt-3 text-sm font-bold">{netLabel(row)}</div>
            <div className="mt-1 text-xs text-slate-500">آخر حركة: {formatDateTime(row.lastMovement)}</div>
            <button
              type="button"
              onClick={() => setSelectedRow(row)}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"
            >
              <Eye size={16} />
              عرض الحساب
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openAdd(row)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"
              >
                <Plus size={16} />
                إضافة
              </button>
              <button
                type="button"
                onClick={() => openRepayment(row)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
              >
                <Plus size={16} />
                تم السداد
              </button>
            </div>
          </article>
        ))}
        {!filteredRows.length ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">
            لا توجد حسابات مطابقة.
          </div>
        ) : null}
      </div>

      {(openForm || editing) ? (
        <MovementModal
          title={editing ? 'تعديل حركة مالية' : 'إضافة حركة مالية'}
          form={form}
          people={people}
          currencies={currencies}
          preview={editing ? null : previewMovement(rows, form)}
          saving={saving}
          onClose={() => {
            setOpenForm(false);
            setEditing(null);
          }}
          onSubmit={editing ? submitEdit : submit}
          onChange={setForm}
          onCurrencyChange={selectCurrency}
        />
      ) : null}

      {selectedRow ? (
        <div className="fixed inset-0 z-50">
          <button className="sheet-backdrop absolute inset-0 bg-slate-950/45 backdrop-blur-sm" aria-label="إغلاق التفاصيل" onClick={() => setSelectedRow(null)} />
          <aside className="sheet-panel absolute inset-x-0 bottom-0 h-[96dvh] w-full overflow-y-auto rounded-t-lg border-t border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-950 md:inset-y-0 md:left-0 md:right-auto md:h-auto md:max-w-4xl md:rounded-none md:border-r md:border-t-0 md:p-5 md:w-[78vw]">
            <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:static md:m-0 md:mb-5 md:border-0 md:bg-transparent md:p-0">
              <div>
                <div className="text-sm font-bold text-indigo-600">{selectedRow.customerNo || '—'}</div>
                <h2 className="text-2xl font-black">{selectedRow.fullName}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedRow.paymentLabel} · {selectedRow.currency.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق"
              >
                <X size={22} />
              </button>
            </div>

            <div className="mb-5 grid gap-3 md:grid-cols-3">
              <AccountPanel
                title="لنا"
                amount={selectedRow.ourAmount}
                currency={selectedRow.currency}
                status={selectedRow.ourAmount > 0 ? 'نشط' : 'مصفّى'}
                tone="green"
                actionLabel="تم السداد"
                onAction={() => openRepayment(selectedRow)}
              />
              <AccountPanel
                title="علينا"
                amount={selectedRow.theirAmount}
                currency={selectedRow.currency}
                status={selectedRow.theirAmount > 0 ? 'نشط' : 'مصفّى'}
                tone="red"
                actionLabel="إضافة"
                onAction={() => openCreditAdd(selectedRow)}
              />
              <NetPanel row={selectedRow} />
            </div>

            <div className="stagger-list grid gap-3 md:hidden">
              {selectedSettlements.map((settlement, index) => (
                <article
                  key={settlement.id}
                  style={{ '--stagger': index } as CSSProperties}
                  className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3 pr-5 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <span className={`absolute right-0 top-0 h-full w-1.5 ${settlement.accountType === 'DEBT' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <div className="flex items-start justify-between gap-3">
                    <div className={settlement.accountType === 'DEBT' ? 'font-black text-emerald-600' : 'font-black text-red-600'}>
                      {settlement.accountType === 'DEBT' ? 'لنا' : 'علينا'} · {walletSettlementDirectionLabels[settlement.direction]}
                    </div>
                    <div className="num text-xs text-slate-500">{formatDateTime(settlement.occurredAt)}</div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <span className="rounded-lg bg-white p-2 dark:bg-slate-950">قبل <b className="num block">{formatMoney(settlement.balanceBefore, settlement.currency)}</b></span>
                    <span className="rounded-lg bg-white p-2 dark:bg-slate-950">القيمة <b className="num block">{formatMoney(settlement.amount, settlement.currency)}</b></span>
                    <span className="rounded-lg bg-white p-2 dark:bg-slate-950">بعد <b className="num block">{formatMoney(settlement.balanceAfter, settlement.currency)}</b></span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{movementEffectLabel(settlement)} · {settlement.username || 'system'}</div>
                  <div className="mt-2">{settlement.note || settlement.reason}</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(settlement)}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <Edit3 size={15} />
                      تعديل
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSettlement(settlement)}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-200"
                    >
                      <Trash2 size={15} />
                      حذف
                    </button>
                  </div>
                </article>
              ))}
              {!selectedSettlements.length ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-slate-700">
                  لا توجد حركات مالية لهذا الحساب.
                </div>
              ) : null}
            </div>

            <div className="table-wrap hidden md:block">
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>المستخدم</th>
                    <th>الحساب</th>
                    <th>العملية</th>
                    <th>طريقة التأثير</th>
                    <th>المبلغ</th>
                    <th>قبل</th>
                    <th>بعد</th>
                    <th>ملاحظة</th>
                    <th>خيارات</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSettlements.map((settlement) => (
                    <tr key={settlement.id}>
                      <td>{formatDateTime(settlement.occurredAt)}</td>
                      <td>{settlement.username || 'system'}</td>
                      <td className={settlement.accountType === 'DEBT' ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                        {settlement.accountType === 'DEBT' ? 'لنا' : 'علينا'}
                      </td>
                      <td>
                        {walletSettlementDirectionLabels[settlement.direction]}
                        {settlement.movementKind === 'REPAYMENT' ? <span className="ms-2 rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">تم سداد</span> : null}
                      </td>
                      <td>{movementEffectLabel(settlement)}</td>
                      <td>{formatMoney(settlement.amount, settlement.currency)}</td>
                      <td>{formatMoney(settlement.balanceBefore, settlement.currency)}</td>
                      <td>{formatMoney(settlement.balanceAfter, settlement.currency)}</td>
                      <td>{settlement.note || settlement.reason}</td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(settlement)}
                            className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            aria-label="تعديل الحركة"
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSettlement(settlement)}
                            className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-200"
                            aria-label="حذف الحركة"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!selectedSettlements.length ? (
                    <tr>
                      <td colSpan={10} className="text-center text-slate-500">
                        لا توجد حركات مالية لهذا الحساب.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function Summary({ title, value, tone }: { title: string; value: React.ReactNode; tone?: 'green' | 'red' }) {
  return (
    <div className="card p-3 md:p-5">
      <div className="text-xs text-slate-500 md:text-sm">{title}</div>
      <div className={`mt-2 text-xl font-black md:text-2xl ${tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function NetPanel({ row }: { row: AccountRow }) {
  const positive = row.net >= 0;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">صافي الحساب</div>
          <div className={`num mt-2 text-2xl font-black ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatMoney(Math.abs(row.net), row.currency)}
          </div>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          {positive ? 'لنا' : 'علينا'}
        </span>
      </div>
      <div className="mt-3 text-sm text-slate-500">{netLabel(row)}</div>
    </div>
  );
}

function AccountPanel({
  title,
  amount,
  currency,
  status,
  tone,
  actionLabel,
  onAction,
}: {
  title: string;
  amount: number;
  currency: CurrencyOption;
  status: string;
  tone: 'green' | 'red';
  actionLabel: string;
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
      <div className="mt-3 text-sm text-slate-500">العملة: {currency.name}</div>
      <button
        type="button"
        onClick={onAction}
        className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-bold text-white ${buttonColor}`}
      >
        <Plus size={16} />
        {actionLabel}
      </button>
    </div>
  );
}

function MovementModal({
  title,
  form,
  people,
  currencies,
  preview,
  saving,
  onClose,
  onSubmit,
  onChange,
  onCurrencyChange,
}: {
  title: string;
  form: MovementForm;
  people: Array<{ id: string; customerNo?: string | null; fullName: string }>;
  currencies: CurrencyOption[];
  preview: ReturnType<typeof previewMovement> | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onChange: (form: MovementForm) => void;
  onCurrencyChange: (currencyId: string) => void;
}) {
  const options = paymentOptions(currencies, form.currencyId);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm md:items-center md:p-4">
      <form onSubmit={onSubmit} className="sheet-panel flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 md:rounded-lg">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="text-lg font-black">{title}</h2>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <select value={form.personId} onChange={(event) => onChange({ ...form, personId: event.target.value })}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.customerNo ? `${person.customerNo} - ` : ''}
                {person.fullName}
              </option>
            ))}
          </select>
          <select value={form.accountType} onChange={(event) => onChange({ ...form, accountType: event.target.value })}>
            <option value="DEBT">لنا</option>
            <option value="CREDIT">علينا</option>
          </select>
          <select value={form.direction} onChange={(event) => onChange({ ...form, direction: event.target.value })}>
            <option value="ADD">إضافة</option>
            <option value="SUBTRACT">خصم</option>
          </select>
          <select value={form.currencyId} onChange={(event) => onCurrencyChange(event.target.value)}>
            {currencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.name}
              </option>
            ))}
          </select>
          <select value={form.paymentMethod} onChange={(event) => onChange({ ...form, paymentMethod: event.target.value })}>
            {options.map((option) => (
              <option key={option.paymentMethod} value={option.paymentMethod}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.000001"
            value={form.amount}
            onChange={(event) => onChange({ ...form, amount: event.target.value })}
            placeholder="القيمة"
          />
          <input
            className="md:col-span-2"
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            placeholder="سبب الحركة"
          />
          <textarea
            className="md:col-span-2"
            value={form.note}
            onChange={(event) => onChange({ ...form, note: event.target.value })}
            placeholder="ملاحظة"
            rows={3}
          />
          <div className="md:col-span-2">
            <div className="mb-2 text-xs font-bold text-slate-500">طريقة التأثير</div>
            <div className="grid grid-cols-2 gap-2">
              {(['OFFSET', 'NORMAL'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChange({ ...form, effectMode: mode })}
                  className={`rounded-lg border px-3 py-3 text-sm font-black transition ${
                    form.effectMode === mode
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  {mode === 'OFFSET' ? 'خصم القيمة من الإجمالي' : 'إضافة عادية'}
                </button>
              ))}
            </div>
          </div>

          {preview ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950 md:col-span-2">
            <div className="mb-3 font-black">معاينة الأرصدة قبل الحفظ</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <span>لنا قبل العملية: <b>{formatMoney(preview.ourAmount, currencies.find((currency) => currency.id === form.currencyId))}</b></span>
              <span>علينا قبل العملية: <b>{formatMoney(preview.theirAmount, currencies.find((currency) => currency.id === form.currencyId))}</b></span>
              <span>قيمة العملية: <b>{formatMoney(preview.amount, currencies.find((currency) => currency.id === form.currencyId))}</b></span>
              <span>طريقة التأثير: <b>{form.effectMode === 'OFFSET' ? 'خصم من الإجمالي' : 'إضافة عادية'}</b></span>
              <span>لنا بعد العملية: <b>{formatMoney(preview.ourAfter, currencies.find((currency) => currency.id === form.currencyId))}</b></span>
              <span>علينا بعد العملية: <b>{formatMoney(preview.theirAfter, currencies.find((currency) => currency.id === form.currencyId))}</b></span>
              {!preview.valid ? <span className="font-bold text-red-600 sm:col-span-2">{preview.message}</span> : null}
            </div>
          </div>
          ) : null}
        </div>

        <div className="grid gap-3 border-t border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            إلغاء
          </button>
          <button
            disabled={saving || Boolean(preview && !preview.valid)}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
            {saving ? 'جار الحفظ...' : 'حفظ الحركة'}
          </button>
        </div>
      </form>
    </div>
  );
}
