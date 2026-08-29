'use client';

import { Camera, CheckCircle2, ChevronDown, ChevronUp, Copy, ImagePlus, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { formatMoney } from '@/lib/format';
import { STANDARD_CUSTOMER_CARD_VALUE_USD } from '@/lib/customer-cards';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';
import { processCardImageFile, type ProcessedCardImage } from '@/components/card-image-tools';

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
  imageConfirmed: boolean;
  cardImageDataUrl?: string;
  cardThumbnailDataUrl?: string;
  cardImageMimeType?: ProcessedCardImage['cardImageMimeType'];
  cardImageSize?: number;
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
    imageConfirmed: false,
  };
}

function numericValue(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanLast4(value: string) {
  return value.replace(/\D/g, '').slice(-4);
}

const defaultOriginalCardValue = String(STANDARD_CUSTOMER_CARD_VALUE_USD);

export default function FastCardEntryModal({ people, selectedPerson, currencies, onClose, onSaved }: Props) {
  const cardCurrencies = currencies.filter((currency) => ['USD', 'LYD'].includes(currency.code));
  const defaultCurrencyId = cardCurrencies.find((currency) => currency.code === 'USD')?.id || cardCurrencies[0]?.id || '';
  const [mode, setMode] = useState(selectedPerson ? 'existing' : 'new');
  const [personId, setPersonId] = useState(selectedPerson?.id || people[0]?.id || '');
  const [newPerson, setNewPerson] = useState({ fullName: '', phone: '', address: '', notes: '' });
  const [defaults, setDefaults] = useState({
    count: '1',
    valueUsd: defaultOriginalCardValue,
    agreedAmount: '',
    currencyId: defaultCurrencyId,
    bankName: '',
    notes: '',
  });
  const [rows, setRows] = useState<FastCardRow[]>([
    newRow({ valueUsd: defaultOriginalCardValue, agreedAmount: '', currencyId: defaultCurrencyId, bankName: '' }),
  ]);
  const [bulkText, setBulkText] = useState('');
  const [saving, setSaving] = useState(false);
  const [processingImageId, setProcessingImageId] = useState('');
  const [lastSavedPerson, setLastSavedPerson] = useState<any | null>(null);
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
        defaults.valueUsd !== defaultOriginalCardValue ||
        defaults.agreedAmount ||
        defaults.bankName ||
        defaults.notes ||
        bulkText ||
        rows.some(
          (row) =>
            row.cardLast4 ||
            row.valueUsd !== defaultOriginalCardValue ||
            row.agreedAmount ||
            row.bankName ||
            row.notes ||
            row.cardImageDataUrl,
        ),
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

  async function attachImage(rowId: string, file?: File | null) {
    if (!file) return;
    setProcessingImageId(rowId);
    try {
      const processed = await processCardImageFile(file);
      patchRow(rowId, { ...processed, imageConfirmed: true });
      toast.success('تم تجهيز صورة البطاقة');
    } catch (error) {
      const message = (error as Error).message;
      toast.error(
        message === 'IMAGE_TOO_LARGE'
          ? 'الصورة ما زالت كبيرة بعد الضغط، جرّب تصويرها من مسافة أقرب'
          : message === 'INVALID_IMAGE_TYPE'
            ? 'اختر صورة بطاقة صحيحة'
            : 'تعذر تجهيز صورة البطاقة',
      );
    } finally {
      setProcessingImageId('');
    }
  }

  function clearImage(rowId: string) {
    patchRow(rowId, {
      imageConfirmed: false,
      cardImageDataUrl: undefined,
      cardThumbnailDataUrl: undefined,
      cardImageMimeType: undefined,
      cardImageSize: undefined,
    });
  }

  function resetRowsForSamePerson(savedPersonId?: string) {
    const row = newRow({
      valueUsd: defaults.valueUsd || defaultOriginalCardValue,
      agreedAmount: defaults.agreedAmount,
      currencyId: defaults.currencyId,
      bankName: defaults.bankName,
    });
    if (savedPersonId) {
      setMode('existing');
      setPersonId(savedPersonId);
    }
    setNewPerson({ fullName: '', phone: '', address: '', notes: '' });
    setRows([row]);
    setExpandedRows(new Set([row.id]));
    setBulkText('');
    setDefaults((current) => ({ ...current, count: '1' }));
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
    try {
      const response = await fetch('/api/inventory/received-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: selectedPerson?.id || (mode === 'existing' ? personId : null),
          newPerson: mode === 'new' ? newPerson : null,
          currencyId: defaults.currencyId || null,
          cardCount: rows.length,
          valueUsdPerCard: numericValue(defaults.valueUsd || defaultOriginalCardValue),
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
            cardImageDataUrl: row.cardImageDataUrl || null,
            cardThumbnailDataUrl: row.cardThumbnailDataUrl || null,
            cardImageMimeType: row.cardImageMimeType || null,
            cardImageSize: row.cardImageSize || null,
          })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return toast.error(result.error || 'تعذر حفظ معاملة البطاقات');

      const warnings = result.entryTransaction?.duplicateWarnings || [];
      toast.success(`تم حفظ ${result.cards?.length || rows.length} بطاقة`);
      if (Array.isArray(warnings) && warnings.length) {
        toast.warning(`تنبيه: ${warnings.length} رقمًا من آخر 4 موجودة سابقًا`);
      }
      setLastSavedPerson(result.person || { id: result.personId, fullName: selectedPerson?.fullName || '' });
      resetRowsForSamePerson(result.personId);
      onSaved(result);
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء حفظ معاملة البطاقات');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalLayer name="fast-card-entry" onClose={requestClose}>
      <ModalBackdrop onClick={requestClose} />
      <form
        onSubmit={submit}
        className="modal-panel sheet-panel max-w-6xl dark:bg-slate-950"
      >
        <div className="modal-header flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">إضافة بطاقة جديدة</h2>
            <p className="mt-1 text-sm text-slate-500">
              {summary.completeRows} من {rows.length} صف مكتمل
            </p>
          </div>
          <button type="button" onClick={requestClose} className="modal-close text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق">
            <X size={22} />
          </button>
        </div>

        <div className="modal-body p-4" data-modal-scroll-body>
          {selectedPerson ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
              <div className="text-xs font-bold text-emerald-700 dark:text-emerald-200">سيتم ربط البطاقة بهذا الزبون مباشرة</div>
              <div className="mt-1 text-lg font-black">{selectedPerson.fullName}</div>
              <div className="text-sm text-slate-600 dark:text-slate-300">{selectedPerson.phone || selectedPerson.customerNo || 'زبون محدد'}</div>
            </div>
          ) : (
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
                  <textarea value={newPerson.notes} onChange={(event) => setNewPerson({ ...newPerson, notes: event.target.value })} placeholder="ملاحظات الزبون" rows={2} className="md:col-span-4" />
                </>
              )}
            </div>
          )}

          {lastSavedPerson ? (
            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={22} />
                <div>
                  <div className="font-black">تم الحفظ بنجاح</div>
                  <div className="text-sm opacity-80">{lastSavedPerson.fullName || 'يمكن إضافة بطاقة أخرى لنفس الزبون الآن'}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => resetRowsForSamePerson(lastSavedPerson.id)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-black text-white"
              >
                <Plus size={16} />
                إضافة بطاقة أخرى لنفس الزبون
              </button>
            </div>
          ) : null}

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
            <table className="min-w-[1060px]">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الصورة</th>
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
                      <div className="grid min-w-36 gap-2">
                        {row.cardThumbnailDataUrl ? (
                          <img src={row.cardThumbnailDataUrl} alt="معاينة البطاقة" className="h-20 w-full rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 dark:border-slate-700">
                            <ImagePlus size={20} />
                          </div>
                        )}
                        <input
                          id={`desktop-card-camera-${row.id}`}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          onChange={(event) => {
                            void attachImage(row.id, event.target.files?.[0]);
                            event.currentTarget.value = '';
                          }}
                        />
                        <label
                          htmlFor={`desktop-card-camera-${row.id}`}
                          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-950"
                        >
                          {processingImageId === row.id ? <Loader2 className="animate-spin" size={14} /> : <Camera size={14} />}
                          {row.cardThumbnailDataUrl ? 'إعادة' : 'تصوير'}
                        </label>
                      </div>
                    </td>
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
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                          <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800">
                            {row.cardThumbnailDataUrl ? (
                              <img src={row.cardThumbnailDataUrl} alt="معاينة البطاقة" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                                <ImagePlus size={34} />
                                <span className="text-sm font-bold">لم يتم تصوير البطاقة بعد</span>
                              </div>
                            )}
                            {row.imageConfirmed ? (
                              <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white shadow-lg">
                                <CheckCircle2 size={14} />
                                تم التأكيد
                              </div>
                            ) : null}
                          </div>
                          <input
                            id={`mobile-card-camera-${row.id}`}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="sr-only"
                            onChange={(event) => {
                              void attachImage(row.id, event.target.files?.[0]);
                              event.currentTarget.value = '';
                            }}
                          />
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label
                              htmlFor={`mobile-card-camera-${row.id}`}
                              className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white dark:bg-slate-100 dark:text-slate-950"
                            >
                              {processingImageId === row.id ? <Loader2 className="animate-spin" size={17} /> : row.cardThumbnailDataUrl ? <RotateCcw size={17} /> : <Camera size={17} />}
                              {row.cardThumbnailDataUrl ? 'إعادة التصوير' : 'تصوير البطاقة'}
                            </label>
                            <button
                              type="button"
                              onClick={() => (row.cardThumbnailDataUrl ? patchRow(row.id, { imageConfirmed: true }) : undefined)}
                              disabled={!row.cardThumbnailDataUrl}
                              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
                            >
                              <CheckCircle2 size={17} />
                              تأكيد الصورة
                            </button>
                          </div>
                          {row.cardThumbnailDataUrl ? (
                            <button
                              type="button"
                              onClick={() => clearImage(row.id)}
                              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200"
                            >
                              <Trash2 size={16} />
                              حذف الصورة
                            </button>
                          ) : null}
                        </div>
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

        <div className="modal-footer grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <div className="text-sm text-slate-500">
            الإجمالي الأصلي: <b>{formatMoney(summary.original, '$')}</b>، المتفق عليه: <b>{formatMoney(summary.agreed, '$')}</b>
          </div>
          <button type="button" onClick={requestClose} className="rounded-lg border border-slate-200 px-4 py-3 font-bold dark:border-slate-700">
            إلغاء
          </button>
          <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-indigo-400">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
            حفظ البطاقة
          </button>
        </div>
      </form>
    </ModalLayer>
  );
}
