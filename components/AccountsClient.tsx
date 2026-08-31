'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Edit3, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatMoney } from '@/lib/format';
import { walletBuckets, walletSettlementDirectionLabels } from '@/lib/customer-wallet';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';

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

type CurrencyTotal = {
  currency: CurrencyOption;
  amount: number;
};

type AccountSummary = {
  personId: string;
  customerNo?: string | null;
  fullName: string;
  phone?: string | null;
  rows: AccountRow[];
  ourTotals: CurrencyTotal[];
  theirTotals: CurrencyTotal[];
  lastMovement: string | Date;
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

function numeric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
    return {
      valid: false,
      message: 'لا يمكن أن يصبح الرصيد بالسالب',
      amount,
      ...totals,
      ourAfter: totals.ourAmount,
      theirAfter: totals.theirAmount,
    };
  }

  if (form.effectMode === 'OFFSET') {
    const net = ourAfter - theirAfter;
    ourAfter = net > 0 ? net : 0;
    theirAfter = net < 0 ? Math.abs(net) : 0;
  }

  return { valid: true, message: '', amount, ...totals, ourAfter, theirAfter };
}

function rowDate(value: string | Date) {
  return new Date(value).getTime() || 0;
}

function addTotal(totals: Map<string, CurrencyTotal>, row: AccountRow, amount: number) {
  if (amount <= 0) return;
  const current = totals.get(row.currency.id) || { currency: row.currency, amount: 0 };
  current.amount += amount;
  totals.set(row.currency.id, current);
}

function buildAccountSummaries(rows: AccountRow[]) {
  const summaries = new Map<string, AccountSummary & { ourMap: Map<string, CurrencyTotal>; theirMap: Map<string, CurrencyTotal> }>();

  for (const row of rows) {
    const current =
      summaries.get(row.personId) ||
      {
        personId: row.personId,
        customerNo: row.customerNo,
        fullName: row.fullName,
        phone: row.phone,
        rows: [],
        ourTotals: [],
        theirTotals: [],
        lastMovement: row.lastMovement,
        ourMap: new Map<string, CurrencyTotal>(),
        theirMap: new Map<string, CurrencyTotal>(),
      };

    current.rows.push(row);
    if (rowDate(row.lastMovement) > rowDate(current.lastMovement)) current.lastMovement = row.lastMovement;
    addTotal(current.ourMap, row, row.ourAmount);
    addTotal(current.theirMap, row, row.theirAmount);
    summaries.set(row.personId, current);
  }

  return Array.from(summaries.values()).map((summary) => ({
    ...summary,
    ourTotals: Array.from(summary.ourMap.values()),
    theirTotals: Array.from(summary.theirMap.values()),
  }));
}

function firstUsefulRow(account: AccountSummary | null) {
  return account?.rows.find((row) => row.ourAmount > 0 || row.theirAmount > 0) || account?.rows[0] || null;
}

function accountCurrencies(account: AccountSummary) {
  const currencies = new Map<string, CurrencyOption>();
  for (const row of account.rows) currencies.set(row.currency.id, row.currency);
  return Array.from(currencies.values()).sort((left, right) => left.code.localeCompare(right.code, 'en'));
}

