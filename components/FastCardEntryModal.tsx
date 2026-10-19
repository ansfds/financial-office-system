'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import CenteredDialog from './CenteredDialog';
import { cardEntryStatuses, cardStatusLabels } from '@/lib/card-display';
type Props = {
  people: any[];
  selectedPerson?: any;
  currencies: any[];
  onClose: () => void;
  onSaved: (batch: any) => void;
};
type Row = {
  id: string;
  cardLast4: string;
  valueUsd: string;
  agreedAmount: string;
  currencyId: string;
  status: string;
};
export default function FastCardEntryModal({ people, selectedPerson, currencies, onClose, onSaved }: Props) {
  const options = currencies.filter((c) => ['USD', 'LYD'].includes(c.code));
  const blank = (): Row => ({
    id: crypto.randomUUID(),
    cardLast4: '',
    valueUsd: '',
    agreedAmount: '',
    currencyId: options.find((c) => c.code === 'USD')?.id || options[0]?.id || '',
    status: 'RECEIVED',
  });
  const [person, setPerson] = useState<any>(selectedPerson || null),
    [existing, setExisting] = useState(Boolean(selectedPerson));
  const [personForm, setPersonForm] = useState({ fullName: '', phone: '', phoneSecondary: '', notes: '' });
  const [matches, setMatches] = useState(people),
    [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([blank()]),
    [busy, setBusy] = useState(false),
    [duplicate, setDuplicate] = useState<any>(null);
  useEffect(() => {
    if (!existing || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/people?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then(setMatches)
        .catch(() => null);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [existing, query]);
  const dirty = (r: Row) => Boolean(r.cardLast4 || r.valueUsd || r.agreedAmount || r.status !== 'RECEIVED');
  function resize(value: string) {
    const count = Math.max(1, Math.min(200, Math.trunc(Number(value) || 1)));
    if (
      count < rows.length &&
      rows.slice(count).some(dirty) &&
      !confirm('سيتم حذف بيانات البطاقات الزائدة غير المحفوظة. هل تريد المتابعة؟')
    )
      return;
    setRows((current) =>
      count < current.length
        ? current.slice(0, count)
        : [...current, ...Array.from({ length: count - current.length }, blank)],
    );
  }
  function remove(id: string) {
    const row = rows.find((r) => r.id === id)!;
    if (dirty(row) && !confirm('حذف بيانات هذه البطاقة غير المحفوظة؟')) return;
    setRows(rows.filter((r) => r.id !== id));
  }
  function close() {
    if (busy) return;
    if ((rows.some(dirty) || personForm.fullName) && !confirm('توجد بيانات غير محفوظة. إغلاق النافذة؟'))
      return;
    onClose();
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !rows.length) return;
    if (existing && !person) return toast.error('اختر الزبون');
    setBusy(true);
    setDuplicate(null);
    try {
      const response = await fetch('/api/inventory/received-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: existing ? person.id : null,
          newPerson: existing ? null : personForm,
          cardCount: rows.length,
          agreedAmountPerCard: Number(rows[0].agreedAmount),
          cards: rows.map((r) => ({
            cardLast4: r.cardLast4,
            valueUsd: Number(r.valueUsd),
            agreedAmount: Number(r.agreedAmount),
            currencyId: r.currencyId,
            status: r.status,
          })),
        }),
      });
      const result = await response.json();
      if (response.status === 409 && result.duplicate) {
        setDuplicate(result.duplicate);
        return;
      }
      if (!response.ok) throw new Error(result.error);
      toast.success('تم حفظ البطاقات في معاملة واحدة');
      onSaved(result);
    } catch (e) {
      toast.error((e as Error).message || 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }
  function patch(id: string, key: keyof Row, value: string) {
    setRows(rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  }
  return (
    <CenteredDialog name="fast-card-entry" title="إضافة بطاقات جديدة" onClose={close} busy={busy}>
      <form onSubmit={save} className="space-y-4">
        <div className="flex gap-4">
          <label>
            <input type="radio" checked={!existing} onChange={() => setExisting(false)} /> زبون جديد
          </label>
          <label>
            <input type="radio" checked={existing} onChange={() => setExisting(true)} /> زبون موجود
          </label>
        </div>
        {existing ? (
          <div className="grid gap-2">
            <input
              aria-label="البحث عن زبون"
              placeholder="بحث بالاسم أو الهاتف أو الكود"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              required
              aria-label="اسم الزبون"
              value={person?.id || ''}
              onChange={(e) => setPerson(matches.find((p) => p.id === e.target.value) || selectedPerson)}
            >
              <option value="">اختر زبونًا</option>
              {[...matches, ...(person && !matches.some((p) => p.id === person.id) ? [person] : [])].map(
                (p) => (
                  <option key={p.id} value={p.id}>
                    {p.customerNo} — {p.fullName}
                  </option>
                ),
              )}
            </select>
            <p>
              الهاتف: {person?.phone || '—'} · الهاتف الثاني: {person?.phoneSecondary || '—'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              اسم الزبون
              <input
                required
                minLength={2}
                value={personForm.fullName}
                onChange={(e) => setPersonForm({ ...personForm, fullName: e.target.value })}
              />
            </label>
            <label>
              رقم الهاتف
              <input
                type="tel"
                value={personForm.phone}
                onChange={(e) => setPersonForm({ ...personForm, phone: e.target.value })}
              />
            </label>
            <label>
              رقم هاتف ثاني — اختياري
              <input
                type="tel"
                value={personForm.phoneSecondary}
                onChange={(e) => setPersonForm({ ...personForm, phoneSecondary: e.target.value })}
              />
            </label>
            <label>
              ملاحظات للزبون — اختياري
              <input
                value={personForm.notes}
                onChange={(e) => setPersonForm({ ...personForm, notes: e.target.value })}
              />
            </label>
          </div>
        )}
        {duplicate && (
          <div role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">
            يوجد زبون مشابه، هل تريد استخدامه؟ {duplicate.fullName}
            <button
              type="button"
              className="mr-2 underline"
              onClick={() => {
                setPerson(duplicate);
                setExisting(true);
                setDuplicate(null);
              }}
            >
              استخدامه وإكمال المعاملة
            </button>
          </div>
        )}
        <label className="block">
          كم بطاقة تريد إضافتها؟
          <input
            type="number"
            min={1}
            max={200}
            value={rows.length}
            onChange={(e) => resize(e.target.value)}
          />
        </label>
        {rows.map((row, index) => (
          <fieldset key={row.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-2 text-sm font-bold">بطاقة {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label>
                آخر 4 أرقام
                <input
                  inputMode="numeric"
                  dir="ltr"
                  required
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={row.cardLast4}
                  onChange={(e) => patch(row.id, 'cardLast4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </label>
              <label>
                الإجمالي داخل البطاقة (USD)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={row.valueUsd}
                  onChange={(e) => patch(row.id, 'valueUsd', e.target.value)}
                />
              </label>
              <label>
                المتفق عليه للبطاقة
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={row.agreedAmount}
                  onChange={(e) => patch(row.id, 'agreedAmount', e.target.value)}
                />
              </label>
              <label>
                عملة الدفع
                <select value={row.currencyId} onChange={(e) => patch(row.id, 'currencyId', e.target.value)}>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code === 'USD' ? 'دولار' : 'دينار'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                حالة البطاقة
                <select value={row.status} onChange={(e) => patch(row.id, 'status', e.target.value)}>
                  {cardEntryStatuses.map((s) => (
                    <option key={s} value={s}>
                      {cardStatusLabels[s]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={rows.length <= 1}
                onClick={() => remove(row.id)}
                className="text-red-700"
              >
                حذف
              </button>
            </div>
          </fieldset>
        ))}
        <button disabled={busy} className="w-full rounded-lg bg-blue-700 p-3 font-bold text-white">
          {busy ? 'جار الحفظ…' : 'حفظ المعاملة والبطاقات'}
        </button>
      </form>
    </CenteredDialog>
  );
}
