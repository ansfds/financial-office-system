'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import PersonEditor from './PersonEditor';
import CenteredDialog from './CenteredDialog';
import { formatDateTime, formatMoney } from '@/lib/format';
export default function PeopleClient({ initialPeople }: { initialPeople: any[] }) {
  const router = useRouter();
  const [people, setPeople] = useState(initialPeople),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<any>(undefined),
    [deleting, setDeleting] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q && page === 1) setPeople(initialPeople);
  }, [initialPeople, q, page]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/people?q=${encodeURIComponent(q)}&page=${page}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!r.ok) throw new Error('تعذر تحميل الزبائن');
        const result = await r.json();
        setPeople(result);
      } catch (e) {
        if (!controller.signal.aborted) toast.error((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, page, initialPeople]);
  async function remove() {
    if (busy || !deleting) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/people/${deleting.id}`, { method: 'DELETE' });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setPeople((current) => current.filter((p) => p.id !== deleting.id));
      setDeleting(null);
      toast.success('تم حذف الزبون وبياناته من الشغل مع حفظ الأرشيف');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          aria-label="بحث الزبائن"
          className="min-w-48 flex-1"
          placeholder="بحث بالاسم أو الهاتف الأساسي أو الثاني أو الكود"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <button onClick={() => setEditor(null)} className="rounded-lg border px-3 py-2 font-bold">
          + زبون جديد
        </button>
      </div>
      <div aria-busy={loading} className="table-wrap people-directory-table">
        <table>
          <colgroup>
            <col style={{ width: 180 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الهاتف</th>
              <th>الهاتف الثاني</th>
              <th>عدد البطاقات</th>
              <th>آخر تعامل</th>
              <th>لنا</th>
              <th>علينا</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr
                key={person.id}
                data-person-row={person.id}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('a,button')) router.push(`/people/${person.id}`);
                }}
                className="cursor-pointer"
              >
                <td>
                  <Link className="font-bold text-blue-700" href={`/people/${person.id}`}>
                    {person.customerNo} · {person.fullName}
                  </Link>
                </td>
                <td>
                  <bdi dir="ltr">{person.phone || '—'}</bdi>
                </td>
                <td>
                  <bdi dir="ltr">{person.phoneSecondary || '—'}</bdi>
                </td>
                <td>{person.cardSummary?.totalCards || 0}</td>
                <td className="text-xs">
                  {formatDateTime(person.cardSummary?.lastUpdate || person.createdAt)}
                </td>
                <td className="text-xs">
                  {(person.wallet || [])
                    .filter((w: any) => w.debt)
                    .map((w: any) => (
                      <div key={`${w.currency.id}:${w.paymentMethod}`}>
                        {w.label}: {formatMoney(w.debt, w.currency)}
                      </div>
                    ))}
                  {!(person.wallet || []).some((w: any) => w.debt) && '—'}
                </td>
                <td className="text-xs">
                  {(person.wallet || [])
                    .filter((w: any) => w.credit)
                    .map((w: any) => (
                      <div key={`${w.currency.id}:${w.paymentMethod}`}>
                        {w.label}: {formatMoney(w.credit, w.currency)}
                      </div>
                    ))}
                  {!(person.wallet || []).some((w: any) => w.credit) && '—'}
                </td>
                <td>
                  <div className="flex gap-3 text-sm">
                    <button onClick={() => setEditor(person)}>تعديل</button>
                    <button onClick={() => setDeleting(person)} className="text-red-700">
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!people.length && <p className="p-5 text-center text-sm text-slate-500">لا توجد نتائج.</p>}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-sm">
        <button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>
          السابق
        </button>
        <span>صفحة {page}</span>
        <button disabled={people.length < 100 || loading} onClick={() => setPage(page + 1)}>
          التالي
        </button>
      </div>
      {editor !== undefined && (
        <PersonEditor
          person={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            router.refresh();
          }}
        />
      )}
      {deleting && (
        <CenteredDialog
          name="delete-customer"
          title="تأكيد حذف الزبون"
          onClose={() => setDeleting(null)}
          busy={busy}
        >
          <p className="font-bold">{deleting.fullName}</p>
          <p>
            سيتم حذف الزبون و{deleting.cardSummary?.totalCards || 0} بطاقة و{deleting.transactionCount || 0}{' '}
            معاملة مرتبطة من بيانات العمل الظاهرة.
          </p>
          {(deleting.wallet || [])
            .filter((w: any) => w.debt || w.credit)
            .map((w: any) => (
              <p key={`${w.currency.id}:${w.paymentMethod}`}>
                {w.label}: لنا {formatMoney(w.debt, w.currency)} — علينا {formatMoney(w.credit, w.currency)}
              </p>
            ))}
          <p className="text-sm text-amber-700">
            تُؤرشف البيانات المرتبطة في عملية واحدة. تبقى حركات الصندوق التاريخية محفوظة حتى لا يتغير الرصيد
            النقدي بأثر رجعي.
          </p>
          <p>هل أنت متأكد؟</p>
          <div className="flex gap-4">
            <button disabled={busy} onClick={() => setDeleting(null)}>
              إلغاء
            </button>
            <button disabled={busy} onClick={remove} className="rounded-lg bg-red-700 px-4 py-2 text-white">
              {busy ? 'جار الحذف…' : 'تأكيد الحذف'}
            </button>
          </div>
        </CenteredDialog>
      )}
    </>
  );
}
