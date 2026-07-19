'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

const categoryLabels: Record<string, string> = {
  VIP: 'عميل مميز',
  REGULAR: 'عميل عادي',
};

export default function PeopleClient({ initialPeople }: { initialPeople: any[] }) {
  const [items, setItems] = useState<any[]>(initialPeople);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    address: '',
    notes: '',
    category: 'REGULAR',
  });

  async function load(search = q) {
    setLoading(true);
    const response = await fetch(`/api/people?q=${encodeURIComponent(search)}`);
    const data = await response.json();
    setLoading(false);
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
    setForm({ fullName: '', phone: '', address: '', notes: '', category: 'REGULAR' });
    load('');
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
        <input
          className="md:col-span-2"
          placeholder="ملاحظات"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
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
                <th>تاريخ الإضافة</th>
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
                  <td>{new Date(person.createdAt).toLocaleDateString('ar')}</td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500">
                    {loading ? 'جار التحميل...' : 'لا توجد نتائج'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
