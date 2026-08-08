'use client';

import { useMemo, useState } from 'react';
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
};

function netLabel(row: AccountRow) {
  if (row.net > 0) return `لنا عند الزبون ${formatMoney(row.net, row.currency)}`;
  if (row.net < 0) return `علينا للزبون ${formatMoney(Math.abs(row.net), row.currency)}`;
  return 'الحساب مصفّى';
}

function paymentOptions(currencies: CurrencyOption[], currencyId: string) {
  const currency = currencies.find((item) => item.id === currencyId);
  return walletBuckets.filter((bucket) => bucket.currencyCode === currency?.code);
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
      movementKind: settlement.movementKind || 'ADJUSTMENT',
      settlementMethod: settlement.settlementMethod || '',
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
      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto]">
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

      <section className="grid gap-4 md:grid-cols-3">
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
                      حركة
                    </button>
                    <button
                      type="button"
                      onClick={() => openRepayment(row)}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
                    >
                      <Plus size={16} />
                      تم سداد
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

      <div className="mt-5 grid gap-3 md:hidden">
        {filteredRows.map((row) => (
          <article key={`${row.personId}-${row.currency.id}-${row.paymentMethod}`} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-500">{row.customerNo || '—'}</div>
                <h2 className="mt-1 font-black">{row.fullName}</h2>
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
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSelectedRow(row)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <Eye size={16} />
                التفاصيل
              </button>
              <button
                type="button"
                onClick={() => openAdd(row)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"
              >
                <Plus size={16} />
                حركة
              </button>
              <button
                type="button"
                onClick={() => openRepayment(row)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
              >
                <Plus size={16} />
                تم سداد
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
          <button className="absolute inset-0 bg-slate-950/45" aria-label="إغلاق التفاصيل" onClick={() => setSelectedRow(null)} />
          <aside className="absolute inset-y-0 left-0 w-full max-w-4xl animate-[drawer-in_220ms_ease-out] overflow-y-auto border-r border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950 md:w-[78vw]">
            <div className="mb-5 flex items-start justify-between gap-4">
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
              <Summary title="لنا" value={formatMoney(selectedRow.ourAmount, selectedRow.currency)} tone="green" />
              <Summary title="علينا" value={formatMoney(selectedRow.theirAmount, selectedRow.currency)} tone="red" />
              <Summary title="الصافي" value={netLabel(selectedRow)} />
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openRepayment(selectedRow)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                <Plus size={16} />
                تم سداد
              </button>
              <button
                type="button"
                onClick={() => openAdd(selectedRow)}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                <Plus size={16} />
                حركة جديدة
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>المستخدم</th>
                    <th>الحساب</th>
                    <th>العملية</th>
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
                      <td colSpan={9} className="text-center text-slate-500">
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
    <div className="card p-5">
      <div className="text-sm text-slate-500">{title}</div>
      <div className={`mt-2 text-2xl font-black ${tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function MovementModal({
  title,
  form,
  people,
  currencies,
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
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onChange: (form: MovementForm) => void;
  onCurrencyChange: (currencyId: string) => void;
}) {
  const options = paymentOptions(currencies, form.currencyId);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="text-lg font-black">{title}</h2>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
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
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
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
            {saving ? 'جار الحفظ...' : 'حفظ الحركة'}
          </button>
        </div>
      </form>
    </div>
  );
}
