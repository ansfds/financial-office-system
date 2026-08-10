'use client';

import { ChevronDown, ChevronUp, Copy, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { formatMoney } from '@/lib/format';

type CurrencyOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

type FastCardRow = {
  id: string;
  cardLast4: string;
  valueUsd: string;
  agreedAmount: string;
  currencyId: string;
  bankName: string;
  notes: string;
};

type Props = {
  people: any[];
  selectedPerson?: any | null;
  currencies: CurrencyOption[];
  onClose: () => void;
  onSaved: (batch: any) => void;
};

function newRow(defaults: { valueUsd: string; agreedAmount: string; currencyId: string; bankName: string }): FastCardRow {
  return {
    id: crypto.randomUUID(),
    cardLast4: '',
    valueUsd: defaults.valueUsd,
    agreedAmount: defaults.agreedAmount,
    currencyId: defaults.currencyId,
    bankName: defaults.bankName,
    notes: '',
  };
}

function numericValue(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanLast4(value: string) {
  return value.replace(/\D/g, '').slice(-4);
}

export default function FastCardEntryModal({ people, selectedPerson, currencies, onClose, onSaved }: Props) {
  const cardCurrencies = currencies.filter((currency) => ['USD', 'LYD'].includes(currency.code));
  const defaultCurrencyId = cardCurrencies.find((currency) => currency.code === 'USD')?.id || cardCurrencies[0]?.id || '';
  const [mode, setMode] = useState(selectedPerson ? 'existing' : 'new');
  const [personId, setPersonId] = useState(selectedPerson?.id || people[0]?.id || '');
  const [newPerson, setNewPerson] = useState({ fullName: '', phone: '', address: '', notes: '' });
  const [defaults, setDefaults] = useState({
    count: '1',
    valueUsd: '',
    agreedAmount: '',
    currencyId: defaultCurrencyId,
    bankName: '',
    notes: '',
  });
  const [rows, setRows] = useState<FastCardRow[]>([newRow({ valueUsd: '', agreedAmount: '', currencyId: defaultCurrencyId, bankName: '' })]);
  const [bulkText, setBulkText] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set(rows.map((row) => row.id)));

  const duplicateLast4 = useMemo(() => {
    const values = rows.map((row) => row.cardLast4).filter(Boolean);
    return values.find((value, index) => values.indexOf(value) !== index) || '';
  }, [rows]);

  const summary = useMemo(
    () => ({
      original: rows.reduce((sum, row) => sum + numericValue(row.valueUsd), 0),
      agreed: rows.reduce((sum, row) => sum + numericValue(row.agreedAmount), 0),
      completeRows: rows.filter((row) => row.cardLast4.length === 4 && numericValue(row.agreedAmount) > 0).length,
    }),
    [rows],
  );

  function setCount(value: string) {
    const count = Math.max(1, Math.min(200, Number(value || 1)));
    setDefaults((current) => ({ ...current, count: String(count) }));
    setRows((current) => {
      if (current.length === count) return current;
      if (current.length > count) return current.slice(0, count);
      const next = [
        ...current,
        ...Array.from({ length: count - current.length }, () =>
          newRow({
            valueUsd: defaults.valueUsd,
            agreedAmount: defaults.agreedAmount,
            currencyId: defaults.currencyId,
            bankName: defaults.bankName,
          }),
        ),
      ];
      setExpandedRows((currentExpanded) => new Set([...currentExpanded, ...next.map((row) => row.id)]));
      return next;
    });
  }

  function patchRow(id: string, patch: Partial<FastCardRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function hasDraftData() {
    return Boolean(
      newPerson.fullName ||
        newPerson.phone ||
        newPerson.address ||
        defaults.valueUsd ||
        defaults.agreedAmount ||
        defaults.bankName ||
        defaults.notes ||
        bulkText ||
        rows.some((row) => row.cardLast4 || row.valueUsd || row.agreedAmount || row.bankName || row.notes),
    );
  }

  function requestClose() {
    if (!saving && hasDraftData() && !window.confirm('توجد بيانات غير محفوظة. هل تريد إغلاق النافذة؟')) return;
    onClose();
  }

  function toggleRow(id: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyDefaults() {
    const hasRowData = rows.some(
      (row) =>
        row.cardLast4 ||
        row.valueUsd !== defaults.valueUsd ||
        row.agreedAmount !== defaults.agreedAmount ||
        row.currencyId !== defaults.currencyId ||
        row.bankName !== defaults.bankName,
    );
    if (hasRowData && !window.confirm('سيتم تطبيق القيم الافتراضية على كل الصفوف. هل تريد المتابعة؟')) return;
    setRows((current) =>
      current.map((row) => ({
        ...row,
        valueUsd: defaults.valueUsd,
        agreedAmount: defaults.agreedAmount,
        currencyId: defaults.currencyId,
        bankName: defaults.bankName,
      })),
    );
  }

  function pasteLast4s() {
    const values = bulkText
      .split(/[\s,;،]+/)
      .map(cleanLast4)
      .filter((value) => value.length === 4);
    if (!values.length) return toast.error('الصق أرقامًا صحيحة من 4 خانات');
    setRows((current) =>
      current.map((row, index) => (values[index] ? { ...row, cardLast4: values[index] } : row)),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (mode === 'existing' && !personId) return toast.error('اختر الزبون');
    if (mode === 'new' && !newPerson.fullName.trim()) return toast.error('أدخل اسم الزبون الجديد');
    if (!rows.length) return toast.error('أضف بطاقة واحدة على الأقل');
    if (duplicateLast4) return toast.error(`آخر 4 أرقام مكررة داخل العملية: ${duplicateLast4}`);

    const incomplete = rows.some((row) => row.cardLast4.length !== 4 || numericValue(row.agreedAmount) <= 0);
    if (incomplete) return toast.error('أكمل آخر 4 أرقام والسعر المتفق عليه لكل بطاقة');

    setSaving(true);
    const response = await fetch('/api/inventory/received-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personId: mode === 'existing' ? personId : null,
        newPerson: mode === 'new' ? newPerson : null,
        currencyId: defaults.currencyId || null,
        cardCount: rows.length,
        valueUsdPerCard: numericValue(defaults.valueUsd),
        agreedAmountPerCard: numericValue(defaults.agreedAmount || rows[0]?.agreedAmount),
        commonBankName: defaults.bankName || undefined,
        notes: defaults.notes || undefined,
        cards: rows.map((row) => ({
          cardLast4: row.cardLast4,
          valueUsd: numericValue(row.valueUsd),
          agreedAmount: numericValue(row.agreedAmount),
          currencyId: row.currencyId || defaults.currencyId || null,
          bankName: row.bankName || undefined,
          notes: row.notes || undefined,
        })),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(result.error || 'تعذر حفظ معاملة البطاقات');

    const warnings = result.entryTransaction?.duplicateWarnings || [];
    toast.success(`تم حفظ ${result.cards?.length || rows.length} بطاقة`);
    if (Array.isArray(warnings) && warnings.length) {
      toast.warning(`تنبيه: ${warnings.length} رقمًا من آخر 4 موجودة سابقًا`);
    }
    onSaved(result);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm md:items-center md:p-3">
      <form
        onSubmit={submit}
        className="sheet-panel flex h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 md:h-auto md:max-h-[94vh] md:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-black">إضافة معاملة بطاقات</h2>
            <p className="mt-1 text-sm text-slate-500">
              {summary.completeRows} من {rows.length} صف مكتمل
            </p>
          </div>
          <button type="button" onClick={requestClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-bold ${mode === 'existing' ? 'bg-white shadow-sm dark:bg-slate-800' : 'text-slate-500'}`}
              >
                زبون موجود
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-bold ${mode === 'new' ? 'bg-white shadow-sm dark:bg-slate-800' : 'text-slate-500'}`}
              >
                زبون جديد
              </button>
            </div>
            {mode === 'existing' ? (
              <select value={personId} onChange={(event) => setPersonId(event.target.value)} className="md:col-span-3">
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.customerNo ? `${person.customerNo} - ` : ''}
                    {person.fullName}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input value={newPerson.fullName} onChange={(event) => setNewPerson({ ...newPerson, fullName: event.target.value })} placeholder="اسم الزبون الجديد" />
                <input value={newPerson.phone} onChange={(event) => setNewPerson({ ...newPerson, phone: event.target.value })} placeholder="الهاتف" />
                <input value={newPerson.address} onChange={(event) => setNewPerson({ ...newPerson, address: event.target.value })} placeholder="العنوان" />
              </>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-6">
            <input type="number" min="1" max="200" value={defaults.count} onChange={(event) => setCount(event.target.value)} placeholder="عدد البطاقات" />
            <input type="number" min="0" step="0.000001" value={defaults.valueUsd} onChange={(event) => setDefaults({ ...defaults, valueUsd: event.target.value })} placeholder="الأصل الافتراضي" />
            <input type="number" min="0" step="0.000001" value={defaults.agreedAmount} onChange={(event) => setDefaults({ ...defaults, agreedAmount: event.target.value })} placeholder="المتفق الافتراضي" />
            <select value={defaults.currencyId} onChange={(event) => setDefaults({ ...defaults, currencyId: event.target.value })}>
              {cardCurrencies.map((currency) => (
                <option key={currency.id} value={currency.id}>
                  {currency.name}
                </option>
              ))}
            </select>
            <input value={defaults.bankName} onChange={(event) => setDefaults({ ...defaults, bankName: event.target.value })} placeholder="المصرف" />
            <button type="button" onClick={applyDefaults} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 font-bold text-white dark:bg-slate-100 dark:text-slate-950">
              <Copy size={16} />
              تطبيق
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={2} placeholder="لصق جماعي لآخر 4 أرقام، كل رقم في سطر أو مفصول بمسافة" />
            <button type="button" onClick={pasteLast4s} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 font-bold dark:border-slate-700">
              <Plus size={16} />
              تعبئة
            </button>
          </div>

          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-[900px]">
              <thead>
                <tr>
                  <th>#</th>
                  <th>آخر 4</th>
                  <th>الأصل</th>
                  <th>المتفق</th>
                  <th>العملة</th>
                  <th>المصرف</th>
                  <th>ملاحظة</th>
                  <th>خيارات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>
                      <input inputMode="numeric" maxLength={4} value={row.cardLast4} onChange={(event) => patchRow(row.id, { cardLast4: cleanLast4(event.target.value) })} />
                    </td>
                    <td>
                      <input type="number" min="0" step="0.000001" value={row.valueUsd} onChange={(event) => patchRow(row.id, { valueUsd: event.target.value })} />
                    </td>
                    <td>
                      <input type="number" min="0" step="0.000001" value={row.agreedAmount} onChange={(event) => patchRow(row.id, { agreedAmount: event.target.value })} />
                    </td>
                    <td>
                      <select value={row.currencyId} onChange={(event) => patchRow(row.id, { currencyId: event.target.value })}>
                        {cardCurrencies.map((currency) => (
                          <option key={currency.id} value={currency.id}>
                            {currency.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={row.bankName} onChange={(event) => patchRow(row.id, { bankName: event.target.value })} />
                    </td>
                    <td>
                      <input value={row.notes} onChange={(event) => patchRow(row.id, { notes: event.target.value })} />
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setRows((current) => {
                              const next = [...current];
                              next.splice(index + 1, 0, { ...row, id: crypto.randomUUID(), cardLast4: '' });
                              setDefaults((currentDefaults) => ({ ...currentDefaults, count: String(next.length) }));
                              return next;
                            })
                          }
                          className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          aria-label="نسخ الصف"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setRows((current) => {
                              if (current.length === 1) return current;
                              const next = current.filter((item) => item.id !== row.id);
                              setDefaults((currentDefaults) => ({ ...currentDefaults, count: String(next.length) }));
                              return next;
                            })
                          }
                          className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-200"
                          aria-label="حذف الصف"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stagger-list mt-4 grid gap-3 md:hidden">
            {rows.map((row, index) => {
              const expanded = expandedRows.has(row.id);
              const complete = row.cardLast4.length === 4 && numericValue(row.agreedAmount) > 0;
              return (
                <article
                  key={row.id}
                  style={{ '--stagger': index } as CSSProperties}
                  className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    onClick={() => toggleRow(row.id)}
                    className="flex w-full items-center justify-between gap-3 text-right"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-500">بطاقة #{index + 1}</div>
                      <div className="mt-1 font-black">{row.cardLast4 || 'آخر 4 غير مدخلة'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md px-2 py-1 text-xs font-bold ${complete ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-200'}`}>
                        {complete ? 'مكتملة' : 'ناقصة'}
                      </span>
                      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </button>

                  <div className={`grid overflow-hidden transition-all duration-200 ${expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="grid gap-3">
                        <input inputMode="numeric" maxLength={4} value={row.cardLast4} onChange={(event) => patchRow(row.id, { cardLast4: cleanLast4(event.target.value) })} placeholder="آخر 4 أرقام" />
                        <div className="grid grid-cols-2 gap-2">
                          <input inputMode="decimal" type="number" min="0" step="0.000001" value={row.valueUsd} onChange={(event) => patchRow(row.id, { valueUsd: event.target.value })} placeholder="الأصل" />
                          <input inputMode="decimal" type="number" min="0" step="0.000001" value={row.agreedAmount} onChange={(event) => patchRow(row.id, { agreedAmount: event.target.value })} placeholder="المتفق" />
                        </div>
                        <select value={row.currencyId} onChange={(event) => patchRow(row.id, { currencyId: event.target.value })}>
                          {cardCurrencies.map((currency) => (
                            <option key={currency.id} value={currency.id}>
                              {currency.code}
                            </option>
                          ))}
                        </select>
                        <input value={row.bankName} onChange={(event) => patchRow(row.id, { bankName: event.target.value })} placeholder="المصرف" />
                        <input value={row.notes} onChange={(event) => patchRow(row.id, { notes: event.target.value })} placeholder="ملاحظة" />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRows((current) => {
                                const next = [...current];
                                const copy = { ...row, id: crypto.randomUUID(), cardLast4: '' };
                                next.splice(index + 1, 0, copy);
                                setExpandedRows((currentExpanded) => new Set([...currentExpanded, copy.id]));
                                setDefaults((currentDefaults) => ({ ...currentDefaults, count: String(next.length) }));
                                return next;
                              })
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <Copy size={15} />
                            نسخ
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRows((current) => {
                                if (current.length === 1) return current;
                                const next = current.filter((item) => item.id !== row.id);
                                setExpandedRows((currentExpanded) => {
                                  const updated = new Set(currentExpanded);
                                  updated.delete(row.id);
                                  return updated;
                                });
                                setDefaults((currentDefaults) => ({ ...currentDefaults, count: String(next.length) }));
                                return next;
                              })
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200"
                          >
                            <Trash2 size={15} />
                            حذف
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {duplicateLast4 ? (
            <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200">
              يوجد تكرار داخل العملية: {duplicateLast4}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 md:grid-cols-[1fr_auto_auto]">
          <div className="text-sm text-slate-500">
            الإجمالي الأصلي: <b>{formatMoney(summary.original, '$')}</b>، المتفق عليه: <b>{formatMoney(summary.agreed, '$')}</b>
          </div>
          <button type="button" onClick={requestClose} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-3 font-bold dark:border-slate-700">
            إلغاء
          </button>
          <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-indigo-400">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
            حفظ المعاملة
          </button>
        </div>
      </form>
    </div>
  );
}