function settlementStatus(settlement: Settlement) {
  return numeric(settlement.balanceAfter) > 0 ? 'نشط' : 'مصفّى';
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
  const [selectedAccount, setSelectedAccount] = useState<AccountSummary | null>(null);
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MovementForm>({
    ...emptyForm,
    personId: people[0]?.id || '',
    currencyId: currencies[0]?.id || '',
    paymentMethod: paymentOptions(currencies, currencies[0]?.id || '')[0]?.paymentMethod || '',
  });

  const accountSummaries = useMemo(() => buildAccountSummaries(rows), [rows]);

  const filteredAccounts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return accountSummaries;
    return accountSummaries.filter((account) =>
      [
        account.customerNo,
        account.fullName,
        account.phone,
        ...account.rows.flatMap((row) => [row.currency.name, row.currency.code, row.paymentLabel]),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [accountSummaries, q]);

  const selectedSettlements = useMemo(
    () => (selectedAccount ? settlements.filter((settlement) => settlement.personId === selectedAccount.personId) : []),
    [selectedAccount, settlements],
  );

  function resetForm(row?: AccountRow | null, personId?: string) {
    const currencyId = row?.currency.id || currencies[0]?.id || '';
    const options = paymentOptions(currencies, currencyId);
    setForm({
      ...emptyForm,
      personId: row?.personId || personId || people[0]?.id || '',
      currencyId,
      paymentMethod: row?.paymentMethod || options[0]?.paymentMethod || '',
    });
  }

  function openAdd(row?: AccountRow | null, personId?: string) {
    resetForm(row, personId);
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

  function selectCurrency(currencyId: string) {
    const options = paymentOptions(currencies, currencyId);
    setForm({ ...form, currencyId, paymentMethod: options[0]?.paymentMethod || '' });
  }

  async function submit(event: FormEvent) {
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
    try {
      const response = await fetch(`/api/people/${form.personId}/wallet-settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return toast.error(result.error || 'تعذر حفظ الحركة');

      toast.success('تم حفظ الحركة المالية');
      setOpenForm(false);
      router.refresh();
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء حفظ الحركة');
    } finally {
      setSaving(false);
    }
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

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/people/${editing.personId}/wallet-settlements/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return toast.error(result.error || 'تعذر تعديل الحركة');

      toast.success('تم تعديل الحركة وإعادة حساب الرصيد');
      setEditing(null);
      router.refresh();
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء تعديل الحركة');
    } finally {
      setSaving(false);
    }
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
      <div className="accounts-toolbar mb-4 grid gap-2 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="h-10 pr-9 text-sm md:h-auto md:text-base"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="بحث باسم الزبون أو رقمه أو العملة"
          />
        </div>
        <button
          type="button"
          onClick={() => openAdd(null)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white md:text-base"
        >
          <Plus size={17} />
          إضافة حركة
        </button>
      </div>

      <section className="accounts-simple-table table-wrap">
        <table>
          <thead>
            <tr>
              <th>اسم الزبون</th>
              <th>لنا</th>
              <th>علينا</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((account, index) => (
              <tr
                key={account.personId}
                style={{ '--stagger': index } as CSSProperties}
                onClick={() => setSelectedAccount(account)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedAccount(account);
                  }
                }}
                tabIndex={0}
                className="cursor-pointer"
              >
                <td>
                  <div className="min-w-0">
                    <div className="truncate font-black">{account.fullName}</div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-500">{account.customerNo || '—'}</div>
                  </div>
                </td>
                <td className="align-top">
                  <AmountStack totals={account.ourTotals} currencies={accountCurrencies(account)} tone="green" />
                </td>
                <td className="align-top">
                  <AmountStack totals={account.theirTotals} currencies={accountCurrencies(account)} tone="red" />
                </td>
              </tr>
            ))}
            {!filteredAccounts.length ? (
              <tr>
                <td colSpan={3} className="text-center text-slate-500">
                  لا توجد حسابات مطابقة.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

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

      {selectedAccount ? (
        <ModalLayer name="account-details" onClose={() => setSelectedAccount(null)} className="md:items-stretch md:justify-start">
          <ModalBackdrop className="bg-slate-950/45" aria-label="إغلاق التفاصيل" onClick={() => setSelectedAccount(null)} />
          <aside className="modal-panel modal-panel--drawer sheet-panel max-w-4xl dark:bg-slate-950 md:w-[78vw]">
            <div className="modal-header flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-bold text-indigo-600">{selectedAccount.customerNo || '—'}</div>
                <h2 className="truncate text-xl font-black md:text-2xl">{selectedAccount.fullName}</h2>
                <p className="mt-1 truncate text-xs text-slate-500 md:text-sm">آخر حركة: {formatDateTime(selectedAccount.lastMovement)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAccount(null)}
                className="modal-close text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق"
              >
                <X size={22} />
              </button>
            </div>

            <div className="modal-body p-4 md:p-5" data-modal-scroll-body>
              <div className="accounts-detail-strip mb-4">
                <span className="accounts-detail-strip__green">
                  لنا <b><AmountInline totals={selectedAccount.ourTotals} currencies={accountCurrencies(selectedAccount)} /></b>
                </span>
                <span className="accounts-detail-strip__red">
                  علينا <b><AmountInline totals={selectedAccount.theirTotals} currencies={accountCurrencies(selectedAccount)} /></b>
                </span>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openAdd(firstUsefulRow(selectedAccount), selectedAccount.personId)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white"
                >
                  <Plus size={16} />
                  إضافة حركة
                </button>
                {firstUsefulRow(selectedAccount) ? (
                  <button
                    type="button"
                    onClick={() => openRepayment(firstUsefulRow(selectedAccount) as AccountRow)}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
                  >
                    <Plus size={16} />
                    تم السداد
                  </button>
                ) : null}
              </div>

              <div className="accounts-movements-table table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الحساب</th>
                      <th>المبلغ</th>
                      <th>العملة</th>
                      <th>ملاحظة</th>
                      <th>مدفوع</th>
                      <th>المتبقي</th>
                      <th>الحالة</th>
                      <th>خيارات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSettlements.map((settlement) => (
                      <tr key={settlement.id}>
                        <td>{formatDateTime(settlement.occurredAt)}</td>
                        <td className={settlement.accountType === 'DEBT' ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                          {settlement.accountType === 'DEBT' ? 'لنا' : 'علينا'}
                        </td>
                        <td className="font-black">{formatMoney(settlement.amount, settlement.currency)}</td>
                        <td>{settlement.currency.code}</td>
                        <td>
                          <div className="max-w-[16rem] whitespace-normal text-sm">{settlement.note || settlement.reason || '—'}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {walletSettlementDirectionLabels[settlement.direction]} · {movementEffectLabel(settlement)}
                          </div>
                        </td>
                        <td>
                          {settlement.direction === 'SUBTRACT' ? (
                            <span className="font-bold text-emerald-600">{formatMoney(settlement.amount, settlement.currency)}</span>
                          ) : (
                            <span className="font-bold text-emerald-600/55">{formatMoney(0, settlement.currency)}</span>
                          )}
                        </td>
                        <td className="font-bold">{formatMoney(settlement.balanceAfter, settlement.currency)}</td>
                        <td>
                          <span
                            className={`rounded-md px-2 py-1 text-xs font-black ${
                              numeric(settlement.balanceAfter) > 0
                                ? 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-200'
                                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                            }`}
                          >
                            {settlementStatus(settlement)}
                          </span>
                        </td>
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
                          لا توجد حركات مالية لهذا الزبون.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        </ModalLayer>
      ) : null}
    </>
  );
}

function displayTotals(totals: CurrencyTotal[], currencies: CurrencyOption[]) {
  if (!currencies.length) return totals;
  const byCurrency = new Map(totals.map((total) => [total.currency.id, total]));
  return currencies.map((currency) => byCurrency.get(currency.id) || { currency, amount: 0 });
}

function AmountInline({ totals, currencies }: { totals: CurrencyTotal[]; currencies: CurrencyOption[] }) {
  const values = displayTotals(totals, currencies);
  if (!values.length) return <>{formatMoney(0, '$')}</>;
  return <>{values.map((total) => formatMoney(total.amount, total.currency)).join(' • ')}</>;
}

function AmountStack({ totals, currencies, tone }: { totals: CurrencyTotal[]; currencies: CurrencyOption[]; tone: 'green' | 'red' }) {
  const values = displayTotals(totals, currencies);
  if (!values.length) return <span className={tone === 'green' ? 'text-emerald-600/55' : 'text-red-600/55'}>{formatMoney(0, '$')}</span>;
  const color = tone === 'green' ? 'text-emerald-600' : 'text-red-600';

  return (
    <div className={`grid gap-1 ${color}`}>
      {values.map((total) => (
        <span key={total.currency.id} className={`num font-black ${total.amount === 0 ? 'opacity-55' : ''}`}>
          {formatMoney(total.amount, total.currency)}
        </span>
      ))}
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
  onSubmit: (event: FormEvent) => void;
  onChange: (form: MovementForm) => void;
  onCurrencyChange: (currencyId: string) => void;
}) {
  const options = paymentOptions(currencies, form.currencyId);

  return (
    <ModalLayer name="wallet-movement" onClose={onClose}>
      <ModalBackdrop onClick={onClose} />
      <form onSubmit={onSubmit} className="modal-panel sheet-panel max-w-2xl dark:bg-slate-900">
        <div className="modal-header flex items-start justify-between gap-4">
          <h2 className="text-lg font-black">{title}</h2>
          <button type="button" onClick={onClose} className="modal-close text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body grid gap-4 p-4 md:grid-cols-2" data-modal-scroll-body>
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

        <div className="modal-footer grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
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
    </ModalLayer>
  );
}
