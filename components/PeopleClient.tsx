'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Edit3, Info, Save, Search, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';

const categoryLabels: Record<string, string> = {
  VIP: 'عميل مميز',
  REGULAR: 'عميل عادي',
};

type PersonForm = {
  fullName: string;
  phone: string;
  address: string;
  notes: string;
  externalId: string;
  category: string;
};

const blankForm: PersonForm = {
  fullName: '',
  phone: '',
  address: '',
  notes: '',
  externalId: '',
  category: 'REGULAR',
};

function formFromPerson(person: any): PersonForm {
  return {
    fullName: person.fullName || '',
    phone: person.phone || '',
    address: person.address || '',
    notes: person.notes || '',
    externalId: person.externalId || '',
    category: person.category || 'REGULAR',
  };
}

export default function PeopleClient({ initialPeople }: { initialPeople: any[] }) {
  const router = useRouter();
  const [items, setItems] = useState<any[]>(initialPeople);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPerson, setEditingPerson] = useState<any | null>(null);
  const [form, setForm] = useState<PersonForm>(blankForm);
  const [editForm, setEditForm] = useState<PersonForm>(blankForm);

  async function load(search = q) {
    setLoading(true);
    const response = await fetch(`/api/people?q=${encodeURIComponent(search)}`, { cache: 'no-store' });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return toast.error(data.error || 'تعذر تحميل الزبائن');
    setItems(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    setItems(initialPeople);
  }, [initialPeople]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const result = await response.json();

    if (!response.ok) return toast.error(result.error || 'تعذر إضافة الزبون');

    toast.success('تمت إضافة الزبون');
    setForm(blankForm);
    load('');
    router.refresh();
  }

  function openEdit(person: any) {
    setEditingPerson(person);
    setEditForm(formFromPerson(person));
  }

  function closeEdit() {
    if (saving) return;
    setEditingPerson(null);
    setEditForm(blankForm);
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingPerson) return;

    setSaving(true);
    const response = await fetch(`/api/people/${editingPerson.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: editForm.fullName,
        phone: editForm.phone || null,
        address: editForm.address || null,
        notes: editForm.notes || null,
        externalId: editForm.externalId || null,
        category: editForm.category,
      }),
    });
    const result = await response.json();
    setSaving(false);

    if (!response.ok) return toast.error(result.error || 'تعذر تعديل الزبون');

    setItems((current) => current.map((person) => (person.id === result.id ? result : person)));
    setEditingPerson(null);
    setEditForm(blankForm);
    toast.success('تم تعديل بيانات الزبون');
    router.refresh();
  }

  return (
    <>
      <form onSubmit={add} className="card mb-6 grid gap-4 p-5 md:grid-cols-2">
        <input
          placeholder="الاسم الكامل"
          value={form.fullName}
          onChange={(event) => setForm({ ...form, fullName: event.target.value })}
        />
        <input
          placeholder="رقم الهاتف"
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />
        <input
          placeholder="العنوان"
          value={form.address}
          onChange={(event) => setForm({ ...form, address: event.target.value })}
        />
        <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
          <option value="REGULAR">عميل عادي</option>
          <option value="VIP">عميل مميز</option>
        </select>
        <textarea
          className="md:col-span-2"
          placeholder="معلومات إضافية"
          value={form.externalId}
          onChange={(event) => setForm({ ...form, externalId: event.target.value })}
          rows={2}
        />
        <textarea
          className="md:col-span-2"
          placeholder="ملاحظات"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          rows={2}
        />
        <button className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500 md:col-span-2">
          <UserPlus size={18} />
          إضافة زبون
        </button>
      </form>

      <div className="card p-5">
        <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="بحث بالاسم أو الهاتف أو رقم العميل"
          />
          <button
            type="button"
            onClick={() => load()}
            className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 font-bold text-white dark:bg-slate-100 dark:text-slate-950"
          >
            <Search size={18} />
            بحث
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>رقم العميل</th>
                <th>الاسم</th>
                <th>التصنيف</th>
                <th>الهاتف</th>
                <th>العنوان</th>
                <th>معلومات إضافية</th>
                <th>ملاحظات</th>
                <th>تاريخ الإضافة</th>
                <th>خيارات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((person) => (
                <tr key={person.id}>
                  <td className="font-bold text-slate-500">{person.customerNo || '—'}</td>
                  <td>
                    <Link className="font-bold text-indigo-600 hover:text-indigo-500" href={`/people/${person.id}`}>
                      {person.fullName}
                    </Link>
                  </td>
                  <td>
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {categoryLabels[person.category] || person.category}
                    </span>
                  </td>
                  <td>{person.phone || '—'}</td>
                  <td>{person.address || '—'}</td>
                  <td className="max-w-64 truncate">{person.externalId || '—'}</td>
                  <td className="max-w-64 truncate">{person.notes || '—'}</td>
                  <td>{formatDate(person.createdAt)}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(person)}
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-500"
                      >
                        <Edit3 size={16} />
                        تعديل
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(person)}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      >
                        <Info size={16} />
                        معلومات إضافية
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={9} className="text-center text-slate-500">
                    {loading ? 'جار التحميل...' : 'لا توجد نتائج'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {editingPerson ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={saveEdit}
            className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">تعديل بيانات الزبون</h2>
                <p className="mt-1 text-sm text-slate-500">{editingPerson.customerNo || ''}</p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق تعديل الزبون"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                value={editForm.fullName}
                onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })}
                placeholder="الاسم"
              />
              <input
                value={editForm.phone}
                onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
                placeholder="رقم الهاتف"
              />
              <input
                value={editForm.address}
                onChange={(event) => setEditForm({ ...editForm, address: event.target.value })}
                placeholder="العنوان"
              />
              <select
                value={editForm.category}
                onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}
              >
                <option value="REGULAR">عميل عادي</option>
                <option value="VIP">عميل مميز</option>
              </select>
              <textarea
                className="md:col-span-2"
                value={editForm.externalId}
                onChange={(event) => setEditForm({ ...editForm, externalId: event.target.value })}
                placeholder="معلومات إضافية"
                rows={3}
              />
              <textarea
                className="md:col-span-2"
                value={editForm.notes}
                onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                placeholder="ملاحظات"
                rows={3}
              />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400"
              >
                <Save size={18} />
                {saving ? 'جار الحفظ...' : 'حفظ التعديل'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
