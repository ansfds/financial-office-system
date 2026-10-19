'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import CenteredDialog from './CenteredDialog';
export default function PersonEditor({
  person,
  onClose,
  onSaved,
}: {
  person?: any;
  onClose: () => void;
  onSaved: (person: any) => void;
}) {
  const [form, setForm] = useState({
    fullName: person?.fullName || '',
    phone: person?.phone || '',
    phoneSecondary: person?.phoneSecondary || '',
    notes: person?.notes || '',
  });
  const [busy, setBusy] = useState(false),
    [duplicate, setDuplicate] = useState<any>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setDuplicate(null);
    try {
      const response = await fetch(person ? `/api/people/${person.id}` : '/api/people', {
        method: person ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (response.status === 409 && result.duplicate) {
        setDuplicate(result.duplicate);
        return;
      }
      if (!response.ok) throw new Error(result.error);
      toast.success('تم حفظ الزبون');
      onSaved(result);
    } catch (e) {
      toast.error((e as Error).message || 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }
  return (
    <CenteredDialog
      name="edit-person"
      title={person ? 'تعديل الزبون' : 'زبون جديد'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={save} className="grid gap-3">
        <label>
          اسم الزبون
          <input
            required
            minLength={2}
            maxLength={200}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </label>
        <label>
          رقم الهاتف
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <label>
          رقم هاتف ثاني — اختياري
          <input
            type="tel"
            value={form.phoneSecondary}
            onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })}
          />
        </label>
        <label>
          ملاحظات — اختياري
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        {duplicate && (
          <div role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">
            يوجد زبون مشابه، هل تريد استخدامه؟ {duplicate.fullName} — {duplicate.phone}
            <button type="button" className="mr-2 font-bold underline" onClick={() => onSaved(duplicate)}>
              استخدام الزبون الموجود
            </button>
          </div>
        )}
        <button disabled={busy} className="rounded-lg bg-blue-700 p-2 text-white">
          {busy ? 'جار الحفظ…' : 'حفظ'}
        </button>
      </form>
    </CenteredDialog>
  );
}
